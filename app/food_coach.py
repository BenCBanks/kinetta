"""AI feedback on food (2026-10-11): a review of the last two weeks of eating, and feedback on a recipe (a cooking-mode
dish, or a saved meal). Same rules as the coach (coach.py): off until the server has an AI key AND the person turned AI features on;
only that person's own numbers are sent; Apple Health workouts only with their OK (the review includes exercise).

The model answers in a small JSON shape so the app can lay it out (a headline, what's going well, what to try); anything
else it says is kept as plain text. Reviews are kept: the diet review in coach_notes (kind 'diet', one per day), the
recipe feedback on the dish or saved meal (ai_note), so opening the page again costs nothing.
"""
import datetime as dt
import json
import re

from fastapi import APIRouter, Depends, HTTPException

from . import coach, db, energy
from .api_dishes import _seen, _totals, _weight
from .auth import current_user

router = APIRouter(prefix='/api')
DAYS = 14
DAILY_LIMIT = 20            # diet reviews + recipe feedback per person per day
AGAIN_AFTER = 10            # minutes before the same review can be written again

DIET_SYSTEM = """You are a practical registered-dietitian-style coach for someone who also trains (running, cycling,
walking). You get their last two weeks of food log as JSON: daily totals, their targets, calories burned (resting +
workouts, an estimate), the foods they eat most, how calories split across meals, and their weight trend.
Answer with JSON only, no code fences:
{"headline": one sentence (max 20 words) summing up how their eating is going,
 "going_well": 2 short points (max 25 words each) of what they are doing well, specific to their numbers and foods,
 "try_next": 2-3 short, concrete changes for next week (max 30 words each), naming real foods from their log where it helps
   (a swap, an addition, a timing change around workouts), each with the reason in a few words,
 "watch": one short caution if something matters (very low intake on training days, protein well under target, a big
   gap between logged and burned that the weight trend doesn't show) - or null}
Use their units (given as "units"; kcal and grams for food). Only use the numbers given; if days are missing or partly
logged, say so instead of guessing. Never shame, never suggest very low calorie diets, no medical diagnoses; suggest a
doctor or dietitian only for clear warning signs.
""" + coach.STYLE

RECIPE_SYSTEM = """You are a chef and sports-nutrition coach. You get one home-cooked dish as JSON: its
ingredients with weights and nutrition, the whole dish's totals, its cooked weight and a typical portion if known.
Several people may read your answer, so don't refer to anyone's personal goals. Answer with JSON only, no code fences:
{"summary": 1-2 sentences on the dish as a meal for someone who trains: calories and protein per typical portion (work it
   out from the numbers; say which portion size you used), and what it does well,
 "ideas": 2-4 specific tweaks, each {"change": what to do with real amounts (max 20 words), "effect": what it does to the
   dish, with rough numbers per portion when you can (max 20 words)} - for example a swap that adds protein, cuts fat
   without losing flavour, or adds fibre and vegetables,
 "note": one short line if an ingredient's numbers look wrong (for example oil weighed as far too much or too little), or null}
Only use the numbers given. Practical, not cheerleading. No medical claims.\n""" + coach.STYLE


def _ask(ctx, system):
    text = coach._gemini(ctx, system) if coach.provider() == 'gemini' else coach._claude(ctx, system)
    if not text: raise ValueError('Kit returned an empty answer.')
    return _parse(text)


def _parse(text):
    """The model's JSON, cleaned; plain text kept as {'text': ...} if it isn't JSON."""
    t = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    try: d = json.loads(t[t.index('{'):t.rindex('}') + 1])
    except (ValueError, json.JSONDecodeError): return {'text': text.strip()[:2000]}
    if not isinstance(d, dict): return {'text': text.strip()[:2000]}
    s = lambda v, n=400: v.strip()[:n] if isinstance(v, str) and v.strip() else None
    out = {k: s(d.get(k)) for k in ('headline', 'summary', 'watch', 'note')}
    lst = lambda k, n: d.get(k)[:n] if isinstance(d.get(k), list) else []
    out['going_well'] = [x for x in (s(v) for v in lst('going_well', 3)) if x]
    out['try_next'] = [x for x in (s(v) for v in lst('try_next', 4)) if x]
    out['ideas'] = [{'change': s(i.get('change'), 200), 'effect': s(i.get('effect'), 200)} for i in lst('ideas', 4)
                    if isinstance(i, dict) and s(i.get('change'), 200)]
    return {k: v for k, v in out.items() if v}


