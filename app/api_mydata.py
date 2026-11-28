"""Your data, your call (2026-10-11): download everything Kinetta keeps about you, or delete your account.

Download: one zip - every personal table as JSON Lines, spreadsheet-friendly CSVs of activities, food and weight, and
the original activity files you or your watch uploaded. Secrets (password hash, login sessions, connection keys) and
server paths are left out. Built in a temporary file and removed once sent; one download per 5 minutes per person.
Delete: needs your password; removes account-owned rows and original/upload files. Shared records and
limited operational/security records have separate retention; backups rotate out (see the privacy policy).
"""
import csv
import io
import json
import os
import secrets
import threading
import time
import weakref
import zipfile
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from . import db, auth, garmin_connect, account_files
from .auth import current_user
from .api_account import DATA, erase, erase_files

router = APIRouter()
_last_export = {}
_export_revocations = {}
_prepared_lock = threading.Lock()

# table -> SQL giving one jsonb per row for the person (%s = user id). Personal tables only; secrets left out.
DROP = " - 'user_id'"
TABLES = {
    'photo_upload_receipts': "SELECT to_jsonb(t)-'user_id' FROM photo_upload_receipts t WHERE user_id=%s ORDER BY created,client_id",
    'group_challenges_created': "SELECT to_jsonb(t)-'creator_id' FROM group_challenges t WHERE creator_id=%s ORDER BY created,id",
    'group_challenge_members': "SELECT to_jsonb(t)-'user_id' FROM group_challenge_members t WHERE user_id=%s ORDER BY joined_at,challenge_id",
    'challenges':"SELECT to_jsonb(t)-'user_id'-'code'-'request_id'-'request_body' FROM challenges t WHERE user_id=%s ORDER BY created",
    'challenge_members':"SELECT to_jsonb(t)-'user_id' FROM challenge_members t WHERE user_id=%s ORDER BY joined",
    'milestones': "SELECT to_jsonb(m)-'user_id' FROM milestones m WHERE user_id=%s ORDER BY occurred,code",
    'milestone_state': "SELECT to_jsonb(m)-'user_id' FROM milestone_state m WHERE user_id=%s",
    'signup_join_intents': "SELECT to_jsonb(t) FROM (SELECT kind,want_request,created FROM signup_join_intents WHERE user_id=%s ORDER BY kind) t",
    'public_card': "SELECT to_jsonb(t) - 'user_id' - 'code' FROM public_cards t WHERE user_id=%s",
    'card_connections': "SELECT to_jsonb(t) FROM (SELECT created,joined FROM card_connections WHERE user_id=%s ORDER BY created) t",
    'activity_intervals': "SELECT to_jsonb(t) - 'user_id' - 'request_hash' FROM activity_intervals t WHERE user_id=%s ORDER BY activity_id,recording_id",
    'interval_presets': "SELECT to_jsonb(t) - 'user_id' FROM interval_presets t WHERE user_id=%s AND deleted_at IS NULL ORDER BY updated,id",
    'interval_preset_receipts': "SELECT to_jsonb(t) - 'user_id' FROM interval_preset_receipts t WHERE user_id=%s ORDER BY preset_id,mutation_id",
    'support_requests': "SELECT jsonb_build_object('kind',kind,'status',status,'received',received,'verified_at',verified_at,'completed_at',completed_at,'method',method) FROM admin_data_requests WHERE user_id=%s ORDER BY received",
    'known_devices': "SELECT to_jsonb(t)" + DROP + " FROM known_devices t WHERE user_id=%s ORDER BY first_seen",
    'kit_visits': "SELECT to_jsonb(t)" + DROP + " FROM kit_visits t WHERE user_id=%s ORDER BY created",
    'kit_memories': "SELECT to_jsonb(t)" + DROP + " FROM kit_memories t WHERE user_id=%s ORDER BY updated",
    'kit_threads': "SELECT to_jsonb(t)" + DROP + " FROM kit_threads t WHERE user_id=%s ORDER BY created,id",
    'kit_conversations': "SELECT to_jsonb(t)" + DROP + " FROM kit_conversations t WHERE user_id=%s",
    'kit_turns': "SELECT to_jsonb(t)" + DROP + " - 'lease' FROM kit_turns t WHERE user_id=%s ORDER BY id",
    'personal_notification_attempts': "SELECT to_jsonb(t)" + DROP + " FROM personal_notification_attempts t WHERE user_id=%s ORDER BY period,kind",
    'health_nutrition_days': "SELECT to_jsonb(t)" + DROP + " FROM health_nutrition_days t WHERE user_id = %s ORDER BY day",
    'health_weight_samples': "SELECT to_jsonb(t)" + DROP + " FROM health_weight_samples t WHERE user_id = %s ORDER BY sample_id",
    'health_weight_exclusions': "SELECT to_jsonb(t)" + DROP + " FROM health_weight_exclusions t WHERE user_id = %s ORDER BY day",
    'recipe_link_drafts': "SELECT to_jsonb(t)" + DROP + " FROM recipe_link_drafts t WHERE user_id = %s ORDER BY created",
    'nutrition_checkins': "SELECT to_jsonb(t)" + DROP + " FROM nutrition_checkins t WHERE user_id = %s ORDER BY week",
    'profile': "SELECT to_jsonb(t)" + DROP + " FROM profile t WHERE user_id = %s",
    'activities': """SELECT to_jsonb(t)""" + DROP + """ - 'geom' - 'start_pt' - 'end_pt' - 'file_path' - 'file_sha256'
                       || jsonb_build_object('track', ST_AsGeoJSON(t.geom)::jsonb) FROM activities t WHERE user_id = %s ORDER BY start_time""",
    'activity_streams': "SELECT to_jsonb(t)" + DROP + " FROM activity_streams t WHERE user_id = %s ORDER BY activity_id",
    'best_efforts': "SELECT to_jsonb(t)" + DROP + " FROM best_efforts t WHERE user_id = %s ORDER BY start_time",
    'routes': "SELECT to_jsonb(t)" + DROP + " FROM routes t WHERE user_id = %s ORDER BY id",
    'planned_routes': "SELECT to_jsonb(t)" + DROP + " FROM planned_routes t WHERE user_id = %s ORDER BY id",
    'planned_route_versions': "SELECT to_jsonb(t)" + DROP + " - 'geom' || jsonb_build_object('line', ST_AsGeoJSON(t.geom)::jsonb) FROM planned_route_versions t WHERE user_id = %s ORDER BY route_id, version",
    'route_drafts': "SELECT to_jsonb(t)" + DROP + " FROM route_drafts t WHERE user_id = %s ORDER BY draft_key",
    'route_publications': "SELECT to_jsonb(t)" + DROP + " - 'geom' FROM route_publications t WHERE user_id=%s ORDER BY route_id",
    'route_share_previews': "SELECT to_jsonb(t)" + DROP + " FROM route_share_previews t WHERE user_id=%s ORDER BY created",
    'route_copy_receipts': "SELECT to_jsonb(t)" + DROP + " FROM route_copy_receipts t WHERE user_id=%s ORDER BY created",
    'segments_created': "SELECT to_jsonb(t) - 'creator_id' - 'geom' || jsonb_build_object('line', ST_AsGeoJSON(t.geom)::jsonb) FROM segments t WHERE creator_id = %s ORDER BY id",
    'segment_drafts': "SELECT to_jsonb(t)" + DROP + " FROM segment_drafts t WHERE user_id = %s ORDER BY id",
    'segment_bookmarks': "SELECT to_jsonb(t)" + DROP + " FROM segment_bookmarks t WHERE user_id = %s ORDER BY segment_id",
    'segment_efforts': "SELECT to_jsonb(t)" + DROP + " FROM segment_efforts t WHERE user_id = %s ORDER BY segment_id, started",
    'segment_stage_scans': "SELECT to_jsonb(t)" + DROP + " FROM segment_stage_scans t WHERE user_id=%s ORDER BY segment_id,activity_id",
    'activity_route_plans': "SELECT to_jsonb(t)" + DROP + " FROM activity_route_plans t WHERE user_id=%s ORDER BY activity_id",
    'track_recording_receipts': "SELECT to_jsonb(t)" + DROP + " FROM track_recording_receipts t WHERE user_id=%s ORDER BY created",
    'segment_appeals': "SELECT to_jsonb(t)" + DROP + " FROM segment_appeals t WHERE user_id = %s ORDER BY id",
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
    'friends': """SELECT jsonb_build_object('login', u.login, 'name', CASE WHEN f.status='accepted' THEN u.name ELSE u.first_name END, 'status', f.status, 'you_asked', f.requester = me.id,
                     'created', f.created, 'accepted', f.accepted)
                   FROM (SELECT %s::bigint AS id) me JOIN friendships f ON me.id IN (f.requester, f.addressee)
                   JOIN users u ON u.id = CASE WHEN f.requester = me.id THEN f.addressee ELSE f.requester END""",
    'blocked': """SELECT jsonb_build_object('login', u.login, 'name', u.first_name, 'since', b.created)
                   FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.user_id = %s""",
    'reports_made': """SELECT jsonb_build_object('about', u.login, 'what', r.what, 'reason', r.reason, 'note', r.note,
                     'created', r.created, 'status', r.status) FROM reports r JOIN users u ON u.id = r.person WHERE r.reporter = %s""",
    'cheers_given': "SELECT to_jsonb(t)" + DROP + " FROM cheers t WHERE user_id = %s ORDER BY created",
    # photos (2026-10-12, api_photos.py): the list here, the pictures themselves in photos/
    # lifting (2026-10-13, api_lifts.py): your exercises, and every set with the session (activity) it was in
    'exercises': "SELECT to_jsonb(t)" + DROP + " FROM exercises t WHERE user_id = %s ORDER BY id",
    'lift_sets': "SELECT to_jsonb(t)" + DROP + " - 'id' FROM lift_sets t WHERE user_id = %s ORDER BY activity_id, pos, n",
    'activity_photos': "SELECT to_jsonb(t)" + DROP + " - 'img' - 'thumb' FROM activity_photos t WHERE user_id = %s ORDER BY id",
    'comment_receipts': "SELECT to_jsonb(t)" + DROP + " FROM comment_receipts t WHERE user_id=%s ORDER BY created",
    'comments_written': "SELECT to_jsonb(t)" + DROP + " FROM comments t WHERE user_id = %s ORDER BY created",
    'ai_daily_usage': "SELECT to_jsonb(t)" + DROP + " FROM ai_daily_usage t WHERE user_id = %s ORDER BY day,kind",
    'ai_food_attempts': "SELECT to_jsonb(t)" + DROP + " FROM ai_food_attempts t WHERE user_id = %s ORDER BY created",
    'ai_food_requests': "SELECT to_jsonb(t)" + DROP + " FROM ai_requests t WHERE user_id = %s ORDER BY created",   # when you asked for AI food feedback
    # dishes shared with you by friends (cooking mode, 2026-10-11): which dish, from whom
    'dishes_shared_with_me': """SELECT jsonb_build_object('dish_id', s.dish_id, 'dish', d.name, 'from', u.login, 'created', s.created)
                   FROM dish_shares s JOIN dishes d ON d.id = s.dish_id JOIN users u ON u.id = d.user_id WHERE s.user_id = %s""",
}
# Explicit projections: schema additions never silently enter these exports.
NEW_EXPORTS = {
    'beta_requests': ('beta_requests', 'id name email phone watch note created status card_request challenge_join'),
    'recipes': ('recipes', 'id name items known_kcal known_protein_g known_carbs_g known_fat_g ai_note ai_note_at created updated cooked'),
    'coach_proposals': ('coach_proposals', 'id kind payload status created expires'),
    'plan_adjustments': ('plan_adjustments', 'plan_id day workout created'),
    'ai_entitlements': ('ai_entitlements', 'feature enabled expires_at updated_at'),
    'admin_account_days': ('admin_account_days', 'day'),
    'admin_login_events': ('admin_login_events', 'channel outcome created'),
    'api_requests': ('api_requests', 'created method route status duration_ms channel'),
    'groups_created': ('event_groups', 'id title event_date time_zone note goal_type goal_target goal_unit goal_sports goal_start_date training_for joining_closed closed_at created'),
    'group_members': ('group_members', 'group_id status joined_at recap_consent notifications_muted sharing_level monday_recap_enabled'),
    'group_updates': ('group_updates', 'id group_id text created'),
    'group_update_reactions': ('group_update_reactions', 'update_id kind created'),
    'group_weekly_reactions': ('group_weekly_reactions', 'group_id week_start kind created'),
    'group_friend_invites': ('group_friend_invites', 'group_id status created_at expires_at responded_at'),
    'achievement_moment_reactions': ('achievement_moment_reactions', 'owner_id week_start kind created'),
    'notifications': ('notifications', 'id kind activity_id dish_id comment_id created read_at reaction_kind milestone_id challenge_id group_id group_update_id group_week_start group_friend_invite_id'),
    'meal_reminder_attempts': ('meal_reminder_attempts', 'day meal attempted_at delivered'),
    'strava_uploads': ('strava_uploads', 'id size received state audience cursor preview result error_code created updated expires'),
    'strava_import_stage': ('strava_import_stage', 'state upload_id reminder_opt_in reminder_due reminder_attempted reminder_sent updated expires'),
    'segment_scans': ('segment_scans', 'segment_id activity_id matcher outcome reason scanned generation source_revision'),
    'route_reports_made': ('route_reports', 'route_id reason note created status decided outcome'),
    'segment_reports_made': ('segment_reports', 'segment_id reason note created status decided outcome'),
}
_SCOPES = {
    'groups_created': 'organizer_id=%s', 'group_friend_invites': '%s IN (inviter_id,invitee_id)',
    'route_reports_made': 'reporter=%s', 'segment_reports_made': 'reporter=%s',
}
for _name, (_table, _fields) in NEW_EXPORTS.items():
    _scope = _SCOPES.get(_name, 'user_id=%s')
    if _name == 'beta_requests':
        # Bind the requesting identity once; neither an unverified address nor an invite for someone else is ownership.
        TABLES[_name] = "SELECT to_jsonb(t) FROM (SELECT " + ','.join('beta_requests.'+field for field in _fields.split()) + " FROM beta_requests CROSS JOIN (SELECT %s::bigint AS id) me WHERE invite_id IN (SELECT id FROM invites WHERE used_by=me.id) OR lower(email) IN (SELECT lower(email::text) FROM users WHERE id=me.id AND email_verified_at IS NOT NULL) ORDER BY beta_requests.id) t"
    else:
        TABLES[_name] = 'SELECT to_jsonb(t) FROM (SELECT '+_fields.replace(' ', ',')+' FROM '+_table+' WHERE '+_scope+') t'


