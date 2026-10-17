"""Your data, your call (2026-10-11): download everything Kinetta keeps about you, or delete your account.

Download: one zip - every personal table as JSON Lines, spreadsheet-friendly CSVs of activities, food and weight, and
the original activity files you or your watch uploaded. Secrets (password hash, login sessions, connection keys) and
server paths are left out. Built in a temporary file and removed once sent; one download per 5 minutes per person.
Delete: needs your password; removes the account, every row and every file at once. Kept only in the server's
backups until they rotate out (see the privacy policy).
"""
import csv
import io
import json
import os
import secrets
import tempfile
import time
import zipfile
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from . import db, auth
from .auth import current_user
from .api_account import DATA, erase, erase_files

router = APIRouter()
_last_export = {}

# table -> SQL giving one jsonb per row for the person (%s = user id). Personal tables only; secrets left out.
DROP = " - 'user_id'"
TABLES = {
    'recipe_link_drafts': "SELECT to_jsonb(t)" + DROP + " FROM recipe_link_drafts t WHERE user_id = %s ORDER BY created",
    'nutrition_checkins': "SELECT to_jsonb(t)" + DROP + " FROM nutrition_checkins t WHERE user_id = %s ORDER BY week",
    'profile': "SELECT to_jsonb(t)" + DROP + " FROM profile t WHERE user_id = %s",
    'activities': """SELECT to_jsonb(t)""" + DROP + """ - 'geom' - 'start_pt' - 'end_pt' - 'file_path' - 'file_sha256'
                       || jsonb_build_object('track', ST_AsGeoJSON(t.geom)::jsonb) FROM activities t WHERE user_id = %s ORDER BY start_time""",
    'activity_streams': "SELECT to_jsonb(t)" + DROP + " FROM activity_streams t WHERE user_id = %s ORDER BY activity_id",
    'best_efforts': "SELECT to_jsonb(t)" + DROP + " FROM best_efforts t WHERE user_id = %s ORDER BY start_time",
    'routes': "SELECT to_jsonb(t)" + DROP + " FROM routes t WHERE user_id = %s ORDER BY id",
    'gear': "SELECT to_jsonb(t)" + DROP + " FROM gear t WHERE user_id = %s ORDER BY id",
    'goals': "SELECT to_jsonb(t)" + DROP + " FROM goals t WHERE user_id = %s ORDER BY id",
    'training_plans': "SELECT to_jsonb(t)" + DROP + " FROM training_plans t WHERE user_id = %s ORDER BY id",
    'plan_marks': "SELECT to_jsonb(t)" + DROP + " FROM plan_marks t WHERE user_id = %s ORDER BY day",
    'coach_notes': "SELECT to_jsonb(t)" + DROP + " FROM coach_notes t WHERE user_id = %s ORDER BY created",
    'food_chat_messages': "SELECT to_jsonb(t)" + DROP + " FROM food_chat_messages t WHERE user_id = %s ORDER BY id",
    'food_chat_aliases': "SELECT to_jsonb(t)" + DROP + " FROM food_chat_aliases t WHERE user_id = %s ORDER BY created",
    'food_chat_cancellations': "SELECT to_jsonb(t)" + DROP + " FROM food_chat_cancellations t WHERE user_id = %s ORDER BY created",
    'food_chat_jobs': "SELECT to_jsonb(t)" + DROP + " FROM food_chat_jobs t WHERE user_id = %s ORDER BY created",
    'food_chat_entries': "SELECT to_jsonb(t)" + DROP + " FROM food_chat_entries t WHERE user_id = %s ORDER BY message_id, entry_id",
    'food_entries': "SELECT to_jsonb(t)" + DROP + " FROM food_entries t WHERE user_id = %s ORDER BY day, position",
    'custom_foods': "SELECT to_jsonb(t)" + DROP + " FROM custom_foods t WHERE user_id = %s ORDER BY id",
    'saved_meals': "SELECT to_jsonb(t)" + DROP + " FROM saved_meals t WHERE user_id = %s ORDER BY id",
    'dishes': "SELECT to_jsonb(t)" + DROP + " FROM dishes t WHERE user_id = %s ORDER BY id",     # cooking mode (api_dishes.py)
    'pans': "SELECT to_jsonb(t)" + DROP + " FROM pans t WHERE user_id = %s ORDER BY id",
    'weights': "SELECT to_jsonb(t)" + DROP + " FROM weights t WHERE user_id = %s ORDER BY day",
    'day_goals': "SELECT to_jsonb(t)" + DROP + " FROM day_goals t WHERE user_id = %s ORDER BY day",
    'health_resting': "SELECT to_jsonb(t)" + DROP + " FROM health_resting t WHERE user_id = %s ORDER BY day, tz",
    'day_energy': "SELECT to_jsonb(t)" + DROP + " FROM day_energy t WHERE user_id = %s ORDER BY day",
    'imports': "SELECT to_jsonb(t)" + DROP + " FROM imports t WHERE user_id = %s ORDER BY created",
    'connections': """SELECT jsonb_build_object('kind', kind, 'status', status, 'last_sync', last_sync, 'created', created)
                        FROM connections WHERE user_id = %s""",
    # friends (by username), and the cheers and comments you gave (2026-10-11, api_social.py)
    'friends': """SELECT jsonb_build_object('login', u.login, 'name', u.name, 'status', f.status, 'you_asked', f.requester = me.id,
                     'created', f.created, 'accepted', f.accepted)
                   FROM (SELECT %s::bigint AS id) me JOIN friendships f ON me.id IN (f.requester, f.addressee)
                   JOIN users u ON u.id = CASE WHEN f.requester = me.id THEN f.addressee ELSE f.requester END""",
    'blocked': """SELECT jsonb_build_object('login', u.login, 'name', u.name, 'since', b.created)
                   FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.user_id = %s""",
    'reports_made': """SELECT jsonb_build_object('about', u.login, 'what', r.what, 'reason', r.reason, 'note', r.note,
                     'created', r.created, 'status', r.status) FROM reports r JOIN users u ON u.id = r.person WHERE r.reporter = %s""",
    'cheers_given': "SELECT to_jsonb(t)" + DROP + " FROM cheers t WHERE user_id = %s ORDER BY created",
    # photos (2026-10-12, api_photos.py): the list here, the pictures themselves in photos/
    # lifting (2026-10-13, api_lifts.py): your exercises, and every set with the session (activity) it was in
    'exercises': "SELECT to_jsonb(t)" + DROP + " FROM exercises t WHERE user_id = %s ORDER BY id",
    'lift_sets': "SELECT to_jsonb(t)" + DROP + " - 'id' FROM lift_sets t WHERE user_id = %s ORDER BY activity_id, pos, n",
    'activity_photos': "SELECT to_jsonb(t)" + DROP + " - 'img' - 'thumb' FROM activity_photos t WHERE user_id = %s ORDER BY id",
    'comments_written': "SELECT to_jsonb(t)" + DROP + " FROM comments t WHERE user_id = %s ORDER BY created",
    'ai_daily_usage': "SELECT to_jsonb(t)" + DROP + " FROM ai_daily_usage t WHERE user_id = %s ORDER BY day,kind",
    'ai_food_attempts': "SELECT to_jsonb(t)" + DROP + " FROM ai_food_attempts t WHERE user_id = %s ORDER BY created",
    'ai_food_requests': "SELECT to_jsonb(t)" + DROP + " FROM ai_requests t WHERE user_id = %s ORDER BY created",   # when you asked for AI food feedback
    # dishes shared with you by friends (cooking mode, 2026-10-11): which dish, from whom
    'dishes_shared_with_me': """SELECT jsonb_build_object('dish_id', s.dish_id, 'dish', d.name, 'from', u.login, 'created', s.created)
                   FROM dish_shares s JOIN dishes d ON d.id = s.dish_id JOIN users u ON u.id = d.user_id WHERE s.user_id = %s""",
}
CSVS = {
    'activities.csv': """SELECT start_time, sport, name, distance_m, moving_s, elapsed_s, ascent_m, avg_hr, max_hr, calories, effort, device
                         FROM activities WHERE user_id = %s ORDER BY start_time""",
    'food.csv': """SELECT day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g
                   FROM food_entries WHERE user_id = %s ORDER BY day, position""",
    'weight.csv': 'SELECT day, kg, note, source FROM weights WHERE user_id = %s ORDER BY day',
}
README = """Your Kinetta data, downloaded {when}.

data/*.jsonl  every table Kinetta keeps about you, one JSON object per line (activity tracks are GeoJSON).
*.csv         your activities, food log and weigh-ins, ready for a spreadsheet. Distances in meters, times in seconds.
files/        the original activity files (FIT, GPX, TCX) you or your watch uploaded.
photos/       your profile photo and the photos on your activities (activity id - photo id.jpg).

Left out on purpose: your password (only a scrambled form is stored), login sessions and connection keys.
"""


