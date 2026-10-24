"""Only an open report unlocks its submitted target for review; no general private-content browsing."""
import hashlib
import hmac
import json
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field
from typing import Literal
from . import db
from .admin_auth import admin_user, audit
from .admin_actions import ActionIn, replay, complete

router = APIRouter(prefix='/api/admin')
LABELS = {'dismiss': 'Dismiss report', 'remove_comment': 'Remove this comment', 'hide_activity': 'Hide this activity',
          'remove_activity_photo': 'Remove an attached photo', 'remove_photo': 'Remove profile photo', 'clear_bio': 'Clear profile bio', 'clear_profile': 'Remove profile photo and bio'}


def material(c, rid, lock=False):
    if lock:
        seed = c.execute('SELECT person,kind,comment_id,activity_id FROM reports WHERE id=%s', (rid,)).fetchone()
        if seed:
            # Lock the target before its report: deleting a comment updates the report's FK in this order too.
            c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (seed['person'],))
            if seed['comment_id']: c.execute('SELECT id FROM comments WHERE id=%s FOR UPDATE', (seed['comment_id'],))
            if seed['kind'] == 'activity' and seed['activity_id']: c.execute('SELECT id FROM activities WHERE id=%s FOR UPDATE', (seed['activity_id'],))
            if seed['kind'] == 'person': c.execute('SELECT user_id FROM profile WHERE user_id=%s FOR UPDATE', (seed['person'],))
    r = c.execute('''SELECT r.*,u.login::text AS login,u.name,u.photo_v,p.bio,rp.name AS reporter_name FROM reports r
         JOIN users u ON u.id=r.person LEFT JOIN profile p ON p.user_id=u.id LEFT JOIN users rp ON rp.id=r.reporter
         WHERE r.id=%s''' + (' FOR UPDATE OF r,u' if lock else ''), (rid,)).fetchone()
    if not r: raise HTTPException(404, 'Report not found.')
    if r['status'] != 'open': raise HTTPException(409, 'This report was already handled. Refresh the queue.')
    item = None; allowed = ['dismiss']; photos = []
    if r['kind'] == 'comment' and r['comment_id']:
        item = c.execute('SELECT text,created FROM comments WHERE id=%s AND user_id=%s' + (' FOR UPDATE' if lock else ''), (r['comment_id'], r['person'])).fetchone()
        if item: allowed += ['remove_comment']
    elif r['kind'] == 'activity' and r['activity_id']:
        item = c.execute('SELECT name,sport,start_time,visibility FROM activities WHERE id=%s AND user_id=%s' + (' FOR UPDATE' if lock else ''), (r['activity_id'], r['person'])).fetchone()
        if item:
            allowed += ['hide_activity']
            photos = c.execute('SELECT id,w,h,created FROM activity_photos WHERE activity_id=%s AND user_id=%s ORDER BY id', (r['activity_id'],r['person'])).fetchall()
            if photos: allowed += ['remove_activity_photo']
    elif r['kind'] == 'person':
        if lock: c.execute('SELECT user_id FROM profile WHERE user_id=%s FOR UPDATE', (r['person'],))
        item = {'bio': r['bio'] or '', 'has_photo': bool(r['photo_v']), 'photo_version': r['photo_v'],
                'scope': 'Current profile. This older report did not store an image or bio snapshot.'}
        if item['has_photo']: allowed += ['remove_photo']
        if item['bio']: allowed += ['clear_bio']
        if item['has_photo'] and item['bio']: allowed += ['clear_profile']
    value = {'report': {'id': r['id'], 'kind': r['kind'], 'reason': r['reason'], 'note': r['note'], 'created': r['created'],
                        'reporter': r['reporter_name'] or 'Deleted account'},
             'person': {'id': r['person'], 'login': r['login'], 'name': r['name']}, 'item': item, 'photos': photos,
             'actions': [{'value': a, 'label': LABELS[a]} for a in allowed]}
    digest = hmac.new(db.secret('KINETTA_ADMIN_KEY').encode(), json.dumps(value, sort_keys=True, default=str).encode(), hashlib.sha256).hexdigest()
    return r, value, digest


