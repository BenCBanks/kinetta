"""Dishes (2026-10-11; reworked 2026-10-12): build a dish from its ingredients, keep it, log a portion whenever you eat it.

A dish is a list of ingredients (each with its own per-100 g values, so its amount can change) or a total typed in from
a recipe (known_*, which wins over the ingredients' sum). Its weight is the ingredients added up, unless the cook typed
the cooked weight (cooked_g). serving says how it's measured: 'one' = by servings (the whole dish is one serving; you log
1, 1½, 2…) or 'portion' = by weight (you log grams). `servings` only remembers an older phone's "1 of 4". The API also takes a
share ("1 of 4"), which older phones send.

2026-10-12, round three: a dish is simply saved (there's no cooking / finished / leftovers any more, and no pans). Every
dish with something in it is kept until the cook deletes it; one opened and left empty is cleared away (_tidy). The old
saved recipes became dishes (migration 32). Logging happens from Add food > Saved Dishes (portion), not on the dish page.

Every query is limited to user['id'], with one exception (2026-10-11): the cook can share a dish with friends
(dish_shares). They see it (_seen) and can log their own portion from it; only the cook can change, share or delete it.
"""
import datetime as dt
import json
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field, StrictBool

from . import db, notify, nutrients as N
from .api_food import MEALS
from .auth import current_user

router = APIRouter(prefix='/api/dishes')
NUM = N.ALL
KNOWN = N.ALL     # what can be typed in for the whole dish
MAX_ITEMS = 60
MAX_DISHES = 300
NEW_NAME = 'New meal'   # a dish not named yet (older ones were called after their meal)
PLACEHOLDERS = {NEW_NAME, 'New dish', 'Breakfast', 'Lunch', 'Dinner', 'Snacks'}


# ---------- "100 g chicken" -> 100 g + "chicken" (no AI: the person then picks a match from /api/food/search) ----------
UNITS = {}
for words, unit, grams in (
        (('g', 'gr', 'grm', 'gm', 'gms', 'gram', 'grams', 'gramme', 'grammes'), 'g', 1),
        (('kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'), 'kg', 1000),
        (('oz', 'ounce', 'ounces'), 'oz', 28.3495),
        (('lb', 'lbs', 'pound', 'pounds'), 'lb', 453.592),
        (('ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'), 'ml', 1),     # water-ish: 1 ml ~ 1 g
        (('cl',), 'cl', 10), (('dl',), 'dl', 100),
        (('l', 'litre', 'litres', 'liter', 'liters'), 'l', 1000),
        (('tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons'), 'tbsp', None),   # weight depends on the food
        (('tsp', 'tsps', 'teaspoon', 'teaspoons'), 'tsp', None),
        (('cup', 'cups'), 'cup', None),
        (('pinch', 'pinches'), 'pinch', None), (('clove', 'cloves'), 'clove', None),
        (('slice', 'slices'), 'slice', None), (('can', 'cans', 'tin', 'tins'), 'can', None),
        (('piece', 'pieces'), 'piece', None), (('handful', 'handfuls'), 'handful', None)):
    for w in words: UNITS[w] = (unit, grams)
FRACTIONS = {'½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3'}
QTY = r'(?P<qty>\d+\s+\d+/\d+|\d+/\d+|\d{1,3},\d{3}(?!\d)|\d+(?:[.,]\d+)?)'
UNIT = r'(?:(?P<unit>' + '|'.join(sorted(map(re.escape, UNITS), key=len, reverse=True)) + r')\.?(?![a-z]))?'
LEAD = re.compile(r'^(?:about\s+|approx\.?\s+|~\s*)?' + QTY + r'\s*' + UNIT + r'\s*(?:of\s+)?(?P<rest>.*)$')
TRAIL = re.compile(r'^(?P<rest>.*?)[\s,:-]+' + QTY + r'\s*' + UNIT + r'$')


