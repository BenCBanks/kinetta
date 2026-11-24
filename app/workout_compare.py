"""On-demand, app-computed comparison of one workout with similar own workouts."""
import math
from statistics import median

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import coach, db, health_copy
from .auth import current_user

router = APIRouter()


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    activity_id: int = Field(gt=0, strict=True)


CONSENTS_SQL = """SELECT coalesce(health_ai_ok,false) AS health_ok,
    coalesce(garmin_ai_ok,false) AS garmin_ok FROM profile WHERE user_id=%s"""

ACTIVITY_SQL = """SELECT id,user_id,sport,source,healthkit_id,start_time,distance_m,moving_s,
    ascent_m,avg_hr,avg_temp,route_id FROM activities WHERE id=%s AND user_id=%s"""

BASELINE_SQL = """SELECT id,user_id,sport,source,healthkit_id,start_time,distance_m,moving_s,
    ascent_m,avg_hr,avg_temp,route_id FROM activities
    WHERE user_id=%s AND sport=%s AND id<>%s
      AND start_time >= %s - interval '120 days' AND start_time < %s
      AND distance_m > 0 AND moving_s > 0
      AND distance_m BETWEEN %s * 0.8 AND %s * 1.2
      AND (NOT (source='healthkit' OR healthkit_id IS NOT NULL) OR %s)
      AND (source<>'garmin_connect' OR %s)
    ORDER BY start_time DESC,id DESC LIMIT 5"""

LONGEST_SQL = """SELECT max(distance_m) AS distance_m FROM activities
    WHERE user_id=%s AND sport=%s AND id<>%s
      AND start_time >= %s - interval '90 days' AND start_time < %s
      AND distance_m > 0
      AND (NOT (source='healthkit' OR healthkit_id IS NOT NULL) OR %s)
      AND (source<>'garmin_connect' OR %s)"""

PERSONAL_RECORD_SQL = "SELECT 1 FROM best_efforts WHERE user_id=%s AND activity_id=%s LIMIT 1"


def _health_activity(activity):
    return activity['source'] == 'healthkit' or activity.get('healthkit_id') is not None


def _source_allowed(activity, consents):
    if _health_activity(activity):
        return consents['health_ok']
    if activity['source'] == 'garmin_connect':
        return consents['garmin_ok']
    return True


def _number(value):
    if value is None:
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _metrics(activity):
    distance = _number(activity.get('distance_m'))
    moving = _number(activity.get('moving_s'))
    sport = activity['sport']
    pace = moving / (distance / 1000) if sport in ('run', 'walk', 'hike') and distance and moving and distance > 0 and moving > 0 else None
    speed = distance / moving if sport not in ('run', 'walk', 'hike') and distance and moving and distance > 0 and moving > 0 else None
    return {
        'distance_m': distance,
        'moving_s': moving,
        'pace_s_per_km': pace,
        'speed_mps': speed,
        'avg_hr': _number(activity.get('avg_hr')),
        'ascent_m': _number(activity.get('ascent_m')),
        'avg_temp_c': _number(activity.get('avg_temp')),
    }


def _comparison(c, uid, activity, consents):
    current = _metrics(activity)
    if activity['sport'] == 'workout':
        return {'status': 'summary_only', 'current': current, 'baseline_count': 0,
                'baseline_medians': {}, 'deltas': {}, 'relations': {}, 'notable': 'none', 'same_route_count': 0}

    distance = current['distance_m']
    if not distance or distance <= 0 or not current['moving_s'] or current['moving_s'] <= 0:
        rows = []
    else:
        rows = c.execute(BASELINE_SQL, (
            uid, activity['sport'], activity['id'], activity['start_time'], activity['start_time'],
            distance, distance, consents['health_ok'], consents['garmin_ok'],
        )).fetchall()

    count = len(rows)
    same_route_count = sum(1 for row in rows if activity.get('route_id') is not None and row.get('route_id') == activity['route_id'])
    if count < 2:
        return {'status': 'not_enough_similar', 'current': current, 'baseline_count': count,
                'baseline_medians': {}, 'deltas': {}, 'relations': {}, 'notable': 'none', 'same_route_count': same_route_count}

    metric_names = ('pace_s_per_km', 'speed_mps', 'avg_hr', 'ascent_m', 'avg_temp_c')
    baseline_metrics = [_metrics(row) for row in rows]
    medians = {}
    deltas = {}
    for name in metric_names:
        available = [metric[name] for metric in baseline_metrics if metric[name] is not None]
        if available and current[name] is not None:
            medians[name] = median(available)
            deltas[name] = current[name] - medians[name]

    relations = {}
    if 'pace_s_per_km' in deltas:
        delta = deltas['pace_s_per_km']
        relations['pace_s_per_km'] = 'about_the_same' if abs(delta) <= 5 else ('slower' if delta > 0 else 'faster')
    if 'avg_hr' in deltas:
        delta = deltas['avg_hr']
        relations['avg_hr'] = 'about_the_same' if abs(delta) <= 2 else ('higher' if delta > 0 else 'lower')

    notable = 'none'
    if c.execute(PERSONAL_RECORD_SQL, (uid, activity['id'])).fetchone():
        notable = 'personal_record'
    longest = c.execute(LONGEST_SQL, (
        uid, activity['sport'], activity['id'], activity['start_time'], activity['start_time'],
        consents['health_ok'], consents['garmin_ok'],
    )).fetchone()['distance_m']
    if notable == 'none' and distance is not None and (longest is None or distance > float(longest)):
        notable = 'longest_90d'
    elif notable == 'none':
        climb_rates = [
            _number(row.get('ascent_m')) / _number(row.get('distance_m'))
            for row in rows if _number(row.get('ascent_m')) is not None
            and _number(row.get('distance_m')) and _number(row.get('distance_m')) > 0
        ]
        if current['ascent_m'] is not None and climb_rates and current['ascent_m'] / distance > median(climb_rates):
            notable = 'hillier'

    return {'status': 'compared', 'current': current, 'baseline_count': count,
            'baseline_medians': medians, 'deltas': deltas, 'relations': relations, 'notable': notable,
            'same_route_count': same_route_count}


@router.post('/api/kit/workout-compare')
def compare(body: CompareRequest, user=Depends(current_user)):
    uid = user['id']
    with db.coach_connect(uid) as c:
        consents = c.execute(CONSENTS_SQL, (uid,)).fetchone() or {'health_ok': False, 'garmin_ok': False}
        activity = c.execute(ACTIVITY_SQL, (body.activity_id, uid)).fetchone()
        if activity is None:
            raise HTTPException(404, 'Workout not found.')
        if not _source_allowed(activity, consents):
            raise HTTPException(403, health_copy.user_message(coach.HEALTH_NO))
        return _comparison(c, uid, activity, consents)
