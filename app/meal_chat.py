"""Describe what you ate in your own words, without AI (2026-10-15).

"2 eggs and toast for breakfast", "230 g of the pasta I cooked on Monday", "a bowl of chili last night", then
"make it 300 grams", "also a diet coke" or "remove the toast". The sentence is split into foods and each one is
matched against the person's own records only: saved Meals (dishes), Saved combinations, My foods and foods they
have logged before. Amounts come from what they said, or from the amount they used last time. It is fixed SQL plus
arithmetic: zero model calls, so it works with AI turned off (and behind a future paywall). Anything that isn't found
comes back as `unknown`; the phone checks public branded catalogs and offers an explicit optional estimate.
Only opted-in unknown words go to the existing estimator with AI access and consent.

Resolve is read-only and stateless: the phone sends back the conversation (`parts`) with each new message. Confirm
recalculates every item on the server under lock, checks each item's 15-minute preview fingerprint, and uses
per-account client IDs so a retried Add never logs twice (even after the source is edited or deleted).
The persistent thread reuses the internal transaction-sharing readers/writers under
its own auto-log or require-a-tap preference; the legacy confirmation API stays explicit.
"""
import datetime as dt
import hashlib
import json
import re
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from . import db
from . import api_dishes as dishes
from .api_food import _custom_food, _search_off, _search_usda
from .auth import current_user

router = APIRouter(prefix='/api/food/meals-chat')
NUM = dishes.NUM
LIMITS = {'kcal': 20000, 'protein_g': 2000, 'carbs_g': 2000, 'fat_g': 2000, 'fiber_g': 1000}   # the normal entry limits
MAX_PARTS = 12
WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
MASS = {'g': 1, 'gr': 1, 'gm': 1, 'gram': 1, 'gramme': 1, 'kg': 1000, 'kilo': 1000, 'kilogram': 1000,
        'oz': 28.3495, 'ounce': 28.3495, 'lb': 453.592, 'lbs': 453.592, 'pound': 453.592}
COUNTS = {'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
          'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'couple': 2, 'single': 1, 'double': 2}
SHARES = {'half': .5, 'halve': .5, 'quarter': .25, 'third': 1 / 3}
VAGUE = {'serving', 'portion', 'bowl', 'plate', 'helping', 'plateful', 'bowlful', 'dish', 'whole', 'meal'}   # "your usual amount"
UNITS = VAGUE | {'piece', 'slice', 'cup', 'can', 'bottle', 'glass', 'scoop', 'bar', 'packet', 'pack', 'handful', 'tbsp',
                 'tablespoon', 'tsp', 'teaspoon', 'ml', 'l', 'litre', 'liter', 'mug', 'spoonful', 'pint', 'shot', 'box',
                 'bag', 'container', 'carton', 'tin', 'jar', 'square', 'wedge'}
CORRECTION = {'make', 'it', 'change', 'set', 'to', 'was', 'is', 'should', 'be', 'instead', 'only', 'just', 'that', 'not',
              'actually', 'more', 'like', 'the', 'my', 'of', 'a', 'an', 'than', 'less', 'really'}
SPLIT = {'and', 'plus', 'with', 'also', 'then', 'alongside', '&', '+', ',', ';'}
CUT = {'without', 'minus', 'hold', 'except'}       # "coffee without sugar": nothing after it is logged
MEAL_WORDS = {'breakfast': 'breakfast', 'brunch': 'lunch', 'lunch': 'lunch', 'dinner': 'dinner', 'supper': 'dinner',
              'snack': 'snacks', 'snacks': 'snacks', 'dessert': 'snacks'}
COOK_WORDS = {'cooked', 'made', 'saved', 'prepared', 'baked', 'roasted', 'cook', 'make', 'from', 'leftover', 'leftovers', 'batch', 'meal'}
FILLER = {'i', 'id', 'ive', 'im', 'we', 'had', 'have', 'has', 'having', 'ate', 'eaten', 'eat', 'eating', 'just', 'some', 'of',
          'the', 'my', 'our', 'your', 'a', 'an', 'it', 'that', 'this', 'these', 'those', 'please', 'log', 'add', 'track',
          'record', 'me', 'for', 'from', 'meal', 'meals', 'leftover', 'leftovers', 'cooked', 'made', 'saved', 'prepared',
          'make', 'was', 'were', 'is', 'are', 'be', 'about', 'around', 'approximately', 'roughly', 'approx', 'like', 'maybe',
          'little', 'on', 'in', 'at', 'to', 'got', 'grabbed', 'drank', 'drink', 'also', 'again', 'usual', 'same', 'as',
          'time', 'last', 'other', 'day', 'one', 'today', 'did', 'do', 'so', 'and', 'or', 'there', 'then', 'still', 'only',
          'whole', 'entire', 'all', 'instead', 'actually', 'change', 'should', 'make', 'cook', 'dish', 'batch', 'up'}
LEAD = re.compile(r'^(?:(?:no|nope|nah|actually|sorry|wait|oh|oops|ok|okay|um|umm|hmm|well|so|yes|yeah|yep|yup)\b[\s,.!]*)+')
TOKEN = re.compile(r"\d+(?:\.\d+)?(?:/\d+)?|[a-z]+|[,;&+]")
UNICODE_FRACTIONS = {'½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8'}


# ---------- words ----------
def norm(s):
    s = s.lower()
    for k, v in UNICODE_FRACTIONS.items(): s = s.replace(k, v)
    s = ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))
    s = s.replace('⁄', '/').replace('’', "'").replace('×', ' x ')
    s = re.sub(r"'s\b", '', s)                                  # Monday's pasta -> monday pasta
    s = re.sub(r"\b(?:i|we|you|they)'(?:ve|d|m|ll)\b", ' ', s)  # I've had
    s = re.sub(r'(\d),(\d{3})(?!\d)', r'\1\2', s)               # 1,500 g
    s = re.sub(r'(\d),(\d)', r'\1.\2', s)                       # 1,5 kg
    s = re.sub(r'\b(\d+(?:\.\d+)?|' + '|'.join(k for k in COUNTS if k not in ('a', 'an')) + r')\s+and\s+a\s+half\b',
               lambda m: str((float(m[1]) if m[1][0].isdigit() else COUNTS[m[1]]) + .5), s)    # two and a half
    return s


