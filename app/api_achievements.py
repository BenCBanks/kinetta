"""Owner-only, worker-backed achievement track output."""
import datetime as dt
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import achievement_tracks as tracks, db, milestones as milestone_engine
from .auth import current_user


router = APIRouter(prefix='/api')
_CATALOG_TAIL_RULE = 'repeat last named level at integer multiples of its canonical threshold'


@lru_cache(maxsize=1)
def _level_catalog():
    path = Path(__file__).parent / 'static' / 'profile.achievement-levels.json'
    return json.loads(path.read_text(encoding='utf-8'))


def _canonical_threshold(level):
    try:
        value = float(level['canonical_value'])
    except (KeyError, TypeError, ValueError):
        return 0.0
    unit = level.get('canonical_unit')
    if unit == 'km':
        return round(value * 1000, 6)
    if unit == 'hours':
        return round(value * 3600, 6)
    return value


def _levels_through(definition, value):
    """Return named catalog levels and the tail that the lifetime value reached."""
    levels = []
    for rank, level in enumerate(definition.get('levels') or (), 1):
        threshold = _canonical_threshold(level)
        if threshold <= value:
            levels.append({'rank': rank, 'name': level['name'], 'threshold': threshold,
                           'quiet': bool(level.get('quiet')),
                           **({'trigger': level['trigger']} if level.get('trigger') else {})})
    fixed = definition.get('levels') or ()
    tail = _level_catalog().get('tail') or {}
    if fixed and tail.get('rule') == _CATALOG_TAIL_RULE:
        last = fixed[-1]
        base = _canonical_threshold(last)
        try:
            multiple = max(2, int(tail.get('first_multiple', 2)))
        except (TypeError, ValueError):
            multiple = 2
        while base > 0 and base * multiple <= value and len(levels) < 100_000:
            name = str(tail.get('name') or 'last_name ×N').replace('last_name', last['name']).replace('N', str(multiple))
            levels.append({'rank': len(levels) + 1, 'name': name,
                           'threshold': base * multiple, 'quiet': False})
            multiple += 1
    return levels


def _catalog_level(code, threshold=None, trigger=None):
    definition = _level_catalog().get('tracks', {}).get(code) or {}
    fixed = definition.get('levels') or ()
    if trigger:
        for rank, level in enumerate(fixed, 1):
            if level.get('trigger') == trigger:
                return {**level, 'rank': rank, 'threshold': _canonical_threshold(level)}
    if threshold is None:
        return None
    try:
        threshold = float(threshold)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(threshold):
        return None
    for rank, level in enumerate(fixed, 1):
        candidate = _canonical_threshold(level)
        if math.isclose(candidate, threshold, rel_tol=1e-12, abs_tol=1e-6):
            return {**level, 'rank': rank, 'threshold': candidate}
    for level in reversed(_levels_through(definition, threshold)):
        if math.isclose(level['threshold'], threshold, rel_tol=1e-12, abs_tol=1e-6):
            return {**fixed[-1], **level} if fixed else level
    return None


def _crossings(thresholds, rows, amount):
    """Find the first source row where each sorted threshold was reached."""
    targets = sorted(thresholds)
    found = {}
    total = 0.0
    index = 0
    for row in rows:
        try:
            delta = float(amount(row) or 0)
        except (TypeError, ValueError):
            delta = 0.0
        if not math.isfinite(delta) or delta < 0:
            delta = 0.0
        total += delta
        while index < len(targets) and targets[index] <= total:
            found[targets[index]] = row
            index += 1
    return total, found


def _max_crossings(thresholds, rows, amount):
    """Find the first row where a single-activity maximum crosses each tier."""
    targets = sorted(thresholds)
    found = {}
    maximum = 0.0
    for row in rows:
        try:
            maximum = max(maximum, float(amount(row) or 0))
        except (TypeError, ValueError):
            continue
        for threshold in targets:
            if threshold not in found and threshold <= maximum:
                found[threshold] = row
    return maximum, found


