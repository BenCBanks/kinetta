"""Grounded saved-meal chat. Fixed account-bound queries; no provider or model-supplied nutrition.

Resolve is read-only. Confirm rechecks the saved recipe under lock and reuses food_entries.client_id
for retry safety. General estimates stay on the existing separately consented/entitled food-photo API.
"""
import datetime as dt
import hashlib
import json
import re
import time
import unicodedata
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from . import db
from . import api_dishes as meals
from .auth import current_user

router = APIRouter(prefix='/api/food/meals-chat')
WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
NUM = meals.NUM
MASS = {'g': 1, 'gram': 1, 'grams': 1, 'kg': 1000, 'kilogram': 1000, 'kilograms': 1000,
        'oz': 28.3495, 'ounce': 28.3495, 'ounces': 28.3495, 'lb': 453.592, 'lbs': 453.592, 'pound': 453.592, 'pounds': 453.592}
AMOUNT = re.compile(r'(?<![\w./-])(' + meals.QTY.replace('(?P<qty>', '(?:') + r')\s*(' +
                    '|'.join(sorted(MASS, key=len, reverse=True)) + r'|servings?|whole meals?)\b')
FILLER = {'i', 'had', 'ate', 'eaten', 'having', 'have', 'a', 'an', 'the', 'of', 'my', 'some', 'please', 'it',
          'that', 'meal', 'meals', 'saved', 'cooked', 'made', 'leftover', 'leftovers', 'from', 'on', 'log', 'add', 'make', 'actually', 'instead', 'to'}


def words(s):
    s = ''.join(c for c in unicodedata.normalize('NFKD', s.lower()) if not unicodedata.combining(c))
    return re.findall(r'[a-z0-9]+', s)


def parse(text, today):
    """Deliberately small grammar. Unknown portions, dates or extra foods ask rather than guessing."""
    if '\n' in text or ',' in text and not re.search(r'\d,\d', text):
        return {'error': 'Describe one saved meal at a time.'}
    t = ' '.join(text.lower().strip().split())
    t = re.sub(r'(\d)?\s*([½¼¾⅓⅔])', lambda m: (m[1] + ' ' if m[1] else '') + meals.FRACTIONS[m[2]], t)
    destination = re.findall(r'\b(?:for|at|to)\s+(breakfast|lunch|dinner|snacks?)\b', t)
    if len(set(destination)) > 1: return {'error': 'Choose one meal to add this to.'}
    meal = ('snacks' if destination and destination[-1] == 'snack' else destination[-1]) if destination else None
    t = re.sub(r'\b(?:for|at|to)\s+(?:breakfast|lunch|dinner|snacks?)\b', '', t)
    # A date describes when the meal was saved, never the date to log it. Creation is the only stored cook-date evidence.
    date_pattern = r'\b(?:(last|this)\s+)?(' + '|'.join(WEEKDAYS) + r'|yesterday|today|\d{4}-\d{2}-\d{2})\b'
    dates = list(re.finditer(date_pattern, t)); saved_day = None
    if len(dates) > 1: return {'error': 'Use one saved-meal date at a time.'}
    if dates:
        m = dates[0]; label = m[2]
        if label in WEEKDAYS:
            ago = (today.weekday() - WEEKDAYS.index(label)) % 7
            if m[1] == 'last' and ago == 0: ago = 7
            saved_day = today - dt.timedelta(days=ago)
        elif label in ('today', 'yesterday'): saved_day = today - dt.timedelta(days=label == 'yesterday')
        else:
            try: saved_day = dt.date.fromisoformat(label)
            except ValueError: return {'error': 'Use a valid saved-meal date, such as 2026-10-12.'}
        t = t[:m.start()] + t[m.end():]
    matches = list(AMOUNT.finditer(t)); portion = None
    if len(matches) > 1: return {'error': 'Describe one saved meal and one amount at a time.'}
    if matches:
        m = matches[0]; amount = meals._qty(m[1]); unit = m[2]
        if not amount or amount <= 0: return {'error': 'Enter a positive portion.'}
        portion = {'grams': round(amount * MASS[unit], 3)} if unit in MASS else {'count': amount}
        if portion.get('grams', 0) > 20000 or portion.get('count', 0) > 20:
            return {'error': 'Use up to 20,000 grams or 20 whole-meal servings.'}
        t = t[:m.start()] + t[m.end():]
    else:
        m = re.search(r'\b(?:a |one )?(half|quarter)\b|(?<![\w/])(1/2|1/4)(?![\w/])', t)
        if m:
            portion = {'share': .5 if (m[1] or m[2]) in ('half', '1/2') else .25}
            t = t[:m.start()] + t[m.end():]
    # Do not silently discard unsupported units, quantities, dates, negation or another food.
    if re.search(r'\b(?:and|plus|with|without|not|no|except|week|weeks|ago|tomorrow|yesterdays)\b|[;,\n]|\d', t):
        return {'error': 'Try one saved meal with grams, ounces, whole-meal servings, half or a quarter. You can choose it from My meals too.'}
    query = [w for w in words(t) if w not in FILLER]
    return {'query': query, 'portion': portion, 'saved_day': saved_day, 'meal': meal}


class ResolveIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=400)
    dish_id: int | None = Field(None, gt=0)  # explicit selection / an amount-only follow-up, still checked against the account
    grams: float | None = Field(None, gt=0, le=20000, allow_inf_nan=False)
    share: float | None = Field(None, gt=0, le=1, allow_inf_nan=False)
    count: float | None = Field(None, gt=0, le=20, allow_inf_nan=False)


def portion_of(body):
    p = {k: getattr(body, k) for k in ('grams', 'share', 'count') if getattr(body, k) is not None}
    if len(p) > 1: raise HTTPException(400, 'Use just one portion amount')
    return p or None


def preview(d, p):
    if not d['items'] and d['known_kcal'] is None: return None, 'Add nutrition to this meal first in My meals.'
    weight = meals._weight(d)
    if ('grams' in p and round(p['grams'], 1) <= 0) or ('count' in p and round(p['count'], 2) <= 0):
        return None, 'Use at least 0.1 grams or 0.01 whole-meal servings.'
    if 'grams' in p and not weight: return None, 'This meal has no total weight. Enter its weight in My meals, or describe half, a quarter or whole-meal servings.'
    factor = p.get('count', p.get('share')) if 'grams' not in p else p['grams'] / weight
    totals = {k: meals._r(v * factor) if v is not None else None for k, v in meals._totals(d).items()}
    # Match normal entry limits, even if a valid whole-meal portion is excessively large.
    limits = {'kcal': 20000, 'protein_g': 2000, 'carbs_g': 2000, 'fat_g': 2000, 'fiber_g': 1000}
    if any((totals[k] or 0) > limits[k] for k in NUM): return None, 'That portion is too large. Check the amount.'
    return totals, None


def fingerprint(uid, d, p, issued):
    # Covers the stored recipe and exact portion. No client nutrition is trusted at confirmation.
    payload = [uid, d['id'], d['name'], str(d['updated']), meals._weight(d), meals._totals(d), p, issued]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@router.post('/resolve')
