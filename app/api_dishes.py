"""Cooking mode (2026-10-11): build a dish while you cook, weigh it, then log your portion; the rest stays as leftovers.

A dish is a list of ingredients (each with its own per-100 g values, so its amount can change) or a total typed in from
a recipe (known_*, which wins over the ingredients' sum). Its weight is the ingredients added up, unless the cooked dish
was weighed (cooked_g, without the pan: pans remembers the person's empty pans). A portion of P grams is logged as an
ordinary food entry with the dish's totals x P / weight, and adds to eaten_g. A portion can also be a share of the dish
("1 of 4"): with a weight that's just grams; without one (a typed-in total only) it adds to eaten_share instead.

2026-10-12: a dish is cooked for a meal (meal), and stays open until the cook finishes it (finish): either it keeps its
leftovers, offered for LEFTOVER_DAYS more, or it's deleted. Dishes aren't kept otherwise (_tidy deletes finished ones and
ones left untouched for LEFTOVER_DAYS); the food log keeps every portion. To keep one, the cook saves it as a recipe
(recipes), which follows later changes to that dish and can be cooked again (a new dish with the same ingredients).

Every query is limited to user['id'], with one exception (2026-10-11): the cook can share a dish with friends
(dish_shares). They see it (_seen) and can log their own portion from it, which comes off the same leftovers; only the
cook can change it, weigh it, share it or delete it.
"""
import datetime as dt
import json
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, notify
from .api_food import MEALS
from .auth import current_user

router = APIRouter(prefix='/api/dishes')
NUM = ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')
KNOWN = ('kcal', 'protein_g', 'carbs_g', 'fat_g')     # what can be typed in for the whole dish
MAX_ITEMS = 60
MAX_PANS = 20
SLACK = 1.05            # a portion may be 5 % more than what's left: kitchen scales and leftovers in the pan disagree
LEFTOVER_DAYS = 5
MAX_RECIPES = 200
DEFAULT_NAMES = {'breakfast': 'Breakfast', 'lunch': 'Lunch', 'dinner': 'Dinner', 'snacks': 'Snacks'}   # a dish not named yet


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
    return {k: _r(per100[k] * grams / 100) if per100.get(k) is not None else (None if k == 'fiber_g' else 0) for k in NUM}


def _totals(d):
    """The dish's kcal + macros: a typed-in total wins, otherwise the ingredients' sum (fiber only if some has it)."""
    items = d['items']
    out = {k: round(sum((i.get(k) or 0) for i in items), 1) for k in NUM}
    if not any(i.get('fiber_g') is not None for i in items): out['fiber_g'] = None
    for k in KNOWN:
        if d[f'known_{k}'] is not None: out[k] = round(d[f'known_{k}'], 1)
    return out


def _weight(d):
    """The whole dish in grams: as weighed, else the ingredients added up; None for a typed-in total that wasn't weighed."""
    if d['cooked_g']: return d['cooked_g']
    g = sum(i.get('grams') or 0 for i in d['items'])
    return round(g, 1) if g > 0 else None


def _left_share(d):
    w = _weight(d)
    return max(0.0, 1 - d['eaten_share'] - (d['eaten_g'] / w if w else 0))


def _out(d):
    totals, weight, share = _totals(d), _weight(d), _left_share(d)
    left = round(weight * share, 1) if weight else None
    some_left = left >= 1 if weight else share >= 0.01
    status = 'cooking' if d['done_at'] is None else ('leftovers' if some_left else 'finished')
    return {'id': d['id'], 'name': d['name'], 'meal': d['meal'], 'items': d['items'],
            'known': {k: d[f'known_{k}'] for k in KNOWN}, 'totals': totals,
            'cooked_g': d['cooked_g'], 'weight_g': weight, 'weighed': d['cooked_g'] is not None,
            'eaten_g': round(d['eaten_g'], 1), 'left_g': left, 'left_share': round(share, 3),
            'eaten': d['eaten_g'] > 0 or d['eaten_share'] > 0,
            'per_100g': {k: _r(v * 100 / weight) if v is not None else None for k, v in totals.items()} if weight else None,
            'recipe_id': d['recipe_id'],
            'status': status, 'created': d['created'], 'updated': d['updated'], 'done_at': d['done_at'],
            'review': {**json.loads(d['ai_note']), 'at': d['ai_note_at'], 'changed_since': d['recipe_updated'] > d['ai_note_at']} if d.get('ai_note') else None}


