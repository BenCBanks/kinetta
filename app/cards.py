"""Revocable public cards. Only a fixed allowlist leaves the owner's account."""
import datetime as dt
import html
import io
import json
import os
import secrets
import threading
import time
from collections import OrderedDict
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException,Request,Response
from fastapi.responses import HTMLResponse
from PIL import Image,ImageDraw,ImageFont,ImageOps
from pydantic import BaseModel,ConfigDict,Field,StrictBool,model_validator
from . import db,auth,recaps,signup,account_email,notify
from .auth import current_user

router=APIRouter()
STAT_KEYS=('distance_year','active_days_year','activities_year','activity_weeks','food_days_month')
PERIODS=('this_week','all_time')
DEFAULT_STATS=('distance_year','activity_weeks')
SPORTS={'run':'Running','ride':'Cycling','walk':'Walking','hike':'Hiking','swim':'Swimming','workout':'Workouts','row':'Rowing','ski':'Skiing','other':'Other activities'}
# The light-theme sport colours used by app/static/theme.css; exported pictures have a white canvas.
SPORT_COLORS={'run':'#12924F','ride':'#0B8798','walk':'#6F8A12','hike':'#B26A10','swim':'#2A80BD','row':'#2A80BD','ski':'#2F6FD6','workout':'#D9532A','other':'#78828C'}
HEADERS={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}
# Process-local, bounded work reuse; browsers still revalidate access on every request.
_pictures=OrderedDict()
_picture_lock=threading.Lock()
_render_slots=threading.BoundedSemaphore(2)
PICTURE_TTL=30
PICTURE_LIMIT=32

def optional_user(request):
    try:return current_user(request)
    except HTTPException as e:
        if e.status_code==401:return None
        raise

def url(code,request=None):
    base=os.environ.get('KINETTA_PUBLIC_URL','').rstrip('/')
    if not base and request:base=str(request.base_url).rstrip('/')
    return base+'/card/'+code

def own(c,uid):
    if not c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',(uid,)).fetchone():raise HTTPException(404,'Not found')
    c.execute('INSERT INTO public_cards(user_id,code) VALUES(%s,%s) ON CONFLICT(user_id) DO NOTHING',(uid,secrets.token_urlsafe(24)))
    return c.execute('SELECT * FROM public_cards WHERE user_id=%s',(uid,)).fetchone()

def active(c,code,viewer=None,lock=False):
    from .api_social import _blocked_pair
    row=c.execute('''SELECT k.*,u.login::text AS login,u.photo_v FROM public_cards k JOIN users u ON u.id=k.user_id
      WHERE k.code=%s AND k.enabled AND NOT u.needs_email_confirm AND u.suspended_at IS NULL'''+(' FOR UPDATE OF k' if lock else ''),((code or '')[:60],)).fetchone()
    if not row or (viewer and _blocked_pair(c,viewer,row['user_id'])):raise HTTPException(404,'This card is no longer active')
    return row

def period(row):
    saved=row.get('stats') or []
    # Legacy stat selections use the new default until the owner picks a period.
    return saved[0] if len(saved)==1 and saved[0] in PERIODS else 'this_week'