def _history_source(c, user_id, code, thresholds, now, zone):
    """Compute exact crossing dates from completed activities for one track."""
    rows = milestone_engine._completed_activity_rows(c, user_id, now)
    by_id = {row['id']: row for row in rows}
    if not rows:
        return 0.0, {}, by_id

    if code == 'consistency':
        total, found = milestone_engine._weeks_facts(rows, zone)
        return total, {threshold: found.get(threshold) for threshold in thresholds
                       if found.get(threshold) is not None}, by_id

    if code == 'years_active':
        start = rows[0]['start_time']
        total = milestone_engine._full_years(start, now, zone)
        found = {}
        for threshold in thresholds:
            years = int(threshold)
            if years <= 0 or years > total:
                continue
            anniversary = milestone_engine._anniversary(start, years, zone)
            row = next((item for item in rows if item['start_time'].astimezone(zone) >= anniversary), None)
            found[threshold] = {'row': row, 'day': anniversary.date(), 'activity_id': row.get('id') if row else None}
        return float(total), found, by_id

    volume = {}
    if code in ('lifted', 'sport:lift'):
        lift_rows = c.execute('''SELECT a.id,coalesce(sum(CASE WHEN s.done AND NOT s.warmup
                           THEN coalesce(s.kg,0)*coalesce(s.reps,0) ELSE 0 END),0) AS volume_kg
                         FROM activities a LEFT JOIN lift_sets s ON s.activity_id=a.id AND s.user_id=a.user_id
                         WHERE a.user_id=%s AND NOT a.lift_open AND a.start_time<=%s
                         GROUP BY a.id''', (user_id, now)).fetchall()
        volume = {row['id']: milestone_engine._number(row, 'volume_kg') for row in lift_rows}

    if code == 'lifted':
        subset = [row for row in rows if volume.get(row['id'], 0) > 0]
        total, found = _crossings(thresholds, subset, lambda row: volume.get(row['id'], 0))
    elif code == 'sport:lift':
        subset = [row for row in rows if row['sport'] == 'workout' or volume.get(row['id'], 0) > 0]
        total, found = _crossings(thresholds, subset, lambda _row: 1)
    elif code == 'personal_bests':
        events = milestone_engine._personal_best_events(c, user_id, by_id)
        total, found = _crossings(thresholds, events, lambda _row: 1)
    elif tracks.fastest_effort_spec(code):
        total, found, _best_seconds = milestone_engine._fastest_effort_facts(c, user_id, by_id, code)
    else:
        sport_by_code = {
            'sport:run': lambda row: row['sport'] == 'run',
            'sport:ride': lambda row: row['sport'] == 'ride',
            'sport:walk-hike': lambda row: row['sport'] in ('walk', 'hike'),
            'sport:swim': lambda row: row['sport'] == 'swim',
        }
        phase1 = tracks.sport_phase1_spec(code)
        if phase1:
            sport, family, _levels = phase1
            subset = [row for row in rows if (row['sport'] == sport if sport != 'walk-hike' else row['sport'] in ('walk', 'hike'))]
            if family == 'workouts':
                total, found = _crossings(thresholds, subset, lambda _row: 1)
            else:
                total, found = _max_crossings(thresholds, subset, lambda row: milestone_engine._number(row, 'distance_m'))
        elif code in sport_by_code:
            subset = [row for row in rows if sport_by_code[code](row)]
            total, found = _crossings(thresholds, subset, lambda row: milestone_engine._number(row, 'distance_m'))
        elif code == 'journey':
            total, found = _crossings(thresholds, rows, lambda row: milestone_engine._number(row, 'distance_m'))
        elif code == 'climbing':
            total, found = _crossings(thresholds, rows, lambda row: milestone_engine._number(row, 'ascent_m'))
        elif code == 'active_time':
            total, found = _crossings(thresholds, rows, lambda row: milestone_engine._number(row, 'moving_s') or milestone_engine._number(row, 'elapsed_s'))
        elif code == 'workouts':
            total, found = _crossings(thresholds, rows, lambda _row: 1)
        else:
            raise HTTPException(status_code=404, detail='Unknown achievement track')
    return total, found, by_id


