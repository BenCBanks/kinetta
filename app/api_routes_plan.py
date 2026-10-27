"""Planned routes (#276, 2026-10-26): draw a route on the map, see its distance and climb, save it, use it in Track.

Planned routes are private to their owner and have nothing to do with segments, leaderboards or totals: saving one adds
no activity, record, heatmap line or competition entry. Matched routes (api_activities /routes) stay what they were:
groups of activities you repeated.

- The phone draws; this server measures. Distances, climb and limits are worked out here from the geometry, never
  taken from the phone. Every save is a new version, so Track can keep the exact version it loaded.
- Map services are called from here (route_providers.py) with coordinates only.
- Two devices editing one route: a save names the version it started from; if another save got there first the answer
  is 409 route_changed and the phone offers to reload or keep its edits as a copy, never a silent overwrite.
"""
import datetime as dt
import json
import re
import secrets
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from typing import Literal
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import db, route_geo, route_providers
from .auth import current_user

router = APIRouter(prefix='/api')
_downloads, _download_lock = {}, threading.Lock()
SPORT = Literal['run', 'walk', 'hike', 'ride']
GPX_MAX = 5 * 1024 * 1024
LEG_END_GAP_M = 600            # a followed path starts where the map service snapped the tap, close to the waypoint
WARN_MANUAL = 'Includes straight-line sections that are not known roads or trails.'


def _unavailable(e):
    raise HTTPException(503, {'code': 'provider_unavailable', 'message': str(e)})


# ---------- map services (coordinates in, lines out) ----------
class PathIn(BaseModel):
    sport: SPORT
    points: list[list[float]] = Field(min_length=2, max_length=26)


@router.post('/plan/path')
def plan_path(body: PathIn, user=Depends(current_user)):
    """Follow streets and trails between consecutive points (one leg per pair). A leg with no path comes back ok:false;
    the phone keeps the last good route and offers a clearly marked straight line instead."""
    if not all(route_geo.valid(p) for p in body.points): raise HTTPException(400, 'A point is outside the map')
    try: return {'legs': route_providers.route(user['id'], body.sport, [list(p) for p in body.points])}
    except route_providers.Unavailable as e: _unavailable(e)


class LineIn(BaseModel):
    line: str = Field(min_length=2, max_length=400_000)


def _line(s):
    try: pts = route_geo.decode(s)
    except ValueError: raise HTTPException(400, 'That route line is damaged')
    if len(pts) < 2 or not all(route_geo.valid(p) for p in pts): raise HTTPException(400, 'That route line is damaged')
    if len(pts) > route_geo.MAX_POINTS * 2: raise HTTPException(400, 'That route has too many points')
    return pts


@router.post('/plan/elevation')
def plan_elevation(body: LineIn, user=Depends(current_user)):
    pts = _line(body.line)
    if route_geo.length(pts) > route_geo.MAX_DISTANCE_M: raise HTTPException(400, 'Routes can be up to 500 km')
    try: return route_providers.elevation(user['id'], pts)
    except route_providers.Unavailable as e: _unavailable(e)


@router.get('/plan/search')
def plan_search(q: str = Query(min_length=2, max_length=120), lat: float | None = None, lon: float | None = None, user=Depends(current_user)):
    near = [lat, lon] if lat is not None and lon is not None else None
    try: return {'places': route_providers.search(user['id'], q, near)}
    except route_providers.Unavailable as e: _unavailable(e)


@router.get('/plan/services')
def plan_services(user=Depends(current_user)):
    return route_providers.status()


# ---------- validation: the server measures ----------
class LegIn(BaseModel):
    mode: Literal['path', 'manual', 'track']
    line: str = Field(min_length=2, max_length=400_000)


class PlanIn(BaseModel):
    waypoints: list[list[float]] = Field(min_length=2, max_length=route_geo.MAX_WAYPOINTS)
    legs: list[LegIn] = Field(min_length=1, max_length=route_geo.MAX_WAYPOINTS)