def _qty(s):
    s = s.strip()
    if re.fullmatch(r'\d{1,3},\d{3}', s): return float(s.replace(',', ''))        # 1,500 g
    if ' ' in s:
        whole, frac = s.split(None, 1)
        f = _qty(frac)
        return float(whole) + f if f is not None else None        # "1 1/0": no amount
    if '/' in s:
        a, b = s.split('/')
        return float(a) / float(b) if float(b) else None
    return float(s.replace(',', '.'))                                              # 1,5 kg


def _query(s):
    s = re.sub(r'^of\s+', '', s.strip())
    s = re.split(r'[,(]', s)[0] or s                     # "carrots, chopped" / "rice (dry)" -> "carrots" / "rice"
    return re.sub(r'\s+', ' ', s.strip(' .,;:-')).strip()[:80]


def parse_line(text):
    t = text.strip().lower()
    t = re.sub(r'(\d)?\s*([½¼¾⅓⅔])', lambda m: (m.group(1) + ' ' if m.group(1) else '') + FRACTIONS[m.group(2)], t)
    m = LEAD.match(t)
    if not (m and m.group('rest').strip()): m = TRAIL.match(t) or m     # "chicken 100g"; "100g" alone keeps the amount
    if not m:
        return {'amount': None, 'unit': None, 'grams': None, 'query': _query(t)}
    amount = _qty(m.group('qty'))
    unit, per = UNITS[m.group('unit')] if m.group('unit') else (None, None)
    grams = round(amount * per, 1) if (amount and per) else None
    return {'amount': round(amount, 3) if amount is not None else None, 'unit': unit, 'grams': grams, 'query': _query(m.group('rest'))}


class ParseIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)


# typical weights of one piece, so "2 apples" can start at a weight (the person can change it) - 2026-10-12
EACH = {'apple': 180, 'banana': 120, 'orange': 140, 'pear': 180, 'peach': 150, 'lemon': 85, 'lime': 65, 'avocado': 150,
        'egg': 50, 'onion': 150, 'red onion': 150, 'shallot': 40, 'garlic': 5, 'carrot': 60, 'potato': 210, 'sweet potato': 130,
        'tomato': 120, 'cherry tomato': 15, 'bell pepper': 120, 'pepper': 120, 'zucchini': 200, 'courgette': 200,
        'cucumber': 300, 'celery': 40, 'mushroom': 18, 'chicken breast': 200, 'chicken thigh': 110, 'sausage': 75,
        'tortilla': 45, 'bagel': 100, 'slice of bread': 35, 'bread': 35, 'chili': 15, 'jalapeno': 15, 'date': 7, 'kiwi': 75}
SPOON = {'tbsp': 14, 'tsp': 5, 'cup': 200, 'pinch': 0.4, 'clove': 5, 'slice': 30, 'handful': 30}


def _singular(q):
    words = q.split()
    w = words[-1] if words else ''
    if len(w) > 3 and not w.endswith(('ss', 'us', 'is')):
        w = w[:-3] + 'y' if w.endswith('ies') else w[:-2] if w.endswith(('oes', 'ches', 'shes')) else w[:-1] if w.endswith('s') else w
    return ' '.join(words[:-1] + [w])


@router.post('/parse')
def parse(body: ParseIn, user=Depends(current_user)):
    """The amount and food, plus 'search' (singular: 'apples' finds 'Apple') and 'guess_g' (a typical weight for
    '2 apples' or '1 tbsp', when the grams aren't said)."""
    p = parse_line(body.text)
    search = _singular(p['query'])
    each = EACH.get(search) if not p['unit'] else SPOON.get(p['unit'])
    guess = round(p['amount'] * each, 1) if (p['amount'] and each and not p['grams']) else None
    return {'text': body.text.strip(), **p, 'search': search, 'guess_g': guess}


# ---------- a dish as the app sees it ----------
def _r(v, n=1): return round(v, n) if v is not None else None


def _item_values(per100, grams):
    return {k:N.rounded(k,per100[k]*grams/100) if per100.get(k) is not None else None for k in NUM}


def _totals(d):
    """Whole-recipe values; a missing ingredient value cannot become a known zero."""
    items=d['items']
    if d.get('recipe_source'):return {k:N.rounded(k,d.get('known_'+k)) for k in NUM}
    out={k:N.rounded(k,sum(i[k] for i in items)) if items and all(N.known(i,k) for i in items) else None for k in NUM}
    for k in KNOWN:
        if d.get('known_'+k) is not None:out[k]=N.rounded(k,d['known_'+k])
    return out