def stem(w):
    """Plural-insensitive: tacos/taco, berries/berry, sandwiches/sandwich. Applied to both sides of every comparison."""
    if len(w) <= 3 or not w.isalpha(): return w
    if w.endswith('ies'): return w[:-3] + 'y'
    if w.endswith(('ches', 'shes', 'xes', 'sses', 'oes')): return w[:-2]
    if w.endswith('s') and not w.endswith(('ss', 'us', 'is')): return w[:-1]
    return w


def raw(s): return TOKEN.findall(norm(s))


def toks(s): return [stem(t) for t in raw(s)]


def st(t): return stem(t) if isinstance(t, str) else t


def name_words(name): return [t for t in toks(name) if t not in FILLER and t not in (',', ';')]


def number(t):
    try:
        if '/' in t:
            a, b = t.split('/'); return float(a) / float(b) if float(b) else None
        return float(t)
    except ValueError: return None


def isnum(t): return bool(t) and t[0].isdigit()


# ---------- dates and meals: when it was eaten, or when a saved meal was made ----------
TIMES = [(r'\blast night\b', -1, 'dinner'), (r'\b(?:this|today) morning\b', 0, 'breakfast'),
         (r'\byesterday morning\b', -1, 'breakfast'), (r'\b(?:this|today) afternoon\b', 0, None),
         (r'\byesterday afternoon\b', -1, None), (r'\b(?:tonight|this evening)\b', 0, 'dinner'),
         (r'\byesterday evening\b', -1, 'dinner')]
DATE = re.compile(r'\b(?:(last|this|past)\s+)?(' + '|'.join(WEEKDAYS) + r'|yesterday|today|\d{4}-\d{2}-\d{2})\b')
_MEAL = r'(?:my |our |the |a |an |some )?(?:breakfast|brunch|lunch|dinner|supper|snacks?|dessert)\b'
MEAL_AT = re.compile(r'\b(?:for|at|during|as|with|over|after)\s+(' + _MEAL + r'(?:\s*(?:,|and|or|&)\s*' + _MEAL + r')*)')
MEAL_WORD = re.compile(r'\b(breakfast|brunch|lunch|dinner|supper|snacks?|dessert)\b')
MEAL_LEAD = re.compile(r'^\s*(breakfast|brunch|lunch|dinner|supper|snacks?|dessert)\s*(?::|-|=|\bwas\b|\bwere\b|\bis\b|\bi had\b)\s*')


def when(s, today):
    """Pull out the log meal, the log day and a saved-meal date. Returns (rest, info) or (None, error)."""
    info = {'meal': None, 'day': None, 'saved_day': None}
    if re.search(r'\btomorrow\b', s): return None, "That day hasn't happened yet."
    if re.search(r'(?<![\w-])-\s*\d', s): return None, 'Use a positive amount.'
    meals, days, saved = set(), set(), set()
    m = MEAL_LEAD.match(s)
    if m: meals.add(MEAL_WORDS[m[1]]); s = s[m.end():]
    for m in MEAL_AT.finditer(s): meals.update(MEAL_WORDS[w] for w in MEAL_WORD.findall(m[1]))   # "for lunch and dinner" asks
    s = MEAL_AT.sub(' ', s)
    found = []
    for pattern, ago, meal in TIMES:
        for m in re.finditer(pattern, s): found.append((m.start(), m.end(), today + dt.timedelta(days=ago), meal))
    taken = [(a, b) for a, b, *_ in found]
    for m in DATE.finditer(s):
        if any(a <= m.start() < b for a, b in taken): continue
        label = m[2]
        if label in WEEKDAYS:
            ago = (today.weekday() - WEEKDAYS.index(label)) % 7
            if m[1] == 'last' and ago == 0: ago = 7
            day = today - dt.timedelta(days=ago)
        elif label in ('today', 'yesterday'): day = today - dt.timedelta(days=label == 'yesterday')
        else:
            try: day = dt.date.fromisoformat(label)
            except ValueError: return None, 'Use a real date, such as 2026-10-12.'
        found.append((m.start(), m.end(), day, None))
    for a, b, day, meal in sorted(found):
        # "the pasta I cooked on Monday" / "chili from last night" date a saved meal; "I had pasta on Monday" is when it was eaten
        before = re.findall(r'[a-z]+', s[max(0, a - 40):a])[-3:]
        if COOK_WORDS & set(before): saved.add(day)
        else:
            days.add(day)
            if meal: meals.add(meal)
    for a, b, *_ in sorted(found, reverse=True): s = s[:a] + ' ' + s[b:]
    # A dated meal lead: ‘yesterday’s breakfast was …’ still names the meal.
    m = MEAL_LEAD.match(s)
    if m: meals.add(MEAL_WORDS[m[1]]); s = s[m.end():]
    if len(meals) > 1: return None, 'Which meal should I add this to? Add one meal at a time.'
    if len(days) > 1 or len(saved) > 1: return None, 'Use one day at a time.'
    if days and max(days) > today: return None, "That day hasn't happened yet."
    info['meal'] = next(iter(meals), None); info['day'] = next(iter(days), None); info['saved_day'] = next(iter(saved), None)
    return s, info