def payload(c,row,request=None):
    uid=row['user_id'];chosen=period(row);out={'username':row['login'],'period':chosen,'sports':[],'stats':[],'garmin_sources':[],'allow_requests':row['allow_requests'],'url':url(row['code'],request)}
    if row['sports']:
        out['sports']=[dict(r) for r in c.execute('''SELECT sport,count(*) AS activities FROM activities
          WHERE user_id=%s AND NOT lift_open GROUP BY sport ORDER BY activities DESC,sport''',(uid,)).fetchall() if r['sport'] in SPORTS]
    profile=c.execute('SELECT tz,units FROM profile WHERE user_id=%s',(uid,)).fetchone() or {};imperial=profile.get('units')=='imperial'
    zone=db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ
    if chosen=='this_week':
        current=recaps.facts(c,uid,'this_week');first=current['start']-dt.timedelta(weeks=11);end=current['end']
        rows=c.execute('''SELECT date_trunc('week',start_time AT TIME ZONE %s)::date AS week,
                            count(*) AS activities,coalesce(sum(distance_m),0) AS distance_m,
                            coalesce(sum(coalesce(moving_s,elapsed_s)),0) AS time_s
                          FROM activities WHERE user_id=%s AND NOT lift_open
                            AND start_time >= (%s::timestamp AT TIME ZONE %s)
                            AND start_time < (%s::timestamp AT TIME ZONE %s)
                          GROUP BY 1''',(zone,uid,first,zone,end,zone)).fetchall()
        by_week={r['week']:r for r in rows};weeks=[]
        for i in range(12):
            week=first+dt.timedelta(weeks=i);r=by_week.get(week,{})
            weeks.append({'week':week.isoformat(),'distance_m':float(r.get('distance_m') or 0),'activities':int(r.get('activities') or 0),'time_s':int(r.get('time_s') or 0)})
        this_week=by_week.get(current['start'],{})
        out['weekly']={'distance_m':float(this_week.get('distance_m') or 0),'activities':int(this_week.get('activities') or 0),'time_s':int(this_week.get('time_s') or 0),'streak_weeks':current['streak_weeks'],'weeks':weeks,'unit':'mi' if imperial else 'km'}
    else:
        totals=c.execute('''SELECT count(*) AS activities,coalesce(sum(distance_m),0) AS distance_m,
                              coalesce(sum(coalesce(moving_s,elapsed_s)),0) AS time_s
                            FROM activities WHERE user_id=%s AND NOT lift_open''',(uid,)).fetchone()
        out['all_time']={'activities':totals['activities'],'distance_m':float(totals['distance_m'] or 0),'time_s':int(totals['time_s'] or 0),'unit':'mi' if imperial else 'km'}
    if row['photo'] and row['photo_v']:out['photo']=url(row['code'],request)+'/photo'
    return out

class Settings(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled:StrictBool
    photo:StrictBool=True
    sports:StrictBool=True
    period:str='this_week'
    stats:list[str]=Field(default_factory=list,max_length=2)
    allow_requests:StrictBool=True
    @model_validator(mode='after')
    def valid_stats(self):
        if self.period not in PERIODS:raise ValueError('Choose This week or All time')
        if len(set(self.stats))!=len(self.stats) or any(k not in STAT_KEYS for k in self.stats):raise ValueError('Choose This week or All time')
        return self

def owner_answer(c,uid,request):
    row=own(c,uid);row.update(c.execute('SELECT login::text AS login,photo_v FROM users WHERE id=%s',(uid,)).fetchone())
    waiting=c.execute("SELECT count(*) AS n FROM card_connections k JOIN friendships f ON f.requester=k.member_id AND f.addressee=k.user_id AND f.status='pending' WHERE k.user_id=%s",(uid,)).fetchone()['n']
    joined=c.execute('SELECT count(*) AS n FROM card_connections WHERE user_id=%s AND joined',(uid,)).fetchone()['n']
    return {**{k:row[k] for k in ('enabled','photo','sports','stats','allow_requests')},'period':period(row),'url':url(row['code'],request),'preview':payload(c,row,request),'joined':joined,'waiting':waiting}

@router.get('/api/card')
def settings(request:Request,user=Depends(current_user)):
    with db.connect() as c:return owner_answer(c,user['id'],request)

@router.put('/api/card')
def change(body:Settings,request:Request,user=Depends(current_user)):
    from .api_social import confirmed
    with db.connect() as c:
        confirmed(c,user['id']);own(c,user['id'])
        c.execute('UPDATE public_cards SET enabled=%s,photo=%s,sports=%s,stats=%s,allow_requests=%s,updated=now() WHERE user_id=%s',(body.enabled,body.photo,body.sports,json.dumps([body.period]),body.allow_requests,user['id']))
        return owner_answer(c,user['id'],request)

@router.post('/api/card/new')
def rotate(request:Request,user=Depends(current_user)):
    with db.connect() as c:
        own(c,user['id']);c.execute('UPDATE public_cards SET code=%s,updated=now() WHERE user_id=%s',(secrets.token_urlsafe(24),user['id']))
        return owner_answer(c,user['id'],request)

@router.get('/api/cards/{code}')
def preview(code:str,request:Request):
    viewer=optional_user(request)
    with db.connect() as c:
        row=active(c,code,viewer['id'] if viewer else None);out=dict(cached_result(c,row,request,'payload'))
        if viewer:
            from .api_social import _pair
            pair=_pair(c,viewer['id'],row['user_id']);out['relationship']='self' if viewer['id']==row['user_id'] else ('friends' if pair and pair['status']=='accepted' else 'request_sent' if pair and pair['requester']==viewer['id'] else 'incoming' if pair else 'none')
        return out

def request_friend(c,uid,code,joined=False):
    from .api_social import confirmed,_pair,MAX_PENDING
    confirmed(c,uid);candidate=active(c,code,uid);owner=candidate['user_id']
    # Account erasure uses account-before-personal-row order; card requests do too.
    c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR UPDATE',(sorted({uid,owner}),)).fetchall()
    confirmed(c,uid)
    row=active(c,code,uid,True)
    if owner==uid:return {'status':'self'}
    if not row['allow_requests']:raise HTTPException(409,'Friend requests from this card are turned off')
    pair=_pair(c,uid,owner,lock=True)
    if pair:return {'status':'friends' if pair['status']=='accepted' else 'request_sent' if pair['requester']==uid else 'incoming'}
    if account_email.limited(c,'card-viewer:'+str(uid),10,60):raise HTTPException(429,'Too many card requests. Try again later.')
    waiting=c.execute("SELECT count(*) AS n FROM card_connections k JOIN friendships f ON f.requester=k.member_id AND f.addressee=k.user_id AND f.status='pending' WHERE k.user_id=%s",(owner,)).fetchone()['n']
    pending=c.execute("SELECT count(*) AS n FROM friendships WHERE requester=%s AND status='pending'",(uid,)).fetchone()['n']
    if waiting>=20 or pending>=MAX_PENDING:raise HTTPException(429,'There are enough requests waiting. Try again later.')
    from .signup import social_action
    social_action(c,uid,'request')
    c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(uid,owner))
    c.execute('INSERT INTO card_connections(user_id,member_id,joined) VALUES(%s,%s,%s) ON CONFLICT(user_id,member_id) DO UPDATE SET joined=card_connections.joined OR excluded.joined',(owner,uid,joined))
    notify.add(c,owner,'friend_request',uid)
    return {'status':'request_sent'}

