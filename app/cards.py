"""Opt-in, revocable public cards. Only a fixed allowlist leaves the owner's account."""
import datetime as dt
import html
import io
import json
import os
import secrets
from fastapi import APIRouter,Depends,HTTPException,Request,Response
from fastapi.responses import HTMLResponse
from PIL import Image,ImageDraw,ImageFont,ImageOps
from pydantic import BaseModel,ConfigDict,Field,StrictBool,model_validator
from . import db,auth,recaps,signup,account_email,notify
from .auth import current_user

router=APIRouter()
STAT_KEYS=('distance_year','active_days_year','activities_year','activity_weeks','food_days_month')
SPORTS={'run':'Running','ride':'Cycling','walk':'Walking','hike':'Hiking','swim':'Swimming','workout':'Workouts','row':'Rowing','ski':'Skiing','other':'Other activities'}
HEADERS={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}

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

def payload(c,row,request=None):
    uid=row['user_id'];wanted=row['stats'];out={'username':row['login'],'sports':[],'stats':[],'garmin_sources':[],'allow_requests':row['allow_requests'],'url':url(row['code'],request)}
    year=recaps.facts(c,uid,'this_year') if wanted else None
    if row['sports']:
        out['sports']=[r['sport'] for r in c.execute('SELECT DISTINCT sport FROM activities WHERE user_id=%s ORDER BY sport',(uid,)).fetchall() if r['sport'] in SPORTS]
    if wanted:
        profile=c.execute('SELECT units FROM profile WHERE user_id=%s',(uid,)).fetchone() or {};imperial=profile.get('units')=='imperial'
        for key in wanted:
            if key=='distance_year':value=year['distance_m']/(1609.344 if imperial else 1000);label=('mi' if imperial else 'km')+' this year';value=round(value,1)
            elif key=='active_days_year':value=year['active_days'];label='active days this year'
            elif key=='activities_year':value=year['activities'];label='activities this year'
            elif key=='activity_weeks':value=year['streak_weeks'];label='active weeks in a row'
            else:value=recaps.facts(c,uid,'this_month')['food']['logged_days'];label='days with food logged this month'
            out['stats'].append({'key':key,'value':value,'label':label})
        if any(k!='food_days_month' for k in wanted):out['garmin_sources']=year['garmin_sources']
    if row['photo'] and row['photo_v']:out['photo']=url(row['code'],request)+'/photo'
    return out

class Settings(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled:StrictBool
    photo:StrictBool=False
    sports:StrictBool=True
    stats:list[str]=Field(default_factory=list,max_length=2)
    allow_requests:StrictBool=True
    @model_validator(mode='after')
    def valid_stats(self):
        if len(set(self.stats))!=len(self.stats) or any(k not in STAT_KEYS for k in self.stats):raise ValueError('Choose up to two listed stats')
        return self

def owner_answer(c,uid,request):
    row=own(c,uid);row.update(c.execute('SELECT login::text AS login,photo_v FROM users WHERE id=%s',(uid,)).fetchone())
    waiting=c.execute("SELECT count(*) AS n FROM card_connections k JOIN friendships f ON f.requester=k.member_id AND f.addressee=k.user_id AND f.status='pending' WHERE k.user_id=%s",(uid,)).fetchone()['n']
    joined=c.execute('SELECT count(*) AS n FROM card_connections WHERE user_id=%s AND joined',(uid,)).fetchone()['n']
    return {**{k:row[k] for k in ('enabled','photo','sports','stats','allow_requests')},'url':url(row['code'],request),'preview':payload(c,row,request),'joined':joined,'waiting':waiting}

@router.get('/api/card')
def settings(request:Request,user=Depends(current_user)):
    with db.connect() as c:return owner_answer(c,user['id'],request)

@router.put('/api/card')
def change(body:Settings,request:Request,user=Depends(current_user)):
    from .api_social import confirmed
    with db.connect() as c:
        confirmed(c,user['id']);own(c,user['id'])
        c.execute('UPDATE public_cards SET enabled=%s,photo=%s,sports=%s,stats=%s,allow_requests=%s,updated=now() WHERE user_id=%s',(body.enabled,body.photo,body.sports,json.dumps(body.stats),body.allow_requests,user['id']))
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
        row=active(c,code,viewer['id'] if viewer else None);out=payload(c,row,request)
        if viewer:
            from .api_social import _pair
            pair=_pair(c,viewer['id'],row['user_id']);out['relationship']='self' if viewer['id']==row['user_id'] else ('friends' if pair and pair['status']=='accepted' else 'request_sent' if pair and pair['requester']==viewer['id'] else 'incoming' if pair else 'none')
        return out

def request_friend(c,uid,code,joined=False):
    from .api_social import confirmed,_pair,MAX_PENDING
    confirmed(c,uid);candidate=active(c,code,uid);owner=candidate['user_id']
    # Account erasure uses account-before-personal-row order; card requests do too.
    c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR KEY SHARE',(sorted({uid,owner}),)).fetchall()
    row=active(c,code,uid,True)
    if owner==uid:return {'status':'self'}
    if not row['allow_requests']:raise HTTPException(409,'Friend requests from this card are turned off')
    pair=_pair(c,uid,owner,lock=True)
    if pair:return {'status':'friends' if pair['status']=='accepted' else 'request_sent' if pair['requester']==uid else 'incoming'}
    if account_email.limited(c,'card-viewer:'+str(uid),10,60):raise HTTPException(429,'Too many card requests. Try again later.')
    waiting=c.execute("SELECT count(*) AS n FROM card_connections k JOIN friendships f ON f.requester=k.member_id AND f.addressee=k.user_id AND f.status='pending' WHERE k.user_id=%s",(owner,)).fetchone()['n']
    pending=c.execute("SELECT count(*) AS n FROM friendships WHERE requester=%s AND status='pending'",(uid,)).fetchone()['n']
    if waiting>=20 or pending>=MAX_PENDING:raise HTTPException(429,'There are enough requests waiting. Try again later.')
    c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(uid,owner))
    c.execute('INSERT INTO card_connections(user_id,member_id,joined) VALUES(%s,%s,%s) ON CONFLICT(user_id,member_id) DO UPDATE SET joined=card_connections.joined OR excluded.joined',(owner,uid,joined))
    notify.add(c,owner,'friend_request',uid)
    return {'status':'request_sent'}