# ---------- amounts ----------
def amount(ts):
    """Find one amount in a part's tokens. Returns (portion | None, remaining tokens) or (None, None) if unclear.
    portion: {'grams'} | {'count', 'unit'?} | {'share'}; no amount at all = your usual amount."""
    out, i = None, 0
    rest = list(ts)
    while i < len(rest):
        t = st(rest[i])
        if not isinstance(t, str): i += 1; continue
        n, used = None, 0
        nxt = st(rest[i + 1]) if i + 1 < len(rest) and isinstance(rest[i + 1], str) else None
        if t == 'x' and nxt and isnum(nxt): n, used = number(nxt), 2                    # coffee x2
        elif isnum(t):
            n, used = number(t), 1
            if nxt and isnum(nxt) and '/' in nxt and '/' not in t and number(nxt) is not None: n, used = n + number(nxt), 2   # 1 1/2
            if i + used < len(rest) and rest[i + used] == 'x': used += 1               # 2x coffee
        elif t in COUNTS and t not in ('a', 'an'):
            n, used = COUNTS[t], 1
            if t == 'couple' and nxt == 'of': used = 2
            if nxt in ('quarter', 'third') and i + 2 <= len(rest):                     # three quarters
                out = {'share': n * SHARES[nxt]} if n * SHARES[nxt] <= 1 else {'count': n * SHARES[nxt]}
                del rest[i:i + 2]; continue
        elif t in SHARES or (t in ('a', 'an', 'one') and nxt in SHARES):
            j = i + (0 if t in SHARES else 1); share = SHARES[st(rest[j])]
            k = j + 1
            while k < len(rest) and rest[k] in ('of', 'the', 'a', 'an', 'my'): k += 1
            unit = st(rest[k]) if k < len(rest) and isinstance(rest[k], str) and (st(rest[k]) in UNITS or st(rest[k]) in MASS) else None
            if out is not None: return None, None
            if unit in MASS: return None, None
            out = {'count': share, 'unit': unit} if unit else {'share': share}
            del rest[i:k + (1 if unit else 0)]; continue
        elif t in ('a', 'an') and nxt in UNITS:
            n, used = 1, 1
        if n is None: i += 1; continue
        if out is not None or n <= 0: return None, None                                # two amounts, or zero
        j = i + used
        while j < len(rest) and rest[j] in ('of',): j += 1
        unit = st(rest[j]) if j < len(rest) and isinstance(rest[j], str) and (st(rest[j]) in MASS or st(rest[j]) in UNITS) else None
        if unit in MASS: out = {'grams': round(n * MASS[unit], 3)}
        elif unit: out = {'count': n, 'unit': unit}
        else: out = {'count': n}
        end = j + 1 if unit else i + used
        del rest[i:end]
    if any(isinstance(t, str) and isnum(t) for t in rest): return None, None
    return out, rest


# ---------- splitting a sentence into foods ----------
def protect(ts, catalog):
    """Replace exact catalog names (longest first) with a reference, so "mac and cheese" or "5 bean chili" stay one food."""
    ts = list(ts)
    names = sorted(((e['phrase'], i) for i, e in enumerate(catalog) if e['phrase']), key=lambda x: -len(x[0]))
    for phrase, idx in names:
        n = len(phrase); i = 0
        while i + n <= len(ts):
            if all(isinstance(t, str) for t in ts[i:i + n]) and tuple(stem(t) for t in ts[i:i + n]) == phrase:
                ts[i:i + n] = [('@', idx)]
            i += 1
    return ts


def split(ts):
    parts, cur = [], []
    for t in ts:
        if isinstance(t, str) and t in SPLIT:
            if cur: parts.append(cur); cur = []
        else: cur.append(t)
    if cur: parts.append(cur)
    out = []
    for p in parts:
        cut = next((i for i, t in enumerate(p) if isinstance(t, str) and t in CUT and i > 0), None)
        if cut is not None: p = p[:cut]
        if any(not isinstance(t, str) or (t not in FILLER and t not in COUNTS) or isnum(t) for t in p): out.append(p)
    return out


OPENERS = {'i', 'we', 'had', 'have', 'has', 'ate', 'eaten', 'just', 'also', 'got', 'grabbed', 'drank', 'then', 'and', 'log', 'add', 'please', 'only'}


def text_of(ts, catalog):
    return ' '.join(catalog[t[1]]['name'].lower() if not isinstance(t, str) else t for t in ts)


def describe(s, today, catalog):
    """A new description -> (parts, info) or (None, message). Each part: {'text', 'portion'}."""
    s = LEAD.sub('', norm(s).strip())
    s, info = when(s, today)
    if s is None: return None, info
    parts, joined, joined_portions = [], [], []
    for fragment in split(protect(raw(s), catalog)):
        portion, rest = amount(fragment)
        previous = joined_portions[-1] if joined else None
        # ‘Garden pasta, 200 grams’: an amount-only fragment belongs to the
        # preceding exact own-food reference when it has no other amount.
        if joined and portion and rest is not None and all(isinstance(t,str) and t in FILLER for t in rest) and previous is None and any(not isinstance(t,str) for t in joined[-1]):
            joined[-1] += fragment; joined_portions[-1] = portion
        else: joined.append(fragment); joined_portions.append(portion)
    for p in joined:
        if p and p[-1] == 'total' and any(not isinstance(t,str) for t in p) and amount(p[:-1])[0]: p = p[:-1]
        while p and isinstance(p[0], str) and p[0] in OPENERS: p = p[1:]                  # "i had", "we ate"
        while p and isinstance(p[-1], str) and p[-1] in FILLER and p[-1] not in COUNTS: p = p[:-1]   # "...i cooked on"
        if p: parts.append({'text': text_of(p, catalog), 'pick': None, 'portion': None, 'removed': False})
    if len(parts) > MAX_PARTS: return None, f'Describe up to {MAX_PARTS} foods at a time.'
    return parts, info


def read_part(text, catalog):
    """A stored part's words -> {'ref', 'query', 'portion'} (or 'unclear')."""
    ts = protect(raw(text), catalog)
    portion, rest = amount(ts)
    if rest is None: return {'unclear': True, 'ref': None, 'query': [], 'portion': None}
    refs = [t[1] for t in rest if not isinstance(t, str)]
    query = [stem(t) for t in rest if isinstance(t, str) and stem(t) not in FILLER and t not in COUNTS and t not in (',', ';')]
    if refs and not query and len(refs) == 1: return {'ref': refs[0], 'query': [], 'portion': portion}
    if not query and not refs and portion and portion.get('unit') and portion['unit'] not in VAGUE:   # "2 bars": the unit is the food
        query = [portion.pop('unit')]
    query = [w for t in rest for w in ([stem(t)] if isinstance(t, str) else list(catalog[t[1]]['words']))
             if w not in FILLER and w not in COUNTS and w not in (',', ';')]
    return {'ref': None, 'query': query, 'portion': portion}


# ---------- the person's own foods ----------
KIND_RANK = {'dish': 0, 'combo': 1, 'custom': 2, 'food': 3}


