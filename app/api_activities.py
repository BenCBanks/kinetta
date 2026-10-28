"""Activity API: upload/import, feed, detail, edit/delete, records, matched routes, similar efforts, fitness, stats,
calendar, heatmap, gear.  Every query is limited to the logged-in person (user['id'])."""
import datetime as dt
import json
import math
import os
import re
import shutil
import secrets
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, ConfigDict

from . import activities, analysis, coach, db, importer, plans, reactions
from .api_lifts import FEED_SQL as LIFTS_SQL, plan_of as lift_plan, copy_into as copy_lift
from .auth import current_user
from .activity_chart import sunday, weekly_distances, distance_days

router = APIRouter(prefix='/api')
DATA = os.environ.get('FIT_DATA', '/data')
UPLOAD_MAX = 8 * 1024 ** 3      # 8 GB per upload request (Strava exports can be big)
from .parsers import SPORTS


def polyline(coords):
    """Google encoded polyline from [[lon, lat], ...] (compact routes for the phone)."""
    out, plat, plon = [], 0, 0
    for lon, lat in coords:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return ''.join(out)


# Map detail (2026-10-11). Stored tracks stay within ~1 m of the watch's points. The activity map gets all of them;
# feed/list previews are simplified to ~4 m (was ~27 m: corners were cut off). Route matching does its own coarse
# simplification in activities.match_route, so map detail never slows it down.
DETAIL_TOL, PREVIEW_TOL = 0, 0.00004


def _line(c, aid, tol):
    r = c.execute('SELECT ST_AsGeoJSON(CASE WHEN %s > 0 THEN ST_Simplify(geom, %s) ELSE geom END) AS g FROM activities WHERE id = %s',
                  (tol, tol, aid)).fetchone()
    return polyline(json.loads(r['g'])['coordinates']) if r and r['g'] else None


# ---------- import ----------
@router.post('/import')
async def upload(request: Request, files: list[UploadFile], user=Depends(current_user)):
    if not files: raise HTTPException(400, 'No files')
    names = [f.filename or 'file' for f in files]
    job = importer.new_job(user['id'], names[0] if len(names) == 1 else f'{names[0]} and {len(names) - 1} more file{"s" if len(names) > 2 else ""}')
    d = os.path.join(DATA, 'uploads', str(user['id']), str(job)); os.makedirs(d, exist_ok=True)
    paths, total = [], 0
    try:
        for f in files:
            name = re.sub(r'[^A-Za-z0-9._-]', '_', os.path.basename(f.filename or 'file'))[:120] or 'file'
            p = os.path.join(d, name)
            with open(p, 'wb') as out:
                while chunk := await f.read(1024 * 1024):
                    total += len(chunk)
                    if total > UPLOAD_MAX: raise HTTPException(413, 'Upload too large - use the server inbox for huge exports')
                    out.write(chunk)
            if not name.lower().endswith(importer.EXTS + ('.zip',)):
                os.remove(p); continue
            paths.append(p)
        if not paths: raise HTTPException(400, 'No FIT, GPX, TCX or ZIP files in the upload')
    except BaseException as e:      # too big, cut off, or nothing to import: no half-saved files left behind (2026-10-12)
        shutil.rmtree(d, ignore_errors=True)
        importer.cancel(job, e.detail if isinstance(e, HTTPException) else 'upload interrupted')
        raise
    importer.submit(job, user['id'], paths)
    return {'job': job}


@router.get('/imports')
def imports(user=Depends(current_user)):
    with db.connect() as c:
        return c.execute("""SELECT id, label, status, total, done, added, duplicates, failed, messages, created, finished
                            FROM imports WHERE user_id = %s ORDER BY id DESC LIMIT 10""", (user['id'],)).fetchall()


# ---------- feed + detail ----------
# the photos on an activity (api_photos.py): [{id, w, h}], oldest first
PHOTOS_SQL = """(SELECT coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'w', ph.w, 'h', ph.h) ORDER BY ph.id), '[]'::jsonb)
                 FROM activity_photos ph WHERE ph.activity_id = a.id) AS photos"""
LIST_COLS = """a.id, a.sport, a.name, a.start_time, a.tz, a.distance_m, a.moving_s, a.elapsed_s, a.ascent_m, a.avg_hr,
               a.gap_s_per_km, a.effort, a.commute, a.route_id, a.description, a.avg_power, a.vo2max, a.sport_label,
               a.norm_power, a.vam, a.steps, a.swolf, a.lengths, a.pool_length_m"""


@router.get('/activities')
def feed(before: str | None = None, sport: str | None = None, q: str | None = None, limit: int = 20,
         user=Depends(current_user)):
    limit = max(1, min(limit, 100))
    sql = f"""SELECT {LIST_COLS}, ST_AsGeoJSON(ST_Simplify(a.geom, %s)) AS g,
                 (SELECT count(*) FROM best_efforts b WHERE b.activity_id = a.id AND NOT EXISTS (
                    SELECT 1 FROM best_efforts p WHERE p.user_id = b.user_id AND p.sport = b.sport AND p.distance_m = b.distance_m
                      AND p.start_time < b.start_time AND p.elapsed_s <= b.elapsed_s)) AS prs,
                 a.visibility, (SELECT count(*) FROM cheers ch WHERE ch.activity_id = a.id AND {reactions.visible('a.user_id')}) AS cheers,
                 {reactions.columns('a.user_id')},
                 EXISTS (SELECT 1 FROM cheers ch WHERE ch.activity_id = a.id AND ch.user_id = a.user_id) AS cheered,
                 (SELECT count(*) FROM comments cm WHERE cm.activity_id = a.id) AS comments, {PHOTOS_SQL}, {LIFTS_SQL}
              FROM activities a WHERE a.user_id = %s"""
    args = [PREVIEW_TOL, user['id']]
    if before: sql += ' AND a.start_time < %s'; args.append(before)
    if sport in SPORTS: sql += ' AND a.sport = %s'; args.append(sport)
    if q: sql += ' AND (a.name ILIKE %s OR a.description ILIKE %s)'; args += [f'%{q}%'] * 2
    sql += ' ORDER BY a.start_time DESC LIMIT %s'; args.append(limit)
    with db.connect() as c:
        rows = c.execute(sql, args).fetchall()
    for r in rows:
        g = r.pop('g')
        r['line'] = polyline(json.loads(g)['coordinates']) if g else None
    return rows


def _rank_efforts(c, uid, aid):
    return c.execute("""
        SELECT b.label, b.distance_m, b.elapsed_s, b.start_s,
          (SELECT count(*) FROM best_efforts p WHERE p.user_id = b.user_id AND p.sport = b.sport AND p.distance_m = b.distance_m
             AND p.start_time < b.start_time AND p.elapsed_s < b.elapsed_s) + 1 AS rank_then,
          (SELECT count(*) FROM best_efforts p WHERE p.user_id = b.user_id AND p.sport = b.sport AND p.distance_m = b.distance_m
             AND p.elapsed_s < b.elapsed_s) + 1 AS rank_now
        FROM best_efforts b WHERE b.activity_id = %s AND b.user_id = %s ORDER BY b.distance_m""", (aid, uid)).fetchall()


