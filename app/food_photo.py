"""Food from a photo (and/or a description) - 2026-10-09.

The phone shrinks the photo (max 1280 px JPEG) and sends it with an optional description ("2 eggs fried in butter,
sourdough toast"). Gemini Flash-Lite lists the foods with portions, calories and macros; nothing is saved here - the
phone shows the list for checking, exactly like Paste. The photo is never stored.

Cost (measured 2026-10-09 on a breakfast photo): ~$0.001 per photo with gemini-3.1-flash-lite, ~2 s.
Model: GEMINI_FOOD_MODEL setting (default gemini-3.1-flash-lite). Brake: 40 estimates per person per day.
"""
import base64
import binascii
import datetime as dt
import json
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import current_user

router = APIRouter(prefix='/api/food')
DAILY_LIMIT = 40
_used = {}          # (user_id, date) -> count; resets with the app, good enough for a cost brake

PROMPT = """You estimate food for a calorie and macro tracker. {what}
List each separate food or drink as its own item with a realistic portion. Count cooking fats, sauces, dressings and
drinks you can see or that the description mentions (as their own items when sizeable). If you assume food was
cooked in oil or butter, list that fat as its own item (e.g. "Butter, for frying" "1 tsp") so its calories count. Ignore food that is clearly on
someone else's plate or in the background. Use typical US restaurant/home portions when unsure.
For each item give: name (short, plain, e.g. "Fried eggs"), amount (household measure, e.g. "2 large", "1 cup",
"1 slice"), grams, kcal, protein_g, carbs_g, fat_g, fiber_g.
In "notes" say in one short sentence what you assumed (e.g. "Assumed eggs fried in 1 tsp butter"). Numbers only, no ranges."""

SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'items': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'name': {'type': 'STRING'}, 'amount': {'type': 'STRING'}, 'grams': {'type': 'NUMBER'}, 'kcal': {'type': 'NUMBER'},
            'protein_g': {'type': 'NUMBER'}, 'carbs_g': {'type': 'NUMBER'}, 'fat_g': {'type': 'NUMBER'}, 'fiber_g': {'type': 'NUMBER'}},
            'required': ['name', 'amount', 'kcal', 'protein_g', 'carbs_g', 'fat_g']}},
        'notes': {'type': 'STRING'}},
    'required': ['items'],
}


class PhotoIn(BaseModel):
    image: str | None = Field(None, max_length=6_000_000)    # base64 JPEG (data: URL prefix allowed)
    note: str | None = Field(None, max_length=600)


def _num(v, hi):
    try: v = float(v)
    except (TypeError, ValueError): return 0.0
    return round(min(max(v, 0.0), hi), 1)


@router.post('/photo')
def photo(body: PhotoIn, user=Depends(current_user)):
    key = os.environ.get('GEMINI_API_KEY')
    if not key: raise HTTPException(503, 'Photo logging needs a Gemini key on the server')
    note = (body.note or '').strip()
    img = None
    if body.image:
        try: img = base64.b64decode(body.image.split(',', 1)[-1], validate=True)
        except (binascii.Error, ValueError): raise HTTPException(400, "That photo couldn't be read")
        if not img.startswith(b'\xff\xd8') or len(img) > 4_000_000: raise HTTPException(400, 'Send a JPEG photo under 4 MB')
    if not img and not note: raise HTTPException(400, 'Add a photo or a description')
    k = (user['id'], dt.date.today())
    if _used.get(k, 0) >= DAILY_LIMIT: raise HTTPException(429, f'That is {DAILY_LIMIT} estimates today - try again tomorrow')
    _used[k] = _used.get(k, 0) + 1
    for old in [x for x in _used if x[1] < dt.date.today()]: _used.pop(old, None)

    what = ('Look at the photo.' if img else 'There is no photo; use the description.') + \
           (f' The person describes the meal as: """{note}""". Trust their description for what the foods are, how they were '
            f'cooked and how much; use the photo for anything they did not mention.' if note else '')
    parts = [{'text': PROMPT.format(what=what)}]
    if img: parts.append({'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(img).decode()}})
    model = os.environ.get('GEMINI_FOOD_MODEL', 'gemini-3.1-flash-lite')
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        json.dumps({'contents': [{'parts': parts}],
                    'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': SCHEMA, 'temperature': 0.2}}).encode(),
        {'Content-Type': 'application/json', 'x-goog-api-key': key})
    try:
        with urllib.request.urlopen(req, timeout=45) as r: data = json.load(r)
        out = json.loads(data['candidates'][0]['content']['parts'][-1]['text'])
    except urllib.error.HTTPError as e:
        print('food photo: gemini HTTP', e.code, e.read()[:300], flush=True)
        raise HTTPException(502, 'The food estimator is busy - try again in a minute')
    except Exception as e:
        print('food photo: failed', repr(e)[:300], flush=True)
        raise HTTPException(502, "Couldn't get an estimate - try again")
    items = []
    for it in (out.get('items') or [])[:30]:
        name = ' '.join(str(it.get('name') or 'Food').split())[:80]
        amount = ' '.join(str(it.get('amount') or '').split())[:40]
        items.append({'name': name, 'amount': amount, 'grams': _num(it.get('grams'), 5000), 'kcal': _num(it.get('kcal'), 5000),
                      'protein_g': _num(it.get('protein_g'), 500), 'carbs_g': _num(it.get('carbs_g'), 1000),
                      'fat_g': _num(it.get('fat_g'), 500), 'fiber_g': _num(it.get('fiber_g'), 200) if it.get('fiber_g') is not None else None})
    u = data.get('usageMetadata', {})
    print(f"food photo: user {user['id']} model {model} items {len(items)} tokens in {u.get('promptTokenCount')} "
          f"out {u.get('candidatesTokenCount')} think {u.get('thoughtsTokenCount', 0)}", flush=True)
    return {'items': items, 'notes': ' '.join(str(out.get('notes') or '').split())[:300], 'model': model}