def _check(c, user_id, kind, health=False):
    """Consent and the daily limit. Each request is written down (ai_requests) before the model is asked, under a lock
    on the person's profile row, so parallel requests or asking again can't get past the limit."""
    if not coach.enabled(): raise HTTPException(400, 'Kit is not switched on yet (needs an AI key on the server).')
    from . import ai_access
    ai_access.require(user_id, 'coach', c)
    if not coach.allowed(user_id, connection=c): raise HTTPException(400, coach.off())
    if health and not coach.health_ok(c, user_id): raise HTTPException(400, coach.HEALTH_NO)
    c.execute('SELECT 1 FROM profile WHERE user_id = %s FOR UPDATE', (user_id,))
    n = c.execute("SELECT count(*) AS n FROM ai_requests WHERE user_id = %s AND created > now() - interval '1 day'", (user_id,)).fetchone()['n']
    if n >= DAILY_LIMIT: raise HTTPException(429, 'Daily limit for food feedback reached - try again tomorrow.')
    c.execute('INSERT INTO ai_requests (user_id, kind) VALUES (%s, %s)', (user_id, kind))


# ---------- the last two weeks of eating ----------
def _diet_context(c, user_id):
    p = c.execute("""SELECT units, sex, birth_year, height_cm, kcal_target, protein_target, carbs_target, fat_target, fiber_target
                     FROM profile WHERE user_id = %s""", (user_id,)).fetchone() or {}
    today = energy.context(c, user_id)['today']
    start = today - dt.timedelta(days=DAYS)
    d = energy.deficits(c, user_id, since=start)
    days = c.execute("""SELECT day, round(sum(kcal)) AS kcal, round(sum(protein_g)) AS protein_g, round(sum(carbs_g)) AS carbs_g,
                          round(sum(fat_g)) AS fat_g, round(sum(fiber_g)) AS fiber_g, count(*) AS items
                        FROM food_entries WHERE user_id = %s AND day >= %s GROUP BY day ORDER BY day""", (user_id, start)).fetchall()
    burn = {x['day']: x for x in d.get('days', [])}
    for r in days:
        b = burn.get(r['day'].isoformat()) or {}
        r.update(burned=b.get('burned'), exercise=b.get('exercise'), partly_logged=b.get('skipped'), today=b.get('today'))
    top = c.execute("""SELECT lower(name) AS food, count(*) AS times, round(avg(kcal)) AS avg_kcal, round(avg(protein_g)) AS avg_protein_g,
                         mode() WITHIN GROUP (ORDER BY meal) AS usual_meal
                       FROM food_entries WHERE user_id = %s AND day >= %s GROUP BY lower(name) ORDER BY count(*) DESC, sum(kcal) DESC LIMIT 15""",
                    (user_id, start)).fetchall()
    meals = c.execute("""SELECT meal, round(sum(kcal) / greatest(count(DISTINCT day), 1)) AS avg_kcal_on_days_logged
                         FROM food_entries WHERE user_id = %s AND day >= %s GROUP BY meal""", (user_id, start)).fetchall()
    w = c.execute('SELECT day, kg FROM weights WHERE user_id = %s AND day >= %s ORDER BY day', (user_id, start - dt.timedelta(days=14))).fetchall()
    age = today.year - p['birth_year'] if p.get('birth_year') else None
    return {'units': p.get('units', 'imperial'), 'today': today, 'person': {'sex': p.get('sex'), 'age': age, 'height_cm': p.get('height_cm')},
            'targets': {k: v for k, v in p.items() if k.endswith('_target') and v}, 'days': days, 'most_eaten': top, 'meals': meals,
            'weights_kg': w, 'deficit_summary': {k: d.get(k) for k in ('avg_deficit', 'counted_days', 'predicted_kg', 'trend_change_kg')},
            'notes': 'kcal and grams per day; burned = resting burn x everyday activity + that day\'s workouts (an estimate); '
                     'partly_logged days were clearly not fully logged; today is not finished'}