def _legacy_history(c, user_id, code):
    """Read durable worker milestone dates to cover source activities later deleted."""
    rows = c.execute('''SELECT kind,activity_id,day,occurred,details
                        FROM milestones WHERE user_id=%s AND valid
                          AND kind IN ('track','first_distance','sport')
                        ORDER BY occurred,rank''', (user_id,)).fetchall()
    out = []
    for row in rows:
        details = row.get('details') or {}
        if details.get('track') == code:
            try:
                threshold = float(details.get('threshold'))
            except (TypeError, ValueError):
                continue
        elif row.get('kind') == 'first_distance' and _sport_code(details) == code:
            try:
                threshold = float(details.get('target_m'))
            except (TypeError, ValueError):
                continue
        elif row.get('kind') == 'sport' and _sport_code(details, include_quiet=True) == code:
            level = _catalog_level(code, trigger='first_activity')
            prior = tracks.legacy_starter_tier(code, trigger='first_activity')
            if level:
                threshold = level['threshold']
            elif prior:
                threshold = prior.threshold
            else:
                continue
        else:
            continue
        if math.isfinite(threshold) and threshold >= 0:
            out.append((threshold, row))
    return out


def _raw_value(code, details):
    if details.get('value') is not None:
        return details['value']
    for key in ('value_m', 'value_kg', 'value_s', 'value_weeks', 'value_years', 'value_sessions'):
        if details.get(key) is not None:
            return details[key]
    return 0


def _value_fields(code, value, units):
    shown, shown_unit = tracks.display_value(code, value, units)
    out = {'value': value, 'display_value': shown, 'display_unit': shown_unit}
    if code in ('journey', 'climbing', 'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim') or (tracks.sport_phase1_spec(code) and tracks.sport_phase1_spec(code)[1] == 'longest'):
        out['value_m'] = value
    elif code == 'lifted':
        out['value_kg'] = value
    elif code == 'active_time':
        out['value_s'] = value
    return out


def _tier(row, code, units):
    details = dict(row.get('details') or {})
    kind = row.get('kind')
    trigger = details.get('trigger')
    catalog_level = None
    if kind == 'sport':
        catalog_level = _catalog_level(code, trigger='first_activity')
        if catalog_level:
            trigger = 'first_activity'
    if kind == 'first_distance':
        threshold = details.get('target_m', _raw_value(code, details))
    else:
        threshold = details.get('threshold', _raw_value(code, details))
    try:
        threshold = float(threshold)
    except (TypeError, ValueError):
        threshold = 0.0
    if kind == 'sport' and catalog_level:
        threshold = catalog_level['threshold']
    if catalog_level is None:
        catalog_level = _catalog_level(code, threshold=threshold, trigger=trigger)
    legacy_level = None if catalog_level else tracks.legacy_starter_tier(
        code, threshold, trigger='first_activity' if kind == 'sport' else None)
    if kind == 'sport' and legacy_level:
        threshold = legacy_level.threshold
    rank = catalog_level.get('rank') if catalog_level else (0 if legacy_level else details.get('rank'))
    if not legacy_level and rank is None and str(row.get('code', '')).startswith(('track:', 'trackt:')):
        try:
            suffix = str(row['code']).rsplit(':', 1)[1]
            rank = int(suffix) if str(row['code']).startswith('track:') else None
        except (ValueError, IndexError):
            rank = row.get('rank', 0)
    rank = int(rank if rank is not None else row.get('rank', 0) or 0)
    label = ((catalog_level or {}).get('name') or (legacy_level.label if legacy_level else None)
             or details.get('label') or row.get('title') or '')
    unit = details.get('unit') or tracks.TRACK_UNITS.get(code, 'count')
    quiet = bool(legacy_level or details.get('quiet') or (catalog_level or {}).get('quiet')
                 or tracks.is_quiet_level(code, rank))
    trigger = trigger or (catalog_level or {}).get('trigger') or tracks.level_trigger(code, rank)
    details.update(track=code, rank=rank, threshold=threshold, label=label, unit=unit, quiet=quiet)
    if legacy_level:
        details['legacy'] = True
        details['legacy_rank'] = (row.get('details') or {}).get('rank')
        details.pop('trigger', None)
        trigger = None
    elif trigger:
        details['trigger'] = trigger
    rule = tracks.Tier(rank, threshold, label, unit, bool(details.get('big')))
    item = {
        'code': row['code'],
        'rank': rule.rank,
        'label': rule.label,
        'title': (rule.label if kind in ('track', 'sport') else row.get('title') or rule.label),
        'day': row.get('day'),
        'activity_id': row.get('activity_id'),
        'big': bool(rule.big and not quiet),
        'quiet': quiet,
        'threshold': threshold,
        'unit': rule.unit,
        'details': details,
    }
    if legacy_level:
        item['legacy'] = True
        if details.get('legacy_rank') is None:
            details.pop('legacy_rank', None)
    if trigger:
        item['trigger'] = trigger
    item.update({k: v for k, v in tracks.display_tier(code, rule, units).items()
                 if k in ('display_threshold', 'display_unit')})
    return item