@router.get('/review/{rid}')
def review(rid: int, user=Depends(admin_user)):
    with db.connect() as c:
        r, result, version = material(c, rid)
        result['version'] = version
        for p in result['photos']: p['url'] = f"/api/admin/review/{rid}/photos/{p['id']}?version={version}"
        if r['kind'] == 'person' and result['item']['has_photo']:
            result['photo_url'] = f'/api/admin/review/{rid}/photo?version={version}'
        result['history'] = c.execute('SELECT id,what,reason,status,created FROM reports WHERE person=%s ORDER BY created DESC LIMIT 20', (r['person'],)).fetchall()
        audit(c, user['id'], 'report.review', rid)
    return result


@router.get('/review/{rid}/photo')
def photo(rid: int, version: str, user=Depends(admin_user)):
    with db.connect() as c:
        r, value, digest = material(c, rid, True)
        if r['kind'] != 'person' or not value['item']['has_photo'] or not hmac.compare_digest(version, digest):
            raise HTTPException(404, 'This reported photo changed or is unavailable. Review the report again.')
        row = c.execute('SELECT img FROM profile_photos WHERE user_id=%s', (r['person'],)).fetchone()
        if not row: raise HTTPException(404, 'Photo unavailable.')
        audit(c, user['id'], 'report.photo_review', rid)
    return Response(bytes(row['img']), media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


@router.get('/review/{rid}/photos/{pid}')
def activity_photo(rid: int, pid: int, version: str, user=Depends(admin_user)):
    with db.connect() as c:
        r, value, digest = material(c, rid, True)
        if r['kind'] != 'activity' or pid not in {p['id'] for p in value['photos']} or not hmac.compare_digest(version, digest):
            raise HTTPException(404, 'This reported photo changed or is unavailable. Review the report again.')
        row = c.execute('SELECT img FROM activity_photos WHERE id=%s AND activity_id=%s AND user_id=%s', (pid,r['activity_id'],r['person'])).fetchone()
        if not row: raise HTTPException(404, 'Photo unavailable.')
        audit(c,user['id'],'report.photo_review',rid)
    return Response(bytes(row['img']),media_type='image/jpeg',headers={'Cache-Control':'no-store'})


class DecisionIn(ActionIn):
    action: Literal['dismiss', 'remove_comment', 'hide_activity', 'remove_photo', 'clear_bio', 'clear_profile', 'remove_activity_photo']
    version: str = Field(min_length=64, max_length=64)
    confirm: str = Field(max_length=30)
    photo_id: int | None = Field(None, gt=0)


@router.post('/review/{rid}')
def decide(rid: int, body: DecisionIn, user=Depends(admin_user)):
    action = 'report.' + body.action
    with db.connect() as c:
        digest, old = replay(c, user, body, action, rid)
        if old: return old
        r, value, version = material(c, rid, True)
        if body.confirm != r['login']: raise HTTPException(400, 'Type the account username exactly.')
        if not hmac.compare_digest(body.version, version): raise HTTPException(409, 'The reported item changed. Review it again before acting.')
        if body.action not in {a['value'] for a in value['actions']}: raise HTTPException(409, 'That action is not available for this reported item.')
        if body.action == 'remove_activity_photo':
            if body.photo_id not in {p['id'] for p in value['photos']}: raise HTTPException(409, 'That photo is not part of this reported activity.')
            c.execute('DELETE FROM activity_photos WHERE id=%s AND activity_id=%s AND user_id=%s',(body.photo_id,r['activity_id'],r['person']))
        if body.action == 'remove_comment': c.execute('DELETE FROM comments WHERE id=%s AND user_id=%s', (r['comment_id'], r['person']))
        if body.action == 'hide_activity': c.execute("UPDATE activities SET visibility='me' WHERE id=%s AND user_id=%s", (r['activity_id'], r['person']))
        if body.action in ('remove_photo', 'clear_profile'):
            c.execute('DELETE FROM profile_photos WHERE user_id=%s', (r['person'],)); c.execute('UPDATE users SET photo_v=NULL WHERE id=%s', (r['person'],))
        if body.action in ('clear_bio', 'clear_profile'): c.execute("UPDATE profile SET bio='' WHERE user_id=%s", (r['person'],))
        c.execute("UPDATE reports SET status='done' WHERE id=%s", (rid,))
        return complete(c, user, body, action, rid, digest)