def resolve(body: ResolveIn, user=Depends(current_user)):
    supplied = portion_of(body)
    with db.connect() as c:
        today = meals._today(c, user['id']).date()
        parsed = parse(body.text, today)
        if 'error' in parsed: return {'status': 'clarify', 'message': parsed['error']}
        tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        rows = c.execute(f'''SELECT {meals.COLS}, (created AT TIME ZONE %s)::date AS saved_day
                             FROM dishes WHERE user_id = %s ORDER BY created DESC, id DESC LIMIT %s''',
                         (tz, user['id'], meals.MAX_DISHES)).fetchall()
        if body.dish_id is not None:
            rows = [d for d in rows if d['id'] == body.dish_id]
            if not rows: raise HTTPException(404, 'Saved meal not found')
        # Choosing a meal retains the original description; a typed new name must still match it.
        matches = [d for d in rows if not meals._empty(d)
                   and (not parsed['saved_day'] or d['saved_day'] == parsed['saved_day'])
                   and (all(w in words(d['name']) for w in parsed['query']))]
        if not parsed['query'] and body.dish_id is None and not parsed['saved_day']:
            return {'status': 'no_match', 'message': 'Name a saved meal, for example: 230 grams of my pasta.'}
        if not matches:
            return {'status': 'no_match', 'message': "I couldn't match that to your saved meals. Check the name or saved date, or choose My meals."}
        choices = [{'id': d['id'], 'name': d['name'], 'saved_day': d['saved_day'], 'weight_g': meals._weight(d)} for d in matches]
        p = parsed['portion'] or supplied
        if len(matches) > 1:
            return {'status': 'choose', 'message': 'Which saved meal did you mean?', 'choices': choices[:12], 'more_matches': len(choices) > 12, 'portion': p, 'meal': parsed['meal']}
        d = matches[0]
        base = {'dish': choices[0], 'portion': p, 'meal': parsed['meal']}
        if not p: return {**base, 'status': 'quantity', 'message': 'How much did you have? Use grams, ounces, whole-meal servings, half or a quarter.'}
        totals, error = preview(d, p)
        if error: return {**base, 'status': 'quantity', 'message': error}
        issued = int(time.time())
        return {**base, 'status': 'ready', 'totals': totals, 'issued': issued,
                'expected': fingerprint(user['id'], d, p, issued), 'client_id': str(uuid.uuid4()),
                'message': 'Calculated from your saved meal. Check the portion and destination, then add it.'}


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dish_id: int = Field(gt=0)
    grams: float | None = Field(None, gt=0, le=20000, allow_inf_nan=False)
    share: float | None = Field(None, gt=0, le=1, allow_inf_nan=False)
    count: float | None = Field(None, gt=0, le=20, allow_inf_nan=False)
    issued: int
    expected: str = Field(pattern=r'^[a-f0-9]{64}$')
    client_id: str = Field(pattern=r'^[A-Za-z0-9-]{8,64}$')
    day: dt.date
    meal: str = Field(pattern='^(breakfast|lunch|dinner|snacks)$')
    confirm: StrictBool


@router.post('/confirm')
def confirm(body: ConfirmIn, user=Depends(current_user)):
    if body.confirm is not True: raise HTTPException(400, 'Confirm the meal before adding it')
    p = portion_of(body)
    if not p: raise HTTPException(400, 'Enter a portion')
    request_key = hashlib.sha256(json.dumps([body.dish_id, p, str(body.day), body.meal, body.expected], sort_keys=True).encode()).hexdigest()
    with db.connect() as c:
        # Serialize same-account retries. No provider calls or second pooled connection inside this lock.
        c.execute('SELECT id FROM users WHERE id = %s FOR UPDATE', (user['id'],))
        old = c.execute('SELECT id, ref FROM food_entries WHERE user_id = %s AND client_id = %s', (user['id'], body.client_id)).fetchone()
        if old:
            if (old['ref'] or {}).get('meal_chat_request') != request_key: raise HTTPException(409, 'This confirmation was already used for a different entry')
            return {'id': old['id'], 'replayed': True}
        if not 0 <= time.time() - body.issued <= 900: raise HTTPException(409, 'This preview expired. Describe the portion again.')
        d = meals._get(c, user['id'], body.dish_id, lock=True)
        if body.expected != fingerprint(user['id'], d, p, body.issued):
            raise HTTPException(409, 'This meal changed. Describe the portion again to review its current nutrition.')
        totals, error = preview(d, p)
        if error: raise HTTPException(400, error)
        weight = meals._weight(d)
        if 'grams' in p: amount, unit = round(p['grams'], 1), 'g'
        elif 'count' in p: amount, unit = round(p['count'], 2), 'serving'
        elif weight: amount, unit = round(weight * p['share'], 1), 'g'
        else: amount, unit = round(p['share'], 3), 'dish'
        pos = c.execute('SELECT coalesce(max(position), 0) + 1 AS p FROM food_entries WHERE user_id = %s AND day = %s', (user['id'], body.day)).fetchone()['p']
        ref = {'dish_id': d['id'], 'weight_g': weight, 'dish_kcal': meals._totals(d)['kcal'], 'meal_chat_request': request_key}
        row = c.execute('''INSERT INTO food_entries (user_id, day, meal, name, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, source, ref, position, client_id)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'dish', %s, %s, %s) RETURNING id''',
                        (user['id'], body.day, body.meal, d['name'], amount, unit, *(totals[k] for k in NUM), json.dumps(ref), pos, body.client_id)).fetchone()
        return {'id': row['id'], 'replayed': False}
