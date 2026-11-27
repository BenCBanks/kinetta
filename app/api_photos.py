"""Photos (2026-10-12): a profile photo for each person, and photos on activities.

Keeping people safe:
 - Every photo is opened and saved again here as a brand-new JPEG (Pillow). Nothing from the original file is kept: no
   location, time or phone details (EXIF), no hidden extras. It is turned the right way up first.
 - A profile photo is seen by anyone signed in to this Kinetta who can see the person's name, except people either of
   them blocked. Activity photos follow the activity: whoever may see the activity (api_social.can_see) sees its photos,
   everyone else gets 404. Only the owner adds or removes them.
 - Photos are stored in the database (bytea), so the nightly backup, the data download and deleting an account all
   cover them with nothing extra to keep track of.
"""
import base64
import binascii
import io
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from . import account_email, db, email_confirmation, image_work
from .api_social import blocked, can_see, unconfirmed
from .auth import current_user

router = APIRouter(prefix='/api')
Image.MAX_IMAGE_PIXELS = 50_000_000        # bigger than any phone photo; stops "decompression bomb" files
WEBP_PIXELS = 16_000_000                    # WebP needs several native canvas buffers, even for thumbnails
PROFILE_PX = 512                           # profile photos: a square this size
FULL_PX, THUMB_PX = 1600, 480              # activity photos: longest side
PER_ACTIVITY, PER_PERSON = 10, 2000
UPLOADS_PER_MINUTE = 30
# Access can change without the photo URL changing (blocking, unsharing or removal).
CACHE = {'Cache-Control': 'private, no-cache'}


class PhotoIn(BaseModel):
    image: str = Field(min_length=10, max_length=12_000_000)   # base64 (a data: URL prefix is fine)


def _open(body, px, square=False):
    try:
        raw = base64.b64decode(body.image.split(',', 1)[-1], validate=True)
        with Image.open(io.BytesIO(raw), formats=['JPEG', 'PNG', 'WEBP']) as original:
            limit = min(Image.MAX_IMAGE_PIXELS, WEBP_PIXELS) if original.format == 'WEBP' else Image.MAX_IMAGE_PIXELS
            if original.width * original.height > limit:
                raise ValueError('Photo exceeds the pixel limit')
            # Decode JPEGs at reduced resolution; shrink other formats before
            # EXIF/RGB copies. A centre square crop commutes with EXIF rotation.
            original.draft('RGB', (px, px))
            pixels = original
            try:
                if square:
                    pixels = ImageOps.fit(original, (px, px), Image.LANCZOS)
                else:
                    original.thumbnail((px, px), Image.LANCZOS)
                with ImageOps.exif_transpose(pixels) as upright:
                    return upright.convert('RGB')
            finally:
                if pixels is not original: pixels.close()
    except (binascii.Error, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "That photo couldn't be opened. Try a JPEG or PNG.")


def upload_attempt(user_id):
    """Commit every attempt before decoding, including malformed/rejected image bodies."""
    email_confirmation.require_upload(user_id)
    with db.connect() as c:
        limited = account_email.limited(c, f'photo-upload:{user_id}', UPLOADS_PER_MINUTE, 1)
    if limited:
        raise HTTPException(429, 'Too many photo uploads. Wait a minute and try again.', headers={'Retry-After': '60'})


def _jpeg(im, quality=82):
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=quality, optimize=True)   # no exif= : the new file carries no metadata
    return out.getvalue()


def _scaled(im, px):
    im = im.copy(); im.thumbnail((px, px), Image.LANCZOS)
    return im


def _jpeg_response(data):
    return Response(bytes(data), media_type='image/jpeg', headers=CACHE)


def _profile_jpeg(body):
    with _open(body, PROFILE_PX, square=True) as pixels:
        return _jpeg(pixels)


# ---------- profile photo ----------
@router.put('/me/photo')
def set_profile_photo(body: PhotoIn, user=Depends(current_user)):
    upload_attempt(user['id'])
    img = image_work.run(_profile_jpeg, body)
    v = secrets.token_urlsafe(6)
    with db.connect() as c:
        c.execute("""INSERT INTO profile_photos (user_id, img) VALUES (%s, %s)
                     ON CONFLICT (user_id) DO UPDATE SET img = EXCLUDED.img, created = now()""", (user['id'], img))
        c.execute('UPDATE users SET photo_v = %s WHERE id = %s', (v, user['id']))
    return {'photo': v}