def _scalars(names):
    return dict.fromkeys(names.split())


_NUTRIENTS = _scalars('kcal protein_g carbs_g fat_g fiber_g sodium_mg sugar_g saturated_fat_g')
_WORKOUT = _scalars('day type dist title detail')
_FOOD = {**_scalars('candidate_id name source source_id amount unit share grams'), **_NUTRIENTS}
_PAYLOAD = {**_scalars('plan_id day meal client_id'),
    'candidate': {**_scalars('candidate_id reason value unit target before after score'),
                  'changes': [_WORKOUT], 'foods': [_FOOD], 'totals': _NUTRIENTS,
                  'goal': _scalars('id sport period metric target')},
    'receipt': _scalars('proposal_id goal_id before after saved_at')}
_NESTED = {
    'recipes': {'items': [{**_scalars('id name grams amount unit source'), **_NUTRIENTS, 'per100': _NUTRIENTS}]},
    'coach_proposals': {'payload': _PAYLOAD}, 'plan_adjustments': {'workout': _WORKOUT},
    'strava_uploads': {'preview': _scalars('added already_here unreadable'), 'result': _scalars('added already_here unreadable')},
}


def _project_json(value, schema):
    """Unknown nested fields/containers are omitted, not recursively dumped."""
    if isinstance(schema, dict):
        return {k:_project_json(value[k],child) for k,child in schema.items() if k in value} if isinstance(value,dict) else None
    if isinstance(schema, list):
        return [_project_json(item,schema[0]) for item in value if isinstance(item,dict)] if isinstance(value,list) else None
    return value if value is None or isinstance(value,(str,int,float,bool)) else None