def _legacy_history_tiers(code, legacy, activity_rows):
    """Expose saved starter awards separately from canonical earned levels."""
    reached = []
    seen = set()
    for threshold, row in legacy:
        prior = tracks.legacy_starter_tier(
            code, threshold,
            trigger='first_activity' if row.get('kind') == 'sport' else None)
        if not prior or prior.threshold in seen:
            continue
        seen.add(prior.threshold)
        activity_id = row.get('activity_id')
        if activity_id not in activity_rows:
            activity_id = None
        day = row.get('day')
        reached.append({
            'rank': 0,
            'name': prior.label,
            'threshold': prior.threshold,
            'day': day.isoformat() if hasattr(day, 'isoformat') else (str(day) if day else None),
            'activity_id': activity_id,
            'date_source': 'legacy',
            'legacy': True,
        })
    return reached


def _visible_achievement_profile(c, viewer_id, login):
    profile = c.execute('''SELECT u.id,p.units,p.tz,p.showcase_pins,p.share_achievements,
                                 p.share_achievements_since,
                                 (u.needs_email_confirm OR u.suspended_at IS NOT NULL) AS hidden
                          FROM users u JOIN profile p ON p.user_id=u.id
                          WHERE u.login=%s''', (login,)).fetchone()
    if not profile:
        return None
    owner_id = profile['id']
    if owner_id != viewer_id:
        relation = c.execute('''SELECT EXISTS(SELECT 1 FROM blocks b WHERE
                                   (b.user_id=%s AND b.blocked=%s) OR
                                   (b.user_id=%s AND b.blocked=%s)) AS blocked''',
                             (viewer_id, owner_id, owner_id, viewer_id)).fetchone()
        if (profile.get('hidden') or not profile.get('share_achievements') or
                not profile.get('share_achievements_since') or relation['blocked']):
            return None
    return owner_id, profile


_SHARED_TRACK_FIELDS = ('code','label','level','unit','tiers','day','earned_ranks')
_SHARED_TIER_FIELDS = ('rank','label','title','day','big','quiet','threshold','unit','trigger','legacy',
                       'display_threshold','display_unit')
_SHARED_DISTANCE_TRACKS = frozenset(('sport:run','sport:ride','sport:walk-hike','sport:swim',
                                     'sport:run:longest','sport:ride:longest','sport:walk-hike:longest','sport:swim:longest'))


def _shared_track_payload(track):
    level = int(track.get('level') or 0)
    legacy = [tier for tier in track.get('tiers') or ()
              if int(tier.get('rank') or 0) == 0 and tier.get('legacy') is True]
    if level < 1 and not legacy:
        return None
    result = {key: track[key] for key in _SHARED_TRACK_FIELDS if key in track}
    if level < 1:
        # An explicitly saved starter remains readable without exposing current
        # unearned progress or turning that history into a canonical level.
        result.pop('day', None)
        result['level'] = 0
        result['tiers'] = [{key: tier[key] for key in _SHARED_TIER_FIELDS if key in tier}
                           for tier in legacy]
        result['history'] = result['tiers']
        return result
    if track.get('code') in _SHARED_DISTANCE_TRACKS:
        result.update({key: track[key] for key in ('display_value','display_unit') if key in track})
    result['tiers'] = [{key: tier[key] for key in _SHARED_TIER_FIELDS if key in tier}
                       for tier in track.get('tiers') or ()]
    result['history'] = result['tiers']
    return result


def _sport_code(details, *, include_quiet=False):
    sport = details.get('sport')
    if sport in ('walk', 'hike'):
        code = 'sport:walk-hike'
    elif sport == 'workout':
        code = 'sport:lift'
    elif sport in ('run', 'ride', 'swim'):
        code = f'sport:{sport}'
    else:
        return None
    first = _catalog_level(code, trigger='first_activity')
    is_first_activity = details.get('target_m') is None
    if is_first_activity and (details.get('quiet') or (first and first.get('quiet'))
                              or code in tracks.LEGACY_FIRST_ACTIVITY_LABELS) and not include_quiet:
        return None
    return code