def catalog_for(c, uid):
    tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
    out = []
    def add(kind, row, name, recent, saved_day=None):
        words = name_words(name + ' ' + (row.get('brand') or '')); phrase = tuple(toks(name))
        if not words: return
        # a one-word name that is also a number/meal word ("Lunch") is never protected as a phrase
        protectable = not (len(phrase) == 1 and (phrase[0] in FILLER or phrase[0] in COUNTS or phrase[0] in MEAL_WORDS))
        out.append({'kind': kind, 'id': row['id'], 'name': name, 'row': row, 'words': tuple(words), 'key': ' '.join(words),
                    'phrase': phrase if protectable else None, 'phrase_text': ' '.join(phrase), 'recent': recent, 'saved_day': saved_day})
    for d in c.execute(f'''SELECT {dishes.COLS}, (created AT TIME ZONE %s)::date AS saved_day FROM dishes WHERE user_id = %s
                           ORDER BY created DESC, id DESC LIMIT %s''', (tz, uid, dishes.MAX_DISHES)).fetchall():
        if not dishes._empty(d) and d['name'] not in dishes.PLACEHOLDERS: add('dish', d, d['name'], d['updated'], d['saved_day'])
    for m in c.execute('SELECT id, name, items FROM saved_meals WHERE user_id = %s ORDER BY name LIMIT 200', (uid,)).fetchall():
        add('combo', m, m['name'], None)
    for f in c.execute('SELECT * FROM custom_foods WHERE user_id = %s ORDER BY favorite DESC, name LIMIT 500', (uid,)).fetchall():
        add('custom', f, f['name'], None)
    for r in c.execute("""SELECT * FROM (SELECT DISTINCT ON (lower(name)) * FROM food_entries
                            WHERE user_id = %s AND source <> 'dish' AND day > current_date - 365
                            ORDER BY lower(name), created DESC) x ORDER BY created DESC LIMIT 600""", (uid,)).fetchall():
        add('food', r, r['name'], r['created'])
    return out


def matches(part, catalog, saved_day):
    """Best catalog entries for a part: one name -> [entry]; several different names -> choices; none -> []."""
    pool = [e for e in catalog if e['kind'] == 'dish'] if saved_day else catalog
    if part['ref'] is not None:
        key = catalog[part['ref']]['key']
        found = [e for e in pool if e['key'] == key] or [catalog[part['ref']]]
    else:
        q = set(part['query'])
        if not q:
            found = [e for e in pool if saved_day and e['saved_day'] == saved_day]
            if not found: return []
        else:
            scored = []
            for e in pool:
                n = set(e['words'])
                if q <= n: scored.append((len(q) / len(n), e))                       # every word you said is in its name
                # Never drop an extra word: it may identify a different brand or variant.
            if not scored:
                return matches(part, catalog, None) if saved_day else []
            scored.sort(key=lambda x: -x[0])
            top = scored[0][0]
            found = [e for s, e in scored if s >= top - 1e-9] if top >= 1 else [e for s, e in scored]
    if saved_day:
        on_day = [e for e in found if e['saved_day'] == saved_day]
        found = on_day or found
    return best_per_name(found)


def best_per_name(found):
    """One entry per food name: a saved meal first, then the most recent."""
    rank = lambda e: (KIND_RANK[e['kind']], -(e['recent'].timestamp() if e['recent'] else 0))
    best = {}
    for e in found:
        if e['key'] not in best or rank(e) < rank(best[e['key']]): best[e['key']] = e
    return list(best.values())


def near(part, catalog):
    """Your foods whose whole name is inside what you said, with extra words ("scrambled eggs" -> Eggs).
    An extra word may be a brand or a variant, so these are only offered as choices, never picked."""
    q = set(part['query'])
    if part['ref'] is not None or len(q) < 2: return []
    close = [e for e in catalog if e['words'] and set(e['words']) < q and len(set(e['words'])) / len(q) >= .5]
    return sorted(best_per_name(close), key=lambda e: (-len(set(e['words'])), KIND_RANK[e['kind']], e['name'].lower()))


# ---------- how much: arithmetic on stored values only ----------
def scaled(values, f):
    return {k: dishes._r(values[k] * f) if values.get(k) is not None else (None if k == 'fiber_g' else 0) for k in NUM}


def fmt(n): return f'{n:g}' if n == int(n) else f'{round(n, 2):g}'


def last_dish_portion(c, uid, did):
    return c.execute("""SELECT amount, unit FROM food_entries WHERE user_id = %s AND source = 'dish' AND ref->>'dish_id' = %s
                        ORDER BY created DESC LIMIT 1""", (uid, str(did))).fetchone()


def settle(c, uid, e, p):
    """Turn "a bowl", "two" or nothing into a concrete portion for this food, using what was said or the last amount.
    Returns (portion, note) or (None, question)."""
    kind, row = e['kind'], e['row']
    if p and 'grams' in p: return p, None
    if kind == 'dish':
        if p and 'share' in p: return p, None
        n = p['count'] if p and 'count' in p else 1
        last = last_dish_portion(c, uid, row['id'])
        if last and (not p or p.get('unit') in VAGUE or not p.get('unit')):
            amount_, unit = last['amount'] * n, last['unit']
            if unit == 'g': return {'grams': round(amount_, 1)}, 'same as last time' if n == 1 else f'{fmt(n)} × last time'
            if unit == 'serving': return {'count': round(amount_, 3)}, 'same as last time' if n == 1 else f'{fmt(n)} × last time'
            if unit == 'dish': return ({'share': amount_} if amount_ <= 1 else {'count': amount_}), 'same as last time'
        if row['serving'] == 'one' and p and 'count' in p: return {'count': n}, None
        return None, 'How much?'
    if kind == 'combo':
        if p and 'share' in p: return {'count': p['share']}, None
        return {'count': p['count'] if p and 'count' in p else 1}, None
    if kind == 'custom':
        if p and 'share' in p: return {'count': p['share']}, None
        return {'count': p['count'] if p and 'count' in p else 1}, None
    # food logged before: no amount = as last time; "2" = 2 of the unit used last time (2 eggs), or 2 × last time's amount
    if not p: return {'count': row['amount'], 'unit': row['unit']}, 'as last time'
    if 'share' in p: return {'count': round(row['amount'] * p['share'], 3), 'unit': row['unit']}, None
    n, unit = p['count'], p.get('unit')
    last_unit = stem((row['unit'] or '').split()[0].lower()) if (row['unit'] or '').split() else ''
    if unit and stem(unit) == last_unit: return {'count': n, 'unit': row['unit']}, None
    if not unit and row['unit'] not in ('g', 'ml', 'oz', 'lb', 'kg', 'l'): return {'count': n, 'unit': row['unit']}, None
    return {'count': round(row['amount'] * n, 3), 'unit': row['unit']}, (f'{fmt(n)} × last time' if n != 1 else 'same as last time')


