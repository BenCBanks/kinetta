"""Owner-only, worker-backed achievement track output."""
import datetime as dt

from fastapi import APIRouter, Depends

from . import achievement_tracks as tracks, db
from .auth import current_user


router = APIRouter(prefix='/api')


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
    threshold = details.get('threshold', _raw_value(code, details))
    try:
        threshold = float(threshold)
    except (TypeError, ValueError):
        threshold = 0.0
    rule = tracks.Tier(int(details.get('rank', row.get('rank', 0)) or 0), threshold,
                       details.get('label') or row.get('title') or '',
                       details.get('unit') or tracks.TRACK_UNITS.get(code, 'count'),
                       bool(details.get('big')))
    item = {
        'code': row['code'],
        'rank': row.get('rank'),
        'label': rule.label,
        'title': row.get('title') or rule.label,
        'day': row.get('day'),
        'activity_id': row.get('activity_id'),
        'big': rule.big,
        'threshold': threshold,
        'unit': rule.unit,
        'details': details,
    }
    item.update({k: v for k, v in tracks.display_tier(code, rule, units).items()
                 if k in ('display_threshold', 'display_unit')})
    return item


def _sport_code(details):
    sport = details.get('sport')
    if sport in ('walk', 'hike'):
        return 'sport:walk-hike'
    if sport == 'workout':
        return 'sport:lift'
    return f'sport:{sport}' if sport in ('run', 'ride', 'swim') else None


@router.get('/achievements')
def achievements(user=Depends(current_user)):
    """Return only rows materialised by the private milestone worker.

    There is intentionally no activity query here.  A dirty account may have
    ``pending=true`` while the worker finishes a scan; the last computed track
    state is still safe to render.
    """
    with db.connect() as c:
        pending = bool(c.execute('''SELECT generation>processed OR next_check<=now() AS pending
                                    FROM milestone_state WHERE user_id=%s''', (user['id'],)).fetchone() or {}).get('pending', False)
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
        code = _sport_code(details)
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
        next_rule = tracks.next_tier(code, value)
        current = {
            'code': code,
            'label': details.get('label') or tracks.track_label(code),
            'level': int(details.get('level', 0) or 0),
            'unit': details.get('unit') or tracks.TRACK_UNITS.get(code, 'count'),
            'tiers': sorted(tiers_by_track.get(code, []), key=lambda x: (x.get('rank') or 0, x.get('day') or dt.date.min)),
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
                'display_threshold': next_item['display_threshold'],
                'display_unit': next_item['display_unit'],
            }
        current['history'] = current['tiers']
        out.append(current)
    return {'tracks': out, 'pending': pending}