@router.get('/activities/{aid}')
def detail(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        a = c.execute(f"""SELECT a.*, g.name AS gear_name, r.name AS route_name,
                           (SELECT count(*) FROM activities x WHERE x.route_id = a.route_id) AS route_count, {PHOTOS_SQL}, {LIFTS_SQL}
                         FROM activities a LEFT JOIN gear g ON g.id = a.gear_id LEFT JOIN routes r ON r.id = a.route_id
                         WHERE a.id = %s AND a.user_id = %s""", (aid, user['id'])).fetchone()
        if not a: raise HTTPException(404, 'Not found')
        # Owner detail can render every recorded section without joining gaps. Shared geometry stays
        # on the existing server-trimmed path; raw recording files never enter shared responses.
        if a.get('source') == 'track' and not {'distance_m','moving_s','elapsed_s'}.intersection(a.get('summary_overrides') or {}):
            try:
                with open(os.path.join(DATA, a['file_path']), 'rb') as recording:
                    original = json.loads(recording.read(16 * 1024 * 1024))   # up to 72,000 points (#234 item 8)
                sections = {}
                for point in original.get('points', []):
                    sections.setdefault(point['segment'], []).append([point['lon'], point['lat']])
                a['track_lines'] = [polyline(points) for points in sections.values() if len(points) > 1]
            except (OSError, ValueError, TypeError, KeyError):
                pass
        for k in ('geom', 'start_pt', 'end_pt', 'file_path', 'file_sha256', 'user_id'): a.pop(k, None)
        a['chart'] = analysis.clean_chart(a.get('chart'))
        a['line'] = _line(c, aid, DETAIL_TOL)
        a['efforts'] = _rank_efforts(c, user['id'], aid)
        a['similar'] = _similar(c, user['id'], aid, 6)
        a['route_plan']=c.execute('''SELECT source_kind,route_id,version,snapshot_key,name,distance_m FROM activity_route_plans
          WHERE activity_id=%s AND user_id=%s''',(aid,user['id'])).fetchone()
        a['has_intervals']=bool(c.execute('SELECT 1 FROM activity_intervals WHERE user_id=%s AND activity_id=%s LIMIT 1',(user['id'],aid)).fetchone())
    return a


class ActivityEdit(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    distance_m: float | None = Field(None,ge=0,le=1_000_000)
    moving_s: float | None = Field(None,gt=0,le=172800)
    elapsed_s: float | None = Field(None,gt=0,le=172800)
    ascent_m: float | None = Field(None,ge=0,le=30000)
    calories: float | None = Field(None,ge=0,le=100000)
    avg_hr: float | None = Field(None,gt=0,le=300)
    max_hr: float | None = Field(None,gt=0,le=300)
    restore_summary: list[str] = Field(default_factory=list,max_length=7)

    name: str | None = Field(None, max_length=200)
    sport: str | None = Field(None, pattern='^(run|ride|walk|hike|swim|row|ski|workout|other)$')
    sport_label: str | None = Field(None, max_length=60)    # the kind ("Yoga"); '' clears it (2026-10-13)
    description: str | None = Field(None, max_length=10000)
    private_note: str | None = Field(None, max_length=10000)
    commute: bool | None = None
    gear_id: int | None = None
    clear_gear: bool = False


@router.patch('/activities/{aid}')
def edit(aid: int, body: ActivityEdit, user=Depends(current_user)):
    sets, args = [], []
    with db.connect() as c:
        a = c.execute('SELECT * FROM activities WHERE id = %s AND user_id = %s FOR UPDATE', (aid, user['id'])).fetchone()
        if not a: raise HTTPException(404, 'Not found')
        from . import activity_corrections as corrections
        changed={k:getattr(body,k) for k in corrections.FIELDS if k in body.model_fields_set}
        if any(k not in corrections.FIELDS for k in body.restore_summary):raise HTTPException(400,'Unknown summary field')
        if set(changed).intersection(body.restore_summary):raise HTTPException(400,'Either correct or restore a field')
        if (changed or body.restore_summary) and a.get('lift_open'):raise HTTPException(409,'Finish the lifting session before correcting its summary')
        if changed or body.restore_summary:
            overrides=dict(a.get('summary_overrides') or {})
            baseline=dict(a.get('summary_original') or {}) if overrides else {k:a.get(k) for k in corrections.FIELDS+corrections.DERIVED}
            overrides.update(changed)
            for k in body.restore_summary:overrides.pop(k,None)
            values={**baseline,**overrides}
            if values.get('moving_s') and values.get('elapsed_s') and values['moving_s']>values['elapsed_s']+1:raise HTTPException(400,'Moving time cannot exceed total duration')
            if values.get('avg_hr') and values.get('max_hr') and values['avg_hr']>values['max_hr']:raise HTTPException(400,'Average heart rate cannot exceed maximum heart rate')
            c.execute('UPDATE activities SET summary_overrides=%s,summary_original=%s WHERE id=%s AND user_id=%s',(json.dumps(overrides),json.dumps(baseline),aid,user['id']))
            corrections.apply(c,user['id'],aid,restore_records=True,clear_note=True)
        if body.gear_id is not None:
            if not c.execute('SELECT 1 FROM gear WHERE id = %s AND user_id = %s', (body.gear_id, user['id'])).fetchone():
                raise HTTPException(400, 'Unknown gear')
            sets.append('gear_id = %s'); args.append(body.gear_id)
        if body.clear_gear: sets.append('gear_id = NULL')
        if body.name is not None:
            sets += ['name = %s', 'auto_name = false']; args.append(body.name.strip() or 'Activity')
        for k in ('description', 'private_note', 'commute', 'sport'):
            v = getattr(body, k)
            if v is not None:
                sets.append(f'{k} = %s'); args.append(v.strip() or None if isinstance(v, str) and k != 'sport' else v)
        if body.sport_label is not None:
            sets.append('sport_label = %s'); args.append(body.sport_label.strip() or None)
        # a name nobody typed follows the new kind ("Lunch Workout" becomes "Lunch Yoga"); a typed name is left alone
        kind = (body.sport or a['sport'], a['sport_label'] if body.sport_label is None else body.sport_label.strip() or None)
        if body.name is None and a['auto_name'] and kind != (a['sport'], a['sport_label']):
            sets.append('name = %s'); args.append(activities.default_name(a['start_time'], a['tz'] or db.DEFAULT_TZ, *kind))
        if sets:
            c.execute(f"UPDATE activities SET {', '.join(sets)}, updated = now() WHERE id = %s AND user_id = %s", (*args, aid, user['id']))
        sport_changed = body.sport and body.sport != a['sport']
        if sport_changed:
            c.execute('UPDATE best_efforts SET sport = %s WHERE activity_id = %s AND user_id = %s', (body.sport, aid, user['id']))
    if sport_changed: activities.reprocess(user['id'], aid)
    return {'ok': True}


class ManualIn(BaseModel):
    sport: str = Field(pattern='^(run|ride|walk|hike|swim|row|ski|workout|other)$')
    name: str | None = Field(None, max_length=200)
    start: dt.datetime                       # local time on the phone, e.g. 2026-10-09T07:30
    duration_s: float = Field(gt=0, le=86400 * 2)
    distance_m: float | None = Field(None, ge=0, le=1_000_000)
    calories: float | None = Field(None, ge=0, le=20000)
    avg_hr: float | None = Field(None, ge=30, le=240)
    ascent_m: float | None = Field(None, ge=0, le=20000)
    description: str | None = Field(None, max_length=10000)
    sport_label: str | None = Field(None, max_length=60)    # the kind picked on the phone, e.g. "Yoga" or "Treadmill" (2026-10-13)
    copy_from: int | None = None                             # lifting: a past session whose exercises and sets come along


@router.post('/activities/manual')
def add_manual(body: ManualIn, user=Depends(current_user)):
    """An activity typed in by hand (no file). Calories left blank are estimated per day from distance/time (energy.py)."""
    from . import parsers
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
    start = body.start if body.start.tzinfo else body.start.replace(tzinfo=ZoneInfo(tz))
    if start > dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1): raise HTTPException(400, 'That start time is in the future')
    lifting = (body.sport_label or '').strip() == 'Strength Training'
    plan = lift_plan(user['id'], body.copy_from) if lifting and body.copy_from else []
    meta = {'sport': body.sport, 'sport_label': (body.sport_label or '').strip() or None,
            'name': (body.name or '').strip() or None, 'start': start, 'elapsed_s': body.duration_s, 'moving_s': body.duration_s,
            'distance_m': body.distance_m or None, 'calories': body.calories, 'avg_hr': body.avg_hr, 'ascent_m': body.ascent_m,
            'description': (body.description or '').strip() or None}
    parsed = {'sport': body.sport, 'sub_sport': None, 'start': start, 'device': None, 'laps': [],
              'session': {'elapsed_s': body.duration_s, 'moving_s': body.duration_s, 'distance_m': body.distance_m},
              'streams': {k: [] for k in ('t',) + parsers.STREAMS}}
    res, aid = activities.store(user['id'], parsed, meta, source='manual')
    if res == 'duplicate': raise HTTPException(409, 'You already have an activity starting at that time')
    if lifting and res == 'added':
        if not meta['name']:     # "Morning Lift", like a session started in the app (still an automatic name)
            with db.connect() as c:
                c.execute('UPDATE activities SET name = %s WHERE id = %s AND user_id = %s',
                          (activities.default_name(start, tz, 'workout').replace('Workout', 'Lift'), aid, user['id']))
        copy_lift(user['id'], aid, plan)
    return {'ok': True, 'id': aid}


# ---------- foreground recordings ----------
class TrackPoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    t: float = Field(ge=0, le=172800)
    accuracy: float = Field(ge=0, le=100)
    segment: int = Field(ge=0, le=10000)
    alt: float | None = Field(None, ge=-500, le=9000)       # metres, from the iPhone (#234 item 5); older builds send none
    valt: float | None = Field(None, ge=0, le=1000)         # its vertical accuracy


class RecordingPlanIn(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False,extra='forbid',str_strip_whitespace=True)
    source_kind:Literal['owned','shared']
    route_id:int=Field(gt=0,le=9_007_199_254_740_991)
    version:int=Field(gt=0,le=2_147_483_647)
    snapshot_key:str|None=Field(None,pattern='^[a-f0-9]{64}$')
    name:str=Field(min_length=1,max_length=120)
    distance_m:float=Field(gt=0,le=500000)


class TrackIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    client_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    sport: str = Field(pattern='^(run|ride|walk|hike|swim|row|ski|workout|other)$')
    sport_label: str | None = Field(None, max_length=60)
    name: str = Field(min_length=1, max_length=200)
    start: dt.datetime
    elapsed_s: float = Field(gt=0, le=172800)
    moving_s: float = Field(gt=0, le=172800)
    points: list[TrackPoint] = Field(default_factory=list, max_length=72000)   # ~360 km at the iPhone's 5 m spacing (#234 item 8)
    visibility: str | None = Field(None, pattern='^(me|friends|everyone)$')
    expected_sharing_default: str | None = Field(None, pattern='^(me|friends|everyone)$')
    route_plan: RecordingPlanIn | None = None
    intervals: dict | None = None


def _spread(points, run, counted):
    """The running distance at every fix. Distance is only counted at some fixes (GPS wobble filter), so between two counted
    fixes of one section it rises evenly with time; otherwise steady movement would look like stop-start and moving
    time and split paces would be wrong. It never rises across a gap between sections."""
    out, i, n = list(run), 0, len(points)
    while i < n:
        j = i
        while j + 1 < n and points[j + 1].segment == points[i].segment: j += 1
        marks = [k for k in range(i, j + 1) if counted[k]]
        for a, b in zip(marks, marks[1:]):
            span = points[b].t - points[a].t
            for k in range(a + 1, b):
                out[k] = run[a] + (run[b] - run[a]) * ((points[k].t - points[a].t) / span if span > 0 else 1)
        i = j + 1
    return out


@router.post('/activities/track')
def save_track(body: TrackIn, user=Depends(current_user)):
    """One activity per account/recording, using its reviewed or default audience. Retry after a lost acknowledgement returns the same id."""
    from . import parsers
    if body.route_plan and body.route_plan.source_kind=='shared' and not body.route_plan.snapshot_key:
        raise HTTPException(422,'A shared recording plan needs its reviewed snapshot identity')
    start = body.start
    if not start.tzinfo: raise HTTPException(422, 'Recording start needs a time zone')
    if start > dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=60): raise HTTPException(422, 'Start is in the future')
    if body.moving_s > body.elapsed_s + 1: raise HTTPException(422, 'Active time exceeds elapsed time')
    if (dt.datetime.now(dt.timezone.utc) - start).total_seconds() + 60 < body.elapsed_s:
        raise HTTPException(422, 'Recording duration exceeds the time since it started')
    points = body.points
    distance, segments, run, counted = 0.0, {}, [], []
    previous = anchor = None
    for point in points:
        if point.t > body.elapsed_s + 1 or previous and (point.t <= previous.t or point.segment < previous.segment):
            raise HTTPException(422, 'Recording points must be in time and segment order')
        if previous and point.segment == previous.segment:
            delta = point.t - previous.t
            metres = float(analysis.haversine(previous.lat, previous.lon, point.lat, point.lon))
            if delta > 30 or metres / delta > analysis.MAX_SPEED[body.sport]:
                raise HTTPException(422, 'GPS gaps and jumps must start a new segment')
        else: anchor = None                  # a new section never adds distance across the gap
        step = analysis.track_step(anchor, point)   # GPS wobble and poor fixes add nothing (#234 item 2)
        if step is not None: distance += step; anchor = point
        segments.setdefault(point.segment, []).append(point)
        run.append(distance); counted.append(step is not None)
        previous = point
    interval_result=None
    if body.intervals is not None:
        from . import intervals
        if body.sport not in ('run','walk'):raise HTTPException(422,'Run/walk intervals require an outdoor Run or Walk recording.')
        try:interval_result=intervals.results(body.intervals,body.moving_s,distance)
        except ValueError as e:raise HTTPException(422,str(e))
    # Every section goes into the streams (#234 item 6), so splits, charts and best efforts cover the whole session. The
    # running distance stands still across a gap and the gap is never "moving" (over 30 s), so nothing is counted across
    # it; best efforts never span sections. The map line (feed and shared previews) stays the longest single section, so
    # it never draws across a pause or outage; every section stays in the downloadable recording file.
    longest = max(segments.values(), key=lambda pts: sum(float(analysis.haversine(a.lat, a.lon, b.lat, b.lon)) for a, b in zip(pts, pts[1:])), default=[])
    streams = {k: [] for k in ('t',) + parsers.STREAMS}
    if points:
        # phone altitude counts only when its vertical accuracy is known and reasonable (#234 item 5)
        streams.update(t=[p.t for p in points], lat=[p.lat for p in points], lon=[p.lon for p in points], dist=_spread(points, run, counted),
                       alt=[p.alt if p.alt is not None and p.valt is not None and 0 < p.valt <= 25 else None for p in points],
                       section=[p.segment for p in points])
        if all(a is None for a in streams['alt']): streams['alt'] = []
    parsed = {'sport': body.sport, 'start': start, 'sub_sport': None, 'device': 'Kinetta foreground recorder',
              'laps': [], 'streams': streams, 'session': {},
              'geometry': {'lat': [p.lat for p in longest], 'lon': [p.lon for p in longest]}}
    meta = {'sport': body.sport, 'sport_label': body.sport_label, 'name': body.name.strip() or 'Activity',
            'source_id': body.client_id, 'elapsed_s': body.elapsed_s, 'moving_s': body.moving_s, 'distance_m': distance}
    if len(segments) > 1:
        meta['description'] = 'Recorded in sections. Your activity shows every section; shared previews show the longest continuous section. Totals, splits and records cover the whole session.'
    # Keep the lock and insert on one connection: concurrent retries cannot exhaust the pool waiting
    # for a second connection. The activity and acknowledgement identity commit together.
    with db.connect() as c:
        c.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"track:{user['id']}:{body.client_id}",))
        if not c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',(user['id'],)).fetchone():raise HTTPException(404,'Account unavailable')
        from psycopg.types.json import Jsonb
        import hashlib
        from uuid import UUID
        try:recording_id=UUID(body.client_id)
        except ValueError:raise HTTPException(422,'Invalid recording ID')
        digest=hashlib.sha256(json.dumps(interval_result,sort_keys=True,separators=(',',':')).encode()).hexdigest() if interval_result is not None else None
        interval_receipt=c.execute('SELECT activity_id,request_hash FROM activity_intervals WHERE user_id=%s AND recording_id=%s',(user['id'],recording_id)).fetchone()
        if interval_receipt and digest is not None and digest!=interval_receipt['request_hash']:
            raise HTTPException(409,'This recording was already saved with different interval results. Your draft is kept.')
        receipt=c.execute('SELECT activity_id FROM track_recording_receipts WHERE user_id=%s AND client_id=%s',(user['id'],body.client_id)).fetchone()
        if receipt:
            if receipt['activity_id'] is None:raise HTTPException(409,'This recording was already saved and removed. It cannot be restored by retrying the upload.')
            if interval_result is not None and not interval_receipt:raise HTTPException(409,'This recording was already saved without intervals; review the existing activity before retrying.')
            return {'id':receipt['activity_id'],'duplicate':True}
        if interval_receipt:return {'id':interval_receipt['activity_id'],'duplicate':True}
        found = c.execute("SELECT id FROM activities WHERE user_id = %s AND source = 'track' AND source_id = %s", (user['id'], body.client_id)).fetchone()
        if found:
            if interval_result is not None:raise HTTPException(409,'This recording was already saved without intervals; review the existing activity before retrying.')
            c.execute('INSERT INTO track_recording_receipts(user_id,client_id,activity_id) VALUES(%s,%s,%s)',(user['id'],body.client_id,found['id']))
            return {'id': found['id'], 'duplicate': True}
        if body.visibility is None and body.expected_sharing_default is None:
            # Installed app builds without the audience picker told people recordings start private.
            body.visibility = 'me'
        if body.visibility is None and body.expected_sharing_default is not None:
            # A cached phone setting must not override a newer privacy choice.
            # Hold this choice through the insert, including a concurrent settings save.
            profile=c.execute('SELECT share_default FROM profile WHERE user_id=%s FOR SHARE',(user['id'],)).fetchone()
            audience=(profile or {}).get('share_default') or 'everyone'
            if audience!=body.expected_sharing_default:
                raise HTTPException(409,{'code':'sharing_changed','message':'Your sharing setting changed. Review the audience before saving.','sharing_default':audience})
        raw = body.model_dump_json().encode()
        _, aid = activities.store(user['id'], parsed, meta, raw=raw, ext='.json', source='track', connection=c)
        if body.visibility is not None:
            c.execute('UPDATE activities SET visibility=%s WHERE user_id=%s AND id=%s',(body.visibility,user['id'],aid))
        if body.route_plan:
            p=body.route_plan
            # A previously authorized, pinned route can finish offline after its original was revoked/deleted.
            # This is private user-supplied history. Never refetch hidden geometry or use it for measured totals.
            c.execute('''INSERT INTO activity_route_plans(activity_id,user_id,source_kind,route_id,version,snapshot_key,name,distance_m)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(activity_id) DO NOTHING''',(aid,user['id'],p.source_kind,p.route_id,p.version,p.snapshot_key,p.name,p.distance_m))
        c.execute('INSERT INTO track_recording_receipts(user_id,client_id,activity_id) VALUES(%s,%s,%s)',(user['id'],body.client_id,aid))
        if interval_result is not None:
            c.execute('INSERT INTO activity_intervals(user_id,recording_id,activity_id,payload,request_hash) VALUES(%s,%s,%s,%s,%s)',(user['id'],recording_id,aid,Jsonb(interval_result),digest))
    return {'id': aid, 'duplicate': False}


