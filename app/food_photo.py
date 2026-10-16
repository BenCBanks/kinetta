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

from . import coach, ai_access
from .auth import current_user

router = APIRouter(prefix='/api/food')
DAILY_LIMIT = 40
_used = {}          # (user_id, kind, date) -> count; resets with the app, good enough for a cost brake

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
    images: list[str] = Field(default_factory=list, max_length=6)
    note: str | None = Field(None, max_length=2000)        # the person's words; several lines = a short chat (Describe or snap)


def image_batch(image, images):
    if image and images: raise HTTPException(400, 'Use image or images, not both')
    values = images or ([image] if image else [])
    if len(values)>6: raise HTTPException(400, 'Choose up to 6 photos')
    result=[]
    for value in values:
        if len(value)>6_000_000: raise HTTPException(400, 'Send JPEG photos under 4 MB each')
        try: img=base64.b64decode(value.split(',',1)[-1],validate=True)
        except (binascii.Error,ValueError): raise HTTPException(400, "A photo couldn't be read")
        if not img.startswith(b'\xff\xd8') or len(img)>4_000_000: raise HTTPException(400, 'Send JPEG photos under 4 MB each')
        if img not in result: result.append(img)
    if sum(map(len,result))>8_000_000: raise HTTPException(400, 'Choose photos totaling under 8 MB after compression')
    return result


def _num(v, hi):
    try: v = float(v)
    except (TypeError, ValueError): return 0.0
    return round(min(max(v, 0.0), hi), 1)


# Flash-Lite can run away on a NUMBER field ("0.9456666...e000000..." until it hits the output limit, ~60 s, broken JSON).
# Asking for short numbers stops it; the output cap makes any runaway fail fast instead of hanging the request.
ROUNDING = '\nNumbers: round grams and kcal to whole numbers and the macros to one decimal (e.g. 0.9), never longer.'
MAX_OUTPUT_TOKENS = 2048


def _ordered(schema):
    """The schema with propertyOrdering = the order its fields are written in (name and grams before the macros)."""
    if not isinstance(schema, dict): return schema
    out = {k: (_ordered(v) if k == 'items' else {f: _ordered(x) for f, x in v.items()} if k == 'properties' else v)
           for k, v in schema.items()}
    if 'properties' in out: out['propertyOrdering'] = list(out['properties'])
    return out


def ask(parts, schema, label, timeout=45):
    """One Gemini call that answers in JSON (schema). Returns (answer, raw response, model); 502 if it fails.
    Google sometimes answers 429/5xx ("high demand") or is slow: then it tries once more, and then a second model
    (GEMINI_FOOD_FALLBACK_MODEL), before giving up (2026-10-12: an ingredient typed in a dish failed on a busy model)."""
    import time
    parts = [*parts, {'text': ROUNDING}]
    main = os.environ.get('GEMINI_FOOD_MODEL', 'gemini-3.1-flash-lite')
    body = json.dumps({'contents': [{'parts': parts}],
                       'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': _ordered(schema), 'temperature': 0.2,
                                            'maxOutputTokens': MAX_OUTPUT_TOKENS}}).encode()
    tries = [main, main, os.environ.get('GEMINI_FOOD_FALLBACK_MODEL', 'gemini-3.8-flash')]
    for n, model in enumerate(tries):
        last = n == len(tries) - 1
        req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', body,
                                     {'Content-Type': 'application/json', 'x-goog-api-key': os.environ.get('GEMINI_API_KEY', '')})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r: data = json.load(r)
            return json.loads(data['candidates'][0]['content']['parts'][-1]['text']), data, model
        except urllib.error.HTTPError as e:
            print(f'{label}: gemini {model} HTTP', e.code, e.read()[:300], flush=True)
            if last or (e.code != 429 and e.code < 500): raise HTTPException(502, 'The food estimator is busy - try again in a minute')
        except (urllib.error.URLError, TimeoutError) as e:
            print(f'{label}: gemini {model} failed', repr(e)[:300], flush=True)
            if last: raise HTTPException(502, "Couldn't reach the food estimator - try again in a minute")
        except Exception as e:      # an answer that isn't the JSON asked for
            print(f'{label}: failed', repr(e)[:300], flush=True)
            raise HTTPException(502, "Couldn't get an estimate - try again")
        time.sleep(2)


def brake(user_id, limit=DAILY_LIMIT, kind='photo', what='estimates'):
    """A per-person daily cost brake, kept in memory (resets with the app: good enough)."""
    k = (user_id, kind, dt.date.today())
    if _used.get(k, 0) >= limit: raise HTTPException(429, f'That is {limit} {what} today - try again tomorrow')
    _used[k] = _used.get(k, 0) + 1
    for old in [x for x in _used if x[2] < dt.date.today()]: _used.pop(old, None)