def export_record(name, value):
    if name not in NEW_EXPORTS:return value
    result={k:value[k] for k in NEW_EXPORTS[name][1].split() if k in value}
    for key,schema in _NESTED.get(name,{}).items():
        if key in result:result[key]=_project_json(result[key],schema)
    return result

CSVS = {
    'activities.csv': """SELECT start_time, sport, name, distance_m, moving_s, elapsed_s, ascent_m, avg_hr, max_hr, calories, effort, device
                         FROM activities WHERE user_id = %s ORDER BY start_time""",
    'food.csv': """SELECT day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g
                   FROM food_entries WHERE user_id = %s ORDER BY day, position""",
    'weight.csv': 'SELECT day, kg, note, source FROM weights WHERE user_id = %s ORDER BY day',
}
README = """Your Kinetta data, downloaded {when}.

data/*.jsonl  your exported account records, one JSON object per line (activity tracks are GeoJSON).
*.csv         your activities, food log and weigh-ins, ready for a spreadsheet. Distances in meters, times in seconds.
files/        the original activity files (FIT, GPX, TCX) you or your watch uploaded.
photos/       your profile photo and the photos on your activities (activity id - photo id.jpg).

Left out on purpose: passwords, login sessions, connection keys, internal worker/moderation records and other people’s private content.
"""


