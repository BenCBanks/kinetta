"""Food log API: day view, entries (add/edit/move/copy/delete), food search (own foods, recent, Open Food Facts, USDA),
barcode lookup, custom foods, saved meals, weight + trend, nutrition targets.

Every personal query is limited to user['id']. Public food data (barcodes, search results) is cached in food_cache
(nothing personal in it). Open Food Facts asks for an identifying User-Agent and ~10 searches/min: we cache 30 days.
USDA FoodData Central needs a key: FDC_API_KEY setting (falls back to the low-volume DEMO_KEY).
"""
import datetime as dt
import json
from uuid import UUID
import os
import re
import threading
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, Field, StrictBool

from . import db, energy, nutrients as N
from .auth import current_user

router = APIRouter(prefix='/api/food')
UA = 'Kinetta/1.0 (self-hosted fitness app; +https://kinetta.app)'
MEALS = ('breakfast', 'lunch', 'dinner', 'snacks')
_last_off = [0.0]
_off_pace = threading.Lock()


def _get(url, timeout=6, body=None):
    headers = {'User-Agent': UA, 'Accept': 'application/json'}
    if body is not None: headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, headers=headers, data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _cached(key, fetch, days=30):
    with db.connect() as c:
        hit = c.execute("SELECT data FROM food_cache WHERE key = %s AND fetched > now() - make_interval(days => %s)", (key, days)).fetchone()
    if hit: return hit['data']
    data = fetch()
    if not data: return data          # never cache "nothing found" (could be a hiccup)
    with db.connect() as c:
        c.execute("""INSERT INTO food_cache (key, data) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET data = excluded.data, fetched = now()""",
                  (key, json.dumps(data)))
    return data


def _num(v):
    try: return round(float(v), 2)
    except (TypeError, ValueError): return None


# ---------- normalised food: per-100g values + serving, so amounts can be changed later ----------
def _sane(per100):
    """Catch bad database rows (2026-10-09): kilojoules stored as kcal, kcal that can't match the macros,
    missing kcal (computed from macros). Returns fixed values, or None to drop the food."""
    k, p, c, f = (per100.get(x) for x in ('kcal', 'protein_g', 'carbs_g', 'fat_g'))
    if any(v is not None and (v < 0 or v > 100) for v in (p, c, f)): return None       # grams per 100 g
    est = 4 * (p or 0) + 4 * (c or 0) + 9 * (f or 0) if None not in (p, c, f) else None
    if k is None:
        if est is None: return None
        per100 = {**per100, 'kcal': round(est)}
    elif k > 900:                       # nothing has more than ~900 kcal/100 g (pure fat): it was kJ
        if est is not None and abs(k / 4.184 - est) <= max(40, est * .25): per100 = {**per100, 'kcal': round(k / 4.184)}
        else: return None
    elif est is not None and est > 40 and not (est * .6 <= k <= est * 1.5):
        return None                    # kcal and macros disagree badly: one of them is wrong
    return per100


def _off_food(p):
    n = p.get('nutriments') or {}
    per100 = {'kcal': _num(n.get('energy-kcal_100g')) or (_num(n.get('energy_100g')) and round(_num(n.get('energy_100g')) / 4.184, 1)),
              'protein_g': _num(n.get('proteins_100g')), 'carbs_g': _num(n.get('carbohydrates_100g')),
              'fat_g': _num(n.get('fat_100g')), 'fiber_g': _num(n.get('fiber_100g')),**N.off_values(n)}
    per100 = _sane(per100)
    if not per100: return None
    sq = _num(p.get('serving_quantity'))
    return {'source': 'off', 'us': 'en:united-states' in (p.get('countries_tags') or []), 'id': p.get('code') or p.get('_id'), 'name': (p.get('product_name') or p.get('product_name_en') or '').strip() or 'Unnamed product',
            'brand': ((p.get('brands') if isinstance(p.get('brands'), str) else ','.join(p.get('brands') or [])) or '').split(',')[0].strip() or None, 'per100': per100,
            'serving': {'label': p.get('serving_size') or (f'{sq:g} g' if sq else '100 g'), 'g': sq or 100.0}}


FDC_IDS = {'kcal': (1008, '208'), 'protein_g': (1003, '203'), 'carbs_g': (1005, '205'), 'fat_g': (1004, '204'), 'fiber_g': (1079, '291')}


def _fdc_food(f):
    per100 = {k: None for k in FDC_IDS}
    for n in f.get('foodNutrients') or []:
        nid, num = n.get('nutrientId'), str(n.get('nutrientNumber') or '')
        for k, (i, code) in FDC_IDS.items():
            if nid == i or num == code:
                if k == 'kcal' and (n.get('unitName') or '').upper() == 'KJ': continue
                per100[k] = _num(n.get('value'))
        if per100['kcal'] is None and (nid in (2047, 2048) or num in ('957', '958')) and (n.get('unitName') or '').upper() == 'KCAL':
            per100['kcal'] = _num(n.get('value'))     # Foundation foods give Atwater energy instead of 1008
    per100.update(N.fdc_values(f.get('foodNutrients') or []))
    per100 = _sane(per100)
    if not per100: return None
    sg = _num(f.get('servingSize')) if (f.get('servingSizeUnit') or '').lower() in ('g', 'grm', 'ml', 'mlt') else None
    label = f.get('householdServingFullText') or (f'{sg:g} g' if sg else '100 g')
    return {'source': 'usda', 'generic': f.get('dataType') != 'Branded', 'id': str(f.get('fdcId')), 'name': (f.get('description') or '').strip().capitalize(),
            'brand': f.get('brandName') or f.get('brandOwner') or None, 'per100': per100, 'serving': {'label': label, 'g': sg or 100.0}}