@router.post('/api/cards/{code}/request')
def ask(code:str,user=Depends(current_user)):
    with db.connect() as c:return request_friend(c,user['id'],code)

def consume_signup(c,uid):
    # Confirmation/account creation must commit before this helper acquires both accounts.
    person=c.execute("SELECT u.needs_email_confirm,u.suspended_at,u.email_verified_at,EXISTS(SELECT 1 FROM account_tokens t WHERE t.user_id=u.id AND t.kind='verify_email') AS asked FROM users u WHERE u.id=%s",(uid,)).fetchone()
    if not person or person['needs_email_confirm'] or person['suspended_at'] or (person['asked'] and person['email_verified_at'] is None):return
    intent=c.execute("SELECT code FROM signup_join_intents WHERE user_id=%s AND kind='card'",(uid,)).fetchone()
    if not intent:return
    try:owner=active(c,intent['code'],uid)['user_id']
    except HTTPException:owner=uid
    c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR UPDATE',(sorted({uid,owner}),)).fetchall()
    rows=c.execute("DELETE FROM signup_join_intents WHERE user_id=%s AND kind='card' RETURNING code,want_request",(uid,)).fetchall()
    for r in rows:
        try:
            with c.transaction():
                row=active(c,r['code'],uid)
                if row['user_id']!=uid:c.execute('INSERT INTO card_connections(user_id,member_id,joined) VALUES(%s,%s,true) ON CONFLICT(user_id,member_id) DO UPDATE SET joined=true',(row['user_id'],uid))
        except HTTPException:continue
        if r['want_request']:
            try:
                with c.transaction():request_friend(c,uid,r['code'],True)
            except HTTPException:pass  # Revoked/blocked/capped links never prevent confirmation.


