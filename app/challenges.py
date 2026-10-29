"""Small, explicit challenges. Other members receive only usernames, permitted photos and aggregate progress."""
import datetime as dt
import html
import json
import math
import os
import secrets
import threading
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException,Request
from fastapi.responses import HTMLResponse,Response
from pydantic import BaseModel,ConfigDict,Field,StrictBool
from . import db,recaps,energy,notify,cards,signup,account_email
from .auth import current_user

router=APIRouter()
KINDS={'distance':'Distance','active_days':'Active days','activities':'Activities','food_days':'Food logging days','protein_days':'Protein goal days'}
SPORTS=('run','walk','hike','ride')
UTC=dt.timezone.utc
HEADERS=cards.HEADERS

def zone_of(c,uid):
    row=c.execute('SELECT tz FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    return ZoneInfo(db.valid_tz(row.get('tz')) or db.DEFAULT_TZ)

def deadline(row,zone=None):
    natural=dt.datetime.combine(row['end_day']+dt.timedelta(days=1),dt.time.min,zone or ZoneInfo(row['zone']))
    return min(natural,row['ended_at']) if row.get('ended_at') else natural

def title(row):
    start,end=row['start_day'],row['end_day'];period=start.strftime('%B %Y') if start.day==1 and (end+dt.timedelta(days=1)).day==1 else start.strftime('%b %d')+' – '+end.strftime('%b %d, %Y')
    return f"{period} · {KINDS[row['kind']].lower()}: {row['target']:g} {row['unit']}"

def link(code,request=None):
    base=os.environ.get('KINETTA_PUBLIC_URL','').rstrip('/') or (str(request.base_url).rstrip('/') if request else '')
    return base+'/challenge/'+code

def member(c,cid,uid):
    return c.execute("SELECT * FROM challenge_members WHERE challenge_id=%s AND user_id=%s AND status='active'",(cid,uid)).fetchone()

def accessible(c,code,uid=None,lock=False):
    row=c.execute('''SELECT q.*,u.login::text AS creator FROM challenges q JOIN users u ON u.id=q.user_id
      WHERE q.code=%s AND NOT u.needs_email_confirm AND u.suspended_at IS NULL
        AND coalesce(q.ended_at,((q.end_day+1)::timestamp AT TIME ZONE 'Etc/GMT+12'))>now()-interval '90 days'
      '''+('FOR UPDATE OF q' if lock else ''),((code or '')[:60],)).fetchone()
    if not row:raise HTTPException(404,'This challenge is no longer available')
    if uid and not member(c,row['id'],uid):
        former=c.execute('SELECT status FROM challenge_members WHERE challenge_id=%s AND user_id=%s',(row['id'],uid)).fetchone()
        if former and former['status']=='removed':raise HTTPException(404,'This challenge is no longer available')
        blocked=c.execute('''SELECT 1 FROM blocks b WHERE (b.user_id=%s AND b.blocked IN
          (SELECT user_id FROM challenge_members WHERE challenge_id=%s AND status='active')) OR
          (b.blocked=%s AND b.user_id IN (SELECT user_id FROM challenge_members WHERE challenge_id=%s AND status='active')) LIMIT 1''',(uid,row['id'],uid,row['id'])).fetchone()
        from .api_social import _blocked_pair
        if blocked or _blocked_pair(c,uid,row['user_id']):raise HTTPException(404,'This challenge is no longer available')
    return row

def confirmed_for_challenge(c,uid):
    from .api_social import confirmed
    confirmed(c,uid)
    row=c.execute("SELECT u.email_verified_at,EXISTS(SELECT 1 FROM account_tokens t WHERE t.user_id=u.id AND t.kind='verify_email') AS asked FROM users u WHERE u.id=%s",(uid,)).fetchone()
    # Invited accounts can otherwise be active while their first email is pending. A signup
    # challenge choice still waits for that email, including when its original token expires.
    if row and row['asked'] and row['email_verified_at'] is None:raise HTTPException(409,'Confirm your email before joining a challenge')

def account_locks(c,ids):
    # Serialize participation caps and new block edges before taking any challenge/member row.
    rows=c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR UPDATE',(sorted(set(ids)),)).fetchall()
    if len(rows)!=len(set(ids)):raise HTTPException(404,'Account no longer available')

def active_count(c,uid,now=None):
    today=(now or dt.datetime.now(UTC)).astimezone(zone_of(c,uid)).date()
    return c.execute("SELECT count(*) AS n FROM challenge_members m JOIN challenges q ON q.id=m.challenge_id WHERE m.user_id=%s AND m.status='active' AND q.ended_at IS NULL AND q.end_day>=%s",(uid,today)).fetchone()['n']

def progress(c,row,uid,now=None):
    now=now or dt.datetime.now(UTC);zone=zone_of(c,uid);today=now.astimezone(zone).date()
    lo=dt.datetime.combine(row['start_day'],dt.time.min,zone);hi=min(deadline(row,zone),now)
    value=0;sources=set();manual=False;needs_target=False
    if row['kind'] in ('food_days','protein_days'):
        target=(c.execute('SELECT protein_target FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}).get('protein_target')
        needs_target=row['kind']=='protein_days' and not (target and math.isfinite(target) and target>0)
        end=min(row['end_day'],today,hi.astimezone(zone).date())
        foods=c.execute(f'''SELECT day,CASE WHEN bool_or({energy.unknown_sql('protein_g')}) THEN NULL ELSE sum(protein_g) END AS protein
          FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s AND (%s::timestamptz IS NULL OR created<=%s)
          GROUP BY day''',(uid,row['start_day'],end,row.get('ended_at'),row.get('ended_at'))).fetchall() if hi>lo else []
        value=len(foods) if row['kind']=='food_days' else sum(r['protein'] is not None and r['protein']>=target for r in foods) if not needs_target else 0
    else:
        rows=c.execute('''SELECT sport,distance_m,coalesce(moving_s,elapsed_s,0) AS seconds,source,device,
          (start_time AT TIME ZONE %s)::date AS day FROM activities WHERE user_id=%s AND start_time>=%s
          AND start_time<%s AND NOT lift_open AND start_time+make_interval(secs=>CASE WHEN coalesce(elapsed_s,moving_s,0) BETWEEN 0 AND 172800 THEN coalesce(elapsed_s,moving_s,0) ELSE 0 END)<=%s
          ORDER BY start_time,id''',(str(zone),uid,lo,hi,min(now,row['ended_at']) if row.get('ended_at') else now)).fetchall() if hi>lo else []
        days=set()
        for r in rows:
            if row['kind']=='distance':
                distance=r['distance_m'];counts=r['sport'] in row['sports'] and distance is not None and math.isfinite(distance) and distance>0
                if counts:value+=distance/(1609.344 if row['unit']=='mi' else 1000)
            else:
                counts=r['seconds']>=600
                if counts:
                    if row['kind']=='activities':value+=1
                    else:days.add(r['day'])
            if counts:
                manual|=r['source']=='manual';credit=recaps.garmin_source(r['source'],r['device'])
                if credit:sources.add(credit)
        if row['kind']=='active_days':value=len(days)
    finished=now>=deadline(row,zone)
    return {'value':round(value,3),'complete':value>=row['target'],'manual':manual,'garmin_sources':sorted(sources),
      'days_left':max(0,(row['end_day']-today).days),'finished':finished,'needs_target':needs_target}

def preview(c,row,uid=None,request=None):
    from .api_social import _blocked_pair
    mine=member(c,row['id'],uid) if uid else None
    count=c.execute("SELECT count(*) AS n FROM challenge_members m JOIN users u ON u.id=m.user_id WHERE m.challenge_id=%s AND m.status='active' AND NOT u.needs_email_confirm AND u.suspended_at IS NULL",(row['id'],)).fetchone()['n']
    creator=None if uid and _blocked_pair(c,uid,row['user_id']) else row['creator']
    return {'code':row['code'],'kind':row['kind'],'title':title(row),'sports':row['sports'],'target':row['target'],'unit':row['unit'],
      'start':row['start_day'],'end':row['end_day'],'creator':creator,'participants':count,'member':bool(mine),'owner':uid==row['user_id'],
      'joining_closed':dt.datetime.now(UTC)>=deadline(row),'ended_early':bool(row['ended_at']),'url':link(row['code'],request)}

def answer(c,row,uid,request=None):
    out=preview(c,row,uid,request)
    if not out['member']:return out
    from .api_social import _blocked_pair
    people=c.execute("SELECT m.user_id,u.login::text AS username,u.photo_v FROM challenge_members m JOIN users u ON u.id=m.user_id WHERE m.challenge_id=%s AND m.status='active' AND NOT u.needs_email_confirm AND u.suspended_at IS NULL ORDER BY m.joined,m.user_id",(row['id'],)).fetchall()
    table=[];sources=set();manual=False
    for person in people:
        if _blocked_pair(c,uid,person['user_id']):continue
        facts=progress(c,row,person['user_id']);sources.update(facts['garmin_sources']);manual|=facts['manual']
        table.append({'username':person['username'],'photo':person['photo_v'] or False,'value':facts['value'],'complete':facts['complete']})
        if person['user_id']==uid:out['self']=facts
    out['people']=sorted(table,key=lambda r:(-r['value'],r['username']));out['manual']=manual;out['garmin_sources']=sorted(sources)
    return out

class Create(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind:Literal['distance','active_days','activities','food_days','protein_days']
    period:Literal['this_week','next_week','this_month','next_month','custom']='this_month'
    start:dt.date|None=None
    end:dt.date|None=None
    target:float=Field(gt=0,le=100000,allow_inf_nan=False)
    unit:Literal['km','mi','days','activities']='km'
    sports:list[Literal['run','walk','hike','ride']]=Field(default_factory=lambda:['run','walk'],max_length=4)
    request_id:str=Field(pattern=r'^[A-Za-z0-9_-]{8,64}$')

def dates(body,today):
    if body.period=='custom':
        if not body.start or not body.end:raise HTTPException(400,'Choose start and end dates')
        start,end=body.start,body.end
    elif body.period in ('this_week','next_week'):
        start=today-dt.timedelta(days=today.weekday())+dt.timedelta(days=7 if body.period=='next_week' else 0);end=start+dt.timedelta(days=6)
    else:
        start=today.replace(day=1)
        if body.period=='next_month':start=(start+dt.timedelta(days=32)).replace(day=1)
        end=(start+dt.timedelta(days=32)).replace(day=1)-dt.timedelta(days=1)
    if not 3<=(end-start).days+1<=62 or end<today or start<today-dt.timedelta(days=61) or start>today+dt.timedelta(days=30):raise HTTPException(400,'Choose 3–62 days, starting no more than 30 days ahead')
    if body.kind!='distance' and (body.target!=int(body.target) or body.target>(1000 if body.kind=='activities' else (end-start).days+1)):raise HTTPException(400,'Choose a whole-number target that fits these dates')
    if body.kind=='distance' and (body.unit not in ('km','mi') or not body.sports or len(set(body.sports))!=len(body.sports)):raise HTTPException(400,'Choose distance units and at least one sport')
    return start,end

def protein_ok(c,uid,kind):
    if kind=='protein_days':
        target=(c.execute('SELECT protein_target FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}).get('protein_target')
        if not target or not math.isfinite(target) or target<=0:raise HTTPException(409,'Set your own protein target in Nutrition before joining this challenge')

@router.post('/api/challenges')
def create(body:Create,request:Request,user=Depends(current_user)):
    from .api_social import confirmed
    with db.connect() as c:
        account_locks(c,[user['id']]);confirmed_for_challenge(c,user['id'])
        old=c.execute('SELECT q.*,u.login::text AS creator FROM challenges q JOIN users u ON u.id=q.user_id WHERE q.user_id=%s AND q.request_id=%s',(user['id'],body.request_id)).fetchone()
        if old:
            if old['request_body']!=body.model_dump(mode='json'):raise HTTPException(409,'This create request has already been used')
            return answer(c,old,user['id'],request)
        if account_email.limited(c,'challenge-create:'+str(user['id']),20,60):raise HTTPException(429,'Too many new challenges. Try again later.')
        zone=zone_of(c,user['id']);start,end=dates(body,dt.datetime.now(UTC).astimezone(zone).date());protein_ok(c,user['id'],body.kind)
        if active_count(c,user['id'])>=5:raise HTTPException(409,'You can take part in up to five active or upcoming challenges')
        unit=body.unit if body.kind=='distance' else 'activities' if body.kind=='activities' else 'days'
        row=c.execute('''INSERT INTO challenges(user_id,code,kind,sports,target,unit,start_day,end_day,zone,request_id,request_body)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',(user['id'],secrets.token_urlsafe(24),body.kind,json.dumps(body.sports if body.kind=='distance' else []),body.target,unit,start,end,str(zone),body.request_id,json.dumps(body.model_dump(mode='json')))).fetchone()
        c.execute('INSERT INTO challenge_members(challenge_id,user_id) VALUES(%s,%s)',(row['id'],user['id']));row['creator']=user['login']
        return answer(c,row,user['id'],request)

def send_notice(c,row,uid,kind,actor,*,push_ids=None):
    setting={'challenge_join':'challenge_joins','challenge_reminder':'challenge_reminders','challenge_finished':'challenge_finished'}[kind]
    prefs=(c.execute('SELECT notify FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}).get('notify')
    if notify._prefs(prefs).get(setting):
        nid=c.execute('INSERT INTO notifications(user_id,actor_id,kind,challenge_id) VALUES(%s,%s,%s,%s) RETURNING id',(uid,actor,kind,row['id'])).fetchone()['id']
        if push_ids is None:threading.Thread(target=notify._push_later,args=(nid,),daemon=True).start()
        else:push_ids.append(nid)

def join_challenge(c,uid,code,*,push_ids=None):
    from .api_social import confirmed
    initial=accessible(c,code,uid);account_locks(c,[uid,initial['user_id']]);confirmed_for_challenge(c,uid);row=accessible(c,code,uid,True)
    if member(c,row['id'],uid):return row
    if dt.datetime.now(UTC)>=deadline(row):raise HTTPException(409,'This challenge has finished')
    prior=c.execute('SELECT * FROM challenge_members WHERE challenge_id=%s AND user_id=%s',(row['id'],uid)).fetchone()
    if prior and prior['status']=='removed':raise HTTPException(404,'This challenge is no longer available')
    if c.execute("SELECT count(*) AS n FROM challenge_members WHERE challenge_id=%s AND status='active'",(row['id'],)).fetchone()['n']>=50:raise HTTPException(409,'This challenge already has 50 participants')
    if active_count(c,uid)>=5:raise HTTPException(409,'You can take part in up to five active or upcoming challenges')
    protein_ok(c,uid,row['kind'])
    c.execute("INSERT INTO challenge_members(challenge_id,user_id) VALUES(%s,%s) ON CONFLICT(challenge_id,user_id) DO UPDATE SET status='active',joined=now()",(row['id'],uid))
    if not prior:send_notice(c,row,row['user_id'],'challenge_join',uid,push_ids=push_ids)
    return row

@router.post('/api/challenges/{code}/join')
def join(code:str,request:Request,user=Depends(current_user)):
    push_ids=[]
    with db.connect() as c:result=answer(c,join_challenge(c,user['id'],code,push_ids=push_ids),user['id'],request)
    # Building a large group's progress can outlast the push retry window.
    for nid in push_ids:threading.Thread(target=notify._push_later,args=(nid,),daemon=True).start()
    return result

def consume_signup(c,uid):
    # Run after account/email confirmation commits, before locking an intent row. Confirmation
    # already holds the new account; joining must acquire both accounts in their canonical order.
    person=c.execute("SELECT u.needs_email_confirm,u.suspended_at,u.email_verified_at,EXISTS(SELECT 1 FROM account_tokens t WHERE t.user_id=u.id AND t.kind='verify_email') AS asked FROM users u WHERE u.id=%s",(uid,)).fetchone()
    if not person or person['needs_email_confirm'] or person['suspended_at'] or (person['asked'] and person['email_verified_at'] is None):return None
    intent=c.execute("SELECT code,want_request FROM signup_join_intents WHERE user_id=%s AND kind='challenge'",(uid,)).fetchone()
    if not intent:return None
    joined=None
    if intent['want_request']:
        try:
            with c.transaction():joined=join_challenge(c,uid,intent['code'])['code']
        except HTTPException:pass  # changed caps, blocks or expired links never undo email confirmation
    c.execute("DELETE FROM signup_join_intents WHERE user_id=%s AND kind='challenge'",(uid,))
    return joined

@router.post('/api/challenges/signup/continue')
def continue_signup(user=Depends(current_user)):
    with db.connect() as c:return {'joined':consume_signup(c,user['id'])}

@router.get('/api/challenges')
def own(request:Request,user=Depends(current_user)):
    with db.connect() as c:
        rows=c.execute("SELECT q.*,u.login::text AS creator FROM challenge_members m JOIN challenges q ON q.id=m.challenge_id JOIN users u ON u.id=q.user_id WHERE m.user_id=%s AND (m.status='active' OR q.user_id=%s) AND NOT u.needs_email_confirm AND u.suspended_at IS NULL AND coalesce(q.ended_at,((q.end_day+1)::timestamp AT TIME ZONE 'Etc/GMT+12'))>now()-interval '90 days' ORDER BY q.end_day DESC,q.created DESC",(user['id'],user['id'])).fetchall()
        return [{**preview(c,row,user['id'],request),'self':progress(c,row,user['id'])} for row in rows]

@router.get('/api/challenges/{code}')
def detail(code:str,request:Request):
    viewer=cards.optional_user(request);uid=viewer['id'] if viewer else None
    with db.connect() as c:
        row=accessible(c,code,uid)
        return answer(c,row,uid,request) if uid else preview(c,row,request=request)

@router.get('/challenge/{code}')
def public_page(code:str,request:Request):
    viewer=cards.optional_user(request);uid=viewer['id'] if viewer else None
    try:
        with db.connect() as c:
            row=accessible(c,code,uid);data=preview(c,row,uid,request);state=signup.state(c)
    except HTTPException as e:
        if e.status_code!=404:raise
        return HTMLResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/theme.css"><link rel="stylesheet" href="/static/style.css"><main class="shell"><h1>This challenge is no longer available</h1><p>Ask for a current invitation.</p><a href="/">Open Kinetta</a></main></html>',status_code=404,headers=HEADERS)
    esc=html.escape;name=esc(data['title']);creator='@'+esc(data['creator']) if data['creator'] else 'A Kinetta member'
    if viewer:
        action=f'<a class="primary wide" href="/me/challenges/{esc(code)}">Open challenge</a>' if data['member'] else '<p>This challenge has finished.</p>' if data['joining_closed'] else f'<button class="primary wide" id="challenge-public-join" data-code="{esc(code)}">Join challenge</button>'
    else:
        from . import api_beta
        if data['joining_closed']:action='<p>This challenge has finished.</p>'
        elif state['open']:action=f'<a class="primary wide" href="/signup?challenge={esc(code)}">Join Kinetta to take part</a>'
        elif api_beta.enabled():action=f'<a class="primary wide" href="/beta?challenge={esc(code)}">Join the waitlist to take part</a><p>Kinetta is invite-only. An invitation is needed before you can join.</p>'
        else:action='<p>Kinetta is invite-only. Ask the server owner for an invitation, then reopen this challenge link.</p>'
        action+=f'<a class="ghost wide" href="/?challenge={esc(code)}">Already a member? Log in</a>'
    app=account_email.iphone_app();install=f'<a class="ghost wide" href="{esc(app)}">Get the iPhone app</a><p class="small muted">After installing, reopen this challenge link.</p>' if app else ''
    body=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>{name} · Kinetta</title><meta property="og:title" content="{name}"><meta property="og:description" content="A small, friendly challenge on Kinetta. Joining is your choice and never adds friends automatically."><link rel="stylesheet" href="/static/theme.css"><link rel="stylesheet" href="/static/style.css"><link rel="stylesheet" href="/static/challenges.css?v=1"></head><body><main class="shell challenge-public"><p class="eyebrow">A Kinetta challenge</p><h1>{name}</h1><p>Started by {creator}</p><p>{data['start']} – {data['end']} · {data['participants']} participants</p><p>Only your username, permitted photo and challenge progress are visible to participants. Only me workouts count toward progress; individual workouts, food entries and your protein target stay private. Joining does not add anyone as a friend.</p>{action}<p id="challenge-public-status" role="status"></p>{install}<a href="https://kinetta.app/privacy">Privacy policy</a></main><script src="/static/challenge-public.js?v=1" defer></script></body></html>'''
    return HTMLResponse(body,headers=HEADERS)

class Remove(BaseModel):
    username:str=Field(max_length=30)

@router.post('/api/challenges/{code}/remove')
def remove(code:str,body:Remove,user=Depends(current_user)):
    with db.connect() as c:
        row=accessible(c,code,user['id'])
        if row['user_id']!=user['id']:raise HTTPException(404,'Not found')
        target=c.execute('SELECT id FROM users WHERE login=%s',(body.username.lower(),)).fetchone()
        if not target or target['id']==user['id']:raise HTTPException(400,'Use Leave for your own participation')
        account_locks(c,[user['id'],target['id']]);accessible(c,code,user['id'],True)
        c.execute("UPDATE challenge_members SET status='removed' WHERE challenge_id=%s AND user_id=%s",(row['id'],target['id']))
    return {'ok':True}

@router.post('/api/challenges/{code}/leave')
def leave(code:str,user=Depends(current_user)):
    with db.connect() as c:
        account_locks(c,[user['id']]);row=accessible(c,code,None,True)
        c.execute("UPDATE challenge_members SET status='left' WHERE challenge_id=%s AND user_id=%s",(row['id'],user['id']))
    return {'ok':True}

@router.post('/api/challenges/{code}/end')
def end_early(code:str,user=Depends(current_user)):
    with db.connect() as c:
        account_locks(c,[user['id']]);row=accessible(c,code,user['id'],True)
        if row['user_id']!=user['id']:raise HTTPException(404,'Not found')
        c.execute('UPDATE challenges SET ended_at=coalesce(ended_at,now()),checked_at=\'epoch\' WHERE id=%s',(row['id'],))
    return {'ok':True}

@router.get('/api/challenges/{code}/photo/{username}')
def photo(code:str,username:str,user=Depends(current_user)):
    from .api_social import _blocked_pair
    with db.connect() as c:
        row=accessible(c,code,user['id'])
        if not member(c,row['id'],user['id']):raise HTTPException(404)
        p=c.execute("SELECT u.id,ph.img FROM challenge_members m JOIN users u ON u.id=m.user_id JOIN profile_photos ph ON ph.user_id=u.id WHERE m.challenge_id=%s AND m.status='active' AND u.login=%s AND NOT u.needs_email_confirm AND u.suspended_at IS NULL",(row['id'],username.lower())).fetchone()
        if not p or _blocked_pair(c,user['id'],p['id']):raise HTTPException(404)
        return Response(bytes(p['img']),media_type='image/jpeg',headers=HEADERS)

def process(c,cid,now=None,*,push_ids=None):
    now=now or dt.datetime.now(UTC);initial=c.execute('SELECT user_id FROM challenges WHERE id=%s',(cid,)).fetchone()
    if not initial:return
    ids={initial['user_id']}|{r['user_id'] for r in c.execute("SELECT user_id FROM challenge_members WHERE challenge_id=%s AND status='active'",(cid,)).fetchall()}
    locked={r['id'] for r in c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR KEY SHARE',(sorted(ids),)).fetchall()}
    # A join may commit while this worker waits for the creator's account lock.
    # Retry next tick rather than touch a newly joined account without its lock.
    current={initial['user_id']}|{r['user_id'] for r in c.execute("SELECT user_id FROM challenge_members WHERE challenge_id=%s AND status='active'",(cid,)).fetchall()}
    if not current.issubset(locked):return
    row=c.execute('SELECT * FROM challenges WHERE id=%s FOR UPDATE SKIP LOCKED',(cid,)).fetchone()
    if not row:return
    for m in c.execute("SELECT m.* FROM challenge_members m JOIN users u ON u.id=m.user_id WHERE m.challenge_id=%s AND m.status='active' AND NOT u.needs_email_confirm AND u.suspended_at IS NULL ORDER BY m.user_id",(cid,)).fetchall():
        zone=zone_of(c,m['user_id']);finished=now>=deadline(row,zone);left=(row['end_day']-now.astimezone(zone).date()).days
        if finished and not m['finished_notice']:
            c.execute('UPDATE challenge_members SET finished_notice=true WHERE challenge_id=%s AND user_id=%s',(cid,m['user_id']))
            c.execute("UPDATE notifications SET cancelled=true WHERE user_id=%s AND challenge_id=%s AND kind='challenge_reminder'",(m['user_id'],cid))
            send_notice(c,row,m['user_id'],'challenge_finished',m['user_id'],push_ids=push_ids)
        elif not finished and left==3 and not m['three_notice']:
            c.execute('UPDATE challenge_members SET three_notice=true WHERE challenge_id=%s AND user_id=%s',(cid,m['user_id']))
            send_notice(c,row,m['user_id'],'challenge_reminder',m['user_id'],push_ids=push_ids)
    c.execute('UPDATE challenges SET checked_at=%s WHERE id=%s',(now,cid))

def pending_jobs(c):
    return [r['id'] for r in c.execute("""SELECT c.id FROM challenges c
      WHERE c.checked_at<now()-interval '30 seconds' AND EXISTS(
        SELECT 1 FROM challenge_members m JOIN users u ON u.id=m.user_id
        WHERE m.challenge_id=c.id AND m.status='active' AND NOT m.finished_notice
          AND NOT u.needs_email_confirm AND u.suspended_at IS NULL)
      ORDER BY c.checked_at LIMIT 50""").fetchall()]

def process_committed(cid,now=None):
    push_ids=[]
    with db.connect() as c:process(c,cid,now,push_ids=push_ids)
    for nid in push_ids:threading.Thread(target=notify._push_later,args=(nid,),daemon=True).start()

def purge(c,now=None):
    cutoff=(now or dt.datetime.now(UTC))-dt.timedelta(days=90)
    expired=c.execute("SELECT id,user_id FROM challenges WHERE coalesce(ended_at,((end_day+1)::timestamp AT TIME ZONE 'Etc/GMT+12'))<%s ORDER BY id LIMIT 50",(cutoff,)).fetchall()
    if not expired:return 0
    cids=[r['id'] for r in expired]
    ids={r['user_id'] for r in expired}|{r['user_id'] for r in c.execute('SELECT user_id FROM challenge_members WHERE challenge_id=ANY(%s)',(cids,)).fetchall()}
    # Retention follows the same account-before-group order as erasure and lifecycle writes.
    c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR KEY SHARE',(sorted(ids),)).fetchall()
    rows=c.execute("DELETE FROM challenges WHERE id=ANY(%s) AND coalesce(ended_at,((end_day+1)::timestamp AT TIME ZONE 'Etc/GMT+12'))<%s RETURNING code",(cids,cutoff)).fetchall()
    if rows:
        codes=[r['code'] for r in rows]
        c.execute("DELETE FROM signup_join_intents WHERE kind='challenge' AND code=ANY(%s)",(codes,))
        c.execute('UPDATE beta_requests SET challenge_code=NULL,challenge_join=false WHERE challenge_code=ANY(%s)',(codes,))
    return len(rows)

def start_worker():
    stop=threading.Event()
    def loop():
        while not stop.wait(10):
            try:
                with db.connect() as c:
                    pending=c.execute("SELECT i.user_id,i.kind FROM signup_join_intents i JOIN users u ON u.id=i.user_id WHERE i.kind IN ('card','challenge') AND NOT u.needs_email_confirm AND u.suspended_at IS NULL LIMIT 50").fetchall()
                for intent in pending:
                    with db.connect() as c:
                        if intent['kind']=='card':cards.consume_signup(c,intent['user_id'])
                        else:consume_signup(c,intent['user_id'])
                with db.connect() as c:
                    ids=pending_jobs(c)
                for cid in ids:
                    if stop.is_set():break
                    process_committed(cid)
                with db.connect() as c:purge(c)
            except Exception as e:print('challenge worker:',type(e).__name__,flush=True)
    worker=threading.Thread(target=loop,daemon=True);worker.start();return stop,worker