def compute(c, uid, kind, row, p):
    """Entries to log for one food at portion p, from stored values only. Returns (entries, None) or (None, why)."""
    if kind == 'dish':
        if not row['items'] and row['known_kcal'] is None: return None, 'Add nutrition to this meal first in My Recipes.'
        weight = dishes._weight(row)
        if 'grams' in p:
            if not weight: return None, 'This meal has no total weight. Say half, a quarter or a number of servings, or add its weight in My Recipes.'
            f, amount_, unit = p['grams'] / weight, round(p['grams'], 1), 'g'
        elif 'count' in p:
            if p['count'] > 20: return None, 'Use up to 20 whole-meal servings.'
            f, amount_, unit = p['count'], round(p['count'], 2), 'serving'
        elif weight: f, amount_, unit = p['share'], round(weight * p['share'], 1), 'g'
        else: f, amount_, unit = p['share'], round(p['share'], 3), 'dish'
        if amount_ <= 0: return None, 'Use a bigger amount.'
        totals = dishes._totals(row)
        return [{'name': row['name'], 'brand': None, 'amount': amount_, 'unit': unit, **scaled(totals, f), 'source': 'dish',
                 'ref': {'dish_id': row['id'], 'weight_g': weight, 'dish_kcal': totals['kcal']}}], None
    if kind == 'combo':
        if 'count' not in p: return None, 'Say how many, like "2" or "half".'
        f = p['count']
        return [{'name': i['name'], 'brand': i.get('brand'), 'amount': round((i.get('amount') or 1) * f, 2), 'unit': i.get('unit') or 'serving',
                 **scaled(i, f), 'source': i.get('source') or 'meal', 'ref': i.get('ref')} for i in row['items']], None
    if kind == 'custom':
        food = _custom_food(row)
        if 'grams' in p:
            if not food['per100']: return None, f"I don't know what a serving of {row['name']} weighs. Say how many servings, or add its weight in My foods."
            return [{'name': row['name'], 'brand': row['brand'], 'amount': round(p['grams'], 1), 'unit': 'g', **scaled(food['per100'], p['grams'] / 100),
                     'source': 'custom', 'ref': food}], None
        return [{'name': row['name'], 'brand': row['brand'], 'amount': round(p['count'], 2), 'unit': 'serving', **scaled(food['per_serving'], p['count']),
                 'source': 'custom', 'ref': food}], None
    # a food logged before (kind 'food'): scale the last entry
    base = {k: row[k] for k in NUM}
    ref = row['ref'] or {}
    if 'grams' in p:
        g = p['grams']
        if row['unit'] == 'g' and row['amount']: f = g / row['amount']
        elif ref.get('per100'): return [{**_food_entry(row), 'amount': round(g, 1), 'unit': 'g', **scaled(ref['per100'], g / 100)}], None
        elif row['unit'] == 'serving' and (ref.get('serving') or {}).get('g') and row['amount']: f = g / (ref['serving']['g'] * row['amount'])
        else: return None, f"I don't know what {row['name']} weighs. Say how many instead, like you logged it before ({fmt(row['amount'])} {row['unit']})."
        return [{**_food_entry(row), 'amount': round(g, 1), 'unit': 'g', **scaled(base, f)}], None
    if not row['amount']: return None, 'Say how much.'
    f = p['count'] / row['amount']
    return [{**_food_entry(row), 'amount': round(p['count'], 2), 'unit': row['unit'], **scaled(base, f)}], None


def _food_entry(row): return {'name': row['name'], 'brand': row['brand'], 'source': row['source'] or 'recent', 'ref': row['ref']}


def amount_label(entries, kind, p):
    if kind == 'combo': return f"{fmt(p['count'])} × saved combination ({len(entries)} item{'s' if len(entries) != 1 else ''})"
    e = entries[0]
    if e['unit'] == 'g': return f"{fmt(e['amount'])} g"
    if e['unit'] == 'serving': return f"{fmt(e['amount'])} {'whole meal' if kind == 'dish' else 'serving'}{'s' if e['amount'] != 1 else ''}"
    if e['unit'] == 'dish': return f"{round(e['amount'] * 100)}% of the meal"
    unit = e['unit'] or ''
    if e['amount'] != 1 and re.fullmatch(r'[a-z]{3,}', unit) and unit not in MASS and not unit.endswith('s'):   # 2 slices
        unit += 'es' if unit.endswith(('ch', 'sh', 'x')) else 's'
    return f"{fmt(e['amount'])} {unit}"


def snapshot(e):
    row = e['row']
    if e['kind'] == 'dish': return [row['name'], str(row['updated']), dishes._weight(row), dishes._totals(row)]
    if e['kind'] == 'combo': return [row['name'], row['items']]
    if e['kind'] == 'custom': return [row['name'], row['serving_g'], [row[k] for k in NUM]]
    return [row['name'], row['amount'], row['unit'], [row[k] for k in NUM], row['ref']]


def fingerprint(uid, kind, fid, p, snap, issued):
    # floats both ways: the phone sends 1 back as 1.0
    payload = [uid, kind, fid, {k: (float(v) if isinstance(v, (int, float)) else v) for k, v in sorted(p.items())}, snap, issued]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def too_big(entries): return any((x[k] or 0) > LIMITS[k] for x in entries for k in NUM)


# ---------- the conversation ----------
class Portion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    grams: float | None = Field(None, gt=0, le=20000, allow_inf_nan=False)
    share: float | None = Field(None, gt=0, le=1, allow_inf_nan=False)
    count: float | None = Field(None, gt=0, le=100000, allow_inf_nan=False)
    unit: str | None = Field(None, max_length=40)

    def clean(self):
        p = {k: v for k, v in self.model_dump().items() if v is not None}
        if sum(k in p for k in ('grams', 'share', 'count')) != 1: raise HTTPException(400, 'Use one portion amount')
        if 'unit' in p and 'count' not in p: p.pop('unit')
        return p