def _write_export(uid, path):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z, db.connect() as c:
        z.writestr('README.txt', README.format(when=time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())))
        u = c.execute('SELECT login::text AS login, name, first_name, last_name, email::text AS email, phone_e164, email_verified_at, created FROM users WHERE id = %s FOR KEY SHARE', (uid,)).fetchone()
        if not u: raise HTTPException(404, 'This account is no longer available')
        z.writestr('data/account.json', json.dumps(u, default=str, indent=1))
        for name, q in TABLES.items():
            with z.open(f'data/{name}.jsonl', 'w') as f, c.cursor(name=f'x_{name}') as cur:   # server-side: streams big tables
                cur.itersize = 500
                cur.execute(q, (uid,))
                for r in cur:
                    f.write((json.dumps(export_record(name,next(iter(r.values()))), default=str, separators=(',', ':')) + '\n').encode())
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
        if os.path.isdir(base) and not os.path.islink(base):
            for root, _, files in os.walk(base):
                for fn in files:
                    full = os.path.join(root, fn)
                    if os.path.islink(full) or not os.path.isfile(full):continue
                    if os.path.commonpath((os.path.realpath(base),os.path.realpath(full))) != os.path.realpath(base):continue
                    z.write(full, 'files/' + os.path.relpath(full, base), compress_type=zipfile.ZIP_STORED)