@router.get('/achievements')
def achievements(login: str | None = Query(None, min_length=1, max_length=60), user=Depends(current_user)):
    """Return only rows materialised by the private milestone worker.

    There is intentionally no activity query here.  A dirty account may have
    ``pending=true`` while the worker finishes a scan; the last computed track
    state is still safe to render.
    """
    with db.connect() as c:
        if login:
            visible = _visible_achievement_profile(c, user['id'], login)
            if not visible:
                return {'tracks': [], 'pending': False}
            owner_id, profile = visible
            shared_view = owner_id != user['id']
        else:
            owner_id = user['id']
            shared_view = False
            profile = c.execute('SELECT units FROM profile WHERE user_id=%s', (owner_id,)).fetchone() or {}
        pending = bool((c.execute('''SELECT generation>processed OR next_check<=now() AS pending
                                     FROM milestone_state WHERE user_id=%s''', (owner_id,)).fetchone() or {}).get('pending', False))
        units = profile.get('units') or 'imperial'
        states = c.execute('''SELECT code,title,day,occurred,details
                              FROM milestones WHERE user_id=%s AND kind='track_state' AND valid
                              ORDER BY code''', (owner_id,)).fetchall()
        rows = c.execute('''SELECT code,kind,title,rank,activity_id,day,occurred,details
                            FROM milestones WHERE user_id=%s AND kind='track' AND valid
                            ORDER BY code,rank,occurred''', (owner_id,)).fetchall()
        firsts = c.execute('''SELECT code,kind,title,rank,activity_id,day,occurred,details
                              FROM milestones WHERE user_id=%s AND kind IN ('sport','first_distance') AND valid
                              ORDER BY occurred,rank''', (owner_id,)).fetchall()

    tiers_by_track = {}
    for row in rows:
        code = (row.get('details') or {}).get('track')
        if code:
            tiers_by_track.setdefault(code, []).append(_tier(row, code, units))
    # Existing first-activity rows remain readable as legacy awards. They do
    # not become a canonical level or shift the track's current rank.
    for row in firsts:
        details = row.get('details') or {}
        code = _sport_code(details, include_quiet=True)
        if code:
            item = _tier(row, code, units)
            item['big'] = True
            tiers_by_track.setdefault(code, []).append(item)

    out = []
    for row in states:
        details = dict(row.get('details') or {})
        code = details.get('track')
        if not code:
            continue
        value = _raw_value(code, details)
        try:
            value = float(value)
        except (TypeError, ValueError):
            value = 0.0
        track_tiers = tiers_by_track.get(code, [])
        catalog = _level_catalog().get('tracks', {}).get(code, {})
        current_levels = _levels_through(catalog, value)
        if tracks.fastest_effort_spec(code):
            earned_ranks = sorted({int(rank) for rank in details.get('earned_ranks', ())
                                   if str(rank).lstrip('-').isdigit()
                                   and 1 <= int(rank) <= len(catalog.get('levels') or ())})
            level = max(earned_ranks, default=0)
        else:
            earned_ranks = []
            level = max((item['rank'] for item in current_levels), default=0)
        has_first_activity = any(item.get('trigger') == 'first_activity' for item in track_tiers)
        if has_first_activity:
            level = max(level, 1)
        next_value = 1.0 if has_first_activity and code in {
            'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim'
        } and value < 1.0 else value
        next_rule = None if tracks.fastest_effort_spec(code) else tracks.next_tier(code, next_value)
        current = {
            'code': code,
            'label': details.get('label') or tracks.track_label(code),
            'level': level,
            'unit': details.get('unit') or tracks.TRACK_UNITS.get(code, 'count'),
            'tiers': sorted(track_tiers, key=lambda x: (x.get('rank') or 0, x.get('day') or dt.date.min)),
            'day': row.get('day'),
        }
        current.update(_value_fields(code, value, units))
        if tracks.fastest_effort_spec(code):
            current['earned_ranks'] = earned_ranks
            current['best_seconds'] = details.get('best_seconds') or {}
        if next_rule:
            next_item = tracks.display_tier(code, next_rule, units)
            current['next_threshold'] = next_rule.threshold
            current['next_label'] = next_rule.label
            current['next'] = {
                'threshold': next_rule.threshold,
                'label': next_rule.label,
                'unit': next_rule.unit,
                'big': next_rule.big,
                'quiet': tracks.is_quiet_level(code, next_rule.rank),
                'display_threshold': next_item['display_threshold'],
                'display_unit': next_item['display_unit'],
            }
        current['history'] = current['tiers']
        out.append(current)
    if shared_view:
        out = [shared for row in out if (shared := _shared_track_payload(row))]
        pending = False
    return {'tracks': out, 'pending': pending}