@router.delete('/me/photo')
def remove_profile_photo(user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM profile_photos WHERE user_id = %s', (user['id'],))
        c.execute('UPDATE users SET photo_v = NULL WHERE id = %s', (user['id'],))
    return {'photo': None}


@router.get('/people/{login}/photo')
def profile_photo(login: str, user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute(f"""SELECT pp.img FROM users u JOIN profile_photos pp ON pp.user_id = u.id
                          WHERE u.login = %(login)s AND NOT {blocked('u.id')}
                          AND (u.id = %(viewer)s OR NOT {unconfirmed('u.id')})""", {'login': login.lower(), 'viewer': user['id']}).fetchone()
    if not r: raise HTTPException(404, 'Not found')
    return _jpeg_response(r['img'])


# ---------- activity photos ----------
def prepare_activity_photo(body: PhotoIn):
    """Decode/orient/re-encode before opening a database transaction. No original metadata is retained."""
    return image_work.run(_activity_jpegs, body)


def _activity_jpegs(body):
    with _open(body, FULL_PX) as im:
        with _scaled(im, FULL_PX) as full, _scaled(im, THUMB_PX) as thumb:
            return (_jpeg(full), _jpeg(thumb, 78), *full.size)


def insert_activity_photo(c, aid, user_id, prepared):
    """The caller holds the per-person photo lock and owns the encompassing transaction."""
    email_confirmation.require_upload(user_id, c)
    if not c.execute('SELECT 1 FROM activities WHERE id = %s AND user_id = %s FOR UPDATE', (aid, user_id)).fetchone():
        raise HTTPException(404, 'Not found')
    if c.execute('SELECT count(*) AS n FROM activity_photos WHERE activity_id = %s', (aid,)).fetchone()['n'] >= PER_ACTIVITY:
        raise HTTPException(400, f'An activity can have up to {PER_ACTIVITY} photos')
    if c.execute('SELECT count(*) AS n FROM activity_photos WHERE user_id = %s', (user_id,)).fetchone()['n'] >= PER_PERSON:
        raise HTTPException(400, f'You have {PER_PERSON} activity photos, the most Kinetta keeps. Remove some first.')
    return c.execute("""INSERT INTO activity_photos (activity_id, user_id, img, thumb, w, h) VALUES (%s, %s, %s, %s, %s, %s)
                     RETURNING id, w, h""", (aid, user_id, *prepared)).fetchone()


def lock_activity_photos(c, user_id):
    # Erasure locks the account before its activities; match that order before any photo/activity lock.
    if not c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE', (user_id,)).fetchone():
        raise HTTPException(404, 'Account unavailable')
    # Serialize the person-wide limit as well as each activity's limit, including concurrent review/photo saves.
    c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (f'activity-photos:{user_id}',))


@router.post('/activities/{aid}/photos')
def add_activity_photo(aid: int, body: PhotoIn, user=Depends(current_user)):
    upload_attempt(user['id'])
    prepared = prepare_activity_photo(body)
    with db.connect() as c:
        lock_activity_photos(c, user['id'])
        r = insert_activity_photo(c, aid, user['id'], prepared)
    return r


@router.get('/activity-photos/{pid}')
def activity_photo(pid: int, size: str = 'full', user=Depends(current_user)):
    col = 'thumb' if size == 'thumb' else 'img'
    with db.connect() as c:
        r = c.execute('SELECT activity_id FROM activity_photos WHERE id = %s', (pid,)).fetchone()
        if not r: raise HTTPException(404, 'Not found')
        can_see(c, user['id'], r['activity_id'])       # 404 for anyone who may not see the activity
        data = c.execute(f'SELECT {col} AS b FROM activity_photos WHERE id = %s', (pid,)).fetchone()['b']
    return _jpeg_response(data)


@router.delete('/activity-photos/{pid}')
def remove_activity_photo(pid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM activity_photos WHERE id = %s AND user_id = %s RETURNING id', (pid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}