def _sum_g(d):
    g = sum(i.get('grams') or 0 for i in d['items'])
    return round(g, 1) if g > 0 else None


def serving_count(d):
    return (d.get('recipe_source') or {}).get('servings') or 1


def _weight(d):
    """The whole dish in grams: as typed in, else the ingredients added up; None for a typed-in total with no weight."""
    if d.get('recipe_source') and (d['recipe_source'].get('pending') or any(not i.get('grams') for i in d['items'])):return d['cooked_g']
    return d['cooked_g'] or _sum_g(d)


def _out(d):
    totals, weight = _totals(d), _weight(d)
    return {'id': d['id'], 'name': (NEW_NAME if d['name'] == 'New dish' else d['name']), 'items': d['items'],
            'known': {k: d.get(f'known_{k}') for k in KNOWN}, 'totals': totals,
            'recipe_source':d.get('recipe_source') or {},'serving_count':serving_count(d),
            'per_serving':{k:N.rounded(k,v/serving_count(d)) if v is not None else None for k,v in totals.items()},
            'cooked_g': d['cooked_g'], 'weight_g': weight, 'items_g': _sum_g(d), 'weighed': d['cooked_g'] is not None,
            'serving': d['serving'], 'servings': d['servings'], 'named': d['name'] not in PLACEHOLDERS,
            'per_100g': {k: N.rounded(k,v * 100 / weight) if v is not None else None for k, v in totals.items()} if weight else None,
            'created': d['created'], 'updated': d['updated'],
            'review': {**json.loads(d['ai_note']), 'at': d['ai_note_at'], 'changed_since': d['recipe_updated'] > d['ai_note_at']} if d.get('ai_note') else None}


COLS = 'id, user_id, name, items, known_kcal, known_protein_g, known_carbs_g, known_fat_g, cooked_g, serving, servings, created, updated, ai_note, ai_note_at, recipe_updated, known_fiber_g, recipe_source, known_sodium_mg, known_sugar_g, known_saturated_fat_g'
SHARED = """EXISTS (SELECT 1 FROM dish_shares s WHERE s.dish_id = dishes.id AND s.user_id = %(u)s)
            AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
              AND ((f.requester = dishes.user_id AND f.addressee = %(u)s) OR (f.addressee = dishes.user_id AND f.requester = %(u)s)))"""


def _seen(c, uid, did, lock=False):
    """A dish this person may see: their own, or one a friend shared with them (while they're still friends). Otherwise 404."""
    d = c.execute(f"SELECT {COLS} FROM dishes WHERE id = %(d)s AND (user_id = %(u)s OR ({SHARED}))"
                  + (' FOR UPDATE' if lock else ''), {'d': did, 'u': uid}).fetchone()
    if not d: raise HTTPException(404, 'Not found')
    return d


def _view(c, uid, d):
    """_out plus who it's from (a friend's dish) or who it's shared with (your own)."""
    o = _out(d)
    o['mine'] = d['user_id'] == uid
    if o['mine']:
        o['shared_with'] = c.execute("""SELECT u.login::text AS login, u.name, u.photo_v AS photo FROM dish_shares s JOIN users u ON u.id = s.user_id
                                        WHERE s.dish_id = %s ORDER BY u.name""", (d['id'],)).fetchall()
    else:
        o['owner'] = c.execute('SELECT login::text AS login, name FROM users WHERE id = %s', (d['user_id'],)).fetchone()
    return o


def _get(c, uid, did, lock=False):
    d = c.execute(f"SELECT {COLS} FROM dishes WHERE id = %s AND user_id = %s" + (' FOR UPDATE' if lock else ''), (did, uid)).fetchone()
    if not d: raise HTTPException(404, 'Not found')
    return d


def _ingredient_totals(items,source):
    return {k:N.rounded(k,sum(i[k] for i in items)) if items and not source.get('pending') and all(N.known(i,k) for i in items) else None for k in NUM}