def _write_export(uid, path):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z, db.connect() as c:
        z.writestr('README.txt', README.format(when=time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())))
        u = c.execute('SELECT login::text AS login, name, created FROM users WHERE id = %s', (uid,)).fetchone()
        z.writestr('data/account.json', json.dumps(u, default=str, indent=1))
        for name, q in TABLES.items():
            with z.open(f'data/{name}.jsonl', 'w') as f, c.cursor(name=f'x_{name}') as cur:   # server-side: streams big tables
                cur.itersize = 500
                cur.execute(q, (uid,))
                for r in cur:
                    f.write((json.dumps(next(iter(r.values())), default=str, separators=(',', ':')) + '\n').encode())
        for name, q in CSVS.items():
            rows = c.execute(q, (uid,)).fetchall()
            buf = io.StringIO(); w = csv.writer(buf)
            if rows: w.writerow(rows[0].keys())
            for r in rows: w.writerow(r.values())
            z.writestr(name, buf.getvalue())
        if (pp := c.execute('SELECT img FROM profile_photos WHERE user_id = %s', (uid,)).fetchone()):
            z.writestr('photos/profile.jpg', bytes(pp['img']))
        with c.cursor(name='x_photos') as cur:
            cur.itersize = 20
            cur.execute('SELECT id, activity_id, img FROM activity_photos WHERE user_id = %s ORDER BY id', (uid,))
            for r in cur: z.writestr(f"photos/activities/{r['activity_id']}-{r['id']}.jpg", bytes(r['img']))
    base = os.path.join(DATA, 'files', str(uid))
    if os.path.isdir(base):
        with zipfile.ZipFile(path, 'a', zipfile.ZIP_STORED) as z:     # already compressed (.fit / .gz) mostly
            for root, _, files in os.walk(base):
                for fn in files:
                    full = os.path.join(root, fn)
                    z.write(full, 'files/' + os.path.relpath(full, base))