def _search_off(q):
    def fetch():
        # Open Food Facts asks for ~10 searches a minute at most; we pace and cache
        with _off_pace:      # several lookups can run side by side; keep them spaced out
            wait = 6 - (time.time() - _last_off[0])
            if wait > 0: time.sleep(min(wait, 6))
            _last_off[0] = time.time()
        fields = 'code,product_name,brands,nutriments,serving_size,serving_quantity,countries_tags'
        try:
            d = _get('https://search.openfoodfacts.org/search?' + urllib.parse.urlencode({'q': q, 'page_size': 20, 'fields': fields}))
            items = d.get('hits') or []
            if items: return items
        except Exception:
            pass
        d = _get('https://world.openfoodfacts.org/cgi/search.pl?' + urllib.parse.urlencode(
            {'search_terms': q, 'search_simple': 1, 'action': 'process', 'json': 1, 'page_size': 20, 'fields': fields}))
        return d.get('products') or []
    try: foods = [f for f in (_off_food(p) for p in _cached('off2-search:' + q.lower(), fetch)) if f]
    except Exception: return []
    return sorted(foods, key=lambda f: (not f['us'], -_match(q, f['name'])))   # US products first, then best name match


def _search_usda(q):
    key = os.environ.get('FDC_API_KEY') or 'DEMO_KEY'
    def fetch():
        # Sent as JSON: the same filter in the address ("Survey (FNDDS)") was refused by about half of USDA's servers.
        d = _get('https://api.nal.usda.gov/fdc/v1/foods/search?' + urllib.parse.urlencode({'api_key': key}),
                 body={'query': q, 'pageSize': 25, 'dataType': ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded']})
        return d.get('foods') or []
    try: foods = [f for f in (_fdc_food(x) for x in _cached('usda2-search:' + q.lower(), fetch)) if f]
    except Exception: return []
    # plain foods ("Bananas, raw") before branded products that merely share a word ("Banana" peanut butter)
    return sorted(foods, key=lambda f: (-(_match(q, f['name']) + (1.5 if f['generic'] else 0)), not f['generic'], len(f['name'])))


def _match(q, name):
    """0..3: how well a food name matches the search words (all words present, starts with the first one)."""
    words, n = [w.rstrip('s') for w in q.lower().split()], name.lower()
    if not words: return 0
    hits = sum(1 for w in words if w and w in n)
    head = ' '.join(q.lower().split())
    plain = n == head or n.startswith(head + ',') or n.startswith(head + 's,')   # "Egg, whole" / "Bananas, raw": the food itself
    return (2 if hits == len(words) else 1 if hits else 0) + (1 if n.startswith(words[0]) else 0) + (1 if plain else 0)


def _custom_food(r):
    sg = r['serving_g']
    f = sg / 100 if sg else None
    per = lambda key: N.rounded(key,r.get(key)/f) if (f and r.get(key) is not None) else None
    return {'source': 'custom', 'origin': r.get('origin','manual'), 'origin_notes':r.get('origin_notes'),
            'origin_model':r.get('origin_model'), 'origin_ref':r.get('origin_ref'), 'origin_edited':r.get('origin_edited',False), 'id': r['id'], 'name': r['name'], 'brand': r['brand'], 'favorite': r['favorite'],
            'per_serving': {k:r.get(k) for k in N.ALL},
            'per100': {k:per(k) for k in N.ALL} if f else None,
            'serving': {'label': r['serving_label'], 'g': sg}}


@router.get('/search')
def search(q: str, sources: str = 'mine,off,usda', user=Depends(current_user)):
    q = q.strip()[:80]
    if len(q) < 2: return {'mine': [], 'recent': [], 'off': [], 'usda': []}
    want = set(sources.split(','))
    with db.connect() as c:
        mine = [_custom_food(r) for r in c.execute("""SELECT * FROM custom_foods WHERE user_id = %s AND (name ILIKE %s OR brand ILIKE %s)
                                                      ORDER BY favorite DESC, name LIMIT 15""", (user['id'], f'%{q}%', f'%{q}%')).fetchall()]
        recent = c.execute("""SELECT DISTINCT ON (lower(name)) name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, ref, source
                              FROM food_entries WHERE user_id = %s AND name ILIKE %s ORDER BY lower(name), created DESC LIMIT 10""",
                           (user['id'], f'%{q}%')).fetchall()
    return {'mine': mine if 'mine' in want else [], 'recent': recent if 'mine' in want else [],
            'off': _search_off(q) if 'off' in want else [], 'usda': _search_usda(q) if 'usda' in want else []}


@router.get('/barcode/{code}')
def barcode(code: str, user=Depends(current_user)):
    if not re.fullmatch(r'\d{6,14}', code): raise HTTPException(400, 'Barcodes are 6-14 digits')
    with db.connect() as c:
        mine = c.execute('SELECT * FROM custom_foods WHERE user_id = %s AND barcode = %s LIMIT 1', (user['id'], code)).fetchone()
    if mine: return _custom_food(mine)
    def fetch():
        d = _get(f'https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=code,product_name,brands,nutriments,serving_size,serving_quantity')
        return d.get('product') if d.get('status') in (1, 'success') else None
    try: p = _cached('off-code:' + code, fetch, days=60)
    except Exception: raise HTTPException(502, "Couldn't reach the food database - try again or add it by hand")
    f = _off_food(p) if p else None
    if not f: raise HTTPException(404, 'Not found in the food database - add it as your own food')
    return f


@router.get('/recent')
def recent(user=Depends(current_user)):
    """Foods logged most often in the last 60 days, for one-tap re-logging."""
    with db.connect() as c:
        return c.execute("""SELECT name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, ref, source, n
                            FROM (SELECT DISTINCT ON (lower(name)) *, count(*) OVER (PARTITION BY lower(name)) AS n
                                  FROM food_entries WHERE user_id = %s AND day > current_date - 60
                                  ORDER BY lower(name), created DESC) x ORDER BY created DESC LIMIT 25""", (user['id'],)).fetchall()


@router.get('/usual')
def usual(user=Depends(current_user)):
    """Foods logged 3+ times in the last 60 days, most often first, with the amount used last time (one-tap logging)."""
    with db.connect() as c:
        return c.execute("""SELECT name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, ref, source, meal, n
                            FROM (SELECT DISTINCT ON (lower(name)) *, count(*) OVER (PARTITION BY lower(name)) AS n
                                  FROM food_entries WHERE user_id = %s AND day > current_date - 60
                                  ORDER BY lower(name), created DESC) x WHERE n >= 3 ORDER BY n DESC, created DESC LIMIT 12""", (user['id'],)).fetchall()


# ---------- day + entries ----------
NUM = ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')


@router.get('/day')
def day(d: str | None = None, user=Depends(current_user)):
    with db.connect() as c:
        result=day_data(c, user['id'], d)
        result['has_history']=c.execute('SELECT EXISTS(SELECT 1 FROM food_entries WHERE user_id=%s) AS yes',(user['id'],)).fetchone()['yes']
        return result


def day_data(c, uid, d=None):
    try: day_ = dt.date.fromisoformat(d) if d else None
    except ValueError: raise HTTPException(400, 'Date must be YYYY-MM-DD')
    if day_ is None:
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        day_ = c.execute('SELECT (now() AT TIME ZONE %s)::date AS d', (tz,)).fetchone()['d']
    entries = c.execute("""SELECT id, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref
                           FROM food_entries WHERE user_id = %s AND day = %s ORDER BY position, id""", (uid, day_)).fetchall()
    t = c.execute('SELECT kcal_target, protein_target, carbs_target, fat_target, fiber_target, sodium_target_mg, sugar_target_g, saturated_fat_target_g FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}
    # exercise today vs a usual day (last 4 weeks): big training days get extra calories on top of the target
    ctx = energy.context(c, uid)
    ex = energy.exercise_by_day(c, uid, ctx['tz'], day_ - dt.timedelta(days=28), day_, ctx['kg'])
    w = c.execute('SELECT kg FROM weights WHERE user_id = %s AND day = %s', (uid, day_)).fetchone()
    today_ex = ex.get(day_) or {'kcal': 0, 'n': 0, 'estimated': False, 'items': []}
    usual = sum(v['kcal'] for d, v in ex.items() if d != day_) / 28
    burned = {**today_ex, 'kcal': round(today_ex['kcal']), 'usual': round(usual),
              'extra': max(0, min(1500, round((today_ex['kcal'] - usual) / 10) * 10))}
    totals = {k: round(sum((e[k] or 0) for e in entries), 1) for k in NUM}
    info = energy.tdee(c, uid)
    least = energy.full_day_min(c, uid, info['base'])
    over = energy.burn_overrides(c, uid, day_, day_).get(day_)
    resting = energy.resting_by_day(c, uid, ctx['tz'], day_, day_) if info['resting_source'] == 'apple_health' else {}
    burn = energy.burn_for_day(info, today_ex['kcal'], day_, resting, {day_: over} if over is not None else {})
    burned['day_burn'] = round(burn['total']) if burn['total'] is not None else None
    burned['source'] = burn['source']; burned['observed_at'] = burn['observed_at']; burned['synced_at'] = burn['synced_at']
    burned['missing'] = burn['total'] is None
    burned['imported'] = burn['source'] == 'imported'
    burned['deficit'] = round(burned['day_burn'] - totals['kcal']) if entries and burned['day_burn'] is not None else None
    burned['partly'] = bool(entries) and day_ < ctx['today'] and totals['kcal'] < least   # left out of averages and totals
    # burn breakdown: resting (BMR, needs height) + daily activity (the rest of the base) + exercise
    burned['base'] = burn['resting'] if burn['source'] == 'apple_health' else info['base']
    burned['bmr'] = burn['resting']; burned['bmr_exact'] = info['bmr_exact']
    burned['daily_life'] = 0 if burn['source'] == 'apple_health' else info['base'] - info['bmr']
    burned['activity'] = info['activity']
    burned['tdee_confidence'] = info['confidence']
    # the day's goal: a goal set for this date wins; otherwise the daily target + the training-day extra
    g = c.execute('SELECT kcal FROM day_goals WHERE user_id = %s AND day = %s', (uid, day_)).fetchone()
    default = t.get('kcal_target')
    # workouts deepen the deficit; they don't raise the goal
    goal = {'custom': round(g['kcal']) if g else None, 'default': round(default) if default else None, 'extra': 0}
    goal['kcal'] = goal['custom'] if g else (goal['default'] if default else None)
    goal['deficit'] = round(burned['day_burn'] - goal['kcal']) if goal['kcal'] is not None and burned['day_burn'] is not None else None
    last_meals = _last_meals(c, uid, day_)
    hours = c.execute("""SELECT extract(hour FROM created AT TIME ZONE %s)::int AS h, meal, count(*) AS n FROM food_entries
                           WHERE user_id = %s AND day > current_date - 60 AND day = (created AT TIME ZONE %s)::date
                           GROUP BY 1, 2""", (ctx['tz'], uid, ctx['tz'])).fetchall()
    meal_hours = {}
    for r in hours:   # most common meal logged (same day) in each hour, needs 3+ entries to count
        if r['n'] >= 3 and r['n'] > meal_hours.get(r['h'], (None, 0))[1]: meal_hours[r['h']] = (r['meal'], r['n'])
    return {'day': day_.isoformat(), 'entries': entries, 'totals': totals,
            'unknown_nutrients':{k:sum(e.get(k) is None or (isinstance((e.get('ref') or {}).get('unknown_nutrients'),list) and k in e['ref']['unknown_nutrients']) for e in entries) for k in NUM}, 'targets': t, 'burned': burned, 'goal': goal, 'weight_kg': w['kg'] if w else None,
            'extra_nutrients':N.day_values(entries,t),'last_meals': last_meals, 'meal_hours': {h: m for h, (m, _) in meal_hours.items()}}


def _last_meals(c, uid, day_):
    """For each meal: the most recent earlier day (last 14) it was logged, with its items, for "Same as Tuesday" re-logging."""
    rows = c.execute("""SELECT day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref
                         FROM food_entries f WHERE user_id = %s AND day < %s AND day >= %s::date - 14
                           AND day = (SELECT max(day) FROM food_entries g WHERE g.user_id = f.user_id AND g.meal = f.meal AND g.day < %s AND g.day >= %s::date - 14)
                         ORDER BY meal, position, id""", (uid, day_, day_, day_, day_)).fetchall()
    out = {}
    for r in rows:
        m = out.setdefault(r['meal'], {'day': r['day'].isoformat(), 'items': [], 'kcal': 0})
        r = dict(r); r.pop('day'); r.pop('meal'); m['items'].append(r); m['kcal'] = round(m['kcal'] + r['kcal'])
    return out


class EntryIn(N.ExtraValues):
    day: dt.date
    meal: str = Field('snacks', pattern='^(breakfast|lunch|dinner|snacks)$')
    name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(None, max_length=120)
    amount: float = Field(1, gt=0, le=100000)
    unit: str = Field('serving', max_length=40)
    kcal: float = Field(0, ge=0, le=20000)
    protein_g: float = Field(0, ge=0, le=2000)
    carbs_g: float = Field(0, ge=0, le=2000)
    fat_g: float = Field(0, ge=0, le=2000)
    fiber_g: float | None = Field(None, ge=0, le=1000)
    source: str = Field('quick', max_length=20)
    ref: dict | None = None
    client_id: str | None = Field(None, pattern=r'^[A-Za-z0-9-]{8,64}$')   # set by a phone that logged offline: resends are ignored


@router.post('/entries')
def add_entries(items: list[EntryIn], user=Depends(current_user), thread: bool = False, captured_at: AwareDatetime | None = None, restore_from: int | None = Query(None,gt=0)):
    if not 1 <= len(items) <= 100: raise HTTPException(400, '1-100 items')
    if restore_from is not None and (thread or len(items)!=1):raise HTTPException(422,'Restore one food without creating a new chat card')
    ids = []; messages = []
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        from . import food_thread_receipts as receipts
        for e in items:
            if thread:receipts.guard(c,user['id'],e.client_id)
            if e.ref is not None and isinstance(e.ref.get('unknown_nutrients'),list):
                missing={k for k in e.ref['unknown_nutrients'] if isinstance(k,str)}
                for k in N.EXTRA:
                    if k in e.model_fields_set:
                        if getattr(e,k) is None:missing.add(k)
                        else:missing.discard(k)
                e.ref={**e.ref,'unknown_nutrients':sorted(missing)}
            pos = c.execute('SELECT coalesce(max(position), 0) + 1 AS p FROM food_entries WHERE user_id = %s AND day = %s', (user['id'], e.day)).fetchone()['p']
            r = c.execute("""INSERT INTO food_entries (user_id, day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref, position, client_id)
                             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                             ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id""",
                          (user['id'], e.day, e.meal, e.name.strip(), e.brand, e.amount, e.unit, e.kcal, e.protein_g, e.carbs_g, e.fat_g,
                           e.fiber_g, e.sodium_mg,e.sugar_g,e.saturated_fat_g,e.source, json.dumps(e.ref) if e.ref else None, pos, e.client_id)).fetchone()
            if r is None:   # already received (offline resend)
                r = c.execute('SELECT id FROM food_entries WHERE user_id = %s AND client_id = %s', (user['id'], e.client_id)).fetchone()
            ids.append(r['id'])
        if thread:messages=receipts.create(c,user['id'],ids,captured_at)
        elif restore_from is not None:messages=receipts.restore(c,user['id'],restore_from,ids[0])
    return {'ids':ids,**({'messages':messages} if thread or restore_from is not None else {})}


class EntryEdit(N.ExtraValues):
    day: dt.date | None = None
    meal: str | None = Field(None, pattern='^(breakfast|lunch|dinner|snacks)$')
    name: str | None = Field(None, min_length=1, max_length=200)
    amount: float | None = Field(None, gt=0, le=100000)
    unit: str | None = Field(None, max_length=40)
    kcal: float | None = Field(None, ge=0, le=20000)
    protein_g: float | None = Field(None, ge=0, le=2000)
    carbs_g: float | None = Field(None, ge=0, le=2000)
    fat_g: float | None = Field(None, ge=0, le=2000)
    fiber_g: float | None = Field(None, ge=0, le=1000)


@router.patch('/entries/{eid}')
def edit_entry(eid: int, body: EntryEdit, user=Depends(current_user)):
    vals = body.model_dump(exclude_unset=True)
    if not vals: return {'ok': True}
    with db.connect() as c:
        old=c.execute('SELECT ref,source,amount,unit,sodium_mg,sugar_g,saturated_fat_g FROM food_entries WHERE id=%s AND user_id=%s FOR UPDATE',(eid,user['id'])).fetchone()
        if not old:raise HTTPException(404,'Not found')
        ref=dict(old['ref'] or {})
        missing={k for k in ref['unknown_nutrients'] if isinstance(k,str)} if isinstance(ref.get('unknown_nutrients'),list) else set()
        if ('amount' in vals and vals['amount'] is not None and vals['amount']!=old['amount']) or ('unit' in vals and vals['unit'] is not None and vals['unit']!=old['unit']):
            same_unit=vals.get('unit',old['unit'])==old['unit']
            for key in N.EXTRA:
                maximum=N.ENTRY_MAX[key]
                if key not in vals:
                    value=old[key]*vals.get('amount',old['amount'])/old['amount'] if same_unit and old['amount'] and old[key] is not None and key not in missing else None
                    if not same_unit:
                        unit=vals.get('unit',old['unit']);amount=vals.get('amount',old['amount'])
                        source=ref.get('per100') if unit=='g' else ref.get('per_serving') if unit=='serving' else None
                        if amount is None or unit is None:raise HTTPException(422,'Keep a value for the amount and unit')
                        reference=N.number(source.get(key),N.PER100_MAX[key] if unit=='g' else N.ENTRY_MAX[key]) if isinstance(source,dict) else None
                        if reference is not None:value=reference*amount/(100 if unit=='g' else 1)
                    if value is not None and value>maximum:raise HTTPException(422,'That portion is too large. Check the amount and nutrient values.')
                    vals[key]=value
        for key,value in list(vals.items()):
            if value is None:
                if key not in N.ALL or key=='kcal':raise HTTPException(422,'Keep a value for calories and the food’s name, amount and destination')
                missing.add(key)
                if key not in ('fiber_g',*N.EXTRA):vals[key]=0
            elif key in N.ALL:missing.discard(key)
        if missing or 'unknown_nutrients' in ref:ref['unknown_nutrients']=sorted(missing)
        if (old['source']=='ai' or ref.get('origin')=='ai') and set(vals)&{'name','amount','unit',*N.ALL}:ref['origin_edited']=True
        c.execute(f"UPDATE food_entries SET {', '.join(f'{k} = %s' for k in vals)},ref=%s,updated=now() WHERE id=%s AND user_id=%s",
                  (*vals.values(),json.dumps(ref),eid,user['id']))
    return {'ok': True}


@router.delete('/entries/{eid}')
def delete_entry(eid: int, user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute("""DELETE FROM food_entries WHERE id = %s AND user_id = %s
                         RETURNING day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref""", (eid, user['id'])).fetchone()
    if not r: raise HTTPException(404, 'Not found')
    return {'deleted': r}     # the phone keeps this for Undo


class CopyIn(BaseModel):
    from_day: dt.date
    to_day: dt.date
    meal: str | None = Field(None, pattern='^(breakfast|lunch|dinner|snacks)$')
    to_meal: str | None = Field(None, pattern='^(breakfast|lunch|dinner|snacks)$')


@router.post('/copy')
def copy(body: CopyIn, user=Depends(current_user)):
    with db.connect() as c:
        n = c.execute("""INSERT INTO food_entries (user_id, day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref, position)
                         SELECT user_id, %s, coalesce(%s, meal), name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref, position + 1000
                         FROM food_entries WHERE user_id = %s AND day = %s AND (%s::text IS NULL OR meal = %s)""",
                      (body.to_day, body.to_meal, user['id'], body.from_day, body.meal, body.meal)).rowcount
    return {'copied': n}


# ---------- custom foods + saved meals ----------
class FoodIn(N.ExtraValues):
    name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(None, max_length=120)
    barcode: str | None = Field(None, pattern=r'^\d{6,14}$')
    serving_label: str = Field('1 serving', max_length=60)
    serving_g: float | None = Field(None, gt=0, le=10000)
    kcal: float = Field(0, ge=0, le=20000)
    protein_g: float = Field(0, ge=0, le=2000)
    carbs_g: float = Field(0, ge=0, le=2000)
    fat_g: float = Field(0, ge=0, le=2000)
    fiber_g: float | None = Field(None, ge=0, le=1000)
    favorite: bool = False


@router.get('/foods')
def foods(user=Depends(current_user)):
    with db.connect() as c:
        return [_custom_food(r) for r in c.execute('SELECT * FROM custom_foods WHERE user_id = %s ORDER BY favorite DESC, name', (user['id'],)).fetchall()]


@router.post('/foods')
def food_add(body: FoodIn, user=Depends(current_user)):
    v = body.model_dump()
    with db.connect() as c:
        return {'id': c.execute(f"INSERT INTO custom_foods (user_id, {', '.join(v)}) VALUES (%s, {', '.join(['%s'] * len(v))}) RETURNING id",
                                (user['id'], *v.values())).fetchone()['id']}


@router.put('/foods/{fid}')
def food_edit(fid: int, body: FoodIn, user=Depends(current_user)):
    v = body.model_dump()
    for key in N.EXTRA:
        if key not in body.model_fields_set:v.pop(key)
    with db.connect() as c:
        old=c.execute('SELECT * FROM custom_foods WHERE id=%s AND user_id=%s FOR UPDATE',(fid,user['id'])).fetchone()
        if not old:raise HTTPException(404,'Not found')
        if body.serving_g!=old['serving_g']:
            for key in N.EXTRA:
                if key not in body.model_fields_set:
                    value=old.get(key)*body.serving_g/old['serving_g'] if old.get(key) is not None and old['serving_g'] and body.serving_g else None
                    if value is not None and value>N.ENTRY_MAX[key]:raise HTTPException(422,'That serving is too large. Check the weight and nutrients.')
                    v[key]=N.rounded(key,value)
        if not c.execute(f"UPDATE custom_foods SET {', '.join(f'{k} = %s' for k in v)}, origin_edited=(origin='ai' OR origin_edited) WHERE id = %s AND user_id = %s RETURNING id",
                         (*v.values(), fid, user['id'])).fetchone(): raise HTTPException(404, 'Not found')
    return {'ok': True}


@router.delete('/foods/{fid}')
def food_delete(fid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM custom_foods WHERE id = %s AND user_id = %s RETURNING id', (fid, user['id'])).fetchone(): raise HTTPException(404, 'Not found')
    return {'ok': True}


class MealIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    from_day: dt.date | None = None
    meal: str | None = Field(None, pattern='^(breakfast|lunch|dinner|snacks)$')
    entry_ids: list[int] | None = None


@router.get('/meals')
def meals(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute('SELECT id, name, items, ai_note, ai_note_at FROM saved_meals WHERE user_id = %s ORDER BY name', (user['id'],)).fetchall()
    for r in rows:
        r['totals'] = {k: round(sum((i.get(k) or 0) for i in r['items']), 1) for k in NUM}
        note, at = r.pop('ai_note'), r.pop('ai_note_at')        # AI feedback on the meal (food_coach.py), if asked for
        r['review'] = {**json.loads(note), 'at': at} if note else None
    return rows


@router.post('/meals')
def meal_save(body: MealIn, user=Depends(current_user)):
    """Save a meal from today's entries (a whole meal, or chosen entries)."""
    with db.connect() as c:
        if body.entry_ids:
            rows = c.execute("""SELECT name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref FROM food_entries
                                WHERE user_id = %s AND id = ANY(%s) ORDER BY position""", (user['id'], body.entry_ids)).fetchall()
        else:
            rows = c.execute("""SELECT name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref FROM food_entries
                                WHERE user_id = %s AND day = %s AND meal = %s ORDER BY position""", (user['id'], body.from_day, body.meal)).fetchall()
        if not rows: raise HTTPException(400, 'Nothing to save')
        return {'id': c.execute('INSERT INTO saved_meals (user_id, name, items) VALUES (%s, %s, %s) RETURNING id',
                                (user['id'], body.name, json.dumps(rows, default=str))).fetchone()['id']}


@router.delete('/meals/{mid}')
def meal_delete(mid: int, user=Depends(current_user)):
    with db.connect() as c:
        if not c.execute('DELETE FROM saved_meals WHERE id = %s AND user_id = %s RETURNING id', (mid, user['id'])).fetchone(): raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- weight + targets ----------
class WeightIn(BaseModel):
    day: dt.date
    kg: float = Field(gt=20, lt=400)
    note: str | None = Field(None, max_length=200)


@router.get('/weights')
def weights(days: int = 180, user=Depends(current_user)):
    """Weigh-ins plus a smoothed trend (exponential average, 10 % per day, like Happy Scale / MacroFactor) and the weekly rate."""
    with db.connect() as c:
        rows = c.execute('SELECT day, kg, note, source, source_name FROM weights WHERE user_id = %s ORDER BY day', (user['id'],)).fetchall()
    trend, out, prev_day = None, [], None
    for r in rows:
        if trend is None: trend = r['kg']
        else:
            gap = (r['day'] - prev_day).days
            a = 1 - 0.9 ** max(gap, 1)
            trend += a * (r['kg'] - trend)
        prev_day = r['day']
        out.append({'day': r['day'].isoformat(), 'kg': r['kg'], 'trend': round(trend, 2), 'note': r['note'],'source':r['source'] or 'manual','source_label':('Apple Health'+(' · '+r['source_name'] if r['source_name'] and r['source_name']!='Apple Health' else '')) if r['source']=='healthkit' else 'Manual' if not r['source'] else 'Imported'})
    cut = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    out = [x for x in out if x['day'] >= cut]
    rate = None
    if len(out) >= 2:
        span = (dt.date.fromisoformat(out[-1]['day']) - dt.date.fromisoformat(out[max(0, len(out) - 15)]['day'])).days
        if span >= 7: rate = round((out[-1]['trend'] - out[max(0, len(out) - 15)]['trend']) / span * 7, 2)
    return {'points': out, 'trend_kg': out[-1]['trend'] if out else None, 'rate_kg_per_week': rate}


@router.get('/weights/latest')
def latest_weight(user=Depends(current_user)):
    """Small, owner-bound prefill read; no full weight history on opening a sheet."""
    with db.connect() as c:
        row = c.execute('SELECT day, kg, note FROM weights WHERE user_id = %s ORDER BY day DESC LIMIT 1', (user['id'],)).fetchone()
    return {'points': [row] if row else []}


@router.put('/weights')
def weight_set(body: WeightIn, user=Depends(current_user)):
    if body.day > dt.date.today() + dt.timedelta(days=1): raise HTTPException(400, "That day hasn't happened yet")
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        from . import api_health_weights as H
        p=H.profile(c,user['id'])
        H.lift_exclusion(c,user['id'],body.day,p['tz'] or db.DEFAULT_TZ)
        c.execute("""INSERT INTO weights (user_id, day, kg, note) VALUES (%s, %s, %s, %s)
                     ON CONFLICT (user_id, day) DO UPDATE SET kg = excluded.kg, note = excluded.note, source = NULL,health_sample_id=NULL,source_name=NULL""", (user['id'], body.day, body.kg, body.note))
        _latest_weight(c, user['id'])
    return {'ok': True}


def _latest_weight(c,uid):
    """Newest daily point drives formulas; source provenance also guards AI use."""
    row=c.execute('SELECT kg,source FROM weights WHERE user_id=%s ORDER BY day DESC LIMIT 1',(uid,)).fetchone()
    if row:c.execute('UPDATE profile SET weight_kg=%s,weight_health_derived=%s WHERE user_id=%s',(row['kg'],row['source']=='healthkit',uid))
    else:c.execute('UPDATE profile SET weight_kg=CASE WHEN weight_health_derived THEN NULL ELSE weight_kg END,weight_health_derived=false WHERE user_id=%s',(uid,))


@router.delete('/weights/{day}')
def weight_delete(day: dt.date, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        from . import api_health_weights as H
        p=H.profile(c,user['id'])
        old=c.execute('SELECT source,health_sample_id FROM weights WHERE user_id=%s AND day=%s',(user['id'],day)).fetchone()
        if p['health_weight_read']:
            c.execute('INSERT INTO health_weight_exclusions(user_id,day) VALUES(%s,%s) ON CONFLICT(user_id,day) DO UPDATE SET before_time=greatest(health_weight_exclusions.before_time,excluded.before_time)',(user['id'],day))
            if old and old['source']=='healthkit':
                c.execute('UPDATE health_weight_samples SET excluded=true WHERE user_id=%s AND (sampled_at AT TIME ZONE %s)::date=%s',(user['id'],p['tz'] or db.DEFAULT_TZ,day))
        c.execute('DELETE FROM weights WHERE user_id = %s AND day = %s', (user['id'], day))
        _latest_weight(c, user['id'])
    return {'ok': True}


class TargetsIn(N.ExtraTargets):
    kcal_target: float | None = Field(None, ge=0, le=10000)
    protein_target: float | None = Field(None, ge=0, le=1000)
    carbs_target: float | None = Field(None, ge=0, le=2000)
    fat_target: float | None = Field(None, ge=0, le=1000)
    fiber_target: float | None = Field(None, ge=0, le=300)


class GoalSetupIn(BaseModel):
    goal: str = Field(pattern='^(lose_weight|maintain|build_muscle|eat_healthier|fuel_training)$')
    pace_percent: float = Field(0, ge=0, le=1, allow_inf_nan=False)
    # Only supplied body fields are changed, and only by the explicit save endpoint.
    weight_kg: float | None = Field(None, ge=25, le=300, allow_inf_nan=False)
    height_cm: float | None = Field(None, ge=100, le=250, allow_inf_nan=False)
    birth_year: int | None = Field(None, ge=1920, le=2020)
    sex: str | None = Field(None, pattern='^(male|female)$')
    activity_factor: float | None = Field(None, allow_inf_nan=False)


class GoalSaveIn(GoalSetupIn):
    kcal_target: float = Field(ge=1, le=10000, allow_inf_nan=False)
    protein_target: float = Field(ge=1, le=1000, allow_inf_nan=False)


def _goal_preview(c, uid, body):
    profile = c.execute('SELECT weight_kg, height_cm, birth_year, sex, activity_factor FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}
    values = body.model_dump(exclude_unset=True)
    for key in ('weight_kg', 'height_cm', 'birth_year', 'sex'):
        if key in values: profile[key] = values[key]
    if body.activity_factor is not None: profile['activity_factor'] = body.activity_factor
    if 'weight_kg' not in values:
        rows = c.execute('SELECT day, kg FROM weights WHERE user_id = %s ORDER BY day', (uid,)).fetchall()
        if rows: profile['weight_kg'] = energy.weight_trend(rows)[-1][2]
    try:
        return energy.target_suggestion(profile, body.goal, body.pace_percent, dt.datetime.now(dt.timezone.utc).year)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post('/target-suggestion')
def target_suggestion(body: GoalSetupIn, user=Depends(current_user)):
    with db.connect() as c:
        return _goal_preview(c, user['id'], body)


@router.put('/goal-setup')
def goal_setup(body: GoalSaveIn, user=Depends(current_user)):
    with db.connect() as c:
        # One transaction; serializes with source/body changes. No partial target/body save on failure.
        c.execute('SELECT user_id FROM profile WHERE user_id = %s FOR UPDATE', (user['id'],))
        suggestion = _goal_preview(c, user['id'], body)
        if body.kcal_target < suggestion['resting_floor']:
            raise HTTPException(400, f"Choose at least {suggestion['resting_floor']} kcal, your estimated resting burn.")
        values = body.model_dump(exclude_unset=True, exclude={'goal', 'pace_percent'})
        values.update(nutrition_goal=body.goal, goal_pace_percent=suggestion['pace_percent'])
        if body.activity_factor is not None: values['activity_factor'] = suggestion['activity_factor']
        else: values.pop('activity_factor', None)
        c.execute(f"UPDATE profile SET {', '.join(f'{key} = %s' for key in values)} WHERE user_id = %s", (*values.values(), user['id']))
    return {'ok': True, 'profile': values}


@router.put('/targets')
def targets(body: TargetsIn, user=Depends(current_user)):
    v = body.model_dump(exclude_unset=True)
    if not v:return {'ok':True}
    with db.connect() as c:
        c.execute(f"UPDATE profile SET {', '.join(f'{k} = %s' for k in v)} WHERE user_id = %s", (*v.values(), user['id']))
    return {'ok': True}


@router.get('/history')
def history(days: int = 30, user=Depends(current_user)):
    """Daily totals for the trend view (calories + macros per day)."""
    days = max(7, min(days, 365))
    with db.connect() as c:
        return c.execute("""SELECT day, round(sum(kcal)::numeric) AS kcal, round(sum(protein_g)::numeric) AS protein_g,
                              round(sum(carbs_g)::numeric) AS carbs_g, round(sum(fat_g)::numeric) AS fat_g, count(*) AS n
                            FROM food_entries e, profile p WHERE e.user_id = %s AND p.user_id = e.user_id
                              AND day > (now() AT TIME ZONE p.tz)::date - %s AND day <= (now() AT TIME ZONE p.tz)::date
                            GROUP BY day ORDER BY day""", (user['id'], days)).fetchall()


# ---------- energy needs + weekly food trends (2026-10-09) ----------
@router.get('/energy')
def energy_needs(user=Depends(current_user)):
    """Adaptive daily calorie needs (TDEE) from the last 4 weeks of food + weight trend; see energy.py."""
    with db.connect() as c:
        return energy.tdee(c, user['id'])


@router.get('/weeks')
def food_weeks(weeks: int = 26, user=Depends(current_user)):
    """Per week (Mon-Sun): days logged, average calories/macros on logged days, exercise kcal per day,
    weight trend at the end of the week, miles/km run+ridden+walked."""
    weeks = max(4, min(weeks, 104))
    with db.connect() as c:
        ctx = energy.context(c, user['id'])
        monday = ctx['today'] - dt.timedelta(days=ctx['today'].weekday())
        start = monday - dt.timedelta(weeks=weeks - 1)
        food = c.execute("""SELECT date_trunc('week', day)::date AS wk, count(DISTINCT day) AS days, sum(kcal) AS kcal, sum(protein_g) AS protein_g,
                                   sum(carbs_g) AS carbs_g, sum(fat_g) AS fat_g, sum(coalesce(fiber_g, 0)) AS fiber_g
                            FROM food_entries WHERE user_id = %s AND day >= %s GROUP BY 1""", (user['id'], start)).fetchall()
        dist = c.execute("""SELECT date_trunc('week', start_time AT TIME ZONE %s)::date AS wk, sum(distance_m) AS d
                            FROM activities WHERE user_id = %s AND start_time AT TIME ZONE %s >= %s GROUP BY 1""",
                         (ctx['tz'], user['id'], ctx['tz'], start)).fetchall()
        ex = energy.exercise_by_day(c, user['id'], ctx['tz'], start, ctx['today'], ctx['kg'])
    F = {r['wk']: r for r in food}; D = {r['wk']: float(r['d'] or 0) for r in dist}
    out = []
    for i in range(weeks):
        wk = start + dt.timedelta(weeks=i)
        f = F.get(wk); n = f['days'] if f else 0
        elapsed = min(7, (ctx['today'] - wk).days + 1)
        exk = sum(v['kcal'] for d, v in ex.items() if wk <= d < wk + dt.timedelta(days=7))
        out.append({'week': wk.isoformat(), 'days_logged': n, 'partial': elapsed < 7,
                    **{k: round(float(f[k]) / n, 1) if n else None for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')},
                    'exercise_per_day': round(exk / elapsed), 'distance_m': round(D.get(wk, 0)),
                    'trend_kg': round(energy.trend_on(ctx['points'], wk + dt.timedelta(days=6)), 2) if energy.trend_on(ctx['points'], wk + dt.timedelta(days=6)) else None})
    return {'weeks': out}


@router.get('/deficit')
def deficit(user=Depends(current_user)):
    """Daily + running calorie deficit since profile.deficit_start (or the first day with food); see energy.deficits."""
    with db.connect() as c:
        start = (c.execute('SELECT deficit_start FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('deficit_start')
        return energy.deficits(c, user['id'], start)


class DeficitStartIn(BaseModel):
    since: dt.date | None = None


@router.put('/deficit/start')
def deficit_start(body: DeficitStartIn, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('UPDATE profile SET deficit_start = %s WHERE user_id = %s', (body.since, user['id']))
    return {'ok': True}


class DayGoalIn(BaseModel):
    day: dt.date
    kcal: float | None = Field(None, ge=0, le=10000)     # None = back to the daily target


@router.put('/day-goal')
def day_goal(body: DayGoalIn, user=Depends(current_user)):
    with db.connect() as c:
        if body.kcal is None: c.execute('DELETE FROM day_goals WHERE user_id = %s AND day = %s', (user['id'], body.day))
        else: c.execute("""INSERT INTO day_goals (user_id, day, kcal) VALUES (%s, %s, %s)
                           ON CONFLICT (user_id, day) DO UPDATE SET kcal = excluded.kcal""", (user['id'], body.day, body.kcal))
    return {'ok': True}


# Weekly check-in reads are code only; only the explicit Accept endpoint changes a calorie target.
class CheckinAcceptIn(BaseModel):
    model_config = {'extra':'forbid'}
    baseline: str = Field(pattern=r'^[0-9a-f]{64}$')
    confirmed: StrictBool


@router.get('/check-in')
def weekly_checkin(user=Depends(current_user)):
    from . import nutrition_checkin
    return nutrition_checkin.current(user['id'])


@router.post('/check-in/{cid}/accept')
def accept_checkin(cid:UUID,body:CheckinAcceptIn,user=Depends(current_user)):
    from . import nutrition_checkin
    if body.confirmed is not True:raise HTTPException(400,'Tap Accept to change your calorie target')
    return nutrition_checkin.act(user['id'],cid,'accept',body.baseline)


@router.post('/check-in/{cid}/later')
def defer_checkin(cid:UUID,user=Depends(current_user)):
    from . import nutrition_checkin
    return nutrition_checkin.act(user['id'],cid,'later')