COLS = 'id, user_id, name, meal, items, known_kcal, known_protein_g, known_carbs_g, known_fat_g, cooked_g, eaten_g, eaten_share, created, updated, done_at, ai_note, ai_note_at, recipe_updated, recipe_id'


def _seen(c, uid, did, lock=False):
    """A dish this person may see: their own, or one a friend shared with them (while they're still friends). Otherwise 404."""
    d = c.execute(f"""SELECT {COLS} FROM dishes WHERE id = %(d)s AND (user_id = %(u)s
                        OR (EXISTS (SELECT 1 FROM dish_shares s WHERE s.dish_id = dishes.id AND s.user_id = %(u)s)
                        AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
                          AND ((f.requester = dishes.user_id AND f.addressee = %(u)s) OR (f.addressee = dishes.user_id AND f.requester = %(u)s)))))"""
                  + (' FOR UPDATE' if lock else ''), {'d': did, 'u': uid}).fetchone()
    if not d: raise HTTPException(404, 'Not found')
    return d


def _view(c, uid, d):
    """_out plus who it's from (a friend's dish) or who it's shared with (your own)."""
    o = _out(d)
    o['mine'] = d['user_id'] == uid
    if o['mine']:
        o['shared_with'] = c.execute("""SELECT u.login::text AS login, u.name FROM dish_shares s JOIN users u ON u.id = s.user_id
                                        WHERE s.dish_id = %s ORDER BY u.name""", (d['id'],)).fetchall()
    else:
        o['owner'] = c.execute('SELECT login::text AS login, name FROM users WHERE id = %s', (d['user_id'],)).fetchone()
    return o


def _get(c, uid, did, lock=False):
    d = c.execute(f"SELECT {COLS} FROM dishes WHERE id = %s AND user_id = %s" + (' FOR UPDATE' if lock else ''), (did, uid)).fetchone()
    if not d: raise HTTPException(404, 'Not found')
    return d


def _save_items(c, uid, did, items):
    c.execute('UPDATE dishes SET items = %s, updated = now(), recipe_updated = now() WHERE id = %s AND user_id = %s', (json.dumps(items), did, uid))
    sync_recipe(c, uid, did)
    return _get(c, uid, did)


def sync_recipe(c, uid, did):
    """A dish saved as a recipe (or cooked from one) keeps that recipe up to date: the latest version is the one saved."""
    c.execute("""UPDATE recipes r SET name = d.name, items = d.items, known_kcal = d.known_kcal, known_protein_g = d.known_protein_g,
                   known_carbs_g = d.known_carbs_g, known_fat_g = d.known_fat_g, ai_note = d.ai_note, ai_note_at = d.ai_note_at, updated = now()
                 FROM dishes d WHERE d.id = %s AND d.user_id = %s AND r.id = d.recipe_id AND r.user_id = d.user_id""", (did, uid))


def _today(c, uid):
    tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
    return c.execute('SELECT (now() AT TIME ZONE %s) AS t', (tz,)).fetchone()['t']


# ---------- pans (before /{did}, though the int path type keeps them apart anyway) ----------
class PanIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    grams: float = Field(gt=0, le=10000)


@router.get('/pans')
def pans(user=Depends(current_user)):
    with db.connect() as c:
        return c.execute('SELECT id, name, grams FROM pans WHERE user_id = %s ORDER BY name, id', (user['id'],)).fetchall()


@router.post('/pans')
def pan_add(body: PanIn, user=Depends(current_user)):
    with db.connect() as c:
        if c.execute('SELECT count(*) AS n FROM pans WHERE user_id = %s', (user['id'],)).fetchone()['n'] >= MAX_PANS:
            raise HTTPException(400, f'You can keep up to {MAX_PANS} pans - remove one first')
        return c.execute('INSERT INTO pans (user_id, name, grams) VALUES (%s, %s, %s) RETURNING id, name, grams',
                         (user['id'], body.name.strip() or 'Pan', round(body.grams, 1))).fetchone()