def measure(plan: PlanIn):
    """Check a drawn route and work out its line, distance and warnings. Rejects rather than trims (#275 item 6)."""
    way = plan.waypoints
    if not all(route_geo.valid(p) for p in way): raise HTTPException(400, 'A point is outside the map')
    if len(plan.legs) != len(way) - 1: raise HTTPException(400, 'Each connection needs a line')
    line, legs, manual = [], [], 0
    for i, leg in enumerate(plan.legs):
        pts = _line(leg.line)
        a, b = way[i], way[i + 1]
        if leg.mode == 'manual':
            if len(pts) != 2 or route_geo.dist(pts[0], a) > 2 or route_geo.dist(pts[1], b) > 2:
                raise HTTPException(400, 'A straight connection must join its two points')
            manual += 1
        elif route_geo.dist(pts[0], a) > LEG_END_GAP_M or route_geo.dist(pts[-1], b) > LEG_END_GAP_M:
            raise HTTPException(400, 'A connection does not reach its points. Re-plan it and save again.')
        legs.append({'mode': leg.mode, 'line': route_geo.encode(pts)})
        line += pts if not line else pts[1:] if route_geo.dist(line[-1], pts[0]) < 1 else pts
    if len(line) > route_geo.MAX_POINTS: raise HTTPException(400, f'Routes can have up to {route_geo.MAX_POINTS:,} map points. Split it into two routes.')
    distance = route_geo.length(line)
    if distance > route_geo.MAX_DISTANCE_M: raise HTTPException(400, 'Routes can be up to 500 km')
    if distance < 1: raise HTTPException(400, 'Add a second point somewhere else to make a route')
    warnings = [{'code': 'manual', 'legs': [i for i, l in enumerate(legs) if l['mode'] == 'manual'], 'text': WARN_MANUAL}] if manual else []
    return {'waypoints': [[round(p[0], 6), round(p[1], 6)] for p in way], 'legs': legs, 'line': line,
            'distance_m': round(distance, 1), 'warnings': warnings}


def _wkt(line):
    return 'LINESTRING(' + ','.join(f'{lo:.6f} {la:.6f}' for la, lo in line) + ')'


def _elevation(uid, line):
    try: return route_providers.elevation(uid, line)
    except route_providers.Unavailable: return None      # climb stays unknown; the route still saves


# ---------- saved routes ----------
class RouteIn(PlanIn):
    client_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    sport: SPORT
    source: Literal['drawn', 'gpx', 'activity', 'copy'] = 'drawn'
    base_version: int | None = None          # the version this edit started from (updates only)


SUMMARY = """SELECT r.id, r.name, r.description, r.sport, r.source, r.version, r.created, r.updated,
                    v.distance_m, v.ascent_m, v.descent_m, v.warnings, ST_AsGeoJSON(ST_Simplify(v.geom, %(tol)s)) AS g
             FROM planned_routes r JOIN planned_route_versions v ON v.route_id = r.id AND v.version = r.version"""


def _summary(r, full=False):
    out = {k: r[k] for k in ('id', 'name', 'description', 'sport', 'source', 'version', 'created', 'updated', 'distance_m', 'ascent_m', 'descent_m', 'warnings')}
    out['line'] = route_geo.encode([[la, lo] for lo, la in json.loads(r['g'])['coordinates']]) if r.get('g') else None
    if full:
        out.update(waypoints=r['waypoints'], legs=r['legs'], elevation=r['elevation'])
    return out


def _clean(s):
    s = (s or '').strip()
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s) or None


def _owned(c, uid, rid, lock=False):
    r = c.execute(f"SELECT * FROM planned_routes WHERE id = %s AND user_id = %s {'FOR UPDATE' if lock else ''}", (rid, uid)).fetchone()
    if not r: raise HTTPException(404, 'Route not found')
    return r


def _add_version(c, uid, rid, version, m, elev):
    c.execute("""INSERT INTO planned_route_versions (route_id, user_id, version, waypoints, legs, geom, distance_m, ascent_m, descent_m, elevation, warnings)
                 VALUES (%s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s, %s)""",
              (rid, uid, version, json.dumps(m['waypoints']), json.dumps(m['legs']), _wkt(m['line']), m['distance_m'],
               elev and elev['ascent_m'], elev and elev['descent_m'], json.dumps(elev) if elev else None, json.dumps(m['warnings'])))


