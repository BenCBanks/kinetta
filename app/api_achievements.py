"""Owner-only, worker-backed achievement track output."""
import datetime as dt
import json
import math
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from . import achievement_tracks as tracks, db, milestones as milestone_engine
from .auth import current_user


router = APIRouter(prefix='/api')


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
        return value * 1000
    if unit == 'hours':
        return value * 3600
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
    if fixed and tail.get('rule') == 'repeat last named level at integer multiples':
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
    else:
        sport_by_code = {
            'sport:run': lambda row: row['sport'] == 'run',
            'sport:ride': lambda row: row['sport'] == 'ride',
            'sport:walk-hike': lambda row: row['sport'] in ('walk', 'hike'),
            'sport:swim': lambda row: row['sport'] == 'swim',
        }
        if code in sport_by_code:
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
            if not level:
                continue
            threshold = level['threshold']
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
    if code in ('journey', 'climbing', 'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim'):
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
    rank = catalog_level.get('rank') if catalog_level else details.get('rank')
    if rank is None and str(row.get('code', '')).startswith(('track:', 'trackt:')):
        try:
            suffix = str(row['code']).rsplit(':', 1)[1]
            rank = int(suffix) if str(row['code']).startswith('track:') else None
        except (ValueError, IndexError):
            rank = row.get('rank', 0)
    rank = int(rank if rank is not None else row.get('rank', 0) or 0)
    label = (catalog_level or {}).get('name') or details.get('label') or row.get('title') or ''
    unit = details.get('unit') or tracks.TRACK_UNITS.get(code, 'count')
    quiet = bool(details.get('quiet') or (catalog_level or {}).get('quiet') or tracks.is_quiet_level(code, rank))
    trigger = trigger or (catalog_level or {}).get('trigger') or tracks.level_trigger(code, rank)
    details.update(track=code, rank=rank, threshold=threshold, label=label, unit=unit, quiet=quiet)
    if trigger:
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
    if trigger:
        item['trigger'] = trigger
    item.update({k: v for k, v in tracks.display_tier(code, rule, units).items()
                 if k in ('display_threshold', 'display_unit')})
    return item


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
    if is_first_activity and (details.get('quiet') or (first and first.get('quiet'))) and not include_quiet:
        return None
    return code


@router.get('/achievements')
def achievements(user=Depends(current_user)):
    """Return only rows materialised by the private milestone worker.

    There is intentionally no activity query here.  A dirty account may have
    ``pending=true`` while the worker finishes a scan; the last computed track
    state is still safe to render.
    """
    with db.connect() as c:
        pending = bool((c.execute('''SELECT generation>processed OR next_check<=now() AS pending
                                     FROM milestone_state WHERE user_id=%s''', (user['id'],)).fetchone() or {}).get('pending', False))
        profile = c.execute('SELECT units FROM profile WHERE user_id=%s', (user['id'],)).fetchone() or {}
        units = profile.get('units') or 'imperial'
        states = c.execute('''SELECT code,title,day,occurred,details
                              FROM milestones WHERE user_id=%s AND kind='track_state' AND valid
                              ORDER BY code''', (user['id'],)).fetchall()
        rows = c.execute('''SELECT code,title,rank,activity_id,day,occurred,details
                            FROM milestones WHERE user_id=%s AND kind='track' AND valid
                            ORDER BY code,rank,occurred''', (user['id'],)).fetchall()
        firsts = c.execute('''SELECT code,title,rank,activity_id,day,occurred,details
                              FROM milestones WHERE user_id=%s AND kind IN ('sport','first_distance') AND valid
                              ORDER BY occurred,rank''', (user['id'],)).fetchall()

    tiers_by_track = {}
    for row in rows:
        code = (row.get('details') or {}).get('track')
        if code:
            tiers_by_track.setdefault(code, []).append(_tier(row, code, units))
    # Existing First rows are worker output too.  Include them in the matching
    # sport track so the new profile can show the familiar First 5K/First run
    # history without recomputing bests in this request.
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
        level = max((item['rank'] for item in current_levels), default=0)
        has_first_activity = any(item.get('trigger') == 'first_activity' for item in track_tiers)
        if has_first_activity:
            level = max(level, 1)
        next_value = 1.0 if has_first_activity and code in {
            'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim'
        } and value < 1.0 else value
        next_rule = tracks.next_tier(code, next_value)
        current = {
            'code': code,
            'label': details.get('label') or tracks.track_label(code),
            'level': level,
            'unit': details.get('unit') or tracks.TRACK_UNITS.get(code, 'count'),
            'tiers': sorted(track_tiers, key=lambda x: (x.get('rank') or 0, x.get('day') or dt.date.min)),
            'day': row.get('day'),
        }
        current.update(_value_fields(code, value, units))
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
    return {'tracks': out, 'pending': pending}


@router.get('/achievement-history/{code}')
def achievement_history(code: str, user=Depends(current_user)):
    """Return named catalog levels with their first-crossing dates for the signed-in owner."""
    definition = _level_catalog().get('tracks', {}).get(code)
    if not definition:
        raise HTTPException(status_code=404, detail='Unknown achievement track')

    now = dt.datetime.now(dt.timezone.utc)
    with db.connect() as c:
        profile = c.execute('SELECT tz FROM profile WHERE user_id=%s', (user['id'],)).fetchone() or {}
        zone = ZoneInfo(db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ)
        state = c.execute('''SELECT details FROM milestones
                             WHERE user_id=%s AND code=%s AND kind='track_state' AND valid''',
                          (user['id'], f'track-state:{code}')).fetchone()
        details = dict((state or {}).get('details') or {})
        try:
            value = max(0.0, float(_raw_value(code, details)))
        except (TypeError, ValueError):
            value = 0.0
        if not math.isfinite(value):
            value = 0.0
        pending = bool((c.execute('''SELECT generation>processed OR next_check<=now() AS pending
                                     FROM milestone_state WHERE user_id=%s''', (user['id'],)).fetchone() or {}).get('pending', False))
        levels = _levels_through(definition, value)
        thresholds = [level['threshold'] for level in levels]
        _total, crossings, activity_rows = _history_source(c, user['id'], code, thresholds, now, zone)
        legacy = _legacy_history(c, user['id'], code)

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
    return {'code': code, 'tiers': reached, 'pending': pending}