def _send_export(user):
    now = time.time()
    if now - _last_export.get(user['id'], 0) < 300: raise HTTPException(429, 'You just downloaded your data - try again in 5 minutes')
    _last_export[user['id']] = now
    fd, path = tempfile.mkstemp(prefix='kinetta-export-', suffix='.zip'); os.close(fd)
    try:
        _write_export(user['id'], path)
    except Exception:
        os.unlink(path); _last_export.pop(user['id'], None); raise
    return FileResponse(path, media_type='application/zip', filename=f"kinetta-{user['login']}-{time.strftime('%Y-%m-%d')}.zip",
                        background=BackgroundTask(os.unlink, path), headers={'Cache-Control': 'no-store'})


@router.get('/api/account/export')
def export(user=Depends(current_user)):
    return _send_export(user)


# The iPhone app (2026-10-12): its web view can't save a download, so it asks for a one-time link and opens it in Safari,
# which saves the zip to Files. The link works once, for 5 minutes, and only for the person who asked (kept in memory:
# the server runs as one process).
_links = {}


@router.post('/api/account/export-link')
def export_link(user=Depends(current_user)):
    now = time.time()
    for k in [k for k, (_, _, t) in _links.items() if t < now]: del _links[k]
    key = secrets.token_urlsafe(32)
    _links[key] = (user['id'], user['login'], now + 300)
    return {'path': f'/api/account/export/{key}'}


@router.get('/api/account/export/{key}')
def export_by_link(key: str):
    uid, login, until = _links.pop(key, (None, None, 0))
    if not uid or until < time.time(): raise HTTPException(404, 'This download link has expired - ask for a new one in the app')
    return _send_export({'id': uid, 'login': login})


class DeleteIn(BaseModel):
    password: str = Field(max_length=200)


@router.post('/api/account/delete')
def delete_account(body: DeleteIn, request: Request, response: Response, user=Depends(current_user)):
    ip = auth.client_ip(request)
    if auth.too_many(ip, user['login']): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    with db.connect() as c:
        c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
        me = c.execute('SELECT id, login::text AS login, is_admin, sql_role, pw_hash FROM users WHERE id = %s', (user['id'],)).fetchone()
        if not auth.check_pw(me['pw_hash'], body.password):
            auth.failed(ip, user['login'])
            raise HTTPException(400, 'Password is wrong')
        if me['is_admin'] and not c.execute('SELECT 1 FROM users WHERE is_admin AND id <> %s', (me['id'],)).fetchone() \
                and c.execute('SELECT 1 FROM users WHERE id <> %s', (me['id'],)).fetchone():
            raise HTTPException(400, "You're the admin and other people use this Kinetta, so this account can't be deleted here")
        erase(c, me)
    erase_files(me['id'])
    response.delete_cookie(auth.COOKIE, path='/')
    return {'ok': True}