def _save_items(c, uid, did, items):
    d=_get(c,uid,did);source=d.get('recipe_source') or {}
    if source.get('basis')=='ingredients':
        values=_ingredient_totals(items,source)
        c.execute(f"UPDATE dishes SET {', '.join('known_'+k+'=%s' for k in KNOWN)} WHERE user_id=%s AND id=%s",(*[values[k] for k in KNOWN],uid,did))
    if source:
        source['edited']=True
        if source.get('basis')=='published':source['site_recipe_changed']=True
        if source.get('basis')=='ingredients':source['sources']={k:('estimated_ingredients' if any(i.get('source')=='ai' for i in items) else 'ingredients') if values[k] is not None else 'unknown' for k in NUM}
        c.execute('UPDATE dishes SET recipe_source=%s WHERE user_id=%s AND id=%s',(json.dumps(source),uid,did))
    c.execute('UPDATE dishes SET items = %s, updated = now(), recipe_updated = now() WHERE id = %s AND user_id = %s', (json.dumps(items), did, uid))
    return _get(c, uid, did)


def _today(c, uid):
    tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
    return c.execute('SELECT (now() AT TIME ZONE %s) AS t', (tz,)).fetchone()['t']


# ---------- dishes ----------
EMPTY = "items = '[]'::jsonb AND cooked_g IS NULL AND "+' AND '.join('known_'+k+' IS NULL' for k in KNOWN)+" AND name = ANY(%(p)s)"


def _empty(d):
    """Opened but nothing added and not named: not a dish yet. Kept off the list; Start a new dish reopens it."""
    return not d['items'] and d['cooked_g'] is None and all(d.get('known_'+k) is None for k in KNOWN) and d['name'] in PLACEHOLDERS


@router.get('')
def dishes(user=Depends(current_user)):
    """Your saved dishes, then the ones friends shared with you; most recently changed first. An empty dish left for
    a day is cleared away here (it was opened and never used)."""
    with db.connect() as c:
        c.execute(f"DELETE FROM dishes WHERE user_id = %(u)s AND {EMPTY} AND updated < now() - interval '1 day'",
                  {'u': user['id'], 'p': list(PLACEHOLDERS)})
        rows = c.execute(f"""SELECT {COLS} FROM dishes WHERE user_id = %(u)s OR ({SHARED})
                             ORDER BY user_id = %(u)s DESC, updated DESC, id DESC LIMIT %(n)s""", {'u': user['id'], 'n': MAX_DISHES + 50}).fetchall()
        return [_view(c, user['id'], d) for d in rows if not (d['user_id'] == user['id'] and _empty(d))]


class DishIn(BaseModel):
    name: str | None = Field(None, max_length=80)
    meal: str | None = None         # older phones send it; not used any more


@router.post('')
def dish_add(body: DishIn, user=Depends(current_user)):
    with db.connect() as c:
        name = (body.name or '').strip()
        # tapping Start a new dish twice shouldn't leave a row of empty dishes: reopen the empty one you already have
        empty = c.execute(f"SELECT id FROM dishes WHERE user_id = %(u)s AND {EMPTY} ORDER BY created DESC LIMIT 1",
                          {'u': user['id'], 'p': list(PLACEHOLDERS)}).fetchone()
        if empty and not name:
            c.execute('UPDATE dishes SET created = now(), updated = now(), name = %s WHERE id = %s', (NEW_NAME, empty['id']))
            return _view(c, user['id'], _get(c, user['id'], empty['id']))
        if c.execute('SELECT count(*) AS n FROM dishes WHERE user_id = %s', (user['id'],)).fetchone()['n'] >= MAX_DISHES:
            raise HTTPException(400, f'You can keep up to {MAX_DISHES} meals - delete one first')
        # new dishes are measured by servings (the whole dish is one serving): the simplest to log; a pot switches to weight
        did = c.execute("INSERT INTO dishes (user_id, name, serving, servings) VALUES (%s, %s, 'one', 1) RETURNING id", (user['id'], name or NEW_NAME)).fetchone()['id']
        return _view(c, user['id'], _get(c, user['id'], did))