SHOWCASE_MAX = 4


class ShowcasePinUpdate(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    pinned: bool


class ShowcasePinsUpdate(BaseModel):
    pinned: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(max_length=SHOWCASE_MAX)


def _showcase_pins(value):
    known = set(_level_catalog().get('tracks', {}))
    pins = []
    for code in value if isinstance(value, (list, tuple)) else ():
        if isinstance(code, str) and code in known and code not in pins:
            pins.append(code)
        if len(pins) >= SHOWCASE_MAX:
            break
    return pins


def _timestamp(value):
    if isinstance(value, dt.datetime):
        return value.timestamp()
    try:
        return dt.datetime.fromisoformat(str(value)).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0


def _showcase_candidates(c, user_id, units):
    """Return each currently reached catalog level, with its latest earning time."""
    states = c.execute('''SELECT occurred,details FROM milestones
                         WHERE user_id=%s AND kind='track_state' AND valid ORDER BY code''',
                       (user_id,)).fetchall()
    rows = c.execute('''SELECT code,kind,rank,activity_id,day,occurred,details FROM milestones
                        WHERE user_id=%s AND valid AND kind IN ('track','sport','first_distance')
                        ORDER BY occurred,rank''', (user_id,)).fetchall()
    events = {}
    for row in rows:
        details = row.get('details') or {}
        if row.get('kind') == 'track':
            code = details.get('track')
        else:
            code = _sport_code(details, include_quiet=True)
        if code not in _level_catalog().get('tracks', {}):
            continue
        tier = _tier(row, code, units)
        events.setdefault(code, []).append({
            'rank': tier['rank'],
            'trigger': tier['details'].get('trigger'),
            'occurred': row.get('occurred'),
        })

    candidates = {}
    catalog = _level_catalog().get('tracks', {})
    for state in states:
        details = dict(state.get('details') or {})
        code = details.get('track')
        definition = catalog.get(code)
        if not definition:
            continue
        try:
            value = float(_raw_value(code, details))
        except (TypeError, ValueError):
            value = 0.0
        if not math.isfinite(value) or value < 0:
            value = 0.0
        if tracks.fastest_effort_spec(code):
            earned_ranks = sorted({int(rank) for rank in details.get('earned_ranks', ())
                                   if str(rank).lstrip('-').isdigit()
                                   and 1 <= int(rank) <= len(definition.get('levels') or ())})
            level = max(earned_ranks, default=0)
        else:
            earned_ranks = []
            level = max((item['rank'] for item in _levels_through(definition, value)), default=0)
        track_events = events.get(code, [])
        first_activity = any(item['trigger'] == 'first_activity' for item in track_events)
        if first_activity:
            level = max(level, 1)
        if level < 1:
            continue
        current_events = [item for item in track_events if item['rank'] == level]
        occurred = max(current_events, key=lambda item: _timestamp(item.get('occurred'))).get('occurred') if current_events else state.get('occurred')
        candidates[code] = {'code': code, 'rank': level, 'occurred': occurred}
    return candidates


def _showcase_payload(c, owner_id, profile, include_available=False):
    pins = _showcase_pins(profile.get('showcase_pins'))
    candidates = _showcase_candidates(c, owner_id, profile.get('units') or 'imperial')
    by_code = candidates
    if pins:
        selected = [by_code[code] for code in pins if code in by_code]
    else:
        selected = sorted(candidates.values(), key=lambda item: (-item['rank'], -_timestamp(item['occurred']), item['code']))[:SHOWCASE_MAX]
    result = {'items': [{'code': item['code'], 'rank': item['rank']} for item in selected], 'pinned': pins}
    if include_available:
        result['available'] = [{'code': code, 'rank': candidates[code]['rank']} for code in sorted(candidates)]
    return result


def _day_streak(c, user_id, tz, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    zone = ZoneInfo(db.valid_tz(tz) or db.DEFAULT_TZ)
    today = now.astimezone(zone).date()
    days = sorted({row['start_time'].astimezone(zone).date()
                   for row in milestone_engine._completed_activity_rows(c, user_id, now)}, reverse=True)
    if not days or days[0] < today - dt.timedelta(days=1):
        return 0
    expected = days[0]
    streak = 0
    for day in days:
        if day != expected:
            break
        streak += 1
        expected -= dt.timedelta(days=1)
    return streak


def _empty_showcase():
    return {'items': [], 'pinned': [], 'day_streak': 0}


@router.get('/achievements/showcase')
def achievement_showcase(login: str | None = Query(None, min_length=1, max_length=60), user=Depends(current_user)):
    """Return the owner's Showcase to an opted-in signed-in viewer, unless blocked or hidden."""
    with db.connect() as c:
        if login:
            visible = _visible_achievement_profile(c, user['id'], login)
            if not visible:
                return _empty_showcase()
            owner_id, profile = visible
        else:
            owner_id = user['id']
            profile = c.execute('''SELECT units,tz,showcase_pins FROM profile WHERE user_id=%s''',
                                (owner_id,)).fetchone()
            if not profile:
                return _empty_showcase()
        result = _showcase_payload(c, owner_id, profile, include_available=owner_id == user['id'])
        result['day_streak'] = _day_streak(c, owner_id, profile.get('tz'))
        return result


@router.post('/achievements/showcase/pin')
def update_showcase_pin(body: ShowcasePinUpdate, user=Depends(current_user)):
    code = body.code.strip()
    if code not in _level_catalog().get('tracks', {}):
        raise HTTPException(400, 'Unknown achievement track')
    with db.connect() as c:
        profile = c.execute('''SELECT units,showcase_pins FROM profile WHERE user_id=%s FOR UPDATE''',
                             (user['id'],)).fetchone()
        if not profile:
            raise HTTPException(404, 'Profile not found')
        candidates = _showcase_candidates(c, user['id'], profile.get('units') or 'imperial')
        pins = [item for item in _showcase_pins(profile.get('showcase_pins')) if item in candidates]
        if body.pinned:
            if code not in candidates:
                raise HTTPException(409, 'Earn the medal before pinning it')
            replaced = code not in pins and len(pins) >= SHOWCASE_MAX
            if code not in pins:
                if replaced:
                    pins.pop(0)
                pins.append(code)
        else:
            replaced = False
            pins = [item for item in pins if item != code]
        c.execute('UPDATE profile SET showcase_pins=%s WHERE user_id=%s', (pins, user['id']))
    return {'pinned': pins, 'replaced': replaced}


@router.put('/achievements/showcase/pins')
def update_showcase_pins(body: ShowcasePinsUpdate, user=Depends(current_user)):
    pins = [code.strip() for code in body.pinned]
    if len(pins) > SHOWCASE_MAX:
        raise HTTPException(400, 'Choose up to four achievements')
    if len(pins) != len(set(pins)):
        raise HTTPException(400, 'Choose each achievement only once')
    if any(code not in _level_catalog().get('tracks', {}) for code in pins):
        raise HTTPException(400, 'Unknown achievement track')
    with db.connect() as c:
        profile = c.execute('SELECT units FROM profile WHERE user_id=%s FOR UPDATE', (user['id'],)).fetchone()
        if not profile:
            raise HTTPException(404, 'Profile not found')
        candidates = _showcase_candidates(c, user['id'], profile.get('units') or 'imperial')
        if any(code not in candidates for code in pins):
            raise HTTPException(409, 'Earn each achievement before featuring it')
        c.execute('UPDATE profile SET showcase_pins=%s WHERE user_id=%s', (pins, user['id']))
    return {'pinned': pins}


@router.get('/achievement-history/{code}')
def achievement_history(code: str, login: str | None = Query(None, min_length=1, max_length=60), user=Depends(current_user)):
    """Return earned catalog levels to the owner or an eligible signed-in viewer."""
    definition = _level_catalog().get('tracks', {}).get(code)
    if not definition:
        raise HTTPException(status_code=404, detail='Unknown achievement track')

    now = dt.datetime.now(dt.timezone.utc)
    with db.connect() as c:
        if login:
            visible = _visible_achievement_profile(c, user['id'], login)
            if not visible:
                return {'code': code, 'tiers': [], 'pending': False}
            owner_id, profile = visible
            shared_view = owner_id != user['id']
        else:
            owner_id = user['id']
            shared_view = False
            profile = c.execute('SELECT tz FROM profile WHERE user_id=%s', (owner_id,)).fetchone() or {}
        zone = ZoneInfo(db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ)
        state = c.execute('''SELECT details FROM milestones
                             WHERE user_id=%s AND code=%s AND kind='track_state' AND valid''',
                          (owner_id, f'track-state:{code}')).fetchone()
        details = dict((state or {}).get('details') or {})
        try:
            value = max(0.0, float(_raw_value(code, details)))
        except (TypeError, ValueError):
            value = 0.0
        if not math.isfinite(value):
            value = 0.0
        pending = bool((c.execute('''SELECT generation>processed OR next_check<=now() AS pending
                                     FROM milestone_state WHERE user_id=%s''', (owner_id,)).fetchone() or {}).get('pending', False))
        if tracks.fastest_effort_spec(code):
            levels = [{'rank': rank, 'name': level['name'], 'threshold': float(rank),
                       'quiet': bool(level.get('quiet'))}
                      for rank, level in enumerate(definition.get('levels') or (), 1)]
        else:
            levels = _levels_through(definition, value)
        thresholds = [level['threshold'] for level in levels]
        _total, crossings, activity_rows = _history_source(c, owner_id, code, thresholds, now, zone)
        legacy = _legacy_history(c, owner_id, code)

    first_level = next(((rank, level) for rank, level in enumerate(definition.get('levels') or (), 1)
                        if code in ('sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim')
                        and level.get('trigger') == 'first_activity'), None)
    first_event = None
    if first_level:
        first_rank, first_definition = first_level
        first_threshold = _canonical_threshold(first_definition)
        first_event = next((row for old_threshold, row in legacy
                            if row.get('kind') == 'sport'
                            and math.isclose(old_threshold, first_threshold, rel_tol=1e-12, abs_tol=1e-6)), None)
        if first_event:
            levels = [level for level in levels if level['rank'] != first_rank]
            levels.append({'rank': first_rank, 'name': first_definition['name'],
                           'threshold': first_threshold, 'quiet': bool(first_definition.get('quiet')),
                           'trigger': 'first_activity'})
            levels.sort(key=lambda level: level['rank'])

    reached = []
    for level in levels:
        threshold = level['threshold']
        is_first_activity = (code in ('sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim')
                             and level.get('trigger') == 'first_activity')
        event = first_event if is_first_activity else crossings.get(threshold)
        source = ('activity' if event and event.get('activity_id') in activity_rows else 'legacy') if is_first_activity else 'activity'
        if is_first_activity and event is None:
            continue
        if event is None:
            # The worker retains milestones after an activity is removed. The
            # nearest later legacy threshold proves the v2 level was reached
            # and keeps its saved date when the original source is unavailable.
            candidates = [(old_threshold, row) for old_threshold, row in legacy
                          if old_threshold >= threshold]
            if candidates:
                _old_threshold, event = min(candidates, key=lambda item: item[0])
                source = 'legacy'
            else:
                continue

        if 'row' in event and 'day' in event:
            row = event.get('row') or {}
            day = event.get('day')
            activity_id = event.get('activity_id')
        else:
            row = event
            day = row.get('day')
            if day is None and row.get('start_time'):
                day = row['start_time'].astimezone(zone).date()
            activity_id = row.get('activity_id') or row.get('id')
        if activity_id not in activity_rows:
            activity_id = None
        reached.append({
            'rank': level['rank'],
            'name': level['name'],
            'threshold': threshold,
            'day': day.isoformat() if hasattr(day, 'isoformat') else (str(day) if day else None),
            'activity_id': activity_id,
            'date_source': source,
        })
    reached.extend(_legacy_history_tiers(code, legacy, activity_rows))
    reached.sort(key=lambda tier: (tier['rank'], tier['threshold']))
    if shared_view:
        reached = [{key: tier[key] for key in ('rank','name','threshold','day','legacy') if key in tier}
                   for tier in reached]
        pending = False
    return {'code': code, 'tiers': reached, 'pending': pending}