class ExportResponse(FileResponse):
    def __init__(self, lease, **kwargs):
        super().__init__(lease.path, **kwargs)
        self.cleanup = weakref.finalize(self, lease.close)

    async def __call__(self, scope, receive, send):
        try:
            # Keep opening/sending inside this lifetime, including on ASGI servers
            # offering deferred pathsend (which would outlive our cleanup).
            scope = {**scope, 'extensions': {k:v for k,v in scope.get('extensions', {}).items() if k != 'http.response.pathsend'}}
            await super().__call__(scope, receive, send)
        finally:
            self.cleanup()  # BackgroundTask alone does not run after a failed send.


def _send_export(user):
    now = time.time()
    with _prepared_lock:
        if now - _last_export.get(user['id'], 0) < 300: raise HTTPException(429, 'You just downloaded your data - try again in 5 minutes')
        _last_export[user['id']] = now
    try:
        lease = account_files.ExportFile(user['id'], DATA)
        try:
            _write_export(user['id'], lease.path)
            return ExportResponse(lease, media_type='application/zip', filename=f"kinetta-{user['login']}-{time.strftime('%Y-%m-%d')}.zip",
                                  headers={'Cache-Control': 'no-store'})
        except BaseException:
            lease.close()
            raise
    except BaseException:
        with _prepared_lock:
            if _last_export.get(user['id']) == now:
                _last_export.pop(user['id'], None)
        raise


@router.get('/api/account/export')
def export(user=Depends(current_user)):
    return _send_export(user)


# The iPhone app (2026-10-12): its web view can't save a download, so it asks for a one-time link and opens it in Safari,
# which saves the zip to Files. The link works once, for 5 minutes, and only for the person who asked (kept in memory:
# the server runs as one process).
_links = {}


