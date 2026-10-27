"""Reviewed route projections (#277). Every recipient representation starts at visible(), never at a private route DTO.

Publication is a snapshot: editing the private source cannot widen it. A later increase in endpoint protection
can only shorten that snapshot. No private notes, original extents, source activity or provider requests leave here.
"""
import datetime as dt
import hashlib
import json
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import contextmanager
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from psycopg import errors

from . import auth, db, route_geo
from . import api_routes_plan as plans
from .api_social import blocked, unconfirmed, confirmed, MIN_SHOWN_M
from .admin_auth import admin_user
from .admin_auth import audit
from .api_account import _admin
from .admin_actions import ActionIn, replay, complete

router = APIRouter(prefix='/api')
_hits, _hit_lock = defaultdict(deque), threading.Lock()
_tickets, _ticket_lock = {}, threading.Lock()
_queries = threading.BoundedSemaphore(4)
FRIEND = """EXISTS (SELECT 1 FROM friendships f WHERE f.status='accepted' AND
 ((f.requester=r.user_id AND f.addressee=%(viewer)s) OR (f.addressee=r.user_id AND f.requester=%(viewer)s)))"""
AUTHORIZED = f"""r.share_audience<>'me' AND NOT r.share_disabled AND NOT {unconfirmed('r.user_id')}
 AND NOT {blocked('r.user_id')} AND (r.share_audience='everyone' OR {FRIEND} OR r.user_id=%(viewer)s)"""
PUBLICATION = """SELECT r.id,r.user_id,r.share_audience,r.share_revision,r.share_disabled,
 p.data,p.hidden_start_m,p.hidden_end_m,p.revision,p.source_version,
 coalesce(pr.share_trim_m,400) AS trim_m,u.login::text AS login,u.name AS owner_name,u.photo_v
 FROM planned_routes r JOIN route_publications p ON p.route_id=r.id
 JOIN users u ON u.id=r.user_id LEFT JOIN profile pr ON pr.user_id=r.user_id"""


def rate(kind, uid, count=120, seconds=60):
    with _hit_lock:
        q, now = _hits[kind, uid], time.monotonic()
        while q and now-q[0] > seconds: q.popleft()
        if len(q) >= count: raise HTTPException(429, 'Too many route requests. Wait a moment, then try again.')
        q.append(now)


def access_lock(c, first, second):
    """Serialize copying/export handoff with block/friendship revocation for this pair."""
    a,b=sorted((first,second))
    c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(f'route-access:{a}:{b}',))


@contextmanager
def query_slot():
    if not _queries.acquire(blocking=False):raise HTTPException(503,'Shared route search is busy. Try again shortly.')
    try:yield
    finally:_queries.release()


def changed():
    raise HTTPException(409, {'code': 'route_share_changed', 'message': 'The route, its sharing or privacy protection changed. Review the current preview again.'})


def _heights(elevation, start, end):
    """Normalize only the visible profile; never retain the private distance axis or source request metadata."""
    raw = (elevation or {}).get('profile') or []
    if len(raw) < 2: return None
    def height(m):
        if raw[0][0]-1<=m<=raw[0][0]:return raw[0][1]
        if raw[-1][0]<=m<=raw[-1][0]+1:return raw[-1][1]
        for a, b in zip(raw, raw[1:]):
            if a[0] <= m <= b[0]:
                if a[1] is None or b[1] is None: return None
                return round(a[1]+(b[1]-a[1])*(m-a[0])/max(b[0]-a[0],.0001),1)
        return None
    profile = [[0,height(start)]] + [[round(x-start,1),y] for x,y in raw if start<x<end] + [[round(end-start,1),height(end)]]
    known = all(y is not None for _,y in profile)
    up, down = route_geo.climb([y for _,y in profile]) if known else (None,None)
    return {'profile':profile,'ascent_m':up,'descent_m':down,'source':'Approximate terrain heights'}


def _clip(data, start, end):
    points = route_geo.decode(data['line']); total = route_geo.length(points)
    start, end = max(0,start), min(total,end)
    if end-start < MIN_SHOWN_M: raise HTTPException(400, 'Too little route remains after hiding the ends. Choose a longer public stretch.')
    line = route_geo.encode(route_geo.slice_line(points,start,end))
    # Measure the actual transmitted line, after rounding, rather than publishing the private total.
    distance = round(route_geo.length(route_geo.decode(line)),1)
    elev = _heights(data.get('elevation'),start,end)
    return {'name':data['name'],'description':data.get('description') or None,'sport':data['sport'],
            'line':line,'distance_m':distance,'ascent_m':elev and elev['ascent_m'],
            'descent_m':elev and elev['descent_m'],'elevation':elev,'warnings':data.get('warnings') or []}


