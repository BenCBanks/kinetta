"""Photo privacy at API ingress; estimators receive only freshly encoded pixels."""
import base64
import io

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image, ImageOps

from . import ai_access, ai_budget, coach, food_photo
from .auth import current_user

router = APIRouter(prefix='/api/food')
MAX_PIXELS = 50_000_000


def clean(body, user):
    if not (body.image or body.images):
        return body
    # Reject access/consent failures before spending work decoding private images.
    ai_budget.require_enabled()
    ai_access.require(user['id'], 'food')
    if coach.enabled() and not coach.allowed(user['id'], 'food'):
        raise HTTPException(403, coach.off())
    images = []
    for raw in food_photo.image_batch(body.image, body.images):
        try:
            with Image.open(io.BytesIO(raw)) as original:
                if original.format != 'JPEG' or original.width * original.height > MAX_PIXELS:
                    raise ValueError('Unsupported image')
                original.load()  # A JPEG header alone is not a usable photo.
                pixels = ImageOps.exif_transpose(original).convert('RGB')
                pixels.info.clear()  # Includes EXIF/GPS, XMP, ICC and JPEG comments.
                output = io.BytesIO()
                pixels.save(output, 'JPEG', quality=90)
            images.append(base64.b64encode(output.getvalue()).decode())
        except (OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(400, "A photo couldn't be read or is too large") from None
    # Retain the existing per-image/batch byte limits after re-encoding too.
    food_photo.image_batch(None, images)
    return body.model_copy(update={'image': None, 'images': images})


@router.post('/photo')
def photo(body: food_photo.PhotoIn, user=Depends(current_user)):
    return food_photo.photo(clean(body, user), user)


@router.post('/label')
def label(body: food_photo.LabelIn, user=Depends(current_user)):
    return food_photo.label(clean(body, user), user)