@router.delete('/activities/{aid}')
def delete(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute('DELETE FROM activities WHERE id = %s AND user_id = %s RETURNING route_id', (aid, user['id'])).fetchone()
        if not r: raise HTTPException(404, 'Not found')
        if r['route_id']:   # a route with fewer than 2 activities is no longer a matched route
            n = c.execute('SELECT count(*) AS n FROM activities WHERE route_id = %s', (r['route_id'],)).fetchone()['n']
            if n < 2:
                c.execute('UPDATE activities SET route_id = NULL WHERE route_id = %s AND user_id = %s', (r['route_id'], user['id']))
                c.execute('DELETE FROM routes WHERE id = %s AND user_id = %s', (r['route_id'], user['id']))
    return {'ok': True}


# ---------- records ----------
@router.get('/records')
def records(sport: str = 'run', user=Depends(current_user)):
    year0 = dt.datetime(dt.date.today().year, 1, 1, tzinfo=dt.timezone.utc)
    with db.connect() as c:
        rows = c.execute("""
            SELECT distance_m, label, activity_id, elapsed_s, start_time, rn FROM (
              SELECT b.*, row_number() OVER (PARTITION BY distance_m ORDER BY elapsed_s) rn
              FROM best_efforts b WHERE user_id = %s AND sport = %s) x WHERE rn <= 3 ORDER BY distance_m, rn""",
                         (user['id'], sport)).fetchall()
        year = c.execute("""SELECT DISTINCT ON (distance_m) distance_m, activity_id, elapsed_s, start_time FROM best_efforts
                            WHERE user_id = %s AND sport = %s AND start_time >= %s ORDER BY distance_m, elapsed_s""",
                         (user['id'], sport, year0)).fetchall()
        counts = c.execute('SELECT distance_m, count(*) AS n FROM best_efforts WHERE user_id = %s AND sport = %s GROUP BY 1',
                           (user['id'], sport)).fetchall()
        curve = c.execute("""SELECT (pc->>'seconds')::int AS seconds, max((pc->>'watts')::int) AS watts
                             FROM activities, jsonb_array_elements(coalesce(power_curve, '[]')) pc
                             WHERE user_id = %s AND sport = %s GROUP BY 1 ORDER BY 1""", (user['id'], sport)).fetchall()
    out = {}
    for r in rows:
        e = out.setdefault(r['distance_m'], {'distance_m': r['distance_m'], 'label': r['label'], 'top': [], 'year': None, 'count': 0})
        e['top'].append({k: r[k] for k in ('activity_id', 'elapsed_s', 'start_time')})
    for r in year:
        if r['distance_m'] in out: out[r['distance_m']]['year'] = dict(r)
    for r in counts:
        if r['distance_m'] in out: out[r['distance_m']]['count'] = r['n']
    return {'efforts': list(out.values()), 'power_curve': curve}


@router.get('/records/history')
def record_history(sport: str, distance_m: float, user=Depends(current_user)):
    """Every effort at one distance in time order, flagged where it set a new PR (the PR progression)."""
    with db.connect() as c:
        rows = c.execute("""SELECT b.activity_id, b.elapsed_s, b.start_time, a.name FROM best_efforts b
                            JOIN activities a ON a.id = b.activity_id
                            WHERE b.user_id = %s AND b.sport = %s AND abs(b.distance_m - %s) < 1 ORDER BY b.start_time""",
                         (user['id'], sport, distance_m)).fetchall()
    best = math.inf
    for r in rows:
        r['pr'] = r['elapsed_s'] < best
        best = min(best, r['elapsed_s'])
    return rows


# ---------- matched routes + similar ----------
def _trend(xs, ys):
    """Least-squares slope per day + fitted ends (for the trend line)."""
    n = len(xs)
    if n < 3: return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0: return None
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return {'slope_per_day': b, 'start': my + b * (xs[0] - mx), 'end': my + b * (xs[-1] - mx)}


@router.get('/routes')
def routes(user=Depends(current_user)):
    with db.connect() as c:
        return c.execute("""
            SELECT r.id, r.name, r.sport, count(a.id) AS count, min(a.moving_s) AS best_s, max(a.start_time) AS last,
                   avg(a.distance_m) AS distance_m,
                   (SELECT ST_AsGeoJSON(ST_Simplify(x.geom, %s)) FROM activities x WHERE x.route_id = r.id ORDER BY x.start_time DESC LIMIT 1) AS g
            FROM routes r JOIN activities a ON a.route_id = r.id WHERE r.user_id = %s
            GROUP BY r.id ORDER BY count(a.id) DESC, max(a.start_time) DESC""", (PREVIEW_TOL, user['id'])).fetchall()


@router.get('/routes/{rid}')
def route(rid: int, user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute('SELECT id, name, sport FROM routes WHERE id = %s AND user_id = %s', (rid, user['id'])).fetchone()
        if not r: raise HTTPException(404, 'Not found')
        acts = c.execute("""SELECT id, name, start_time, distance_m, moving_s, avg_hr, gap_s_per_km, avg_temp, effort FROM activities
                            WHERE route_id = %s AND user_id = %s ORDER BY start_time""", (rid, user['id'])).fetchall()
        g = c.execute("""SELECT ST_AsGeoJSON(geom) AS g FROM activities WHERE route_id = %s AND user_id = %s
                         ORDER BY start_time DESC LIMIT 1""", (rid, user['id'])).fetchone()
    days = lambda t: t.timestamp() / 86400
    pace = [(days(a['start_time']), a['moving_s'] / a['distance_m'] * 1000) for a in acts if a['moving_s'] and a['distance_m']]
    # efficiency: metres per heartbeat (hill-adjusted where possible) - higher = fitter at the same effort
    eff = [(days(a['start_time']), (1000 / (a['gap_s_per_km'] or a['moving_s'] / a['distance_m'] * 1000)) * 60 / a['avg_hr'])
           for a in acts if a['avg_hr'] and a['moving_s'] and a['distance_m']]
    r['activities'] = acts
    r['line'] = polyline(json.loads(g['g'])['coordinates']) if g and g['g'] else None
    r['pace_trend'] = _trend(*zip(*pace)) if len(pace) >= 3 else None
    r['efficiency_trend'] = _trend(*zip(*eff)) if len(eff) >= 3 else None
    r['fastest_id'] = min(acts, key=lambda a: a['moving_s'] or math.inf)['id'] if acts else None
    return r


class RouteEdit(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.patch('/routes/{rid}')
def rename_route(rid: int, body: RouteEdit, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('UPDATE routes SET name = %s, renamed = true WHERE id = %s AND user_id = %s RETURNING id',
                         (body.name.strip(), rid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


def _similar(c, uid, aid, limit):
    """Other activities of the same sport and similar distance (±10 %), newest first, for side-by-side comparison."""
    return c.execute("""
        SELECT o.id, o.name, o.start_time, o.distance_m, o.moving_s, o.avg_hr, o.gap_s_per_km, o.route_id = a.route_id AS same_route
        FROM activities a JOIN activities o ON o.user_id = a.user_id AND o.sport = a.sport AND o.id <> a.id
        WHERE a.id = %s AND a.user_id = %s AND a.distance_m > 0
          AND o.distance_m BETWEEN a.distance_m * 0.9 AND a.distance_m * 1.1
        ORDER BY o.start_time DESC LIMIT %s""", (aid, uid, limit)).fetchall()


# ---------- fitness, stats, calendar ----------
@router.get('/fitness')
def fitness(days: int = 365, user=Depends(current_user)):
    """Daily fitness (42-day load), fatigue (7-day) and form (fitness - fatigue) from effort scores;
    race predictions + monthly VDOT from real best efforts (see below)."""
    days = max(30, min(days, 3650))
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        loads = c.execute("""SELECT (start_time AT TIME ZONE %s)::date AS d, sum(effort) AS load FROM activities
                             WHERE user_id = %s AND effort IS NOT NULL GROUP BY 1 ORDER BY 1""", (tz, user['id'])).fetchall()
    today = dt.datetime.now(ZoneInfo(tz)).date()
    by_day = {r['d']: float(r['load']) for r in loads}
    out, ctl, atl = [], 0.0, 0.0
    if by_day:
        d = min(by_day)
        while d <= today:
            l = by_day.get(d, 0.0)
            ctl += (l - ctl) / 42; atl += (l - atl) / 7
            if (today - d).days < days: out.append({'d': d.isoformat(), 'load': round(l, 1), 'fitness': round(ctl, 1), 'fatigue': round(atl, 1), 'form': round(ctl - atl, 1)})
            d += dt.timedelta(days=1)
    # Race predictions come from what you actually ran (2026-10-09): the best effort of a mile or longer in the last
    # 90 days, turned into Daniels VDOT. The heart-rate VO2max guesses (above) are too noisy to predict races from.
    with db.connect() as c:
        effs = c.execute("""SELECT b.label, b.distance_m, b.elapsed_s, b.start_time, b.activity_id,
                                   to_char(b.start_time AT TIME ZONE %s, 'YYYY-MM') AS m
                            FROM best_efforts b WHERE b.user_id = %s AND b.sport = 'run' AND b.distance_m >= 1609
                              AND b.elapsed_s > 0""", (tz, user['id'])).fetchall()
    for e in effs: e['vdot'] = analysis.vdot(e['distance_m'], e['elapsed_s'])
    effs = [e for e in effs if 25 <= e['vdot'] <= 85]          # drop GPS glitches
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=90)
    recent = [e for e in effs if e['start_time'] >= cutoff]
    basis = max(recent, key=lambda e: e['vdot']) if recent else None
    current = round(basis['vdot'], 1) if basis else None
    # each race from its best-suited effort, slowed for long races on low mileage (2026-10-12, plans.run_predictions)
    with db.connect() as c:
        preds = plans.run_predictions(c, user['id'], ((5000, '5K'), (10000, '10K'), (21097.5, 'Half marathon'), (42195, 'Marathon'))) if current else []
        # your all-time best at each race distance (2026-10-13): the tile turns green when the prediction beats it
        bests = {r['label']: r['s'] for r in c.execute("""SELECT label, min(elapsed_s) AS s FROM best_efforts WHERE user_id = %s
            AND sport = 'run' AND label = ANY(%s) GROUP BY 1""", (user['id'], [p['label'] for p in preds])).fetchall()}
    for p in preds:
        f = p.pop('from'); p['from'] = {'label': f['label'], 'activity_id': f['activity_id'], 'start_time': f['start_time']}
        p['best_s'] = bests.get(p['label'])
    months = {}
    for e in effs: months[e['m']] = max(months.get(e['m'], 0), e['vdot'])
    ramp = None
    if len(out) >= 8: ramp = round(out[-1]['fitness'] - out[-8]['fitness'], 1)
    return {'days': out, 'vdot_now': current, 'predictions': preds, 'ramp_7d': ramp,
            'basis': {k: basis[k] for k in ('label', 'distance_m', 'elapsed_s', 'start_time', 'activity_id')} if basis else None,
            'vdot_months': [{'m': m, 'v': round(v, 1)} for m, v in sorted(months.items())]}


# ---------- progress: mileage by period + growth trends (2026-10-09) ----------
SPORT_BUCKET = "CASE WHEN sport = 'run' THEN 'run' WHEN sport = 'ride' THEN 'ride' WHEN sport IN ('walk', 'hike') THEN 'walk' ELSE 'other' END"


@router.get('/progress/volume')
def progress_volume(period: str = 'week', user=Depends(current_user)):
    """Distance/time/count per week, month or year, per sport bucket (run, ride, walk = walk+hike, other)."""
    if period not in ('week', 'month', 'year'): raise HTTPException(400, 'period must be week, month or year')
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        rows = c.execute(f"""SELECT date_trunc('{period}', start_time AT TIME ZONE %s)::date AS p, {SPORT_BUCKET} AS s, count(*) AS n,
                                    coalesce(sum(distance_m), 0) AS d, coalesce(sum(moving_s), 0) AS t, coalesce(sum(ascent_m), 0) AS a
                             FROM activities WHERE user_id = %s GROUP BY 1, 2 ORDER BY 1""", (tz, user['id'])).fetchall()
    today = dt.datetime.now(ZoneInfo(tz)).date()
    return {'period': period, 'today': today.isoformat(), 'rows': rows}


@router.get('/progress/trends')
def progress_trends(sport: str = 'run', user=Depends(current_user)):
    """Per month, sums the phone turns into averages for any month/year: pace = moving time / distance,
    heart rate and cadence weighted by moving time (only activities that have them)."""
    sports = {'run': ['run'], 'ride': ['ride'], 'walk': ['walk', 'hike']}.get(sport)
    if not sports: raise HTTPException(400, 'sport must be run, ride or walk')
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        rows = c.execute("""SELECT to_char(start_time AT TIME ZONE %s, 'YYYY-MM') AS m, count(*) AS n,
                 coalesce(sum(distance_m), 0) AS d, coalesce(sum(moving_s), 0) AS t, coalesce(sum(ascent_m), 0) AS a,
                 max(distance_m) AS longest,
                 sum(distance_m) FILTER (WHERE distance_m > 0 AND moving_s > 0) AS pd, sum(moving_s) FILTER (WHERE distance_m > 0 AND moving_s > 0) AS pt,
                 sum(avg_hr * moving_s) FILTER (WHERE avg_hr > 0 AND moving_s > 0) AS hr_w, sum(moving_s) FILTER (WHERE avg_hr > 0 AND moving_s > 0) AS hr_t,
                 sum(avg_cad * moving_s) FILTER (WHERE avg_cad > 0 AND moving_s > 0) AS cad_w, sum(moving_s) FILTER (WHERE avg_cad > 0 AND moving_s > 0) AS cad_t
               FROM activities WHERE user_id = %s AND sport = ANY(%s) GROUP BY 1 ORDER BY 1""", (tz, user['id'], sports)).fetchall()
    today = dt.datetime.now(ZoneInfo(tz)).date()
    return {'sport': sport, 'today': today.isoformat(), 'months': rows}


@router.get('/stats')
def stats(user=Depends(current_user)):
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        weeks = c.execute("""SELECT date_trunc('week', start_time AT TIME ZONE %s)::date AS week, sport, count(*) AS n,
                               sum(distance_m) AS distance_m, sum(moving_s) AS moving_s, sum(ascent_m) AS ascent_m, sum(effort) AS effort
                             FROM activities WHERE user_id = %s AND start_time > now() - interval '53 weeks' GROUP BY 1, 2 ORDER BY 1""",
                          (tz, user['id'])).fetchall()
        years = c.execute("""SELECT extract(year FROM start_time AT TIME ZONE %s)::int AS year, sport, count(*) AS n,
                               sum(distance_m) AS distance_m, sum(moving_s) AS moving_s, sum(ascent_m) AS ascent_m
                             FROM activities WHERE user_id = %s GROUP BY 1, 2 ORDER BY 1 DESC""", (tz, user['id'])).fetchall()
        days = [r['d'] for r in c.execute("""SELECT DISTINCT (start_time AT TIME ZONE %s)::date AS d FROM activities
                                             WHERE user_id = %s ORDER BY 1 DESC""", (tz, user['id'])).fetchall()]
        total = c.execute('SELECT count(*) AS n, min(start_time) AS first FROM activities WHERE user_id = %s', (user['id'],)).fetchone()
        today = dt.datetime.now(ZoneInfo(tz)).date()
        chart_start = sunday(today) - dt.timedelta(weeks=6)
        # this week day by day (Today's strip, 2026-10-10): distance + time per day, main sport by time
        groups = c.execute("""SELECT (start_time AT TIME ZONE %s)::date AS d, sport, sum(distance_m) AS distance_m, sum(moving_s) AS moving_s
                                   FROM activities WHERE user_id = %s AND start_time AT TIME ZONE %s >= %s
                                   AND start_time AT TIME ZONE %s < %s
                                   GROUP BY 1,2""", (tz, user['id'], tz, chart_start, tz, today + dt.timedelta(days=1))).fetchall()
        day_totals = distance_days(groups)
        week_days = [{'d': day, **values} for day, values in day_totals.items()]
    streak, d = 0, today if days and days[0] == today else today - dt.timedelta(days=1)
    s = set(days)
    while d in s: streak += 1; d -= dt.timedelta(days=1)
    wk = set(); wd = today - dt.timedelta(days=today.weekday()); wstreak = 0
    for x in days: wk.add(x - dt.timedelta(days=x.weekday()))
    w = wd if wd in wk else wd - dt.timedelta(days=7)
    while w in wk: wstreak += 1; w -= dt.timedelta(days=7)
    mon = today - dt.timedelta(days=today.weekday()); wd_by = {r['d']: r for r in week_days}
    strip = [{'d': (mon + dt.timedelta(days=i)).isoformat(), 'distance_m': (wd_by.get(mon + dt.timedelta(days=i)) or {}).get('distance_m'),
              'moving_s': (wd_by.get(mon + dt.timedelta(days=i)) or {}).get('moving_s'), 'sport': (wd_by.get(mon + dt.timedelta(days=i)) or {}).get('sport'),
              'today': mon + dt.timedelta(days=i) == today} for i in range(7)]
    recent = [{'d': (today - dt.timedelta(days=i)).isoformat(), 'distance_m': (wd_by.get(today - dt.timedelta(days=i)) or {}).get('distance_m', 0), 'today': i == 0, 'by_sport': (wd_by.get(today - dt.timedelta(days=i)) or {}).get('by_sport', {})} for i in reversed(range(14))]
    return {'chart_today': today, 'chart_weeks': weekly_distances(today, {r['d']: r['distance_m'] for r in week_days}, {d: v['by_sport'] for d, v in day_totals.items()}), 'recent_days': recent, 'weeks': weeks, 'years': years, 'day_streak': streak, 'week_streak': wstreak, 'total': total['n'], 'first': total['first'], 'week_days': strip}


@router.get('/calendar')
def calendar(month: str, user=Depends(current_user)):
    try: y, m = map(int, month.split('-'))
    except ValueError: raise HTTPException(400, 'month must be YYYY-MM')
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        return c.execute("""SELECT id, sport, name, (start_time AT TIME ZONE %s)::date AS d, distance_m, moving_s, effort FROM activities
                            WHERE user_id = %s AND (start_time AT TIME ZONE %s)::date >= make_date(%s, %s, 1)
                              AND (start_time AT TIME ZONE %s)::date < make_date(%s, %s, 1) + interval '1 month'
                            ORDER BY start_time""", (tz, user['id'], tz, y, m, tz, y, m)).fetchall()


@router.get('/calendar/month')
def calendar_month(month: str, user=Depends(current_user)):
    from . import energy
    """The month at a glance (2026-10-11): each day's workouts, food against that day's calorie goal and weigh-in,
    plus each week's totals. A day counts as on target within 10 % of its goal; a day logged at under half a usual
    day's calories is 'partial' (probably not fully logged), so it isn't judged."""
    try:
        y, m = map(int, month.split('-'))
        if not 1900 <= y <= 2200: raise ValueError
        first, nxt = dt.date(y, m, 1), dt.date(y + (m == 12), m % 12 + 1, 1)
    except ValueError: raise HTTPException(400, 'month must be YYYY-MM')
    last = nxt - dt.timedelta(days=1)
    mon, sun = first - dt.timedelta(days=first.weekday()), last + dt.timedelta(days=6 - last.weekday())   # whole weeks, Monday to Sunday
    with db.connect() as c:
        p = c.execute('SELECT tz, kcal_target, protein_target FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        tz = p.get('tz') or db.DEFAULT_TZ
        today = c.execute('SELECT (now() AT TIME ZONE %s)::date AS d', (tz,)).fetchone()['d']
        acts = c.execute("""SELECT id, sport, name, (start_time AT TIME ZONE %s)::date AS d, distance_m, moving_s FROM activities
                            WHERE user_id = %s AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s ORDER BY start_time""",
                         (tz, user['id'], tz, mon, sun)).fetchall()
        food = {r['day']: r for r in c.execute("""SELECT day, round(sum(kcal)) AS kcal, round(sum(protein_g)) AS protein_g, count(*) AS n
                                                  FROM food_entries WHERE user_id = %s AND day BETWEEN %s AND %s GROUP BY day""",
                                               (user['id'], mon, sun)).fetchall()}
        goals=energy.day_goals(c,user['id'],mon,sun)
        weights = {r['day']: r['kg'] for r in c.execute('SELECT day, kg FROM weights WHERE user_id = %s AND day BETWEEN %s AND %s',
                                                         (user['id'], mon, sun)).fetchall()}
        typical = c.execute("""SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY k) AS k FROM (SELECT sum(kcal) AS k FROM food_entries
                               WHERE user_id = %s AND day BETWEEN %s AND %s GROUP BY day) x""", (user['id'], today - dt.timedelta(days=60), today)).fetchone()['k']
    by = {}
    for a in acts: by.setdefault(a['d'], []).append({k: a[k] for k in ('id', 'sport', 'name', 'distance_m', 'moving_s')})
    days, d = [], mon
    while d < sun + dt.timedelta(days=1):
        f, goal = food.get(d), goals[d]['kcal']
        status = None
        if f and d <= today:
            if typical and f['kcal'] < 0.5 * typical and d < today: status = 'partial'
            elif d == today: status = 'today'
            elif goal: status = 'on' if abs(f['kcal'] - goal) <= 0.1 * goal else 'over' if f['kcal'] > goal else 'under'
            else: status = 'logged'
        days.append({'d': d, 'in_month': first <= d < nxt, 'today': d == today, 'acts': by.get(d, []),
                     'food': {'kcal': f['kcal'], 'protein_g': f['protein_g'], 'goal': round(goal) if goal else None, 'status': status} if f else None,
                     'weight_kg': weights.get(d)})
        d += dt.timedelta(days=1)
    weeks = [{'start': days[i]['d'], 'distance_m': sum(a['distance_m'] or 0 for x in days[i:i + 7] for a in x['acts']),
              'moving_s': sum(a['moving_s'] or 0 for x in days[i:i + 7] for a in x['acts']), 'n': sum(len(x['acts']) for x in days[i:i + 7])}
             for i in range(0, len(days), 7)]
    inm = [x for x in days if x['in_month'] and x['d'] <= today]
    judged = [x for x in inm if x['food'] and x['food']['status'] in ('on', 'over', 'under')]
    return {'month': f'{y:04d}-{m:02d}', 'days': days, 'weeks': weeks, 'protein_target': p.get('protein_target'),
            'summary': {'days': len(inm), 'trained': sum(1 for x in inm if x['acts']), 'logged': sum(1 for x in inm if x['food']),
                        'judged': len(judged), 'on_target': sum(1 for x in judged if x['food']['status'] == 'on'),
                        'weighed': sum(1 for x in inm if x['weight_kg'])}}


@router.get('/heatmap')
def heatmap(sport: str | None = None, user=Depends(current_user)):
    sql = 'SELECT ST_AsGeoJSON(ST_Simplify(geom, 0.00008)) AS g FROM activities WHERE user_id = %s AND geom IS NOT NULL'
    args = [user['id']]
    if sport in SPORTS: sql += ' AND sport = %s'; args.append(sport)
    with db.connect() as c:
        return [polyline(json.loads(r['g'])['coordinates']) for r in c.execute(sql + ' LIMIT 5000', args).fetchall() if r['g']]


# ---------- gear ----------
class GearIn(BaseModel):
    kind: str = Field('shoe', pattern='^(shoe|bike|other)$')
    name: str = Field(min_length=1, max_length=120)
    brand: str | None = Field(None, max_length=80)
    model: str | None = Field(None, max_length=80)
    notes: str | None = Field(None, max_length=2000)
    start_distance_m: float = 0
    alert_distance_m: float | None = None
    retired: bool = False
    is_default: bool = False


@router.get('/gear')
def gear_list(user=Depends(current_user)):
    with db.connect() as c:
        return c.execute("""SELECT g.*, g.start_distance_m + coalesce(sum(a.distance_m), 0) AS total_m, count(a.id) AS uses,
                              max(a.start_time) AS last_used
                            FROM gear g LEFT JOIN activities a ON a.gear_id = g.id WHERE g.user_id = %s
                            GROUP BY g.id ORDER BY g.retired, max(a.start_time) DESC NULLS LAST""", (user['id'],)).fetchall()


def _gear_save(c, uid, body, gid=None):
    if body.is_default:
        c.execute('UPDATE gear SET is_default = false WHERE user_id = %s AND kind = %s', (uid, body.kind))
    vals = body.model_dump()
    if c.execute('SELECT 1 FROM gear WHERE user_id = %s AND name = %s AND id IS DISTINCT FROM %s', (uid, body.name, gid)).fetchone():
        raise HTTPException(409, 'You already have gear with that name')      # adding or renaming (2026-10-12: renaming gave a 500)
    if gid is None:
        return c.execute(f"INSERT INTO gear (user_id, {', '.join(vals)}) VALUES (%s, {', '.join(['%s'] * len(vals))}) RETURNING id",
                         (uid, *vals.values())).fetchone()['id']
    r = c.execute(f"UPDATE gear SET {', '.join(f'{k} = %s' for k in vals)} WHERE id = %s AND user_id = %s RETURNING id",
                  (*vals.values(), gid, uid)).fetchone()
    if not r: raise HTTPException(404, 'Not found')
    return gid


@router.post('/gear')
def gear_add(body: GearIn, user=Depends(current_user)):
    with db.connect() as c:
        return {'id': _gear_save(c, user['id'], body)}


@router.put('/gear/{gid}')
def gear_edit(gid: int, body: GearIn, user=Depends(current_user)):
    with db.connect() as c:
        return {'id': _gear_save(c, user['id'], body, gid)}


@router.delete('/gear/{gid}')
def gear_delete(gid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM gear WHERE id = %s AND user_id = %s RETURNING id', (gid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- goals ----------
class GoalIn(BaseModel):
    sport: str | None = Field(None, pattern='^(run|ride|walk|hike|swim|row|ski|workout|other)$')
    period: str = Field(pattern='^(day|week|month|year)$')
    metric: str = Field(pattern='^(distance|time|elevation|count|calories)$')
    target: float = Field(gt=0, le=1e9)


@router.get('/goals')
def goals(user=Depends(current_user)):
    """Each goal with progress for the current day/week/month/year (in the person's time zone; weeks start Monday)."""
    col = {'distance': 'sum(distance_m)', 'time': 'sum(moving_s)', 'elevation': 'sum(ascent_m)', 'count': 'count(*)', 'calories': 'sum(calories)'}
    with db.connect() as c:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        out = []
        for g in c.execute('SELECT id, sport, period, metric, target FROM goals WHERE user_id = %s ORDER BY id', (user['id'],)).fetchall():
            r = c.execute(f"""SELECT coalesce({col[g['metric']]}, 0) AS v FROM activities WHERE user_id = %s
                              AND (%s::text IS NULL OR sport = %s)
                              AND date_trunc(%s, start_time AT TIME ZONE %s) = date_trunc(%s, now() AT TIME ZONE %s)""",
                          (user['id'], g['sport'], g['sport'], g['period'], tz, g['period'], tz)).fetchone()
            out.append({**g, 'value': float(r['v'])})
        return out


@router.post('/goals')
def goal_add(body: GoalIn, user=Depends(current_user)):
    with db.connect() as c:
        return {'id': c.execute('INSERT INTO goals (user_id, sport, period, metric, target) VALUES (%s, %s, %s, %s, %s) RETURNING id',
                                (user['id'], body.sport, body.period, body.metric, body.target)).fetchone()['id']}


@router.delete('/goals/{gid}')
def goal_delete(gid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM goals WHERE id = %s AND user_id = %s RETURNING id', (gid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


@router.post('/activities/{aid}/coach')
def coach_note(aid: int, user=Depends(current_user)):
    try: return {'note': coach.note(user['id'], aid)}
    except ValueError as e: raise HTTPException(400, str(e))


@router.get('/coach/week')
def coach_week_get(user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute("SELECT period_start, text, created FROM coach_notes WHERE user_id = %s AND kind = 'week' ORDER BY period_start DESC LIMIT 1",
                      (user['id'],)).fetchone()
    return {'paused': not coach.ai_budget.enabled(), 'enabled': coach.allowed(user['id']), 'latest': r}


@router.post('/coach/week')
def coach_week_make(user=Depends(current_user)):
    try: return {'text': coach.week_review(user['id'])}
    except ValueError as e: raise HTTPException(400, str(e))


@router.get('/activity-food')
def activity_food_summary(user=Depends(current_user)):
    from . import activity_food
    with db.connect() as c:return activity_food.read(c,user['id'])


@router.get('/activities/{aid}/intervals')
def own_intervals(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('SELECT 1 FROM activities WHERE id=%s AND user_id=%s',(aid,user['id'])).fetchone():raise HTTPException(404,'Activity not found')
        rows=c.execute('SELECT payload FROM activity_intervals WHERE activity_id=%s AND user_id=%s ORDER BY recording_id',(aid,user['id'])).fetchall()
    return [r['payload'] for r in rows]