def projection(row):
    """A fixed allowlist. More-protective account settings apply immediately, even to old publications."""
    data = row['data']; total = route_geo.length(route_geo.decode(data['line']))
    left = max(0,row['trim_m']+3-row['hidden_start_m']) if row['trim_m'] else 0
    right = max(0,row['trim_m']+3-row['hidden_end_m']) if row['trim_m'] else 0
    out = ({k:data.get(k) for k in ('name','description','sport','line','distance_m','ascent_m','descent_m','elevation','warnings')}
           if left==0 and right==0 else _clip(data,left,total-right))
    out.update(id=row['id'],version=row['revision'],audience=row['share_audience'],
               owner={'login':row['login'],'name':row['owner_name'],'photo':row['photo_v']})
    out['snapshot_key'] = hashlib.sha256(json.dumps(out,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return out


def visible(c, uid, rid, lock=False):
    if lock:
        seed=c.execute('SELECT user_id FROM planned_routes WHERE id=%s',(rid,)).fetchone()
        if not seed:raise HTTPException(404,'Shared route not available')
        access_lock(c,uid,seed['user_id'])
        people=c.execute('SELECT id,suspended_at,needs_email_confirm,password_change_expires FROM users WHERE id=ANY(%s) ORDER BY id FOR SHARE',([uid,seed['user_id']],)).fetchall()
        if not any(p['id']==uid and not p['suspended_at'] and not p['needs_email_confirm'] and not p['password_change_expires'] for p in people):
            raise HTTPException(403,'Confirm an active account before saving a shared route')
        _policy(c,seed['user_id'],True)
    row = c.execute(PUBLICATION+f' WHERE r.id=%(rid)s AND {AUTHORIZED}'+(' FOR SHARE OF r,p' if lock else ''), {'rid':rid,'viewer':uid}).fetchone()
    if not row: raise HTTPException(404, 'Shared route not available')
    try: return projection(row)
    except HTTPException: raise HTTPException(404, 'Shared route not available')


def _policy(c, uid, lock=False):
    r = c.execute('SELECT share_trim_m FROM profile WHERE user_id=%s'+(' FOR SHARE' if lock else ''),(uid,)).fetchone()
    return r['share_trim_m'] if r else 400


def _state(c, uid, rid):
    r = plans._owned(c,uid,rid)
    p = c.execute('SELECT source_version FROM route_publications WHERE route_id=%s AND user_id=%s',(rid,uid)).fetchone()
    return {'audience':r['share_audience'],'revision':r['share_revision'],'disabled':r['share_disabled'],
            'route_version':r['version'],'published_source_version':p and p['source_version']}


@router.get('/planned-routes/{rid}/sharing')
def state(rid:int,user=Depends(auth.current_user)):
    with db.connect() as c: return _state(c,user['id'],rid)


class PreviewIn(BaseModel):
    audience:Literal['friends','everyone']
    name:str=Field(min_length=1,max_length=120)
    description:str=Field('',max_length=2000)
    start_m:float=Field(0,ge=0,allow_inf_nan=False)
    end_m:float|None=Field(None,gt=0,allow_inf_nan=False)


@router.post('/planned-routes/{rid}/sharing/preview')
def preview(rid:int,body:PreviewIn,user=Depends(auth.current_user)):
    rate('preview',user['id'],20,300)
    with db.connect() as c:
        confirmed(c,user['id']);r=plans._owned(c,user['id'],rid,lock=True)
        if r['share_disabled']: raise HTTPException(403,'Sharing for this route was removed after a report. Contact support before publishing it again.')
        v=c.execute('SELECT *,ST_AsGeoJSON(geom) AS g FROM planned_route_versions WHERE route_id=%s AND user_id=%s AND version=%s',(rid,user['id'],r['version'])).fetchone()
        trim=_policy(c,user['id'],True)
        pts=[[la,lo] for lo,la in json.loads(v['g'])['coordinates']];total=route_geo.length(pts)
        start=max(body.start_m,trim+3 if trim else 0);end=min(body.end_m or total,total-(trim+3 if trim else 0))
        # Private notes are never a default. The publisher deliberately supplies the public name/description.
        data={'name':plans._clean(body.name) or 'Route','description':plans._clean(body.description),'sport':r['sport'],
              'line':route_geo.encode(pts),'elevation':v['elevation'],'warnings':[]}
        offset=0.0;previous=None
        for leg in v['legs']:
            leg_points=route_geo.decode(leg['line'])
            if previous is not None:offset+=route_geo.dist(previous,leg_points[0])
            size=route_geo.length(leg_points)
            if leg['mode']=='manual' and min(end,offset+size)>max(start,offset):
                data['warnings']=[{'code':'manual','text':'This plan includes straight connections; verify access before following it.'}]
            offset+=size;previous=leg_points[-1]
        data=_clip(data,start,end)
        c.execute('DELETE FROM route_share_previews WHERE expires<now()')
        if c.execute('SELECT count(*) AS n FROM route_share_previews WHERE user_id=%s',(user['id'],)).fetchone()['n']>=40:
            raise HTTPException(429,'Finish or wait for your earlier sharing previews before creating another.')
        key=uuid.uuid4()
        c.execute('''INSERT INTO route_share_previews(id,user_id,route_id,source_version,route_updated,share_revision,policy_trim,audience,data,hidden_start_m,hidden_end_m)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(key,user['id'],rid,r['version'],r['updated'],r['share_revision'],trim,body.audience,json.dumps(data),start,total-end))
        return {'preview_id':str(key),'audience':body.audience,'route':data,'expires_in':900,
                'notice':'Others receive only this preview. Deliberate copies, exports and screenshots cannot be recalled.'}


class PublishIn(BaseModel):
    preview_id:uuid.UUID
    confirmed:bool


@router.put('/planned-routes/{rid}/sharing')
def publish(rid:int,body:PublishIn,user=Depends(auth.current_user)):
    rate('publish',user['id'],40,300)
    if not body.confirmed: raise HTTPException(400,'Review and confirm the recipient preview first')
    with db.connect() as c:
        confirmed(c,user['id']);r=plans._owned(c,user['id'],rid,lock=True)
        p=c.execute('SELECT * FROM route_share_previews WHERE id=%s AND user_id=%s AND route_id=%s AND expires>now() FOR UPDATE',(body.preview_id,user['id'],rid)).fetchone()
        if not p: raise HTTPException(409,'This preview expired. Open a new recipient preview.')
        if p['consumed_revision'] is not None:
            if r['share_revision']!=p['consumed_revision']: changed()
            return _state(c,user['id'],rid)|{'duplicate':True}
        trim=_policy(c,user['id'],True)
        if r['share_disabled'] or (r['version'],r['updated'],r['share_revision'],trim)!=(p['source_version'],p['route_updated'],p['share_revision'],p['policy_trim']): changed()
        revision=r['share_revision']+1;data=p['data']
        c.execute('''INSERT INTO route_publications(route_id,user_id,revision,source_version,data,geom,hidden_start_m,hidden_end_m)
          VALUES(%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326),%s,%s)
          ON CONFLICT(route_id) DO UPDATE SET revision=EXCLUDED.revision,source_version=EXCLUDED.source_version,data=EXCLUDED.data,
          geom=EXCLUDED.geom,hidden_start_m=EXCLUDED.hidden_start_m,hidden_end_m=EXCLUDED.hidden_end_m,created=now()''',
          (rid,user['id'],revision,p['source_version'],json.dumps(data),plans._wkt(route_geo.decode(data['line'])),p['hidden_start_m'],p['hidden_end_m']))
        c.execute('UPDATE planned_routes SET share_audience=%s,share_revision=%s WHERE id=%s AND user_id=%s',(p['audience'],revision,rid,user['id']))
        c.execute('UPDATE route_share_previews SET consumed_revision=%s WHERE id=%s',(revision,body.preview_id))
        return _state(c,user['id'],rid)|{'duplicate':False}


class UnshareIn(BaseModel):
    revision:int=Field(ge=0)


@router.post('/planned-routes/{rid}/unshare')
def unshare(rid:int,body:UnshareIn,user=Depends(auth.current_user)):
    with db.connect() as c:
        r=plans._owned(c,user['id'],rid,lock=True)
        if r['share_revision']!=body.revision: changed()
        c.execute("UPDATE planned_routes SET share_audience='me',share_revision=share_revision+1 WHERE id=%s AND user_id=%s",(rid,user['id']))
        c.execute('DELETE FROM route_publications WHERE route_id=%s AND user_id=%s',(rid,user['id']))
        return _state(c,user['id'],rid)


@router.get('/shared-routes')
def discover(q:str=Query('',max_length=120),sport:Literal['','run','walk','hike','ride']='',scope:Literal['everyone','friends']='everyone',
             lat:float|None=Query(None,ge=-90,le=90),lon:float|None=Query(None,ge=-180,le=180),radius_km:float=Query(10,gt=0,le=100),
             min_km:float|None=Query(None,ge=0,le=500),max_km:float|None=Query(None,ge=0,le=500),
             min_climb:float|None=Query(None,ge=0,le=30000),max_climb:float|None=Query(None,ge=0,le=30000),
             before:int|None=Query(None,gt=0),user=Depends(auth.current_user)):
    rate('read',user['id'])
    if (lat is None)!=(lon is None): raise HTTPException(400,'Choose both coordinates for the map area')
    if min_km is not None and max_km is not None and min_km>max_km:raise HTTPException(400,'Minimum distance must not exceed maximum distance')
    if min_climb is not None and max_climb is not None and min_climb>max_climb:raise HTTPException(400,'Minimum climb must not exceed maximum climb')
    where=[AUTHORIZED];args={'viewer':user['id']}
    if scope=='everyone':where.append("r.share_audience='everyone'")
    else:where.append(FRIEND)
    if q.strip():where.append("p.data->>'name' ILIKE %(q)s");args['q']='%'+q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
    if sport:where.append("p.data->>'sport'=%(sport)s");args['sport']=sport
    if before:where.append('r.id<%(before)s');args['before']=before
    if lat is not None:
        where.append('ST_DWithin(p.geom::geography,ST_SetSRID(ST_MakePoint(%(lon)s,%(lat)s),4326)::geography,%(radius)s)')
        args.update(lat=lat,lon=lon,radius=radius_km*1000)
    with query_slot(),db.connect() as c:
        candidates=c.execute(PUBLICATION+' WHERE '+' AND '.join(where)+' ORDER BY r.id DESC LIMIT 200',args).fetchall()
        rows=[];last=None
        for r in candidates:
            last=r['id']
            try:d=projection(r)
            except HTTPException:continue
            km=d['distance_m']/1000;climb=d['ascent_m']
            if min_km is not None and km<min_km or max_km is not None and km>max_km:continue
            if min_climb is not None and (climb is None or climb<min_climb) or max_climb is not None and (climb is None or climb>max_climb):continue
            if lat is not None and not c.execute('SELECT ST_DWithin(ST_GeomFromText(%s,4326)::geography,ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,%s) AS near',
                    (plans._wkt(route_geo.decode(d['line'])),lon,lat,radius_km*1000)).fetchone()['near']:continue
            rows.append(d)
            if len(rows)==25:break
    return {'rows':rows,'next':last if len(rows)==25 or len(candidates)==200 else None}


@router.get('/shared-routes/{rid}')
def shared(rid:int,user=Depends(auth.current_user)):
    rate('read',user['id'])
    with db.connect() as c:return visible(c,user['id'],rid)


class CopyIn(BaseModel):
    client_id:uuid.UUID
    snapshot_key:str=Field(pattern='^[a-f0-9]{64}$')


@router.post('/shared-routes/{rid}/copy')
def copy(rid:int,body:CopyIn,user=Depends(auth.current_user)):
    rate('copy',user['id'],40,300)
    with db.connect() as c:
        confirmed(c,user['id'])
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(f'plan:{user["id"]}:{body.client_id}',))
        d=visible(c,user['id'],rid,True)
        if d['snapshot_key']!=body.snapshot_key:changed()
        old=c.execute('SELECT * FROM route_copy_receipts WHERE user_id=%s AND client_id=%s',(user['id'],body.client_id)).fetchone()
        if old:
            if old['source_route_id']!=rid or old['snapshot_key']!=body.snapshot_key:changed()
            if not old['destination_id']:raise HTTPException(409,'You removed this copy. Open a new copy confirmation if you want another.')
            return {'id':old['destination_id'],'duplicate':True}
        if c.execute('SELECT 1 FROM planned_routes WHERE user_id=%s AND client_id=%s',(user['id'],body.client_id)).fetchone():
            raise HTTPException(409,'This save identifier belongs to another route. Open a new copy confirmation.')
        pts=route_geo.decode(d['line']);draft=route_geo.to_draft(pts);m=plans.measure(plans.PlanIn(**draft))
        m['warnings']=d['warnings']
        new=c.execute('''INSERT INTO planned_routes(user_id,client_id,name,description,sport,source,source_route_id)
          VALUES(%s,%s,%s,%s,%s,'copy',%s) RETURNING id''',(user['id'],body.client_id,d['name'],d['description'],d['sport'],rid)).fetchone()['id']
        plans._add_version(c,user['id'],new,1,m,d['elevation'])
        c.execute('INSERT INTO route_copy_receipts(user_id,client_id,source_route_id,destination_id,snapshot_key) VALUES(%s,%s,%s,%s,%s)',
                  (user['id'],body.client_id,rid,new,body.snapshot_key))
        return {'id':new,'duplicate':False}


def _gpx(d):
    safe=plans.re.sub(r'[^a-zA-Z0-9 .-]+','',d['name']).strip()[:60] or 'route'
    return Response(plans.gpx_for(d['name'],route_geo.decode(d['line']),d['description']),media_type='application/gpx+xml',
                    headers={'Content-Disposition':f'attachment; filename="{safe}.gpx"','Cache-Control':'no-store','Referrer-Policy':'no-referrer'})


@router.get('/shared-routes/{rid}/gpx')
def gpx(rid:int,snapshot_key:str=Query(pattern='^[a-f0-9]{64}$'),user=Depends(auth.current_user)):
    rate('download',user['id'],30,300)
    with db.connect() as c:
        d=visible(c,user['id'],rid)
        if d['snapshot_key']!=snapshot_key:changed()
        return _gpx(d)


class DownloadIn(BaseModel):
    snapshot_key:str=Field(pattern='^[a-f0-9]{64}$')


@router.post('/shared-routes/{rid}/gpx-link')
def download_link(rid:int,body:DownloadIn,request:Request,user=Depends(auth.current_user)):
    rate('download',user['id'],30,300)
    with db.connect() as c:
        d=visible(c,user['id'],rid)
        if d['snapshot_key']!=body.snapshot_key:changed()
    now=time.monotonic();key=secrets.token_urlsafe(32)
    with _ticket_lock:
        for k in list(_tickets):
            if _tickets[k][0]<now:del _tickets[k]
        if len(_tickets)>=256:raise HTTPException(429,'Downloads are busy. Try again shortly.')
        _tickets[key]=(now+60,user['id'],rid,body.snapshot_key,auth.token_hash(auth.session_token(request)))
    return {'path':'/api/shared-route-downloads/'+key}


@router.get('/shared-route-downloads/{key}')
def download(key:str):
    with _ticket_lock:t=_tickets.pop(key,None)
    if not t or t[0]<time.monotonic():raise HTTPException(404,'Download expired. Ask for a new link.')
    _,uid,rid,snapshot,session=t
    with db.connect() as c:
        if not c.execute('''SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=%s AND s.token_hash=%s
          AND s.last_seen>now()-%s*interval '1 day' AND u.suspended_at IS NULL AND u.password_change_expires IS NULL''',(uid,session,auth.SESSION_DAYS)).fetchone():raise HTTPException(404,'Download no longer available')
        d=visible(c,uid,rid)
        if d['snapshot_key']!=snapshot:raise HTTPException(404,'The shared route changed. Review it before downloading again.')
        return _gpx(d)


class ReportIn(BaseModel):
    reason:Literal['unsafe','privacy','inaccurate','abusive']
    note:str=Field('',max_length=500)


@router.post('/shared-routes/{rid}/report')
def report(rid:int,body:ReportIn,user=Depends(auth.current_user)):
    rate('report',user['id'],20,300)
    with db.connect() as c:
        confirmed(c,user['id']);d=visible(c,user['id'],rid)
        if c.execute("SELECT 1 FROM route_reports WHERE reporter=%s AND route_id=%s AND status='open'",(user['id'],rid)).fetchone():
            return {'ok':True,'duplicate':True}
        if c.execute("SELECT count(*) AS n FROM route_reports WHERE reporter=%s AND status='open'",(user['id'],)).fetchone()['n']>=20:
            raise HTTPException(429,'Your earlier reports are waiting for review.')
        try:
            with c.transaction():
                row=c.execute('INSERT INTO route_reports(reporter,route_id,reason,note) VALUES(%s,%s,%s,%s) RETURNING id',
                              (user['id'],rid,body.reason,plans._clean(body.note))).fetchone()
        except errors.UniqueViolation:return {'ok':True,'duplicate':True}
        return {'ok':True,'id':row['id'],'duplicate':False}


def _case(c,rid):
    r=c.execute("SELECT id,route_id,reason,note,created FROM route_reports WHERE id=%s AND status='open'",(rid,)).fetchone()
    if not r:raise HTTPException(404,'Open route report not found')
    p=c.execute(PUBLICATION+" WHERE r.id=%s AND r.share_audience<>'me' AND NOT r.share_disabled",(r['route_id'],)).fetchone()
    try:item=projection(p) if p else None
    except HTTPException:item=None
    r['route']=item
    r['person']=c.execute('SELECT u.login::text AS login,u.name FROM planned_routes p JOIN users u ON u.id=p.user_id WHERE p.id=%s',(r['route_id'],)).fetchone()
    r['version']=hashlib.sha256(json.dumps({'id':rid,'route':item},sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return r


@router.get('/admin/route-reports')
def reports(user=Depends(admin_user)):
    _admin(user)
    with db.connect() as c:
        return c.execute('''SELECT r.id,r.route_id,r.reason,r.note,r.created,
          CASE WHEN p.share_audience<>'me' AND NOT p.share_disabled THEN pub.data->>'name' END AS route_name
          FROM route_reports r JOIN planned_routes p ON p.id=r.route_id LEFT JOIN route_publications pub ON pub.route_id=p.id
          WHERE r.status='open' ORDER BY r.created LIMIT 100''').fetchall()


@router.get('/admin/route-reports/{rid}')
def review(rid:int,user=Depends(admin_user)):
    _admin(user)
    with db.connect() as c:
        value=_case(c,rid);audit(c,user['id'],'route_report.review',rid);return value


class ReviewIn(ActionIn):
    action:Literal['dismiss','remove']
    version:str=Field(pattern='^[a-f0-9]{64}$')
    reason:str=Field(min_length=3,max_length=300)
    confirm:str=Field(min_length=1,max_length=30)


@router.post('/admin/route-reports/{rid}')
def decide(rid:int,body:ReviewIn,user=Depends(admin_user)):
    _admin(user)
    if len(body.reason.strip())<3:raise HTTPException(400,'Record a specific reason')
    with db.connect() as c:
        digest,old=replay(c,user,body,'route_report.'+body.action,rid)
        if old:return old
        seed=c.execute('SELECT rr.route_id,p.user_id FROM route_reports rr JOIN planned_routes p ON p.id=rr.route_id WHERE rr.id=%s',(rid,)).fetchone()
        if not seed:raise HTTPException(404,'Report not found')
        c.execute('SELECT id FROM users WHERE id=%s FOR SHARE',(seed['user_id'],))
        _policy(c,seed['user_id'],True)
        r=c.execute('SELECT user_id FROM planned_routes WHERE id=%s FOR UPDATE',(seed['route_id'],)).fetchone()
        current=_case(c,rid)
        owner=c.execute('SELECT login::text AS login FROM users WHERE id=%s',(r['user_id'],)).fetchone()
        if body.confirm!=owner['login']:raise HTTPException(400,'Type the account username exactly')
        if current['version']!=body.version:changed()
        if body.action=='remove':
            if not current['route']:raise HTTPException(409,'This route is no longer shared. Dismiss the report instead.')
            c.execute("UPDATE planned_routes SET share_audience='me',share_disabled=true,share_revision=share_revision+1 WHERE id=%s",(seed['route_id'],))
            c.execute('DELETE FROM route_publications WHERE route_id=%s',(seed['route_id'],))
        done=c.execute("UPDATE route_reports SET status=%s,decided_by=%s,decided=now(),outcome=%s WHERE id=%s AND status='open' RETURNING id",
                       ('removed' if body.action=='remove' else 'dismissed',user['id'],body.reason.strip(),rid)).fetchone()
        if not done:changed()
        return complete(c,user,body,'route_report.'+body.action,rid,digest)
