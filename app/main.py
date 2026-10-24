"""Kinetta web app: accounts, login, per-person settings, the phone-installable app and all API routers."""
import os, time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware import gzip as _gzip
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StrictBool
from . import db, auth, api_activities, api_food, api_connections, api_account, food_photo, nutrition_insights, history_import, coach, plans, api_beta, api_mydata, api_health, api_social, api_dishes, cook_chat, food_coach, notify, api_photos, api_lifts, garmin_connect
import threading
from .auth import current_user
from . import request_log
from . import meal_reminders,recipe_import, api_coach, ai_release, meal_chat, admin_auth, api_admin, food_thread, admin_usage, kit_thread

@asynccontextmanager
async def lifespan(app):
    db.migrate()     # nightly database copies: host timer fit-db-backup.timer (pg_dump), see README
    threading.Thread(target=coach.weekly_scheduler, daemon=True).start()      # Sunday 6 PM weekly reviews (if an AI key is set)
    threading.Thread(target=meal_reminders.scheduler,daemon=True).start()
    recipe_stop=threading.Event()
    recipe_worker=threading.Thread(target=recipe_import.cleanup,args=(recipe_stop,),daemon=True);recipe_worker.start()
    try:yield
    finally:
        recipe_stop.set();recipe_worker.join(timeout=3)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.include_router(api_activities.router)
app.include_router(api_lifts.router)
app.include_router(api_food.router)
app.include_router(garmin_connect.router)     # before api_connections: its /connections/{kind} would catch these
app.include_router(api_connections.router)
app.include_router(api_account.router)
from . import account_email, signup, api_devices
app.include_router(account_email.router)
app.include_router(signup.router)
app.include_router(api_devices.router)
app.include_router(food_photo.router)
app.include_router(nutrition_insights.router)
app.include_router(history_import.router)
app.include_router(plans.router)
app.include_router(api_beta.router)
app.include_router(api_mydata.router)
app.include_router(api_health.router)
from . import api_health_weights,api_health_nutrition
app.include_router(api_health_weights.router)
app.include_router(api_health_nutrition.router)
app.include_router(api_social.router)
app.include_router(api_photos.router)
app.include_router(api_dishes.router)
app.include_router(cook_chat.router)
app.include_router(food_coach.router)
app.include_router(notify.router)
app.include_router(meal_reminders.router)
app.include_router(api_coach.router)
app.include_router(kit_thread.router)
app.include_router(meal_chat.router)
app.include_router(food_thread.router)
from . import food_entry_review
app.include_router(food_entry_review.router)
app.include_router(recipe_import.router)
app.include_router(admin_auth.router)
app.include_router(api_admin.router)
app.include_router(admin_usage.router)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    # Same 422 as FastAPI's own, minus the echoed input: a NaN/Infinity there made the error response itself fail (500).
    return JSONResponse({'detail': [{k: e[k] for k in ('type', 'loc', 'msg') if k in e} for e in exc.errors()]}, 422)


STATIC = os.path.join(os.path.dirname(__file__), 'static')
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; "
       "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


# The Kinetta iPhone app (mobile/) shows the same pages from inside the app, at this address. Its requests carry a login
# token in a header instead of the cookie (see auth.session_token), so this origin can't act with a browser's login.
APP_ORIGINS = ('capacitor://localhost',)