@router.post('/photo')
def photo(body: PhotoIn, user=Depends(current_user)):
    ai_access.require(user['id'], 'food')
    if coach.enabled() and not coach.allowed(user['id'], 'food'): raise HTTPException(403, coach.OFF)
    key = os.environ.get('GEMINI_API_KEY')
    if not key: raise HTTPException(503, 'Photo logging needs a Gemini key on the server')
    note = (body.note or '').strip()
    imgs = image_batch(body.image, body.images)
    if not imgs and not note: raise HTTPException(400, 'Add photos or a description')
    brake(user['id'])

    what = ('Look at all the photos together. Different views of the same food are one portion, not additional servings. Include distinct foods once each.' if imgs else 'There is no photo; use the description.') + \
           (f' The person describes the meal as: """{note}""". Trust their description for what the foods are, how they were '
            f'cooked and how much; use the photo for anything they did not mention.' if note else '') + \
           (' The description is several messages in order: later ones correct or add to earlier ones (e.g. "make it two" '
            'means two of the item just discussed), so list the meal as it stands after the last message.' if '\n' in note else '')
    parts = [{'text': PROMPT.format(what=what)}]
    parts.extend({'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(img).decode()}} for img in imgs)
    out, data, model = ask(parts, SCHEMA, 'food photo')
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


# ---------- a photo of a nutrition label (2026-10-12): read it, and the app asks how much went in ----------
LABEL_PROMPT = """This is a photo of a food package's nutrition facts label (maybe with the front of the package). Read it
exactly as printed; don't estimate anything that isn't on it. Give:
name: the product, short (e.g. "Protein penne pasta"), from the package if it shows, else from the ingredients; brand if it shows.
serving_label: the serving size as printed (e.g. "2 oz (56g)", "1 cup (240mL)"); serving_g: that serving in grams (or mL
for drinks); servings_per_package: as printed (number, use the "about" number); package_g: the net weight in grams if it shows.
per_serving: kcal, protein_g, carbs_g (total carbohydrate), fat_g (total fat), fiber_g (dietary fiber) for ONE serving,
from the "per serving" column (not "per container" or "as prepared").
readable: false if this isn't a nutrition label or it can't be read; then note says why in one short sentence."""

LABEL_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'readable': {'type': 'BOOLEAN'}, 'note': {'type': 'STRING'}, 'name': {'type': 'STRING'}, 'brand': {'type': 'STRING'},
        'serving_label': {'type': 'STRING'}, 'serving_g': {'type': 'NUMBER'}, 'servings_per_package': {'type': 'NUMBER'},
        'package_g': {'type': 'NUMBER'},
        'per_serving': {'type': 'OBJECT', 'properties': {k: {'type': 'NUMBER'} for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')}}},
    'required': ['readable'],
}


class LabelIn(BaseModel):
    image: str | None = Field(None, max_length=6_000_000)
    images: list[str] = Field(default_factory=list, max_length=6)      # base64 JPEG (data: URL prefix allowed)


@router.post('/label')
def label(body: LabelIn, user=Depends(current_user)):
    """Read a nutrition label: {name, brand, serving: {label, g}, servings, package_g, per_serving, per100}. Nothing is saved."""
    ai_access.require(user['id'], 'food')
    if coach.enabled() and not coach.allowed(user['id'], 'food'): raise HTTPException(403, coach.OFF)
    if not os.environ.get('GEMINI_API_KEY'): raise HTTPException(503, 'Reading labels needs a Gemini key on the server')
    imgs = image_batch(body.image, body.images)
    if not imgs: raise HTTPException(400, 'Add photos of one ingredient or package')
    brake(user['id'])
    prompt = LABEL_PROMPT + '\nThese photos show one ingredient/package from several angles. Combine the front and nutrition panel; never multiply servings by the number of photos. If they show different products, set readable=false and ask for one product at a time.'
    out, _, model = ask([{'text': prompt}] + [{'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(img).decode()}} for img in imgs],
                        LABEL_SCHEMA, 'food label')
    print(f"food label: user {user['id']} model {model} readable {out.get('readable')}", flush=True)
    if not out.get('readable'):
        raise HTTPException(422, ' '.join(str(out.get('note') or '').split())[:200] or "That doesn't look like a nutrition label - try a closer, sharper photo.")
    sg = _num(out.get('serving_g'), 2000)
    ps = out.get('per_serving') or {}
    per = {k: _num(ps.get(k), 5000) for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')}
    if not sg or ps.get('kcal') is None: raise HTTPException(422, "Couldn't read the serving size in grams or the calories - try a closer photo of the label.")
    from .api_food import _sane
    per100 = _sane({k: (v * 100 / sg if v is not None else None) for k, v in per.items()})
    if not per100: raise HTTPException(422, "The numbers on the label didn't add up - try a sharper photo, or type it in.")
    n = _num(out.get('servings_per_package'), 1000)
    pkg = _num(out.get('package_g'), 20000) or (round(n * sg) if n else None)
    s = lambda v, k: ' '.join(str(v or '').split())[:k] or None
    return {'name': s(out.get('name'), 80) or 'Food from a label', 'brand': s(out.get('brand'), 60),
            'serving': {'label': s(out.get('serving_label'), 40) or f'{sg:g} g', 'g': sg}, 'servings': n, 'package_g': pkg,
            'per_serving': per, 'per100': per100}