@router.delete('/pans/{pid:int}')
def pan_delete(pid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM pans WHERE id = %s AND user_id = %s RETURNING id', (pid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- dishes ----------
def _empty(d):
    """Opened (still its default name) but nothing added: kept off the list, and Cooking reopens it (see dish_add)."""
    return d['done_at'] is None and not d['items'] and d['cooked_g'] is None and d['known_kcal'] is None and d['name'] in DEFAULT_NAMES.values()


def _expired(d, now):
    """Finished, leftovers older than LEFTOVER_DAYS, or left cooking and untouched that long."""
    o, days = _out(d), dt.timedelta(days=LEFTOVER_DAYS)
    if o['status'] == 'finished': return True
    if o['status'] == 'leftovers': return d['done_at'] < now - days
    return d['updated'] < now - days


@router.get('')
def dishes(user=Depends(current_user)):
    """Dishes still in use: cooking, or with leftovers from the last few days (yours, or shared by a friend). Newest first.
    Your own dishes that are done with are deleted here: a dish is only kept as a saved recipe."""
    with db.connect() as c:
        rows = c.execute(f"""SELECT {COLS} FROM dishes WHERE user_id = %(u)s
                                 OR (EXISTS (SELECT 1 FROM dish_shares s WHERE s.dish_id = dishes.id AND s.user_id = %(u)s)
                        AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
                          AND ((f.requester = dishes.user_id AND f.addressee = %(u)s) OR (f.addressee = dishes.user_id AND f.requester = %(u)s))))
                             ORDER BY created DESC, id DESC LIMIT 200""", {'u': user['id']}).fetchall()
        now, out, gone = dt.datetime.now(dt.timezone.utc), [], []
        for d in rows:
            if _expired(d, now):
                if d['user_id'] == user['id']: gone.append(d['id'])
            elif not (d['user_id'] == user['id'] and _empty(d)) and len(out) < 50:
                out.append(_view(c, user['id'], d))
        if gone: c.execute('DELETE FROM dishes WHERE user_id = %s AND id = ANY(%s)', (user['id'], gone))
        return out


class DishIn(BaseModel):
    name: str | None = Field(None, max_length=80)
    meal: str | None = Field(None, pattern='^(' + '|'.join(MEALS) + ')$')


def _default_meal(now):
    return 'breakfast' if now.hour < 11 else 'lunch' if now.hour < 16 else 'dinner'


@router.post('')
def dish_add(body: DishIn, user=Depends(current_user)):
    with db.connect() as c:
        # tapping Cooking twice shouldn't leave a row of empty dishes: reopen the empty one you already have
        meal = body.meal or _default_meal(_today(c, user['id']))
        empty = c.execute("""SELECT id FROM dishes WHERE user_id = %s AND done_at IS NULL AND items = '[]'::jsonb AND cooked_g IS NULL AND known_kcal IS NULL AND name = ANY(%s)
                             ORDER BY created DESC LIMIT 1""", (user['id'], list(DEFAULT_NAMES.values()))).fetchone()
        if empty and not (body.name or '').strip():
            c.execute('UPDATE dishes SET created = now(), updated = now(), meal = %s, name = %s WHERE id = %s', (meal, DEFAULT_NAMES[meal], empty['id']))
            return _view(c, user['id'], _get(c, user['id'], empty['id']))
        name = (body.name or '').strip() or DEFAULT_NAMES[meal]
        did = c.execute('INSERT INTO dishes (user_id, name, meal) VALUES (%s, %s, %s) RETURNING id', (user['id'], name, meal)).fetchone()['id']
        return _view(c, user['id'], _get(c, user['id'], did))


@router.get('/{did:int}')
def dish(did: int, user=Depends(current_user)):
    with db.connect() as c:
        return _view(c, user['id'], _seen(c, user['id'], did))


class DishEdit(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    cooked_g: float | None = Field(None, gt=0, le=30000)      # the dish without the pan; null clears
    gross_g: float | None = Field(None, gt=0, le=40000)       # or: dish + pan, with pan_id (no pan_id = no pan)
    pan_id: int | None = None
    known_kcal: float | None = Field(None, ge=0, le=50000)    # a total from a recipe; null = use the ingredients
    known_protein_g: float | None = Field(None, ge=0, le=5000)
    known_carbs_g: float | None = Field(None, ge=0, le=5000)
    known_fat_g: float | None = Field(None, ge=0, le=5000)
    meal: str | None = Field(None, pattern='^(' + '|'.join(MEALS) + ')$')    # renames a dish still called after its meal
    done: bool | None = None                                  # older phones: true = finished, nothing left; false = back to cooking


@router.patch('/{did:int}')
def dish_edit(did: int, body: DishEdit, user=Depends(current_user)):
    v = body.model_dump(exclude_unset=True)
    with db.connect() as c:
        d = _get(c, user['id'], did, lock=True)
        sets = {}
        if 'name' in v:
            if not (v['name'] or '').strip(): raise HTTPException(400, 'The dish needs a name')
            sets['name'] = v['name'].strip()
        if v.get('meal'):
            sets['meal'] = v['meal']
            if 'name' not in sets and d['name'] in DEFAULT_NAMES.values(): sets['name'] = DEFAULT_NAMES[v['meal']]
        if v.get('gross_g') is not None:
            if 'cooked_g' in v: raise HTTPException(400, 'Send cooked_g or gross_g, not both')
            pan = 0
            if v.get('pan_id') is not None:
                p = c.execute('SELECT grams FROM pans WHERE id = %s AND user_id = %s', (v['pan_id'], user['id'])).fetchone()
                if not p: raise HTTPException(404, 'Pan not found')
                pan = p['grams']
            if v['gross_g'] - pan <= 0: raise HTTPException(400, "That's no more than the empty pan weighs - check the pan and the weight")
            sets['cooked_g'] = round(v['gross_g'] - pan, 1)
        elif 'cooked_g' in v:
            sets['cooked_g'] = _r(v['cooked_g'])
        for k in KNOWN:
            if f'known_{k}' in v: sets[f'known_{k}'] = _r(v[f'known_{k}'])
        if set(sets) & {'cooked_g', *(f'known_{k}' for k in KNOWN)}: sets['recipe_updated'] = dt.datetime.now(dt.timezone.utc)
        if v.get('done') is not None:
            sets['done_at'] = (d['done_at'] or dt.datetime.now(dt.timezone.utc)) if v['done'] else None
            if not v['done'] and (d['eaten_g'] > 0 or 0 < d['eaten_share'] < 1): raise HTTPException(400, 'Portions are already logged from this dish')
            if not v['done']: sets['eaten_share'] = 0
            if v['done']: sets['eaten_share'] = max(d['eaten_share'], 1)     # "nothing left": it leaves the list
        if sets:
            c.execute(f"UPDATE dishes SET {', '.join(f'{k} = %s' for k in sets)}, updated = now() WHERE id = %s AND user_id = %s",
                      (*sets.values(), did, user['id']))
            if set(sets) & {'name', *(f'known_{k}' for k in KNOWN)}: sync_recipe(c, user['id'], did)
        return _view(c, user['id'], _get(c, user['id'], did))


class FinishIn(BaseModel):
    leftovers: bool = False         # keep what's left, on the list for LEFTOVER_DAYS; otherwise the dish is deleted
    save: bool = False              # save it as a recipe first (if it isn't already)


@router.post('/{did:int}/finish')
def finish(did: int, body: FinishIn, user=Depends(current_user)):
    """Done cooking: the dish leaves the list (kept only while it has leftovers). Portions stay in the food log."""
    with db.connect() as c:
        d = _get(c, user['id'], did, lock=True)
        rid = d['recipe_id']
        if body.save and not rid: rid = _save_recipe(c, user['id'], d)
        o = _out(d)
        some_left = (o['left_g'] or 0) >= 1 if o['weight_g'] else o['left_share'] >= 0.01
        if body.leftovers and some_left:
            c.execute('UPDATE dishes SET done_at = coalesce(done_at, now()), updated = now() WHERE id = %s', (did,))
            return {'kept': True, 'recipe_id': rid, 'dish': _view(c, user['id'], _get(c, user['id'], did))}
        c.execute('DELETE FROM dishes WHERE id = %s AND user_id = %s', (did, user['id']))
        return {'kept': False, 'recipe_id': rid}


@router.delete('/{did:int}')
def dish_delete(did: int, user=Depends(current_user)):
    """Food entries already logged from the dish stay in the food log."""
    with db.connect() as c:
        if not c.execute('DELETE FROM dishes WHERE id = %s AND user_id = %s RETURNING id', (did, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- ingredients ----------
class Per100(BaseModel):
    kcal: float = Field(ge=0, le=1000)          # nothing has more than ~900 kcal per 100 g (pure fat)
    protein_g: float | None = Field(0, ge=0, le=100)
    carbs_g: float | None = Field(0, ge=0, le=100)
    fat_g: float | None = Field(0, ge=0, le=100)
    fiber_g: float | None = Field(None, ge=0, le=100)


class ItemIn(BaseModel):
    """Either per100 (a food picked from search) or kcal + macros typed in for this amount."""
    name: str = Field(min_length=1, max_length=200)
    grams: float = Field(gt=0, lt=20000)
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
    if per['kcal'] > 1000 or any((per[k] or 0) > 100 for k in NUM if k != 'kcal'):
        raise HTTPException(400, f"That's more than {body.grams:g} g of food can hold - check the amount and the calories")
    return {k: _r(v, 3) if (v is not None or k == 'fiber_g') else 0 for k, v in per.items()}


@router.post('/{did:int}/items')
def item_add(did: int, body: ItemIn, user=Depends(current_user)):
    if body.ref is not None and len(json.dumps(body.ref)) > 2000: raise HTTPException(400, 'ref is too big')
    per100 = _per100(body)
    with db.connect() as c:
        items = _get(c, user['id'], did, lock=True)['items']
        if len(items) >= MAX_ITEMS: raise HTTPException(400, f'A dish can have up to {MAX_ITEMS} ingredients')
        item = {'id': secrets.token_hex(4), 'name': body.name.strip(), 'grams': round(body.grams, 1), **_item_values(per100, body.grams),
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
        items = _get(c, user['id'], did, lock=True)['items']
        n = _find(items, iid)
        items[n] = {**items[n], 'grams': round(body.grams, 1), **_item_values(items[n]['per100'], body.grams)}
        return _view(c, user['id'], _save_items(c, user['id'], did, items))


@router.delete('/{did:int}/items/{iid}')
def item_delete(did: int, iid: str, user=Depends(current_user)):
    with db.connect() as c:
        items = _get(c, user['id'], did, lock=True)['items']
        del items[_find(items, iid)]
        return _view(c, user['id'], _save_items(c, user['id'], did, items))


# ---------- log a portion ----------
class PortionIn(BaseModel):
    grams: float | None = Field(None, gt=0, le=20000)
    share: float | None = Field(None, gt=0, le=1)      # or: this much of the whole dish, like 0.25 for "1 of 4"
    meal: str = Field(pattern='^(' + '|'.join(MEALS) + ')$')
    day: dt.date | None = None          # default: today where the person is


@router.post('/{did:int}/portion')
def portion(did: int, body: PortionIn, user=Depends(current_user)):
    if (body.grams is None) == (body.share is None): raise HTTPException(400, 'Send grams or share')
    with db.connect() as c:
        d = _seen(c, user['id'], did, lock=True)     # locked: two portions at once can't both take the last of it
        if not d['items'] and d['known_kcal'] is None: raise HTTPException(400, "Add the ingredients or the dish's total calories first")
        weight, share_left = _weight(d), _left_share(d)
        if body.grams is not None and not weight: raise HTTPException(400, 'Weigh the cooked dish first, or log a share of it')
        grams = body.grams if body.grams is not None else (body.share * weight if weight else None)
        f = grams / weight if grams is not None else body.share
        if f > share_left * SLACK + (0.5 / weight if weight else 0.01):
            raise HTTPException(400, f"Only {share_left * weight:.0f} g of {d['name']} is left - check the weight of your portion" if weight
                                else f"Only {share_left * 100:.0f}% of {d['name']} is left")
        totals = _totals(d)
        vals = {k: _r(v * f) if v is not None else None for k, v in totals.items()}
        day = body.day or _today(c, user['id']).date()
        pos = c.execute('SELECT coalesce(max(position), 0) + 1 AS p FROM food_entries WHERE user_id = %s AND day = %s', (user['id'], day)).fetchone()['p']
        ref = {'dish_id': did, 'weight_g': weight, 'dish_kcal': totals['kcal']}
        # grams when the dish has a weight; otherwise "0.25 dish" (unit 'dish' moves eaten_share, see api_food._dish_grams)
        amount, unit = (round(grams, 1), 'g') if grams is not None else (round(f, 3), 'dish')
        entry = c.execute("""INSERT INTO food_entries (user_id, day, meal, name, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, source, ref, position)
                             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'dish', %s, %s)
                             RETURNING id, day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, source, ref""",
                          (user['id'], day, body.meal, d['name'], amount, unit, vals['kcal'], vals['protein_g'], vals['carbs_g'],
                           vals['fat_g'], vals['fiber_g'], json.dumps(ref), pos)).fetchone()
        c.execute(f"UPDATE dishes SET {'eaten_g' if unit == 'g' else 'eaten_share'} = {'eaten_g' if unit == 'g' else 'eaten_share'} + %s, updated = now() WHERE id = %s",
                  (amount, did))        # _seen above checked it's theirs or shared with them
        return {'entry': entry, 'dish': _view(c, user['id'], _seen(c, user['id'], did))}


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
        if not t: raise HTTPException(404, 'You can share a dish only with friends')
        if c.execute('SELECT count(*) AS n FROM dish_shares WHERE dish_id = %s', (did,)).fetchone()['n'] >= MAX_SHARES:
            raise HTTPException(400, f'A dish can be shared with up to {MAX_SHARES} people')
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


# ---------- saved recipes (2026-10-12): a dish the cook chose to keep, to cook again ----------
def _save_recipe(c, uid, d):
    if c.execute('SELECT count(*) AS n FROM recipes WHERE user_id = %s', (uid,)).fetchone()['n'] >= MAX_RECIPES:
        raise HTTPException(400, f'You can save up to {MAX_RECIPES} recipes - delete one first')
    rid = c.execute("""INSERT INTO recipes (user_id, name, items, known_kcal, known_protein_g, known_carbs_g, known_fat_g, ai_note, ai_note_at, cooked)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                    (uid, d['name'], json.dumps(d['items']), d['known_kcal'], d['known_protein_g'], d['known_carbs_g'], d['known_fat_g'],
                     d['ai_note'], d['ai_note_at'], d['created'])).fetchone()['id']
    c.execute('UPDATE dishes SET recipe_id = %s WHERE id = %s AND user_id = %s', (rid, d['id'], uid))
    return rid


def _recipe_out(r):
    t = _totals(r)
    return {'id': r['id'], 'name': r['name'], 'items': [i['name'] for i in r['items']], 'totals': t,
            'weight_g': round(sum(i.get('grams') or 0 for i in r['items']), 1) or None,
            'updated': r['updated'], 'cooked': r['cooked']}


RCOLS = 'id, name, items, known_kcal, known_protein_g, known_carbs_g, known_fat_g, ai_note, ai_note_at, updated, cooked'


@router.get('/recipes')
def recipes(user=Depends(current_user)):
    """Saved recipes, the ones cooked most recently first."""
    with db.connect() as c:
        rows = c.execute(f'SELECT {RCOLS} FROM recipes WHERE user_id = %s ORDER BY coalesce(cooked, updated) DESC, id DESC', (user['id'],)).fetchall()
        return [_recipe_out(r) for r in rows]


@router.post('/{did:int}/recipe')
def recipe_save(did: int, user=Depends(current_user)):
    """Save this dish as a recipe (already saved: nothing changes)."""
    with db.connect() as c:
        d = _get(c, user['id'], did, lock=True)
        if not d['items'] and d['known_kcal'] is None: raise HTTPException(400, 'Add what goes in first')
        if not d['recipe_id']: _save_recipe(c, user['id'], d)
        return _view(c, user['id'], _get(c, user['id'], did))


@router.delete('/{did:int}/recipe')
def recipe_unsave(did: int, user=Depends(current_user)):
    """Stop saving this dish: its recipe is deleted (the dish itself stays until it's finished)."""
    with db.connect() as c:
        d = _get(c, user['id'], did, lock=True)
        if d['recipe_id']: c.execute('DELETE FROM recipes WHERE id = %s AND user_id = %s', (d['recipe_id'], user['id']))
        return _view(c, user['id'], _get(c, user['id'], did))


@router.post('/recipes/{rid:int}/cook')
def recipe_cook(rid: int, body: DishIn, user=Depends(current_user)):
    """Cook it again: a new dish with the recipe's ingredients, linked to it so changes are saved back."""
    with db.connect() as c:
        r = c.execute(f'SELECT {RCOLS} FROM recipes WHERE id = %s AND user_id = %s', (rid, user['id'])).fetchone()
        if not r: raise HTTPException(404, 'Not found')
        meal = body.meal or _default_meal(_today(c, user['id']))
        items = [{**i, 'id': secrets.token_hex(4)} for i in r['items']]
        did = c.execute("""INSERT INTO dishes (user_id, name, meal, items, known_kcal, known_protein_g, known_carbs_g, known_fat_g, recipe_id,
                             ai_note, ai_note_at, recipe_updated) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, coalesce(%s, now())) RETURNING id""",
                        (user['id'], r['name'], meal, json.dumps(items), r['known_kcal'], r['known_protein_g'], r['known_carbs_g'], r['known_fat_g'],
                         rid, r['ai_note'], r['ai_note_at'], r['ai_note_at'])).fetchone()['id']
        c.execute('UPDATE recipes SET cooked = now() WHERE id = %s', (rid,))
        return _view(c, user['id'], _get(c, user['id'], did))


@router.delete('/recipes/{rid:int}')
def recipe_delete(rid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM recipes WHERE id = %s AND user_id = %s RETURNING id', (rid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}