class Pick(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: str = Field(pattern='^(dish|combo|custom|food)$')
    id: int = Field(gt=0)


class PartIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=200)
    pick: Pick | None = None
    portion: Portion | None = None
    saved_day: dt.date | None = None
    removed: bool = False
    new: bool = False        # "something new": skip the "is it one of your foods?" question


class ResolveIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    say: str | None = Field(None, max_length=400)
    parts: list[PartIn] = Field(default_factory=list, max_length=MAX_PARTS)


REMOVE = re.compile(r'^(?:remove|delete|drop|take off|take out|skip|forget|scratch|cancel|no|not|without|minus|lose|no more)\s+(?:the\s+|my\s+|that\s+)?(?P<what>[^,]+?)[.!]*$')
APPEND = re.compile(r'^(?:and|also|plus|oh and|i also had|i also ate|also had|add|and also|with|as well as)\b\s*')


def follow_up(say, parts, today, catalog):
    """A message after the first: a removal, an addition, a new amount, a new meal/day, or a new description.
    Returns (parts, info, note) or (None, message, None)."""
    live = [i for i, p in enumerate(parts) if not p['removed']]
    words_of = lambda i: set(name_words(parts[i]['text'])) | set(parts[i].get('_name_words') or [])
    target = lambda words: [i for i in live if words and set(words) <= words_of(i)]
    m = REMOVE.match(' '.join(norm(say).split()))
    if m:
        hit = target(name_words(m['what']))
        if len(hit) == 1:
            parts[hit[0]]['removed'] = True
            return parts, {'meal': None, 'day': None, 'saved_day': None}, 'removed'
    s, info = when(LEAD.sub('', norm(say).strip()), today)
    if s is None: return None, info, None
    s = ' '.join(s.split()).strip(' ,.!')
    if not s or not [t for t in toks(s) if t not in FILLER and t not in CORRECTION]:   # "for lunch", "it was yesterday"
        if info['meal'] or info['day']: return parts, info, 'changed'
    if APPEND.match(s):
        new, extra = describe(APPEND.sub('', s), today, catalog)
        if new is None: return None, extra, None
        for k in ('meal', 'day', 'saved_day'): info[k] = info[k] or extra[k]
        return parts + new, info, 'added'
    p, rest = amount(protect(raw(s), catalog))
    if p and rest is not None:                                   # "make it 300 grams", "the pasta was 2 servings", "two"
        words = [w for t in rest for w in ([stem(t)] if isinstance(t, str) else list(catalog[t[1]]['words']))
                 if w not in FILLER and w not in CORRECTION and w not in COUNTS]
        hit = target(words) if words else ([i for i in live if parts[i].get('_status') == 'quantity'][:1] or
                                           (live if len(live) == 1 else []))
        if len(hit) == 1:
            parts[hit[0]]['portion'] = p
            return parts, info, 'changed'
        if not words and len(live) > 1: return None, 'Which food should change? For example: make the pasta 300 grams.', None
    new, extra = describe(s, today, catalog)
    if new is None: return None, extra, None
    for k in ('meal', 'day', 'saved_day'): extra[k] = extra[k] or info[k]
    return new, extra, 'new'


@router.post('/resolve')
def resolve(body: ResolveIn, user=Depends(current_user)):
    with db.connect() as c:
        return resolve_data(c, user['id'], body)


def resolve_data(c, uid, body, anchor=None):
    today = anchor or dishes._today(c, uid).date()
    catalog = catalog_for(c, uid)
    parts = [{'text': p.text, 'pick': p.pick.model_dump() if p.pick else None, 'saved_day': p.saved_day,
              'portion': p.portion.clean() if p.portion else None, 'removed': p.removed, 'new': p.new} for p in body.parts]
    say = (body.say or '').strip()
    info, note = {'meal': None, 'day': None, 'saved_day': None}, None
    if parts and say:
        for p in parts:            # what each part is now, so "remove the pasta" / "make it 300 g" can find it
            e = pick_entry(p, catalog)
            p['_name_words'] = list(e['words']) if e else []
            p['_status'] = None if p['removed'] else item_for(c, uid, p, catalog)['status']
        parts, info, note = follow_up(say, parts, today, catalog)
        if parts is None: return {'status': 'clarify', 'message': info}
    elif say:
        parts, info = describe(say, today, catalog)
        if parts is None: return {'status': 'clarify', 'message': info}
        note = 'new'
    for p in parts:
        if 'saved_day' not in p: p['saved_day'] = info['saved_day']     # new parts from this message
    if not any(not p['removed'] for p in parts):
        return {'status': 'clarify', 'message': 'Tell me what you ate, for example: 2 eggs and toast for breakfast.', 'parts': [], 'items': []}
    issued = int(time.time())
    items = []
    for i, p in enumerate(parts):
        if p['removed']: continue
        it = item_for(c, uid, p, catalog, issued)
        it['index'] = i
        if it.get('kind') and not p.get('pick'): p['pick'] = {'kind': it['kind'], 'id': it['id']}   # keep the match for follow-ups
        items.append(it)
    state = [{'text': p['text'], 'pick': p['pick'], 'portion': p['portion'], 'removed': p['removed'], 'new': bool(p.get('new')),
              'saved_day': p['saved_day'] and p['saved_day'].isoformat()} for p in parts]
    status = 'ready' if all(i['status'] == 'ready' for i in items) else 'needs'
    return {'status': status, 'parts': state, 'items': items, 'meal': info['meal'], 'day': info['day'] and info['day'].isoformat(),
            'note': note, 'issued': issued, 'client_id': str(uuid.uuid4()), 'message': summary(items, note)}


def product_words(s):
    """Words for catalog matching: Siggi's = siggis, plural-insensitive."""
    return [stem(t) for t in raw(re.sub(r"['’]", '', s)) if t not in (',', ';')]