def sport_icon(g,sport,x,y,size=48):
    # Same simple 24-unit pictograms as the app, drawn locally without an SVG/network dependency.
    strokes={
      'run':[[8,21,11,15,14,17,14,21],[6,12,9,8,13,9,15,12,18,13],[11,15,9,12]],
      'ride':[[6,16,10,8,15,8,18,16],[10,8,12,16],[13,5,16,5]],
      'walk':[[10,21,12,15,14,17,14,21],[9,13,10,8,13,9,15,12],[10,8,7,10,7,13]],
      'hike':[[3,20,9,10,13,16,16,12,21,20,3,20],[14,6,16,4,18,6]],
      'swim':[[2,18,6,16.5,10,18,14,16.5,18,18,22,16.5],[8,13,12,9,15,12]],
      'row':[[3,17,21,17],[6,17,15,7],[14,6,17,7,16,10]],
      'ski':[[4,20,20,14],[9,4,11,13],[7,9,13,7]],
      'workout':[[6,8,6,16],[18,8,18,16],[3,10,3,14],[21,10,21,14],[6,12,18,12]],
      'other':[[12,8,12,12,15,14]]}
    circles={'run':[(15,4.5,2)],'walk':[(13,4.5,2)],'ride':[(6,16,4),(18,16,4)],'swim':[(16,8.5,2)],'ski':[(13,4,1.6)],'other':[(12,12,8)]}
    scale=size/24;color=SPORT_COLORS[sport];width=max(2,round(1.7*scale))
    for path in strokes.get(sport,[]):
        points=[(x+path[i]*scale,y+path[i+1]*scale) for i in range(0,len(path),2)]
        g.line(points,fill=color,width=width,joint='curve')
        for px,py in points:g.ellipse((px-width/2,py-width/2,px+width/2,py+width/2),fill=color)
    for cx,cy,r in circles.get(sport,[]):g.ellipse((x+(cx-r)*scale,y+(cy-r)*scale,x+(cx+r)*scale,y+(cy+r)*scale),outline=color,width=width)

def flame_icon(g,x,y,size=24):
    # Draw the streak mark locally; the default image font has no emoji glyphs.
    s=size/24
    outer=[(12,1),(15,7),(19,9),(22,15),(20,21),(16,24),(7,23),(3,18),(4,12),(8,8),(9,14),(12,11)]
    inner=[(12,14),(15,17),(14,21),(9,21),(7,18),(9,15)]
    g.polygon([(x+a*s,y+b*s) for a,b in outer],fill='#F0642B')
    g.polygon([(x+a*s,y+b*s) for a,b in inner],fill='#FFC247')