@router.get('/{did:int}')
def dish(did: int, user=Depends(current_user)):
    with db.connect() as c:
        return _view(c, user['id'], _seen(c, user['id'], did))


class DishEdit(N.KnownExtras):
    name: str | None = Field(None, min_length=1, max_length=80)
    cooked_g: float | None = Field(None, gt=0, le=30000)      # the whole dish as weighed; null = the ingredients added up
    known_kcal: float | None = Field(None, ge=0, le=50000)    # a total from a recipe; null = use the ingredients
    known_protein_g: float | None = Field(None, ge=0, le=5000)
    known_carbs_g: float | None = Field(None, ge=0, le=5000)
    known_fat_g: float | None = Field(None, ge=0, le=5000)
    known_fiber_g: float | None = Field(None, ge=0, le=5000)
    use_ingredients:StrictBool=False
    serving: str | None = Field(None, pattern='^(one|portion)$')
    servings: int | None = Field(None, ge=1, le=50)


@router.patch('/{did:int}')
def dish_edit(did: int, body: DishEdit, user=Depends(current_user)):
    v = body.model_dump(exclude_unset=True)
    with db.connect() as c:
        d = _get(c, user['id'], did, lock=True)
        sets = {}
        if 'name' in v:
            if not (v['name'] or '').strip(): raise HTTPException(400, 'The meal needs a name')
            sets['name'] = v['name'].strip()
        if 'cooked_g' in v:     # the same as the ingredients added up = not weighed
            g = _r(v['cooked_g'])
            sets['cooked_g'] = None if g is not None and _sum_g(d) is not None and abs(g - _sum_g(d)) < 0.5 else g
        for k in KNOWN:
            if f'known_{k}' in v: sets[f'known_{k}'] = N.rounded(k,v[f'known_{k}'])
        if v.get('serving'): sets['serving'] = v['serving']
        if 'servings' in v: sets['servings'] = v['servings']
        if set(sets) & {'cooked_g', *(f'known_{k}' for k in KNOWN)}: sets['recipe_updated'] = dt.datetime.now(dt.timezone.utc)
        if d.get('recipe_source') and (any('known_'+k in sets for k in KNOWN) or body.use_ingredients):
            source=dict(d['recipe_source']);source['basis']='ingredients' if body.use_ingredients else 'entered';source['edited']=True
            source['sources']={k:('entered' if sets.get('known_'+k) is not None else 'unknown') if 'known_'+k in sets else (source.get('sources') or {}).get(k,'unknown') for k in NUM}
            if body.use_ingredients:
                values=_ingredient_totals(d['items'],source);sets['recipe_updated']=dt.datetime.now(dt.timezone.utc)
                estimated=any(i.get('source')=='ai' or (i.get('ref') or {}).get('origin')=='ai' for i in d['items'])
                for k in KNOWN:
                    sets['known_'+k]=values[k]
                    source['sources'][k]=('estimated_ingredients' if estimated else 'ingredients') if values[k] is not None else 'unknown'
            sets['recipe_source']=json.dumps(source)
        if sets:
            c.execute(f"UPDATE dishes SET {', '.join(f'{k} = %s' for k in sets)}, updated = now() WHERE id = %s AND user_id = %s",
                      (*sets.values(), did, user['id']))
        return _view(c, user['id'], _get(c, user['id'], did))