@router.post('/api/cards/{code}/request')
def ask(code:str,user=Depends(current_user)):
    with db.connect() as c:return request_friend(c,user['id'],code)

def consume_signup(c,uid):
    rows=c.execute('DELETE FROM signup_join_intents WHERE user_id=%s RETURNING kind,code,want_request',(uid,)).fetchall()
    for r in rows:
        if r['kind']=='card':
            try:
                with c.transaction():
                    row=active(c,r['code'],uid)
                    if row['user_id']!=uid:c.execute('INSERT INTO card_connections(user_id,member_id,joined) VALUES(%s,%s,true) ON CONFLICT(user_id,member_id) DO UPDATE SET joined=true',(row['user_id'],uid))
            except HTTPException:continue
            if r['want_request']:
                try:
                    with c.transaction():request_friend(c,uid,r['code'],True)
                except HTTPException:pass   # revoked/blocked/capped links never prevent confirmation


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
    scale=size/24;color='#1F55D0';width=max(2,round(1.7*scale))
    for path in strokes.get(sport,[]):g.line([(x+path[i]*scale,y+path[i+1]*scale) for i in range(0,len(path),2)],fill=color,width=width,joint='curve')
    for cx,cy,r in circles.get(sport,[]):g.ellipse((x+(cx-r)*scale,y+(cy-r)*scale,x+(cx+r)*scale,y+(cy+r)*scale),outline=color,width=width)


def image(c,row,request):
    d=payload(c,row,request);im=Image.new('RGB',(1080,1350),'#FFFFFF');g=ImageDraw.Draw(im)
    def text(value,x,y,size=42,color='#15191D',max_width=936):
        while size>20:
            font=ImageFont.load_default(size=size)
            if g.textlength(str(value),font=font)<=max_width:break
            size-=2
        g.text((x,y),str(value),font=font,fill=color)
    y=100
    if 'photo' in d:
        p=c.execute('SELECT img FROM profile_photos WHERE user_id=%s',(row['user_id'],)).fetchone()
        if p:
            photo=ImageOps.fit(Image.open(io.BytesIO(bytes(p['img']))).convert('RGB'),(180,180));mask=Image.new('L',(180,180));ImageDraw.Draw(mask).ellipse((0,0,180,180),fill=255);im.paste(photo,(72,y),mask);y+=225
    text('@'+d['username'],72,y,76);y+=110;text('is on Kinetta',72,y,42,'#4A535C');y+=95
    if d['sports']:
        for n,sport in enumerate(d['sports']):
            x=72+(n%3)*312;top=y+(n//3)*64
            sport_icon(g,sport,x,top)
            text(SPORTS[sport],x+60,top+7,30,'#4A535C',max_width=240)
        y+=((len(d['sports'])+2)//3)*64+25
    if d['stats']:
        slot=(1040-y)/len(d['stats'])
        for stat in d['stats']:
            size=min(144,int(slot*.5));offset=max(0,(slot-size-65)/2)
            text(f"{stat['value']:,}",72,y+offset,size)
            text(stat['label'],72,y+offset+size+18,min(40,int(slot*.2)),'#4A535C')
            y+=slot
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

@router.get('/api/card/image.png')
def own_image(request:Request,user=Depends(current_user)):
    with db.connect() as c:
        row=own(c,user['id']);row.update(c.execute('SELECT login::text AS login,photo_v FROM users WHERE id=%s',(user['id'],)).fetchone())
        return Response(image(c,row,request),media_type='image/png',headers=HEADERS)

@router.get('/card/{code}/image.png')
def card_image(code:str,request:Request):
    viewer=optional_user(request)
    with db.connect() as c:return Response(image(c,active(c,code,viewer['id'] if viewer else None),request),media_type='image/png',headers=HEADERS)

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
            row=active(c,code,viewer['id'] if viewer else None);d=payload(c,row,request);state=signup.state(c)
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