def image(c,row,request):
    d=payload(c,row,request);im=Image.new('RGB',(1080,1350),'#FFFFFF');g=ImageDraw.Draw(im)
    def text(value,x,y,size=42,color='#15191D',max_width=936):
        font=ImageFont.load_default(size=size)
        while size>20:
            if g.textlength(str(value),font=font)<=max_width:break
            size-=2;font=ImageFont.load_default(size=size)
        g.text((x,y),str(value),font=font,fill=color)
    y=100
    if 'photo' in d:
        p=c.execute('SELECT img FROM profile_photos WHERE user_id=%s',(row['user_id'],)).fetchone()
        if p:
            photo=ImageOps.fit(Image.open(io.BytesIO(bytes(p['img']))).convert('RGB'),(180,180));mask=Image.new('L',(180,180));ImageDraw.Draw(mask).ellipse((0,0,180,180),fill=255);im.paste(photo,(72,y),mask);y+=225
    text('@'+d['username'],72,y,76);y+=110;text('is on Kinetta',72,y,42,'#4A535C');y+=95
    if d['sports']:
        text('Sports · all time',72,y,26,'#646D77');y+=44
        for n,item in enumerate(d['sports']):
            sport=item['sport'];x=72+(n%3)*312;top=y+(n//3)*100
            g.rounded_rectangle((x,top,x+296,top+88),radius=18,fill='#EDF0F3')
            sport_icon(g,sport,x+16,top+23,size=42)
            text(f"{item['activities']:,}",x+76,top+10,36,max_width=204)
            text(SPORTS[sport],x+76,top+54,22,'#4A535C',max_width=204)
        y+=((len(d['sports'])+2)//3)*100+16
    if d['period']=='this_week':
        week=d['weekly'];unit=week['unit'];scale=1609.344 if unit=='mi' else 1000
        text('This week',72,y,30,'#646D77')
        if week['streak_weeks']>=2:
            streak=f"{week['streak_weeks']} weeks";font=ImageFont.load_default(size=30)
            while g.textlength(streak,font=font)>330:font=ImageFont.load_default(size=max(20,font.size-2))
            g.text((1008,y),streak,font=font,fill='#15191D',anchor='ra')
            flame_icon(g,1008-round(g.textlength(streak,font=font))-32,y+2,size=26)
        y+=48
        distance=week['distance_m']/scale
        elapsed=week['time_s'];duration=(f'{elapsed//3600}h {elapsed%3600//60:02}m' if elapsed>=3600 else f'{elapsed//60}m')
        metrics=[(f'{distance:.1f} {unit}','distance'),(f"{week['activities']:,}",'workouts'),(duration,'time')]
        for i,(value,label) in enumerate(metrics):
            x=72+i*312;text(value,x,y,48,max_width=292);text(label,x,y+56,22,'#4A535C',max_width=292)
        y+=98
        bars=week['weeks'];peak=max((v['distance_m'] for v in bars),default=0);bar_top=y+62;baseline=bar_top+64;bar_w=42;step=78
        g.line((72,baseline,1008,baseline),fill='#AEB6C0',width=2)
        previous_month=None
        for i,item in enumerate(bars):
            x=72+i*step;value=item['distance_m'];height=max(4,round(value/peak*58)) if peak else 2
            color='#1F55D0' if i==len(bars)-1 else '#93B4F4'
            if value:g.rounded_rectangle((x,baseline-height,x+bar_w,baseline),radius=6,fill=color)
            else:g.line((x,baseline-2,x+bar_w,baseline-2),fill='#646D77',width=2)
            month=dt.date.fromisoformat(item['week']).strftime('%b')
            if month!=previous_month:text(month,x,baseline+10,18,'#646D77',max_width=bar_w+20)
            previous_month=month
        y=baseline+42
    else:
        totals=d['all_time'];unit=totals['unit'];scale=1609.344 if unit=='mi' else 1000
        text('All time',72,y,30,'#646D77');y+=48
        distance=totals['distance_m']/scale;elapsed=totals['time_s'];duration=(f'{elapsed//3600}h {elapsed%3600//60:02}m' if elapsed>=3600 else f'{elapsed//60}m')
        for i,(value,label) in enumerate([(f'{distance:.1f} {unit}','distance'),(f"{totals['activities']:,}",'workouts'),(duration,'time')]):
            x=72+i*312;text(value,x,y,48,max_width=292);text(label,x,y+56,22,'#4A535C',max_width=292)
        y+=135
    def wrapped(value,y,size,max_lines):
        # Long configured addresses and source lists must wrap, never leave the canvas.
        while size>=18:
            font=ImageFont.load_default(size=size);lines=[];line=''
            for ch in value:
                if line and g.textlength(line+ch,font=font)>936:lines.append(line);line=ch
                else:line+=ch
            if line:lines.append(line)
            if len(lines)<=max_lines:
                for n,line in enumerate(lines):g.text((72,y+n*24),line,font=font,fill='#646D77')
                return
            size-=1
        raise HTTPException(400,'The public card address is too long for its picture. Ask the server owner to use a shorter public address.')
    if d['garmin_sources']:
        sources=d['garmin_sources'];credit=', '.join(sources[:2])+(f' + {len(sources)-2} other Garmin devices' if len(sources)>2 else '')
        wrapped('Includes data from '+credit,1060,22,2)
    text('Join me on Kinetta',72,1135,40)
    wrapped(d['url'].removeprefix('https://').removeprefix('http://'),1190,22,4)
    # Use the established app mark, with the same gap and dot rather than inventing a logo.
    g.rounded_rectangle((72,1290,124,1320),radius=15,outline='#1F55D0',width=5);g.ellipse((107,1280,133,1306),fill='white');g.ellipse((113,1286,127,1300),fill='#1F55D0');text('Kinetta',146,1285,36)
    out=io.BytesIO();im.save(out,format='PNG');return out.getvalue()

def cached_result(c,row,request,kind='picture'):
    profile=c.execute('SELECT tz,units FROM profile WHERE user_id=%s',(row['user_id'],)).fetchone() or {}
    state=c.execute('SELECT generation FROM milestone_state WHERE user_id=%s',(row['user_id'],)).fetchone()
    zone=ZoneInfo(db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ)
    key=(kind,row['code'],row['updated'],row['login'],row['photo_v'],profile.get('tz'),profile.get('units'),
         state['generation'] if state else 0,dt.datetime.now(zone).date(),url(row['code'],request))
    def get():
        with _picture_lock:
            for old in [k for k,v in _pictures.items() if v[0]<=time.monotonic()]:del _pictures[old]
            item=_pictures.get(key)
            if item:_pictures.move_to_end(key);return item[1]
    found=get()
    if found is not None:return found
    if not _render_slots.acquire(timeout=1):
        raise HTTPException(429,'The picture is busy. Try again in a moment.',headers={'Retry-After':'1'})
    try:
        found=get()
        if found is not None:return found
        picture=image(c,row,request) if kind=='picture' else payload(c,row,request)
        with _picture_lock:
            _pictures[key]=(time.monotonic()+PICTURE_TTL,picture);_pictures.move_to_end(key)
            while len(_pictures)>PICTURE_LIMIT:_pictures.popitem(last=False)
        return picture
    finally:_render_slots.release()

@router.get('/api/card/image.png')
def own_image(request:Request,user=Depends(current_user)):
    with db.connect() as c:
        row=own(c,user['id']);row.update(c.execute('SELECT login::text AS login,photo_v FROM users WHERE id=%s',(user['id'],)).fetchone())
        return Response(cached_result(c,row,request),media_type='image/png',headers=HEADERS)

@router.get('/card/{code}/image.png')
def card_image(code:str,request:Request):
    viewer=optional_user(request)
    with db.connect() as c:
        # Revocation, rotation, suspension and blocks are checked even on cache hits.
        row=active(c,code,viewer['id'] if viewer else None)
        return Response(cached_result(c,row,request),media_type='image/png',headers=HEADERS)

@router.get('/card/{code}/photo')
def card_photo(code:str,request:Request):
    viewer=optional_user(request)
    with db.connect() as c:
        r=active(c,code,viewer['id'] if viewer else None)
        if not r['photo']:raise HTTPException(404)
        p=c.execute('SELECT img FROM profile_photos WHERE user_id=%s',(r['user_id'],)).fetchone()
        if not p:raise HTTPException(404)
        return Response(bytes(p['img']),media_type='image/jpeg',headers=HEADERS)

@router.get('/card/{code}')
def public_page(code:str,request:Request):
    viewer=optional_user(request)
    try:
        with db.connect() as c:
            row=active(c,code,viewer['id'] if viewer else None)
            d={'username':row['login'],'url':url(row['code'],request),'allow_requests':row['allow_requests']};state=signup.state(c)
    except HTTPException as e:
        if e.status_code!=404:raise
        return HTMLResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/theme.css"><link rel="stylesheet" href="/static/style.css"><main class="shell"><h1>This card is no longer active</h1><p>Ask for a new link.</p><a href="/">Open Kinetta</a></main></html>',status_code=404,headers=HEADERS)
    esc=html.escape;title='@'+d['username']+' on Kinetta';dest='/signup?card='+code if state['open'] else '/beta?card='+code
    if viewer:
        from .api_social import _pair
        with db.connect() as c:pair=_pair(c,viewer['id'],row['user_id'])
        if viewer['id']==row['user_id']:action='<a class="primary wide" href="/me">Open Kinetta</a>'
        elif pair:
            label='Friends' if pair['status']=='accepted' else 'Request sent' if pair['requester']==viewer['id'] else 'Respond in Friends'
            action=f'<p>{label}</p><a class="primary wide" href="/me/friends">Open Friends</a>'
        elif d['allow_requests']:action=f'<button class="primary wide" id="public-card-request" data-code="{esc(code)}">Send friend request</button>'
        else:action='<p>Friend requests from this card are off.</p><a class="primary wide" href="/me">Open Kinetta</a>'
    else:action=f'<a class="primary wide" href="{esc(dest)}">Join @{esc(d["username"])} on Kinetta</a><p class="small muted">'+('You’ll choose whether to send a friend request when signing up.' if state['open'] else 'Kinetta is invite-only right now. Join the waitlist for an invitation.')+'</p><a class="ghost wide" href="/?card='+esc(code)+'">Already a member? Log in</a>'
    from . import api_beta
    if not viewer and not state['open'] and not api_beta.enabled():action=f'<p>Kinetta is invite-only right now. Ask the server owner for an invitation, then reopen this card link.</p><a class="primary wide" href="/?card={esc(code)}">Already a member? Log in</a>'
    app_link=account_email.iphone_app();install=f'<a class="ghost wide" href="{esc(app_link)}">Get the iPhone app</a><p class="small muted">After installing, reopen this card link to continue in the app.</p>' if app_link else ''
    body=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>{esc(title)}</title><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="Join me on Kinetta. Friend requests are approved, never automatic."><meta property="og:image" content="{esc(d['url']+'/image.png')}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350"><link rel="stylesheet" href="/static/theme.css"><link rel="stylesheet" href="/static/style.css"><link rel="stylesheet" href="/static/cards.css?v=2"></head><body><main class="shell public-card"><img class="public-card-picture" src="/card/{esc(code)}/image.png" alt="{esc(title)}"><h1>@{esc(d['username'])} is on Kinetta</h1>{action}<p id="public-card-status" role="status"></p>{install}<p class="small muted">Your workouts and food, in one app. Opening this card never makes you friends automatically.</p></main><script src="/static/card-public.js?v=2" defer></script></body></html>'''
    return HTMLResponse(body,headers=HEADERS)
