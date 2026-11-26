"""Photo privacy at API ingress; estimators receive only freshly encoded pixels."""
import base64
import io
import threading

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image, ImageOps

from . import account_email, ai_access, ai_budget, coach, db, food_photo
from .auth import current_user

router = APIRouter(prefix='/api/food')
MAX_PIXELS = 16_000_000
MAX_SIDE = 2048
REQUESTS_PER_MINUTE = 12
_decode_slots = threading.BoundedSemaphore(2)


def _encode(raw, budget):
    with Image.open(io.BytesIO(raw), formats=['JPEG']) as original:
        if original.width * original.height > MAX_PIXELS:
            raise ValueError('Unsupported image')
        original.draft('RGB', (MAX_SIDE, MAX_SIDE))
        original.load()
        pixels = ImageOps.exif_transpose(original).convert('RGB')
    pixels.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    pixels.info.clear()  # EXIF/GPS, XMP, ICC and comments never reach the new JPEG.
    while True:  # At most 12 sizes from 2048 down to 1 pixel; never reject on the first encoding.
        for quality in (90, 75, 60):
            output = io.BytesIO()
            pixels.save(output, 'JPEG', quality=quality)
            if output.tell() <= budget:
                return base64.b64encode(output.getvalue()).decode()
        if pixels.size == (1, 1):
            raise ValueError('Image cannot fit')
        pixels = pixels.resize(tuple(max(1, side // 2) for side in pixels.size), Image.Resampling.LANCZOS)


def clean(body, user):
    if not (body.image or body.images):
        return body
    # Reject access/consent failures before spending work decoding private images.
    ai_budget.require_enabled()
    ai_access.require(user['id'], 'food')
    if coach.enabled() and not coach.allowed(user['id'], 'food'):
        raise HTTPException(403, coach.off())
    with db.connect() as c:
        limited = account_email.limited(c, f'food-photo-decode:{user["id"]}', REQUESTS_PER_MINUTE, 1)
    if limited:
        raise HTTPException(429, 'Too many food photos. Wait a minute and try again.', headers={'Retry-After': '60'})
    if not _decode_slots.acquire(blocking=False):
        raise HTTPException(503, 'Photo processing is busy. Try again shortly.', headers={'Retry-After': '2'})
    try:
        raw_images = food_photo.image_batch(body.image, body.images)
        budget = min(4_000_000, 8_000_000 // len(raw_images))
        try:
            images = [_encode(raw, budget) for raw in raw_images]
        except (OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(400, "A photo couldn't be read or is too large") from None
    finally:
        _decode_slots.release()
    # Retain the existing per-image/batch byte limits after re-encoding too.
    food_photo.image_batch(None, images)
    return body.model_copy(update={'image': None, 'images': images})


@router.post('/photo')
def photo(body: food_photo.PhotoIn, user=Depends(current_user)):
    return food_photo.photo(clean(body, user), user)


@router.post('/label')
def label(body: food_photo.LabelIn, user=Depends(current_user)):
    return food_photo.label(clean(body, user), user)