def forget_exports(uid):
    with _prepared_lock:
        # Fence in-flight builds as well as tokens that are already published.
        _export_revocations[uid] = _export_revocations.get(uid, 0) + 1
        responses = [_prepared_exports.pop(key)[2] for key, item in list(_prepared_exports.items())
                     if item[0] == uid]
        _last_export.pop(uid, None)
        for key, (owner, _, _) in list(_links.items()):
            if owner == uid:
                _links.pop(key, None)
    for response in responses:
        response.cleanup()


@router.post('/api/account/export-link')
def export_link(user=Depends(current_user)):
    return _prepare_export(user, native=True)


@router.get('/api/account/export/{key}')
def export_by_link(key: str):
    expire_prepared_exports()
    with _prepared_lock:
        item = _prepared_exports.get(key)
        if item is not None and item[3]:
            return _prepared_exports.pop(key)[2]
    # Retain existing outstanding-link behavior; new links are already prepared.
    uid, login, until = _links.pop(key, (None, None, 0))
    if not uid or until < time.time(): raise HTTPException(404, 'This download link has expired - ask for a new one in the app')
    return _send_export({'id': uid, 'login': login})


# Prepare via JSON before either browser downloads or the native Safari handoff.
# Only native links are bearer capabilities; browser links still require login.
_prepared_exports = {}


def expire_prepared_exports(uid=None):
    with _prepared_lock:
        stale = [key for key, (owner, until, _, _) in _prepared_exports.items()
                 if owner == uid or until <= time.time()]
        responses = [_prepared_exports.pop(key)[2] for key in stale]
    for response in responses:
        response.cleanup()


@router.post('/api/account/export-ready')
def prepare_export(user=Depends(current_user)):
    return _prepare_export(user)


def _prepare_export(user, native=False):
    prefix = '/api/account/export/' if native else '/api/account/export-ready/'
    expire_prepared_exports()
    with _prepared_lock:
        generation = _export_revocations.get(user['id'], 0)
        for key, (owner, _, _, is_native) in _prepared_exports.items():
            if owner == user['id'] and is_native == native:
                return {'path': prefix + key}
    response = _send_export(user)  # Existing own-data queries, rate limit and file lease.
    key = secrets.token_urlsafe(32)
    with _prepared_lock:
        revoked = generation != _export_revocations.get(user['id'], 0)
        if not revoked:
            _prepared_exports[key] = (user['id'], time.time() + 300, response, native)
    if revoked:
        response.cleanup()
        raise HTTPException(409, 'This download is no longer available. Please try again.')
    return {'path': prefix + key}


@router.get('/api/account/export-ready/{key}')
def download_prepared_export(key: str, user=Depends(current_user)):
    expire_prepared_exports()
    with _prepared_lock:
        item = _prepared_exports.get(key)
        if item is None or item[0] != user['id'] or item[3]:
            raise HTTPException(404, 'This download expired. Please try again.')
        return _prepared_exports.pop(key)[2]


class DeleteIn(BaseModel):
    password: str = Field(max_length=200)


@router.post('/api/account/delete')
def delete_account(body: DeleteIn, request: Request, response: Response, user=Depends(current_user)):
    ip = auth.client_ip(request)
    if auth.too_many(ip, user['login']): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    try:
        with db.connect() as c:
            c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
            me = c.execute('SELECT id, login::text AS login, is_admin, sql_role, pw_hash FROM users WHERE id = %s', (user['id'],)).fetchone()
            if not auth.check_pw(me['pw_hash'], body.password):
                raise auth.Failed(400, 'Password is wrong')
            if me['is_admin'] and not c.execute('SELECT 1 FROM users WHERE is_admin AND id <> %s', (me['id'],)).fetchone() \
                    and c.execute('SELECT 1 FROM users WHERE id <> %s', (me['id'],)).fetchone():
                raise HTTPException(400, "You’re the only admin, and other people use this Kinetta, so you can’t delete this account yet. Make someone else an admin first.")
            garmin = garmin_connect._settings(c, me['id'])
            erase(c, me)
    except auth.Failed as e:
        auth.failed(ip, user['login']); raise HTTPException(e.status, e.message)
    erase_files(me['id'])
    if garmin: garmin_connect.deregister(garmin)     # after the account is gone; Garmin stops sending its data
    response.delete_cookie(auth.COOKIE, path='/')
    return {'ok': True}
