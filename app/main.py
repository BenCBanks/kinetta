"""Kinetta web app: accounts, login, per-person settings, the phone-installable app and all API routers."""
import os, time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import db, auth, api_activities, api_food, api_connections, api_account, food_photo, nutrition_insights, history_import, coach, plans, api_beta, api_mydata, api_health, api_social, api_dishes, cook_chat, food_coach, notify
import threading
from .auth import current_user

@asynccontextmanager
async def lifespan(app):
    db.migrate()     # nightly database copies: host timer fit-db-backup.timer (pg_dump), see README
    threading.Thread(target=api_connections.scheduler, daemon=True).start()   # intervals.icu every 30 min
    threading.Thread(target=coach.weekly_scheduler, daemon=True).start()      # Sunday 6 PM weekly reviews (if an AI key is set)
    yield

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.include_router(api_activities.router)
app.include_router(api_food.router)
app.include_router(api_connections.router)
app.include_router(api_account.router)
app.include_router(food_photo.router)
app.include_router(nutrition_insights.router)
app.include_router(history_import.router)
app.include_router(plans.router)
app.include_router(api_beta.router)
app.include_router(api_mydata.router)
app.include_router(api_health.router)
app.include_router(api_social.router)
app.include_router(api_dishes.router)
app.include_router(cook_chat.router)
app.include_router(food_coach.router)
app.include_router(notify.router)
STATIC = os.path.join(os.path.dirname(__file__), 'static')
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; "
       "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


# The Kinetta iPhone app (mobile/) shows the same pages from inside the app, at this address. Its requests carry a login
# token in a header instead of the cookie (see auth.session_token), so this origin can't act with a browser's login.
APP_ORIGINS = ('capacitor://localhost',)


@app.middleware('http')
async def guard(request: Request, call_next):
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
    r.headers['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()'
    r.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    if request.url.scheme == 'https': r.headers['Strict-Transport-Security'] = 'max-age=31536000'
    if request.url.path.startswith('/api/'): r.headers['Cache-Control'] = 'no-store'
    return r


# Only the iPhone app may read answers across sites, and never with cookies (it sends its token in a header).
app.add_middleware(CORSMiddleware, allow_origins=list(APP_ORIGINS), allow_credentials=False, allow_methods=['*'],
                   allow_headers=['Authorization', 'Content-Type'], max_age=3600)


class Login(BaseModel):
    login: str = Field(max_length=60)
    password: str = Field(max_length=200)
    app: bool = False       # the iPhone app: answer with the login token instead of setting a cookie


@app.post('/api/login')
def login(body: Login, request: Request, response: Response):
    ip = auth.client_ip(request)
    if auth.too_many(ip, body.login):
        raise HTTPException(429, 'Too many tries - wait 15 minutes')
    with db.connect() as c:
        u = c.execute('SELECT id, name, pw_hash FROM users WHERE login = %s', (body.login.strip(),)).fetchone()
        ok = auth.check_pw(u['pw_hash'] if u else None, body.password)   # always hash-checks (same timing)
        if not u or not ok:
            auth.failed(ip, body.login)
            raise HTTPException(401, 'Wrong name or password')
        token = auth.new_session(c, u['id'], request.headers.get('user-agent'))
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
    with db.connect() as c:
        p = c.execute('SELECT units, tz, max_hr, rest_hr, sex, birth_year, weight_kg, height_cm, activity_factor, kcal_target, protein_target, carbs_target, fat_target, fiber_target, ai_ok, health_ai_ok FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        waiting = api_social.waiting(c, user['id'])     # friend requests to answer (a number on the Me tab)
        unread = notify.unread(c, user['id'])            # notifications not yet seen
    return {**user, 'friend_requests': waiting, 'notifications': unread, 'units': 'imperial', 'tz': db.DEFAULT_TZ, 'coach': coach.enabled(), 'ai_provider': {'gemini': "Google's Gemini", 'claude': "Anthropic's Claude"}.get(coach.provider()), **{k: v for k, v in p.items() if v is not None}}


class ProfileIn(BaseModel):
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
    health_ai_ok: bool | None = None      # the AI coach may read workouts that came from Apple Health


@app.put('/api/profile')
def set_profile(body: ProfileIn, user=Depends(current_user)):
    vals = body.model_dump(exclude_unset=True)
    if vals.get('health_ai_ok', False) is None: del vals['health_ai_ok']    # yes or no only
    if 'tz' in vals:
        vals['tz'] = db.valid_tz(vals['tz'])
        if not vals['tz']: raise HTTPException(400, 'Unknown time zone')
    if vals:
        with db.connect() as c:
            c.execute(f"UPDATE profile SET {', '.join(f'{k} = %s' for k in vals)} WHERE user_id = %s", (*vals.values(), user['id']))
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


@app.get('/{path:path}')
def page(path: str):
    if path.startswith('api/'): raise HTTPException(404)
    return FileResponse(os.path.join(STATIC, 'index.html'), headers={'Cache-Control': 'no-cache'})