@router.get('/planned-routes')
def planned_routes(q: str = Query('', max_length=120), sport: str = Query('', pattern='^(|run|walk|hike|ride)$'), user=Depends(current_user)):
    where, args = ['r.user_id = %(u)s'], {'u': user['id'], 'tol': 0.00008}
    if q.strip():
        where.append("r.name ILIKE %(m)s"); args['m'] = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    if sport: where.append('r.sport = %(s)s'); args['s'] = sport
    with db.connect() as c:
        rows = c.execute(SUMMARY + ' WHERE ' + ' AND '.join(where) + ' ORDER BY r.updated DESC LIMIT 200', args).fetchall()
    return [_summary(r) for r in rows]


@router.get('/planned-routes/{rid}')
def planned_route(rid: int, version: int | None = None, user=Depends(current_user)):
    with db.connect() as c:
        r = _owned(c, user['id'], rid)
        v = c.execute("""SELECT v.*, ST_AsGeoJSON(v.geom) AS g FROM planned_route_versions v
                         WHERE v.route_id = %s AND v.user_id = %s AND v.version = %s""", (rid, user['id'], version or r['version'])).fetchone()
        if not v: raise HTTPException(404, 'That version of the route is gone')
    return _summary({**r, **{k: v[k] for k in v if k not in ('version', 'created')}, 'g': v['g']}, full=True) | {'loaded_version': v['version']}


