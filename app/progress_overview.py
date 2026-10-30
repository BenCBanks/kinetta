"""Small private discovery facts. No friends, AI, writes or new storage."""
import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from . import db, energy, plans
from .auth import current_user

router = APIRouter(prefix='/api/progress')


@router.get('/overview')
def overview(user=Depends(current_user)):
    uid = user['id']
    with db.connect() as c:
        profile = c.execute('SELECT tz, protein_target, food_reminders FROM profile WHERE user_id=%s', (uid,)).fetchone() or {}
        tz = db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ
        today = dt.datetime.now(ZoneInfo(tz)).date()
        week = today - dt.timedelta(days=today.weekday())
        counts = c.execute('''SELECT count(*) AS activities,
            count(*) FILTER (WHERE geom IS NOT NULL) AS mapped,
            count(DISTINCT (start_time AT TIME ZONE %s)::date) FILTER
              (WHERE (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s) AS active_days,
            count(DISTINCT date_trunc('year', start_time AT TIME ZONE %s)) AS years
            FROM activities WHERE user_id=%s AND NOT lift_open AND start_time<%s''',
            (tz, tz, today.replace(day=1), today, tz, uid,
             dt.datetime.combine(today + dt.timedelta(days=1), dt.time.min, ZoneInfo(tz)))).fetchone()
        routes = c.execute('''SELECT count(*) AS n FROM
            (SELECT route_id FROM activities WHERE user_id=%s AND route_id IS NOT NULL
             AND NOT lift_open GROUP BY route_id HAVING count(*)>1) x''', (uid,)).fetchone()['n']
        segments = c.execute('''SELECT count(DISTINCT e.segment_id) AS n FROM segment_efforts e
            JOIN segments s ON s.id=e.segment_id WHERE e.user_id=%s AND e.state='ok'
            AND s.status='active' ''', (uid,)).fetchone()['n']
        lift = c.execute('''SELECT e.name::text AS name, max(s.kg) AS kg FROM lift_sets s
            JOIN exercises e ON e.id=s.exercise_id AND e.user_id=s.user_id
            JOIN activities a ON a.id=s.activity_id AND a.user_id=s.user_id
            WHERE s.user_id=%s AND s.done AND NOT s.warmup AND NOT a.lift_open
            GROUP BY e.id ORDER BY max(s.kg) DESC NULLS LAST, e.id LIMIT 1''', (uid,)).fetchone()
        best = c.execute('''SELECT label, elapsed_s, start_time FROM
            (SELECT DISTINCT ON (distance_m) label, elapsed_s, start_time FROM best_efforts
             WHERE user_id=%s AND sport='run' AND elapsed_s>0
             ORDER BY distance_m, elapsed_s, start_time) x ORDER BY start_time DESC LIMIT 1''', (uid,)).fetchone()
        food = c.execute(f'''SELECT day, CASE WHEN bool_or({energy.unknown_sql('protein_g')})
            THEN NULL ELSE sum(protein_g) END AS protein FROM food_entries
            WHERE user_id=%s AND day BETWEEN %s AND %s GROUP BY day''', (uid, week, today)).fetchall()
        target = profile.get('protein_target')
        protein_days = sum(r['protein'] is not None and r['protein'] >= target for r in food) if target and target > 0 else None
        weights = c.execute('SELECT day, kg FROM weights WHERE user_id=%s AND day<=%s ORDER BY day', (uid, today)).fetchall()
        points = energy.weight_trend(weights)
        # Compare actual trend points a week apart; one weigh-in cannot establish a trend.
        previous = next((p for p in reversed(points) if points and p[0] <= points[-1][0] - dt.timedelta(days=7)), None)
        change = round(points[-1][2] - previous[2], 2) if previous and points[-1][0] >= week - dt.timedelta(days=7) else None
        from .api_dishes import EMPTY, PLACEHOLDERS
        recipes = c.execute('SELECT count(*) AS n FROM dishes WHERE user_id=%(u)s AND NOT ('+EMPTY+')', {'u':uid,'p':list(PLACEHOLDERS)}).fetchone()['n']
        library_items = recipes + c.execute('SELECT (SELECT count(*) FROM custom_foods WHERE user_id=%s)+(SELECT count(*) FROM saved_meals WHERE user_id=%s) AS n', (uid,uid)).fetchone()['n']
        logged_days = c.execute('SELECT count(DISTINCT day) AS n FROM food_entries WHERE user_id=%s AND day<=%s', (uid,today)).fetchone()['n']
        plan = plans.current_from_connection(c, uid)
    active = plan.get('plan')
    next_workout = None
    if active:
        w = plan.get('today_workout')
        if not w or w['status'] == 'done': w = plan.get('next_workout')
        if w:
            next_workout = {k: w.get(k) for k in ('day', 'title', 'dist')}
        active = {'week': plan['this_week'], 'weeks': active['weeks'], 'unit': active['unit'], 'next': next_workout}
    return {'today': today.isoformat(), **counts, 'routes': routes, 'segments': segments,
            'lifting': dict(lift) if lift else None, 'record': dict(best) if best else None,
            'plan': active, 'food': {'protein_days': protein_days, 'weight_change_kg': change, 'library_items':library_items, 'weight_kg':weights[-1]['kg'] if weights else None, 'logged_days':logged_days, 'reminders_on':bool(profile.get('food_reminders'))}}