@app.middleware('http')
async def guard(request: Request, call_next):
    started, request_id = time.monotonic(), request_log.new_id()
    # Cross-site requests can't change anything: writes must come from this site (or the iPhone app) and be JSON.
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE') and request.url.path.startswith('/api/'):
        origin = request.headers.get('origin')
        host = request.headers.get('x-forwarded-host') or request.headers.get('host')
        if origin and origin.split('://', 1)[-1] != host and origin not in APP_ORIGINS:
            return Response('{"detail":"Bad origin"}', 403, media_type='application/json')
        ctype = request.headers.get('content-type', '')
        if 'application/json' not in ctype and not (request.url.path == '/api/import' and ctype.startswith('multipart/form-data')):
            return Response('{"detail":"JSON only"}', 415, media_type='application/json')
    # Through Cloudflare, plain http is answered with a redirect to https, so passwords never travel unencrypted.
    if request.headers.get('cf-connecting-ip') and request.headers.get('x-forwarded-proto', 'https') == 'http':
        return Response(status_code=308, headers={'Location': str(request.url.replace(scheme='https'))})
    r = await call_next(request)
    r.headers['X-Content-Type-Options'] = 'nosniff'
    r.headers['Referrer-Policy'] = 'same-origin'
    r.headers['X-Frame-Options'] = 'DENY'
    r.headers['Content-Security-Policy'] = CSP
    r.headers['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()'
    r.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    if request.url.scheme == 'https': r.headers['Strict-Transport-Security'] = 'max-age=31536000'
    # photos say for themselves how long phones may keep them (api_photos.py: private, and the address changes with the photo)
    if request.url.path.startswith('/api/') and 'cache-control' not in r.headers: r.headers['Cache-Control'] = 'no-store'
    # the app's own files carry their version in the address (?v=), so a phone may keep each one for good (2026-10-13)
    if request.url.path.startswith('/static/') and request.query_params.get('v') and r.status_code == 200:
        r.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    # every API call is recorded (request_log.py): who, which endpoint, result and time; the id helps match a support question
    if request.url.path.startswith('/api/'):
        r.headers['X-Request-Id'] = request_id
        request_log.record(request, r.status_code, (time.monotonic() - started) * 1000, request_id)
    return r


# Compressed answers (2026-10-13): the app's code and data shrink to about a quarter. Photos and zip downloads are
# compressed already, so they're sent as they are (the setting is read by Starlette on every response).
_gzip.DEFAULT_EXCLUDED_CONTENT_TYPES = ('text/event-stream', 'image/', 'application/zip', 'application/octet-stream')
app.add_middleware(_gzip.GZipMiddleware, minimum_size=1024, compresslevel=6)


# Only the iPhone app may read answers across sites, and never with cookies (it sends its token in a header).
app.add_middleware(CORSMiddleware, allow_origins=list(APP_ORIGINS), allow_credentials=False, allow_methods=['*'],
                   allow_headers=['Authorization', 'Content-Type', 'X-Kinetta-Account'], max_age=3600)


class Login(BaseModel):
    login: str = Field(max_length=120)
    password: str = Field(max_length=200)
    app: bool = False       # the iPhone app: answer with the login token instead of setting a cookie


from .admin_usage import audit_attempt

@app.post('/api/login')
@audit_attempt('web')
def login(body: Login, request: Request, response: Response, background: BackgroundTasks):
    ip = auth.client_ip(request)
    if auth.too_many(ip, body.login):
        raise HTTPException(429, 'Too many tries - wait 15 minutes')
    try:
        with db.connect() as c:
            # a username, or the account's confirmed email (2026-10-24)
            who = body.login.strip()
            u = c.execute(('SELECT id, name, pw_hash, suspended_at FROM users WHERE email = %s AND email_verified_at IS NOT NULL' if '@' in who
                           else 'SELECT id, name, pw_hash, suspended_at FROM users WHERE login = %s'), (who,)).fetchone()
            ok = auth.check_pw(u['pw_hash'] if u else None, body.password)   # always hash-checks (same timing)
            if not u or not ok: raise auth.Failed(401, 'Wrong name or password')
            # said only after the right password, so it never reveals who has an account (#233)
            if u['suspended_at']: raise HTTPException(403, 'This account is suspended. Reply to any email from Kinetta, or ask the person who runs it.')
            token = auth.new_session(c, u['id'], request.headers.get('user-agent'),channel='app' if body.app else 'web')
            api_devices.remember(c, background, u['id'], request.headers.get('user-agent'))   # new-device email (#232 I)
    except auth.Failed as e:
        auth.failed(ip, body.login); raise HTTPException(e.status, e.message)
    if body.app: return {'ok': True, 'token': token}
    auth.set_cookie(request, response, token)
    return {'ok': True}


@app.post('/api/logout')
def logout(request: Request, response: Response):
    with db.connect() as c:
        auth.end_session(c, auth.session_token(request))
    response.delete_cookie(auth.COOKIE, path='/')
    return {'ok': True}


@app.get('/api/me')
def me(user=Depends(current_user)):
    from . import ai_access
    with db.connect() as c:
        p = c.execute('SELECT share_default, bio, units, tz, max_hr, rest_hr, sex, birth_year, weight_kg, height_cm, activity_factor, kcal_target, protein_target, carbs_target, fat_target, fiber_target, sodium_target_mg, sugar_target_g, saturated_fat_target_g, ai_ok, health_ai_ok, health_weight_ai_ok, garmin_ai_ok, health_weight_read, health_nutrition_write, weight_health_derived, resting_source, nutrition_goal, goal_pace_percent FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        waiting = api_social.waiting(c, user['id'])     # friend requests to answer (a number on the Me tab)
        unread = notify.unread(c, user['id'])            # notifications not yet seen
        from .admin_usage import opened
        opened(c,user['id'])
        food_user = api_food.food_user(c, user['id'])
        acct = c.execute("SELECT email::text AS email, email_verified_at IS NOT NULL AS email_confirmed, needs_email_confirm FROM users WHERE id = %s", (user['id'],)).fetchone()
        acct['pending_email'] = account_email.pending(c, user['id'])    # Progress shows its Food & weight half only for food users
    return {**user, **acct, 'mail_ready': account_email.mail_ready(), 'food_user': food_user, 'ai_access': ai_access.capabilities(user['id']), 'friend_requests': waiting, 'notifications': unread, 'units': 'imperial', 'tz': db.DEFAULT_TZ, 'ai_paused': not coach.ai_budget.enabled(), 'coach': coach.enabled(), 'coach_tools': ai_release.enabled(), 'food_coach_tools': ai_release.enabled('food'), 'food_photo_itemize': ai_release.food_photo_itemization_enabled(), 'kit_chat': ai_release.enabled('kit'), 'ai_provider': {'gemini': "Google's Gemini", 'claude': "Anthropic's Claude"}.get(coach.provider()), **{k: v for k, v in p.items() if v is not None}}


class ProfileIn(BaseModel):
    bio: str | None = Field(None, max_length=280)
    units: str | None = Field(None, pattern='^(imperial|metric)$')
    tz: str | None = Field(None, max_length=64)
    ai_ok: bool | None = None      # consent to AI features (coach notes, weekly review, food photos)
    max_hr: int | None = Field(None, ge=120, le=230)
    rest_hr: int | None = Field(None, ge=30, le=100)
    sex: str | None = Field(None, pattern='^(male|female)$')
    birth_year: int | None = Field(None, ge=1920, le=2020)
    weight_kg: float | None = Field(None, ge=25, le=300)
    height_cm: float | None = Field(None, ge=100, le=250)
    activity_factor: float | None = Field(None, ge=1.1, le=1.7)
    resting_source: str | None = Field(None, pattern="^(formula|apple_health)$")
    health_weight_ai_ok: StrictBool | None = None
    health_ai_ok: bool | None = None      # the AI coach may read workouts that came from Apple Health
    garmin_ai_ok: StrictBool | None = None   # ... and activities from Garmin Connect (its own yes)


@app.put('/api/profile')
def set_profile(body: ProfileIn, user=Depends(current_user)):
    vals = body.model_dump(exclude_unset=True)
    if vals.get('resting_source', False) is None: del vals['resting_source']
    if vals.get('health_ai_ok', False) is None: del vals['health_ai_ok']    # yes or no only
    if vals.get('health_weight_ai_ok',False) is None:del vals['health_weight_ai_ok']
    if vals.get('garmin_ai_ok',False) is None:del vals['garmin_ai_ok']
    if 'bio' in vals: vals['bio'] = (vals['bio'] or '').strip()
    if 'tz' in vals:
        vals['tz'] = db.valid_tz(vals['tz'])
        if not vals['tz']: raise HTTPException(400, 'Unknown time zone')
    if vals:
        with db.connect() as c:
            c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
            old=c.execute('SELECT tz,health_ai_ok,weight_kg,weight_health_derived,health_weight_read FROM profile WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone() or {}
            if vals.get('health_ai_ok') is False:vals['health_weight_ai_ok']=False
            if vals.get('health_weight_ai_ok') and not vals.get('health_ai_ok',old.get('health_ai_ok')):raise HTTPException(400,'Allow Health data for AI before including Health weight')
            if 'weight_kg' in vals and vals['weight_kg']!=old.get('weight_kg'):vals['weight_health_derived']=False
            changed_tz='tz' in vals and (vals['tz'] or db.DEFAULT_TZ)!=(old.get('tz') or db.DEFAULT_TZ)
            if changed_tz:
                api_health_nutrition.lock(c,user['id'])
                from uuid import uuid4
                vals['health_weight_epoch']=uuid4()
                vals['health_nutrition_epoch']=uuid4()
            c.execute(f"UPDATE profile SET {', '.join(f'{k} = %s' for k in vals)} WHERE user_id = %s", (*vals.values(), user['id']))
            if changed_tz and old.get('health_weight_read'):
                api_health_weights.rebuild(c,user['id'],vals['tz'])
                if api_health_nutrition.profile(c,user['id'])['health_nutrition_write']:api_health_nutrition.invalidate(c,user['id'])
    return {'ok': True}


@app.get('/api/health')
def health():
    with db.connect() as c:
        c.execute('SELECT 1')
    return {'ok': True, 'time': time.time()}


# The phone app: one page + its files. Unknown paths fall back to the page so in-app links survive reloads.
app.mount('/static', StaticFiles(directory=STATIC), name='static')


@app.get('/manifest.webmanifest')
def manifest(): return FileResponse(os.path.join(STATIC, 'manifest.webmanifest'), media_type='application/manifest+json')


@app.get('/sw.js')
def sw(): return FileResponse(os.path.join(STATIC, 'sw.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/admin')
@app.get('/admin/{path:path}')
def admin_page(path: str = ''):
    return FileResponse(os.path.join(STATIC, 'admin.html'), headers={'Cache-Control':'no-store'})


@app.get('/{path:path}')
def page(path: str):
    if path.startswith('api/'): raise HTTPException(404)
    return FileResponse(os.path.join(STATIC, 'index.html'), headers={'Cache-Control': 'no-cache'})