LEAD_IN = {'i', 'had', 'ate', 'of', 'the', 'a', 'an', 'my'}
BASIC = {'raw', 'whole', 'plain', 'fresh', 'cooked', 'nf', 'regular', 'medium', 'large', 'prepared'}


def lookup(text):
    """Public catalog candidates for one food that isn't in your own foods. Never an automatic write.

    'brand': you named a brand: that brand's products, closest to your words first (Siggi's vanilla skyr).
    'plain': an everyday food: plain database foods with every word in their name ("a banana" -> Bananas, raw).
    'none': nothing reliable. A word shared with a product name never counts as a brand ("banana" is not
    the Banana Time brand), so plain foods aren't offered banana bread or juice.
    A human checks the package and serving on the phone; catalog availability and completeness vary.
    """
    portion, remaining = amount(raw(re.sub(r"['’]", '', text)))
    out = {'text': text, 'query': '', 'kind': 'none', 'foods': [], 'portion': portion}
    if remaining is None or re.search(r'-\s*\d', text): return out
    # Keep brand words such as 'Other', 'Simply' or 'Whole': only grammatical lead-ins go.
    said = ' '.join(t for t in remaining if isinstance(t, str) and t not in LEAD_IN)
    words = set(product_words(said))
    if not words: return out
    out['query'] = query = ' '.join(product_words(said))[:80]
    if len(' '.join(product_words(said))) > 80: return out     # a truncated query isn't the whole description

    usda = _search_usda(query)
    # A word is a brand you named when more results carry it as their brand than as a plain food's name:
    # Chobani, Siggi's. "Banana" names plain foods more often than brands (Banana Time), so it's a food.
    as_food, as_brand = {}, {}
    for f in usda:
        for w in set(product_words(f.get('name') or '')) if f.get('generic') else set(): as_food[w] = as_food.get(w, 0) + 1
        for w in set(product_words(f.get('brand') or '')) if not f.get('generic') else set(): as_brand[w] = as_brand.get(w, 0) + 1
    named = {w for w in words if as_brand.get(w, 0) > as_food.get(w, 0)}
    must = {w for w in words if not as_food.get(w)}    # brand and product words; only plain-food words may be missing

    def branded(foods):
        scored, seen = [], set()
        for f in foods:
            name, brand = set(product_words(f.get('name') or '')), set(product_words(f.get('brand') or ''))
            key = ((f.get('name') or '').lower(), (f.get('brand') or '').lower())
            rest = words - brand
            hits = len(rest & name)
            # A word USDA doesn't know as a food counts too (Kodiak). If USDA couldn't be reached, a word in the
            # product's own name isn't taken as its brand ("Eggs" by The Happy Egg).
            mine = {w for w in words & brand if w in named or not as_food.get(w)} if usda else (words & brand) - name
            # the brand you named, and most of the other words (labels shorten names: "Protein Waffles")
            if mine and must <= name | brand and hits * 2 >= len(rest) and key not in seen:
                seen.add(key); scored.append((-hits, len(scored), f))
        return [f for *_, f in sorted(scored, key=lambda x: x[:2])]

    found = branded(usda)
    if found: return {**out, 'kind': 'brand', 'foods': found[:8]}
    plain = [f for f in usda if f.get('generic') and words <= set(product_words(f.get('name') or ''))]
    # the plainest first: "Egg, whole, raw" before "Egg, deviled"
    plain.sort(key=lambda f: len(set(product_words(f['name'])) - words - BASIC))
    if plain: return {**out, 'kind': 'plain', 'foods': plain[:5]}
    # Open Food Facts is paced (about one search every 6 seconds), so it's asked only when USDA has neither.
    found = branded(_search_off(query))
    return {**out, 'kind': 'brand', 'foods': found[:8]} if found else out


@router.get('/products')
def products(text: str, user=Depends(current_user)):
    """One food (kept for app builds from before /lookup)."""
    if not 2 <= len(text.strip()) <= 200:
        raise HTTPException(400, 'Use a product name up to 200 characters')
    r = lookup(text)
    return {'query': r['query'], 'foods': r['foods'], 'portion': r['portion'], 'kind': r['kind']}


class LookupIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    texts: list[str] = Field(min_length=1, max_length=MAX_PARTS)


@router.post('/lookup')
def lookup_all(body: LookupIn, user=Depends(current_user)):
    """Every new food in one request, looked up side by side, so three new foods don't take three turns."""
    if any(not 2 <= len(t.strip()) <= 200 for t in body.texts):
        raise HTTPException(400, 'Use a product name up to 200 characters')
    with ThreadPoolExecutor(max_workers=4) as pool:
        return {'results': list(pool.map(lookup, body.texts))}


def pick_entry(p, catalog):
    if not p.get('pick'): return None
    return next((e for e in catalog if e['kind'] == p['pick']['kind'] and e['id'] == p['pick']['id']), None)


def item_for(c, uid, p, catalog, issued=None):
    base = {'text': p['text']}
    e = pick_entry(p, catalog)
    if p.get('pick') and not e: return {**base, 'status': 'unknown', 'message': f"“{p['text']}” isn't in your foods any more."}
    read = read_part(p['text'], catalog)
    if read.get('unclear') and not e and not p.get('portion'):
        return {**base, 'status': 'unknown', 'message': f"I couldn't read the amount in “{p['text']}”."}
    if not e:
        found = matches(read, catalog, p.get('saved_day'))
        close = [] if found or p.get('new') else near(read, catalog)
        if close:   # one tap to use your own food, or "something new" to look it up
            return {**base, 'status': 'choose', 'message': f"Is “{p['text']}” one of your foods?",
                    'choices': [choice(x) for x in close[:6]], 'more': False, 'new_ok': True}
        if not found: return {**base, 'status': 'unknown', 'message': f"“{p['text']}” isn't in your foods yet."}
        if len(found) > 1:
            found.sort(key=lambda x: (KIND_RANK[x['kind']], x['name'].lower()))
            return {**base, 'status': 'choose', 'message': f"Which one did you mean by “{p['text']}”?",
                    'choices': [choice(x) for x in found[:12]], 'more': len(found) > 12}
        e = found[0]
    head = {**base, 'kind': e['kind'], 'id': e['id'], 'name': e['name'], 'saved_day': e['saved_day'] and e['saved_day'].isoformat(),
            'detail': KIND_LABEL[e['kind']]}
    portion, note = settle(c, uid, e, p.get('portion') or read['portion'])     # "two" = two of your usual amount
    if portion is None:
        return {**head, 'status': 'quantity', 'message': f"How much {e['name']}? Say grams, or tap an amount.", 'options': quick_amounts(e)}
    entries, why = compute(c, uid, e['kind'], e['row'], portion)
    if not why and too_big(entries): why = 'That portion is too large. Check the amount.'
    if why: return {**head, 'status': 'quantity', 'message': why, 'options': quick_amounts(e)}
    totals = {k: round(sum(x[k] or 0 for x in entries), 1) for k in NUM}
    if all(x['fiber_g'] is None for x in entries): totals['fiber_g'] = None
    out = {**head, 'status': 'ready', 'portion': portion, 'amount': amount_label(entries, e['kind'], portion), 'note': note, 'totals': totals}
    if issued is not None: out['expected'] = fingerprint(uid, e['kind'], e['id'], portion, snapshot(e), issued)
    return out