@router.post('/planned-routes')
def create_route(body: RouteIn, user=Depends(current_user)):
    """Save a new route. Saving twice (a lost answer, a double tap) returns the first one."""
    from .route_sharing import rate
    rate('create', user['id'], 100, 300)
    m = measure(body)
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (f"plan:{user['id']}:{body.client_id}",))
        had = c.execute('SELECT id FROM planned_routes WHERE user_id = %s AND client_id = %s', (user['id'], str(body.client_id))).fetchone()
        if had: return planned_route(had['id'], user=user) | {'duplicate': True}
    elev = _elevation(user['id'], m['line'])      # outside the transaction: a slow provider never holds a connection
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (f"plan:{user['id']}:{body.client_id}",))
        had = c.execute('SELECT id FROM planned_routes WHERE user_id = %s AND client_id = %s', (user['id'], str(body.client_id))).fetchone()
        if had: return planned_route(had['id'], user=user) | {'duplicate': True}
        rid = c.execute("""INSERT INTO planned_routes (user_id, client_id, name, description, sport, source)
                           VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                        (user['id'], str(body.client_id), _clean(body.name) or 'Route', _clean(body.description), body.sport, body.source)).fetchone()['id']
        _add_version(c, user['id'], rid, 1, m, elev)
        c.execute('DELETE FROM route_drafts WHERE user_id = %s AND draft_key = %s', (user['id'], 'new'))
    return planned_route(rid, user=user) | {'duplicate': False}


@router.put('/planned-routes/{rid}')
def update_route(rid: int, body: RouteIn, user=Depends(current_user)):
    """Save an edit as a new version. Segments made from this route are separate copies and never change."""
    m = measure(body)
    elev = _elevation(user['id'], m['line'])
    with db.connect() as c:
        r = _owned(c, user['id'], rid, lock=True)
        if body.base_version is not None and body.base_version != r['version']:
            raise HTTPException(409, {'code': 'route_changed', 'version': r['version'],
                                      'message': 'This route was changed on another device. Reload it, or save your edits as a copy.'})
        version = r['version'] + 1
        _add_version(c, user['id'], rid, version, m, elev)
        c.execute("""UPDATE planned_routes SET name = %s, description = %s, sport = %s, version = %s, updated = now()
                     WHERE id = %s AND user_id = %s""", (_clean(body.name) or r['name'], _clean(body.description), body.sport, version, rid, user['id']))
        c.execute('DELETE FROM route_drafts WHERE user_id = %s AND draft_key = %s', (user['id'], f'route-{rid}'))
    return planned_route(rid, user=user)


class RenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)


@router.patch('/planned-routes/{rid}')
def rename_route(rid: int, body: RenameIn, user=Depends(current_user)):
    with db.connect() as c:
        _owned(c, user['id'], rid)
        c.execute('UPDATE planned_routes SET name = %s, description = %s, updated = now() WHERE id = %s AND user_id = %s',
                  (_clean(body.name) or 'Route', _clean(body.description), rid, user['id']))
    return planned_route(rid, user=user)


class CopyIn(BaseModel):
    client_id: uuid.UUID
    name: str | None = Field(None, max_length=120)


@router.post('/planned-routes/{rid}/duplicate')
def duplicate_route(rid: int, body: CopyIn, user=Depends(current_user)):
    """An independent copy: later edits to either one leave the other alone."""
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (f"plan:{user['id']}:{body.client_id}",))
        had = c.execute('SELECT id FROM planned_routes WHERE user_id = %s AND client_id = %s', (user['id'], str(body.client_id))).fetchone()
        if not had:
            r = _owned(c, user['id'], rid)
            name = _clean(body.name) or (r['name'][:113] + ' (copy)')
            new = c.execute("""INSERT INTO planned_routes (user_id, client_id, name, description, sport, source)
                               VALUES (%s, %s, %s, %s, %s, 'copy') RETURNING id""",
                            (user['id'], str(body.client_id), name, r['description'], r['sport'])).fetchone()['id']
            c.execute("""INSERT INTO planned_route_versions (route_id, user_id, version, waypoints, legs, geom, distance_m, ascent_m, descent_m, elevation, warnings)
                         SELECT %s, user_id, 1, waypoints, legs, geom, distance_m, ascent_m, descent_m, elevation, warnings
                         FROM planned_route_versions WHERE route_id = %s AND user_id = %s AND version = %s""", (new, rid, user['id'], r['version']))
        else: new = had['id']
    return planned_route(new, user=user)


@router.delete('/planned-routes/{rid}')
def delete_route(rid: int, user=Depends(current_user)):
    """Deletes the route and all its versions. Activities recorded with it, copies and segments made from it stay."""
    with db.connect() as c:
        _owned(c, user['id'], rid)
        c.execute('DELETE FROM planned_routes WHERE id = %s AND user_id = %s', (rid, user['id']))
        c.execute('DELETE FROM route_drafts WHERE user_id = %s AND draft_key = %s', (user['id'], f'route-{rid}'))
    return {'ok': True}


# ---------- autosaved drafts ----------
class DraftIn(BaseModel):
    data: dict


@router.get('/route-drafts/{key}')
def get_draft(key: str = Path(pattern='^[a-z0-9:-]{1,80}$'), user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute('SELECT data, updated FROM route_drafts WHERE user_id = %s AND draft_key = %s', (user['id'], key)).fetchone()
    return r or {'data': None, 'updated': None}


@router.put('/route-drafts/{key}')
def put_draft(body: DraftIn, key: str = Path(pattern='^[a-z0-9:-]{1,80}$'), user=Depends(current_user)):
    raw = json.dumps(body.data)
    if len(raw) > 1_500_000: raise HTTPException(413, 'This draft is too big to autosave')
    with db.connect() as c:
        r = c.execute("""INSERT INTO route_drafts (user_id, draft_key, data) VALUES (%s, %s, %s)
                         ON CONFLICT (user_id, draft_key) DO UPDATE SET data = EXCLUDED.data, updated = now() RETURNING updated""",
                      (user['id'], key, raw)).fetchone()
    return {'updated': r['updated']}


@router.delete('/route-drafts/{key}')
def delete_draft(key: str = Path(pattern='^[a-z0-9:-]{1,80}$'), user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM route_drafts WHERE user_id = %s AND draft_key = %s', (user['id'], key))
    return {'ok': True}


# ---------- GPX in and out ----------
def _local(tag): return tag.rsplit('}', 1)[-1]


def read_gpx_lines(data):
    """Tracks and routes in a GPX file as separate lines [{name, points}]. Times, names of people, devices and every
    other detail are dropped: a planned route keeps only the shape. DOCTYPEs/entities are refused outright."""
    if len(data) > GPX_MAX: raise HTTPException(413, 'GPX files can be up to 5 MB')
    head = data[:4096].lower()
    if b'<!doctype' in head or b'<!entity' in data.lower(): raise HTTPException(400, 'That GPX file uses features we don\'t open')
    try: root = ET.fromstring(data.lstrip(b'\xef\xbb\xbf \r\n\t'))
    except ET.ParseError: raise HTTPException(400, 'That file isn\'t a readable GPX file')
    if _local(root.tag) != 'gpx': raise HTTPException(400, 'That file isn\'t a GPX file')
    out, total = [], 0
    for el in root:
        kind = _local(el.tag)
        if kind not in ('trk', 'rte'): continue
        name = next((c.text.strip()[:120] for c in el if _local(c.tag) == 'name' and c.text and c.text.strip()), None)
        groups = [[c for c in s if _local(c.tag) == 'trkpt'] for s in el if _local(s.tag) == 'trkseg'] if kind == 'trk' else [[c for c in el if _local(c.tag) == 'rtept']]
        for n, pts in enumerate(groups):
            line = []
            for p in pts:
                try: q = [float(p.get('lat')), float(p.get('lon'))]
                except (TypeError, ValueError): raise HTTPException(400, 'A point in that file has no proper position')
                if not route_geo.valid(q): raise HTTPException(400, 'A point in that file is outside the map')
                line.append(q)
            total += len(line)
            if total > 200_000: raise HTTPException(400, 'That file has too many points')
            if len(line) > 1:
                label = name or ('Track' if kind == 'trk' else 'Route')
                out.append({'name': label + (f' · part {n + 1}' if len(groups) > 1 else ''), 'points': line})
    if not out: raise HTTPException(400, 'That GPX file has no track or route in it')
    return out


def _as_draft(points):
    pts = route_geo.simplify(points, 1.0) if len(points) > route_geo.MAX_POINTS else points
    if len(pts) > route_geo.MAX_POINTS: pts = route_geo.simplify(points, 4.0)
    if len(pts) > route_geo.MAX_POINTS: raise HTTPException(400, 'That line is too detailed to plan with. Try a shorter part.')
    d = route_geo.length(pts)
    if d > route_geo.MAX_DISTANCE_M: raise HTTPException(400, 'Routes can be up to 500 km')
    return route_geo.to_draft(pts) | {'distance_m': round(d, 1)}


class GpxIn(BaseModel):
    gpx: str = Field(min_length=1, max_length=GPX_MAX)


@router.post('/planned-routes/import')
def import_gpx(body: GpxIn, user=Depends(current_user)):
    """Read a GPX file into a draft (nothing is saved). The phone sends the file's text as JSON, so the app's rule that
    writes are JSON (main.py guard) holds. Several tracks come back separately: the person picks one, because joining
    unrelated tracks would invent a connection."""
    lines = read_gpx_lines(body.gpx.encode('utf-8', 'replace'))
    return {'tracks': [{'name': t['name'], **_as_draft(t['points'])} for t in lines[:20]], 'more': max(0, len(lines) - 20)}


def gpx_for(name, points, description=None):
    pts = ''.join(f'<trkpt lat="{la:.6f}" lon="{lo:.6f}"></trkpt>' for la, lo in points)
    desc = f'<desc>{escape(description)}</desc>' if description else ''
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Kinetta" xmlns="http://www.topografix.com/GPX/1/1">'
            f'<trk><name>{escape(name)}</name>{desc}<trkseg>{pts}</trkseg></trk></gpx>\n')


@router.get('/planned-routes/{rid}/gpx')
def export_gpx(rid: int, description: bool = False, user=Depends(current_user)):
    """The route's shape and name (and its description only if asked): no times, account or device details."""
    r = planned_route(rid, user=user)
    with db.connect() as c:
        g = c.execute('SELECT ST_AsGeoJSON(geom) AS g FROM planned_route_versions WHERE route_id = %s AND user_id = %s AND version = %s',
                      (rid, user['id'], r['version'])).fetchone()['g']
    pts = [[la, lo] for lo, la in json.loads(g)['coordinates']]
    safe = re.sub(r'[^a-zA-Z0-9 .-]+', '', r['name']).strip()[:60] or 'route'
    return Response(gpx_for(r['name'], pts, r['description'] if description else None), media_type='application/gpx+xml',
                    headers={'Content-Disposition': f'attachment; filename="{safe}.gpx"'})


class GpxLinkIn(BaseModel):
    description: bool = False


@router.post('/planned-routes/{rid}/gpx-link')
def gpx_link(rid: int, body: GpxLinkIn, user=Depends(current_user)):
    """Short-lived, single-use Safari download. A link never grants access to another route."""
    planned_route(rid, user=user)
    key, now = secrets.token_urlsafe(32), time.monotonic()
    with _download_lock:
        for k in list(_downloads):
            if _downloads[k][0] < now: del _downloads[k]
        if len(_downloads) >= 256: raise HTTPException(429, 'Downloads are busy. Try again shortly.')
        _downloads[key] = (now + 60, user['id'], rid, body.description)
    return {'path': '/api/planned-routes/download/' + key}


@router.get('/planned-routes/download/{key}')
def gpx_download(key: str):
    with _download_lock: ticket = _downloads.pop(key, None)
    if not ticket or ticket[0] < time.monotonic(): raise HTTPException(404, 'Download expired. Ask for a new link in the app.')
    _, uid, rid, description = ticket
    with db.connect() as c:
        if not c.execute('SELECT 1 FROM users WHERE id = %s AND suspended_at IS NULL', (uid,)).fetchone():
            raise HTTPException(404, 'Download no longer available')
    response = export_gpx(rid, description, user={'id': uid})
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


# ---------- from your own activity ----------
@router.get('/activities/{aid}/sections')
def activity_sections(aid: int, user=Depends(current_user)):
    """The GPS sections of your own activity, split wherever the recording had a gap (gaps are never joined up)."""
    with db.connect() as c:
        a = c.execute('SELECT sport, name FROM activities WHERE id = %s AND user_id = %s', (aid, user['id'])).fetchone()
        if not a: raise HTTPException(404, 'Not found')
        s = c.execute('SELECT t, lat, lon FROM activity_streams WHERE activity_id = %s AND user_id = %s', (aid, user['id'])).fetchone()
    secs = route_geo.split_gaps(s and s['lat'], s and s['lon'], s and s['t']) if s else []
    out = []
    for pts in secs:
        if len(pts) > 4000: pts = route_geo.simplify(pts, 2.0)
        out.append({'line': route_geo.encode(pts), 'distance_m': round(route_geo.length(pts), 1)})
    return {'sport': a['sport'], 'name': a['name'], 'sections': out}


class FromActivityIn(BaseModel):
    activity_id: int
    section: int = Field(ge=0, le=1000)
    start_m: float = Field(ge=0)
    end_m: float = Field(gt=0)


def activity_part(uid, body):
    """The chosen stretch of one section of your own activity: positions only (no times, heart rate or notes)."""
    with db.connect() as c:
        s = c.execute('SELECT s.t, s.lat, s.lon, a.sport FROM activity_streams s JOIN activities a ON a.id = s.activity_id WHERE s.activity_id = %s AND s.user_id = %s AND a.user_id = %s',
                      (body.activity_id, uid, uid)).fetchone()
    if not s: raise HTTPException(404, 'Not found')
    secs = route_geo.split_gaps(s['lat'], s['lon'], s['t'])
    if body.section >= len(secs): raise HTTPException(400, 'Choose one of the recorded sections')
    pts = secs[body.section]
    if body.end_m - body.start_m < 20: raise HTTPException(400, 'Choose a longer stretch')
    return route_geo.slice_line(pts, body.start_m, body.end_m), s['sport']


@router.post('/planned-routes/from-activity')
def route_from_activity(body: FromActivityIn, user=Depends(current_user)):
    pts, sport = activity_part(user['id'], body)
    return _as_draft(pts) | {'sport': sport if sport in ('run', 'walk', 'hike', 'ride') else 'run'}