@router.delete('/{did:int}')
def dish_delete(did: int, user=Depends(current_user)):
    """Food entries already logged from the dish stay in the food log."""
    with db.connect() as c:
        if not c.execute('DELETE FROM dishes WHERE id = %s AND user_id = %s RETURNING id', (did, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- ingredients ----------
class Per100(N.ExtraPer100):
    kcal: float = Field(ge=0, le=1000)          # nothing has more than ~900 kcal per 100 g (pure fat)
    protein_g: float | None = Field(None, ge=0, le=100)
    carbs_g: float | None = Field(None, ge=0, le=100)
    fat_g: float | None = Field(None, ge=0, le=100)
    fiber_g: float | None = Field(None, ge=0, le=100)


class ItemIn(N.ExtraValues):
    """Either per100 (a food picked from search) or kcal + macros typed in for this amount."""
    name: str = Field(min_length=1, max_length=200)
    grams: float | None = Field(None,gt=0, lt=20000)
    per100: Per100 | None = None
    kcal: float | None = Field(None, ge=0, le=20000)
    protein_g: float | None = Field(None, ge=0, le=2000)
    carbs_g: float | None = Field(None, ge=0, le=2000)
    fat_g: float | None = Field(None, ge=0, le=2000)
    fiber_g: float | None = Field(None, ge=0, le=1000)
    source: str = Field('quick', max_length=20)
    ref: dict | None = None


def _per100(body):
    if body.per100 is not None: return body.per100.model_dump()
    if body.kcal is None: raise HTTPException(400, 'Pick a food, or type its calories')
    per = {k: (getattr(body, k) * 100 / body.grams if getattr(body, k) is not None else None) for k in NUM}
    if any((per[k] or 0)>N.PER100_LIMITS[k] for k in NUM):
        raise HTTPException(400, f"That's more than {body.grams:g} g of food can hold - check the amount and the calories")
    return {k:round(v,4 if k in N.EXTRA else 3) if v is not None else None for k,v in per.items()}


@router.post('/{did:int}/items')
def item_add(did: int, body: ItemIn, user=Depends(current_user)):
    if body.ref is not None and len(json.dumps(body.ref)) > 2000: raise HTTPException(400, 'ref is too big')
    if body.grams is None and body.per100 is not None:raise HTTPException(400,'Enter the ingredient weight to use per-100-gram nutrition')
    per100 = _per100(body) if body.grams is not None else None
    with db.connect() as c:
        dish=_get(c,user['id'],did,lock=True);items=dish['items']
        if body.grams is None and (not dish.get('recipe_source') or body.kcal is None):raise HTTPException(400,'Enter a weight, or keep this imported ingredient with its known amount nutrition')
        if len(items) >= MAX_ITEMS: raise HTTPException(400, f'A meal can have up to {MAX_ITEMS} ingredients')
        item = {'id': secrets.token_hex(4), 'name': body.name.strip(), 'grams': _r(body.grams), **(_item_values(per100,body.grams) if per100 else {k:getattr(body,k) for k in NUM}),
                'per100': per100, 'source': body.source, 'ref': body.ref}
        return _view(c, user['id'], _save_items(c, user['id'], did, items + [item]))


class ItemEdit(BaseModel):
    grams: float = Field(gt=0, lt=20000)


def _find(items, iid):
    for n, i in enumerate(items):
        if i.get('id') == iid: return n
    raise HTTPException(404, 'Not found')


@router.patch('/{did:int}/items/{iid}')
def item_edit(did: int, iid: str, body: ItemEdit, user=Depends(current_user)):
    with db.connect() as c:
        dish=_get(c,user['id'],did,lock=True);items=dish['items']
        n=_find(items,iid);old=items[n]
        if not old.get('per100'):
            if not dish.get('recipe_source'):raise HTTPException(400,'Enter nutrition for this ingredient before changing its weight')
            per={k:old.get(k)*100/body.grams if old.get(k) is not None else None for k in NUM}
            if any(v is not None and v>N.PER100_LIMITS[k] for k,v in per.items()):raise HTTPException(400,'Check the weight for this ingredient’s known nutrition')
            items[n]={**old,'grams':_r(body.grams),'per100':per}
        else:
            values={k:N.rounded(k,old['per100'].get(k)*body.grams/100) if old['per100'].get(k) is not None else None for k in NUM} if dish.get('recipe_source') else _item_values(old['per100'],body.grams)
            items[n]={**old,'grams':_r(body.grams),**values}
        return _view(c, user['id'], _save_items(c, user['id'], did, items))


@router.delete('/{did:int}/items/{iid}')
def item_delete(did: int, iid: str, user=Depends(current_user)):
    with db.connect() as c:
        items = _get(c, user['id'], did, lock=True)['items']
        del items[_find(items, iid)]
        return _view(c, user['id'], _save_items(c, user['id'], did, items))


# ---------- log a portion (from Add food > Saved Dishes) ----------
class PortionIn(BaseModel):
    """One of: grams; share of the whole dish (0.25 for "1 of 4", with of=4 to remember); count of whole servings
    (a one-serving dish, like 1 smoothie or 2 coffees)."""
    client_id: str | None = Field(None,pattern=r'^[A-Za-z0-9-]{8,64}$')
    grams: float | None = Field(None, gt=0, le=20000)
    share: float | None = Field(None, gt=0, le=1)
    of: int | None = Field(None, ge=1, le=50)
    count: float | None = Field(None, gt=0, le=20)
    meal: str = Field(pattern='^(' + '|'.join(MEALS) + ')$')
    day: dt.date | None = None          # default: today where the person is


@router.post('/{did:int}/portion')
def portion(did: int, body: PortionIn, user=Depends(current_user), thread: bool = False, captured_at: AwareDatetime | None = None):
    if sum(x is not None for x in (body.grams, body.share, body.count)) != 1: raise HTTPException(400, 'Send grams, share or count')
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        from . import food_thread_receipts as receipts
        if thread:receipts.guard(c,user['id'],body.client_id)
        request=body.model_dump(mode='json',exclude={'client_id'})
        if body.client_id:
            old=c.execute(f'SELECT {receipts.ENTRY} FROM food_entries WHERE user_id=%s AND client_id=%s',(user['id'],body.client_id)).fetchone()
            if old:
                ref=old.get('ref') or {}
                if ref.get('dish_id')!=did or ref.get('portion_request')!=request:raise HTTPException(409,'This portion identity was already used. Edit the saved food or start a new log.')
                messages=receipts.create(c,user['id'],[old['id']],captured_at) if thread else []
                return {'entry':old,'replayed':True,**({'messages':messages} if thread else {})}
        d = _seen(c, user['id'], did)
        if _totals(d)['kcal'] is None: raise HTTPException(400, "Add the ingredients or the meal's total calories first")
        weight = _weight(d)
        if body.grams is not None and not weight: raise HTTPException(400, "This meal has no weight yet - log a share of it, or add its weight")
        if body.count is not None:      # servings of the whole dish: by servings, the whole dish is one serving (Ben, 2026-10-12)
            f, amount, unit = body.count / serving_count(d), round(body.count, 2), 'serving'
        elif body.grams is not None: f, amount, unit = body.grams / weight, round(body.grams, 1), 'g'
        elif weight: f, amount, unit = body.share, round(body.share * weight, 1), 'g'
        else: f, amount, unit = body.share, round(body.share, 3), 'dish'     # "0.25 dish": a typed-in total with no weight
        totals = _totals(d)
        vals = {k:N.rounded(k,v*f) if v is not None else None for k,v in totals.items()}
        if any(v is not None and v>N.ENTRY_MAX[k] for k,v in vals.items() if k in N.EXTRA):raise HTTPException(400,'That portion is too large. Check the amount.')
        day = body.day or _today(c, user['id']).date()
        pos = c.execute('SELECT coalesce(max(position), 0) + 1 AS p FROM food_entries WHERE user_id = %s AND day = %s', (user['id'], day)).fetchone()['p']
        ref = {'dish_id': did, 'weight_g': weight, 'dish_kcal': totals['kcal'],'unknown_nutrients':[k for k,v in vals.items() if v is None],**({'recipe_source':{k:d['recipe_source'].get(k) for k in ('source_url','basis','sources','servings','edited')}} if d.get('recipe_source') else {}),**({'portion_request':request} if body.client_id else {})}
        entry = c.execute("""INSERT INTO food_entries (user_id, day, meal, name, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref, position, client_id)
                             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'dish', %s, %s, %s)
                             RETURNING id, day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref""",
                          (user['id'], day, body.meal, d['name'], amount, unit, vals['kcal'], vals['protein_g'] or 0, vals['carbs_g'] or 0,
                           vals['fat_g'] or 0, vals['fiber_g'],vals['sodium_mg'],vals['sugar_g'],vals['saturated_fat_g'],json.dumps(ref), pos, body.client_id)).fetchone()
        if body.of and d['user_id'] == user['id']:      # "1 of 4": the next time it offers 4 again
            c.execute('UPDATE dishes SET servings = %s WHERE id = %s AND user_id = %s', (body.of, did, user['id']))
        messages=receipts.create(c,user['id'],[entry['id']],captured_at) if thread else []
        return {'entry':entry,**({'messages':messages} if thread else {})}


# ---------- share a dish with friends (2026-10-11) ----------
MAX_SHARES = 10


class ShareIn(BaseModel):
    login: str = Field(min_length=1, max_length=60)


@router.post('/{did:int}/share')
def share(did: int, body: ShareIn, user=Depends(current_user)):
    """The cook shares the dish with a friend (approved friends only), who can then log a portion from it."""
    with db.connect() as c:
        _get(c, user['id'], did, lock=True)
        t = c.execute("""SELECT u.id, u.name FROM users u JOIN friendships f ON f.status = 'accepted'
                           AND ((f.requester = u.id AND f.addressee = %(me)s) OR (f.addressee = u.id AND f.requester = %(me)s))
                         WHERE u.login = %(l)s""", {'me': user['id'], 'l': body.login.strip().lower()}).fetchone()
        if not t: raise HTTPException(404, 'You can share a meal only with friends')
        if c.execute('SELECT count(*) AS n FROM dish_shares WHERE dish_id = %s', (did,)).fetchone()['n'] >= MAX_SHARES:
            raise HTTPException(400, f'A meal can be shared with up to {MAX_SHARES} people')
        if c.execute('INSERT INTO dish_shares (dish_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING 1', (did, t['id'])).fetchone():
            notify.add(c, t['id'], 'dish_shared', user['id'], dish_id=did)
        return _view(c, user['id'], _get(c, user['id'], did))


@router.delete('/{did:int}/share/{login}')
def unshare(did: int, login: str, user=Depends(current_user)):
    """The cook stops sharing with someone, or someone hides a dish shared with them (their own username)."""
    with db.connect() as c:
        d = _seen(c, user['id'], did)
        t = c.execute('SELECT id FROM users WHERE login = %s', (login.strip().lower(),)).fetchone()
        if not t or (d['user_id'] != user['id'] and t['id'] != user['id']): raise HTTPException(404, 'Not found')
        c.execute('DELETE FROM dish_shares WHERE dish_id = %s AND user_id = %s', (did, t['id']))
    return {'ok': True}


class PortionCancelIn(BaseModel):
    model_config={'extra':'forbid'}
    client_id:str=Field(pattern=r'^[A-Za-z0-9-]{8,64}$')


@router.post('/{did:int}/portion/cancel')
def cancel_portion(did:int,body:PortionCancelIn,user=Depends(current_user)):
    """Undo a sent or queued portion, including when its original upload is still in flight."""
    from . import food_thread,food_thread_log as engine,food_thread_receipts as receipts
    uid=user['id']
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
        entry=c.execute('SELECT id,source,ref FROM food_entries WHERE user_id=%s AND client_id=%s',(uid,body.client_id)).fetchone()
        if entry and (entry['source']!='dish' or (entry['ref'] or {}).get('dish_id')!=did):raise HTTPException(409,'This Undo belongs to a different food')
        key=receipts.identity(uid,body.client_id)
        c.execute('INSERT INTO food_chat_cancellations(user_id,client_id) VALUES(%s,%s) ON CONFLICT DO NOTHING',(uid,key))
        root=c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND client_id=%s FOR UPDATE',(uid,key)).fetchone()
        if root and ((root.get('result') or {}).get('receipt') or {}).get('client_id')==body.client_id:
            reply=engine.stored_reply(c,uid,root)
            if reply and (reply.get('result') or {}).get('kind') in ('log','undone'):
                return {**engine.undo(c,uid,root),'cancelled':True}
        removed=c.execute('DELETE FROM food_entries WHERE user_id=%s AND client_id=%s RETURNING id',(uid,body.client_id)).fetchall()
        return {'cancelled':True,'removed':len(removed),'messages':[]}