@router.get('/food/review')
def diet_review_get(user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute("SELECT period_start, text, created FROM coach_notes WHERE user_id = %s AND kind = 'diet' ORDER BY period_start DESC LIMIT 1",
                      (user['id'],)).fetchone()
    latest = {'day': r['period_start'], 'created': r['created'], **json.loads(r['text'])} if r else None
    return {'paused': not coach.ai_budget.enabled(), 'enabled': coach.allowed(user['id']), 'available': coach.enabled(), 'latest': latest}


@router.post('/food/review')
def diet_review(user=Depends(current_user)):
    from . import ai_access
    ai_access.require(user['id'], 'coach')
    if not coach.enabled(): raise HTTPException(400, 'Kit is not switched on yet (needs an AI key on the server).')
    if not coach.allowed(user['id']): raise HTTPException(400, coach.off())      # before reading anything
    with db.connect() as c:
        ctx = _diet_context(c, user['id'])
        last = c.execute("SELECT created FROM coach_notes WHERE user_id = %s AND kind = 'diet' AND period_start = %s",
                         (user['id'], ctx['today'])).fetchone()
        if last and last['created'] > dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=AGAIN_AFTER):
            raise HTTPException(429, 'You just had a review - log some more and try again later.')
        if sum(1 for d in ctx['days'] if not d['today']) < 3: raise HTTPException(400, 'Log food on at least 3 days first, then ask for a review.')
        _check(c, user['id'], 'diet', health=True)
    try:
        with coach.ai_budget.scope(user['id'],feature='food review'): out = _ask(ctx, DIET_SYSTEM)
    except ValueError as e: raise HTTPException(400, str(e))
    with db.connect() as c:
        c.execute("""INSERT INTO coach_notes (user_id, kind, period_start, text) VALUES (%s, 'diet', %s, %s)
                     ON CONFLICT (user_id, kind, period_start) DO UPDATE SET text = excluded.text, created = now()""",
                  (user['id'], ctx['today'], json.dumps(out)))
    return {'day': ctx['today'], 'created': dt.datetime.now(dt.timezone.utc), **out}


