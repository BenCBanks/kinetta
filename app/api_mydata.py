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
    'profile': "SELECT to_jsonb(t)" + DROP + " FROM profile t WHERE user_id = %s",
    'activities': """SELECT to_jsonb(t)""" + DROP + """ - 'geom' - 'start_pt' - 'end_pt' - 'file_path' - 'file_sha256'
                       || jsonb_build_object('track', ST_AsGeoJSON(t.geom)::jsonb) FROM activities t WHERE user_id = %s ORDER BY start_time""",
    'activity_streams': "SELECT to_jsonb(t)" + DROP + " FROM activity_streams t WHERE user_id = %s ORDER BY activity_id",
    'best_efforts': "SELECT to_jsonb(t)" + DROP + " FROM best_efforts t WHERE user_id = %s ORDER BY start_time",
    'routes': "SELECT to_jsonb(t)" + DROP + " FROM routes t WHERE user_id = %s ORDER BY id",
    'gear': "SELECT to_jsonb(t)" + DROP + " FROM gear t WHERE user_id = %s ORDER BY id",
    'goals': "SELECT to_jsonb(t)" + DROP + " FROM goals t WHERE user_id = %s ORDER BY id",
    'training_plans': "SELECT to_jsonb(t)" + DROP + " FROM training_plans t WHERE user_id = %s ORDER BY id",
    'coach_notes': "SELECT to_jsonb(t)" + DROP + " FROM coach_notes t WHERE user_id = %s ORDER BY created",
    'food_entries': "SELECT to_jsonb(t)" + DROP + " FROM food_entries t WHERE user_id = %s ORDER BY day, position",
    'custom_foods': "SELECT to_jsonb(t)" + DROP + " FROM custom_foods t WHERE user_id = %s ORDER BY id",
    'saved_meals': "SELECT to_jsonb(t)" + DROP + " FROM saved_meals t WHERE user_id = %s ORDER BY id",
    'dishes': "SELECT to_jsonb(t)" + DROP + " FROM dishes t WHERE user_id = %s ORDER BY id",     # cooking mode (api_dishes.py)
    'pans': "SELECT to_jsonb(t)" + DROP + " FROM pans t WHERE user_id = %s ORDER BY id",
    'weights': "SELECT to_jsonb(t)" + DROP + " FROM weights t WHERE user_id = %s ORDER BY day",
    'day_goals': "SELECT to_jsonb(t)" + DROP + " FROM day_goals t WHERE user_id = %s ORDER BY day",
    'day_energy': "SELECT to_jsonb(t)" + DROP + " FROM day_energy t WHERE user_id = %s ORDER BY day",
    'imports': "SELECT to_jsonb(t)" + DROP + " FROM imports t WHERE user_id = %s ORDER BY created",
    'connections': """SELECT jsonb_build_object('kind', kind, 'status', status, 'last_sync', last_sync, 'created', created)
                        FROM connections WHERE user_id = %s""",
    # friends (by username), and the cheers and comments you gave (2026-10-11, api_social.py)
    'friends': """SELECT jsonb_build_object('login', u.login, 'name', u.name, 'status', f.status, 'you_asked', f.requester = me.id,
                     'created', f.created, 'accepted', f.accepted)
                   FROM (SELECT %s::bigint AS id) me JOIN friendships f ON me.id IN (f.requester, f.addressee)
                   JOIN users u ON u.id = CASE WHEN f.requester = me.id THEN f.addressee ELSE f.requester END""",
    'cheers_given': "SELECT to_jsonb(t)" + DROP + " FROM cheers t WHERE user_id = %s ORDER BY created",
    'comments_written': "SELECT to_jsonb(t)" + DROP + " FROM comments t WHERE user_id = %s ORDER BY created",
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
    base = os.path.join(DATA, 'files', str(uid))
    if os.path.isdir(base):
        with zipfile.ZipFile(path, 'a', zipfile.ZIP_STORED) as z:     # already compressed (.fit / .gz) mostly
            for root, _, files in os.walk(base):
                for fn in files:
                    full = os.path.join(root, fn)
                    z.write(full, 'files/' + os.path.relpath(full, base))


@router.get('/api/account/export')
def export(user=Depends(current_user)):
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


class DeleteIn(BaseModel):
    password: str = Field(max_length=200)


@router.post('/api/account/delete')
def delete_account(body: DeleteIn, request: Request, response: Response, user=Depends(current_user)):
    ip = auth.client_ip(request)
    if auth.too_many(ip, user['login']): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    with db.connect() as c:
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