KIND_LABEL = {'dish': 'Saved recipe', 'combo': 'Saved combination', 'custom': 'My food', 'food': 'Logged before'}


def choice(e):
    return {'kind': e['kind'], 'id': e['id'], 'name': e['name'], 'detail': KIND_LABEL[e['kind']],
            'saved_day': e['saved_day'] and e['saved_day'].isoformat(), 'weight_g': dishes._weight(e['row']) if e['kind'] == 'dish' else None}


def quick_amounts(e):
    if e['kind'] != 'dish': return []
    return [{'label': 'All of it', 'portion': {'share': 1}}, {'label': 'Half', 'portion': {'share': .5}}, {'label': 'A quarter', 'portion': {'share': .25}}]


def summary(items, note=None):
    if all(i['status'] == 'ready' for i in items):
        return {'changed': 'Done, I changed it.', 'added': 'Added. Anything else?', 'removed': 'Removed.'}.get(note, 'Here’s what I found. Check it, then add it.')
    ask = next((i for i in items if i['status'] in ('quantity', 'choose')), None)
    return ask['message'] if ask else next(i['message'] for i in items if i['status'] == 'unknown')


# ---------- adding it ----------
class ItemIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: str = Field(pattern='^(dish|combo|custom|food)$')
    id: int = Field(gt=0)
    portion: Portion
    expected: str = Field(pattern=r'^[a-f0-9]{64}$')


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    items: list[ItemIn] = Field(min_length=1, max_length=MAX_PARTS)
    issued: int
    client_id: str = Field(pattern=r'^[A-Za-z0-9-]{8,40}$')
    day: dt.date
    meal: str = Field(pattern='^(breakfast|lunch|dinner|snacks)$')
    confirm: StrictBool


def source_row(c, uid, kind, fid):
    if kind == 'dish': return dishes._get(c, uid, fid, lock=True)
    table = {'combo': 'saved_meals', 'custom': 'custom_foods', 'food': 'food_entries'}[kind]
    extra = " AND source <> 'dish'" if kind == 'food' else ''
    row = c.execute(f'SELECT * FROM {table} WHERE id = %s AND user_id = %s{extra} FOR UPDATE', (fid, uid)).fetchone()
    if not row: raise HTTPException(404, 'That food was not found')
    return row


@router.post('/confirm')
def confirm(body: ConfirmIn, user=Depends(current_user)):
    with db.connect() as c:
        return confirm_data(c, user['id'], body)


def confirm_data(c, uid, body, include_groups=False):
    if body.confirm is not True: raise HTTPException(400, 'Confirm before adding')
    items = [(i.kind, i.id, i.portion.clean(), i.expected) for i in body.items]
    request_key = hashlib.sha256(json.dumps([[k, f, p, x] for k, f, p, x in items] + [str(body.day), body.meal], sort_keys=True).encode()).hexdigest()
    # Serialize same-account retries. No provider calls or second pooled connection inside this lock.
    c.execute('SELECT id FROM users WHERE id = %s FOR UPDATE', (uid,))
    old = c.execute('SELECT id, ref FROM food_entries WHERE user_id = %s AND client_id LIKE %s', (uid, body.client_id + '-__')).fetchall()
    if old:
        if any((o['ref'] or {}).get('chat_request') != request_key for o in old): raise HTTPException(409, 'This confirmation was already used for a different entry')
        return {'ids': [o['id'] for o in sorted(old, key=lambda o: o['id'])], 'replayed': True}
    if not 0 <= time.time() - body.issued <= 900: raise HTTPException(409, 'This preview expired. Describe it again.')
    rows = []; group_specs=[]
    for kind, fid, p, expected in items:
        row = source_row(c, uid, kind, fid)
        e = {'kind': kind, 'id': fid, 'row': row}
        if expected != fingerprint(uid, kind, fid, p, snapshot(e), body.issued):
            raise HTTPException(409, f"{row['name']} changed. Describe it again to see its current nutrition.")
        entries, why = compute(c, uid, kind, row, p)
        if why: raise HTTPException(400, why)
        if too_big(entries): raise HTTPException(400, 'That portion is too large. Check the amount.')
        rows += entries
        group_specs.append((row['name'],len(entries),p))
    pos = c.execute('SELECT coalesce(max(position), 0) + 1 AS p FROM food_entries WHERE user_id = %s AND day = %s', (uid, body.day)).fetchone()['p']
    ids = []
    for n, x in enumerate(rows):
        ref = {**(x['ref'] or {}), 'chat_request': request_key}
        ids.append(c.execute('''INSERT INTO food_entries (user_id, day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, source, ref, position, client_id)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
                             (uid, body.day, body.meal, x['name'], x['brand'], x['amount'], x['unit'], *(x[k] for k in NUM),
                              x['source'], json.dumps(ref, default=str), pos + n, f'{body.client_id}-{n:02d}')).fetchone()['id'])
    result={'ids':ids,'replayed':False}
    if include_groups:
        groups=[];offset=0
        for name,count,portion in group_specs:
            groups.append({'name':name,'ids':ids[offset:offset+count],'portion':portion});offset+=count
        result['groups']=groups
    return result