# ---------- one recipe (a cooking-mode dish) ----------
def _recipe_context(c, user_id, d):
    """No personal targets here: the answer is kept on the dish and friends it's shared with can read it."""
    p = c.execute('SELECT units FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}
    portion = c.execute("""SELECT round(avg(amount)) AS g FROM food_entries WHERE user_id = %s AND source = 'dish' AND unit = 'g'
                           AND ref->>'dish_id' = %s""", (user_id, str(d['id']))).fetchone()['g']
    items = [{k: i.get(k) for k in ('name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')} for i in d['items']]
    known = {k: d[f'known_{k}'] for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g') if d[f'known_{k}'] is not None}
    return {'units': p.get('units', 'imperial'), 'dish': d['name'], 'ingredients': items, 'whole_dish': _totals(d),
            'typed_in_totals': known or None, 'weight_g': _weight(d), 'weighed_after_cooking': d['cooked_g'] is not None, 'typical_portion_g': portion,
            'eaten_as': 'the whole dish is one serving' if d['serving'] == 'one' else 'a portion by weight',
            'notes': 'grams and kcal; whole_dish uses the typed-in totals when given; ingredient weights are raw; weight_g is the ingredients added up unless weighed_after_cooking'}


@router.post('/dishes/{did:int}/review')
def recipe_review(did: int, user=Depends(current_user)):
    """Feedback on a dish, kept on the dish so everyone it's shared with sees it. Only the cook asks for it."""
    with db.connect() as c:
        d = _seen(c, user['id'], did)
        if d['user_id'] != user['id']: raise HTTPException(404, 'Not found')
        if not d['items'] and d['known_kcal'] is None: raise HTTPException(400, 'Add some ingredients first.')
        at = d['ai_note_at']
        if at and at > dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=AGAIN_AFTER) and d['recipe_updated'] <= at:
            raise HTTPException(429, 'Change the recipe or wait a few minutes before asking again.')
        _check(c, user['id'], 'recipe')
        ctx = _recipe_context(c, user['id'], d)
    try:
        with coach.ai_budget.scope(user['id'],feature='recipe review'): out = _ask(ctx, RECIPE_SYSTEM)
    except ValueError as e: raise HTTPException(400, str(e))
    with db.connect() as c:
        c.execute('UPDATE dishes SET ai_note = %s, ai_note_at = now() WHERE id = %s AND user_id = %s', (json.dumps(out), did, user['id']))
    return {**out, 'at': dt.datetime.now(dt.timezone.utc)}


# ---------- a saved meal (2026-10-11) ----------
MEAL_SYSTEM = """You are a sports-nutrition coach. You get one meal someone saved to log again (its foods with amounts
and nutrition, the meal's totals, which meal of the day it usually is, and their daily targets) as JSON. Answer with JSON
only, no code fences:
{"summary": 1-2 sentences on this meal for someone who trains: its calories and protein against their day, and what it
   does well,
 "ideas": 2-3 specific tweaks, each {"change": what to do with real amounts (max 20 words), "effect": what it changes,
   with rough numbers (max 20 words)} - for example more protein, more fibre or vegetables, or fewer calories without
   losing what makes it work,
 "note": one short line if a food's numbers look wrong, or null}
Only use the numbers given. Practical, not cheerleading. No medical claims.\n""" + coach.STYLE


@router.post('/food/meals/{mid:int}/review')
def meal_review(mid: int, user=Depends(current_user)):
    """Feedback on a saved meal, kept on the meal."""
    with db.connect() as c:
        m = c.execute('SELECT id, name, items, ai_note_at FROM saved_meals WHERE id = %s AND user_id = %s', (mid, user['id'])).fetchone()
        if not m: raise HTTPException(404, 'Not found')
        if m['ai_note_at'] and m['ai_note_at'] > dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=AGAIN_AFTER):
            raise HTTPException(429, 'You just asked - try again in a few minutes.')
        _check(c, user['id'], 'meal')
        p = c.execute('SELECT units, kcal_target, protein_target FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        usual = c.execute("""SELECT meal FROM food_entries WHERE user_id = %s AND source = 'meal' AND name = ANY(%s)
                             GROUP BY meal ORDER BY count(*) DESC LIMIT 1""", (user['id'], [i.get('name') for i in m['items']])).fetchone()
    keys = ('name', 'brand', 'amount', 'unit', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')
    items = [{k: i.get(k) for k in keys if i.get(k) is not None} for i in m['items']]
    ctx = {'units': p.get('units', 'imperial'), 'meal': m['name'], 'foods': items, 'usual_meal': usual and usual['meal'],
           'totals': {k: round(sum((i.get(k) or 0) for i in m['items']), 1) for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')},
           'daily_targets': {k: v for k, v in p.items() if k.endswith('_target') and v}}
    try:
        with coach.ai_budget.scope(user['id'],feature='meal review'): out = _ask(ctx, MEAL_SYSTEM)
    except ValueError as e: raise HTTPException(400, str(e))
    with db.connect() as c:
        c.execute('UPDATE saved_meals SET ai_note = %s, ai_note_at = now() WHERE id = %s AND user_id = %s', (json.dumps(out), mid, user['id']))
    return {**out, 'at': dt.datetime.now(dt.timezone.utc)}
