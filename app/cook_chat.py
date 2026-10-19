"""Cooking mode in plain words (2026-10-12): type what went in the pot the way you'd text it ("2 apples", "a splash of
olive oil and 3 cloves of garlic", "oops, make that 200 g rice", "take the butter out") and it's added to the dish.

Cheap first, AI only when needed:
1. Memory (free): every ingredient this person has added before is remembered with its values per 100 g and, when they
   said it as a count or a spoon ("2 apples", "1 tbsp oil"), its grams per piece or spoon. A message made only of foods
   they've used before is added straight away, with no AI.
2. Otherwise one Gemini Flash-Lite call reads the whole message (adds, corrections and removals at once). Text only, so
   its cost depends on input, output and retries. What it adds goes into memory, so the next "2 apples" is free.
   Durable brake: 60 messages per UTC day, plus the shared AI budget (docs/ai-budgets.md).
3. No AI (no key on the server, or AI features off for this person): the app falls back to search-and-pick.

The cook's own dish only (api_dishes._get checks user_id). Nothing about the person is sent: just the dish's
ingredient names and amounts and their message.
"""
import concurrent.futures
import difflib
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import nutrients as N
from . import api_dishes as D, api_food, coach, db, food_photo
from .auth import current_user

router = APIRouter(prefix='/api/dishes')
DAILY_LIMIT = 60          # messages to the AI per person per day (2026-10-12, was 150): plenty for cooking, a brake on misuse
WEIGHTS = {'g', 'kg', 'oz', 'lb', 'ml', 'cl', 'dl', 'l'}    # units that already say the grams

# ---------- reading the message ----------
WORDNUM = {'a': '1', 'an': '1', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
           'eight': '8', 'nine': '9', 'ten': '10', 'eleven': '11', 'twelve': '12', 'dozen': '12', 'a dozen': '12',
           'half a': '1/2', 'half an': '1/2', 'half': '1/2', 'a half': '1/2', 'a couple of': '2', 'a couple': '2', 'couple of': '2',
           'a few': '3', 'quarter of a': '1/4', 'a quarter of a': '1/4'}
_WN = re.compile(r'^(' + '|'.join(sorted(map(re.escape, WORDNUM), key=len, reverse=True)) + r')\b\s*')
PREP = {'chopped', 'diced', 'sliced', 'minced', 'fresh', 'grated', 'peeled', 'crushed', 'shredded', 'raw', 'whole', 'some',
        'more', 'extra', 'another', 'the', 'of', 'in', 'my', 'about', 'roughly', 'approx', 'around', 'just', 'added', 'add',
        'i', 'put', 'threw', 'used', 'and', 'then', 'also', 'finely', 'roughly'}


def numerals(s):
    """'two apples' -> '2 apples', 'half an onion' -> '1/2 onion', 'a tbsp of oil' -> '1 tbsp of oil'."""
    s = s.strip().lower()
    s = re.sub(r'^(?:i\s+)?(?:added|add|put in|threw in|used|plus|then|and|also)\s+', '', s)
    m = _WN.match(s)
    return WORDNUM[m.group(1)] + ' ' + s[m.end():] if m and s[m.end():] else s


def singular(w):
    if len(w) <= 3 or w.endswith(('ss', 'us', 'is')): return w
    if w.endswith('ies'): return w[:-3] + 'y'
    if w.endswith(('oes', 'ches', 'shes', 'xes', 'ses')): return w[:-2]
    if w.endswith('ves') and w not in ('chives', 'olives'): return w[:-3] + 'f'          # halves, loaves
    return w[:-1] if w.endswith('s') else w


def key(name):
    """How a food is looked up in memory: lower case, singular, no 'chopped' or 'fresh'. 'Apples' and 'apple' match."""
    words = [singular(w) for w in re.findall(r'[a-zà-ÿ]+', (name or '').lower()) if w not in PREP]
    return ' '.join(words)[:60]


def pieces(text):
    """Split a message into one ingredient each - but only where every piece has its own amount, so 'salt and pepper'
    or 'chicken breast, 250 g' stay whole."""
    t = re.sub(r'\s+', ' ', text.replace('\n', ';')).strip()
    out = []
    for chunk in (x for x in t.split(';') if x.strip()):
        parts = [p for p in re.split(r',|\band\b|\bplus\b|&|\bthen\b', chunk) if p.strip()]
        parsed = [D.parse_line(numerals(p)) for p in parts]
        if len(parts) > 1 and all(p['amount'] and p['query'] for p in parsed): out += [numerals(p) for p in parts]
        else: out.append(numerals(chunk))
    return out


# ---------- memory: what this person has added before ----------
def memory(c, uid):
    """key -> {name, per100, units: {'each' | 'tbsp' | 'cup' ...: grams}}. Newest first wins; units add up across dishes."""
    mem = {}
    for d in c.execute('SELECT items FROM dishes WHERE user_id = %s ORDER BY updated DESC LIMIT 80', (uid,)).fetchall():
        for it in d['items']:
            if not it.get('per100') or it['per100'].get('kcal') is None: continue
            for k in {key(it['name']), it.get('key') or ''} - {''}:
                m = mem.setdefault(k, {'name': it['name'], 'per100': it['per100'], 'units': {},'source':it.get('source'),'ref':it.get('ref') or {}})
                for u, g in (it.get('units') or {}).items(): m['units'].setdefault(u, g)
    return mem


def units_of(amount, grams):
    """'2 medium' + 364 g -> {'each': 182}; '1 tbsp' + 13.5 g -> {'tbsp': 13.5}. Weights need nothing remembered."""
    p = D.parse_line(numerals(amount or ''))
    if not (p['amount'] and grams) or p['unit'] in WEIGHTS: return {}
    return {p['unit'] or 'each': round(grams / p['amount'], 1)}


def from_memory(text, mem):
    """Every piece of the message found in memory with a weight -> the items to add; any piece missing -> None."""
    out = []
    for piece in pieces(text):
        p = D.parse_line(piece)
        m = mem.get(key(p['query']))
        if not (m and p['amount']): return None
        if not p['grams'] and (m.get('source')=='ai' or (m.get('ref') or {}).get('origin')=='ai'):return None
        grams = p['grams'] or (p['amount'] * m['units'][p['unit'] or 'each'] if (p['unit'] or 'each') in m['units'] else None)
        if not grams or grams >= 20000: return None
        said = f"{p['amount']:g} {p['unit']}" if p['unit'] else f"{p['amount']:g}"
        out.append({'name': m['name'], 'amount': said, 'grams': round(grams, 1), 'per100': m['per100'], 'source': 'memory','ref':{**{k:v for k,v in m.get('ref',{}).items() if k in ('id','barcode','fdc_id','origin','origin_model')},**({'origin':'ai'} if m.get('source')=='ai' or m.get('ref',{}).get('origin')=='ai' else {})},
                    'key': key(p['query']), 'units': units_of(said, grams)})
    return out


# ---------- the AI, when memory doesn't know ----------
PROMPT = """You help someone log the ingredients of a dish while they cook, for a calorie and macro tracker. They type
in plain words, like texting a friend, often one ingredient at a time, sometimes several, sometimes a correction.

The dish so far (id | ingredient | grams):
{items}

Their message: \"\"\"{text}\"\"\"

{refs}
Turn it into actions:
- "add" for each ingredient they put in. Keep their amount; when they also give a weight ("2 apples which weigh 100 grams",
  "a can of beans, 400 g drained") use that weight as the grams. Turn household amounts into grams with typical sizes
  (an apple ~180 g, an egg ~50 g, a tbsp of oil ~13.5 g, a cup of cooked rice ~160 g, a splash of oil ~5 g, a pinch ~0.4 g).
  Give kcal, protein_g, carbs_g, fat_g, fiber_g for THAT amount, using USDA-style values for the food as they'd weigh it
  (raw / dry / as bought) unless they say it's cooked or canned.
- "change" when they correct an ingredient already in the dish: its id and the new total grams.
- "remove" when they took something out or added it by mistake: its id.
They often type fast: read through misspellings and shorthand ("brocoli", "chiken brest", "bx", "tbs") and name the
food correctly spelled.
name: short and plain, singular, capitalised ("Apple", "Olive oil", "Chicken thigh, skinless"). amount: their amount as
words ("2 medium", "1 tbsp", "200 g").
reply: one short, friendly sentence saying what you did and any size you assumed, e.g. "Added 2 medium apples (about 360 g)."
If the message isn't about food going into this dish, return no actions and say what you can help with."""

REFS = """Real products that may match what they typed (looked up for you; per 100 g as sold):
{lines}
If one is the product they mean, use its package weight and its numbers. If none is the same brand, the closest one is a
good guide to the package size. Always think of the usual size a home cook buys at a US grocery store (a can of tomatoes
or beans is about 14.5-15.5 oz / 410-440 g, a box of pasta 12-16 oz), never food-service or bulk sizes. Say which size
you assumed in the reply so they can check the package.
"""

SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'actions': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'op': {'type': 'STRING', 'enum': ['add', 'change', 'remove']}, 'id': {'type': 'STRING'},
            'name': {'type': 'STRING'}, 'amount': {'type': 'STRING'}, 'grams': {'type': 'NUMBER'}, 'kcal': {'type': 'NUMBER'},
            'protein_g': {'type': 'NUMBER'}, 'carbs_g': {'type': 'NUMBER'}, 'fat_g': {'type': 'NUMBER'}, 'fiber_g': {'type': 'NUMBER'}},
            'required': ['op']}},
        'reply': {'type': 'STRING'}},
    'required': ['actions', 'reply'],
}


def _n(v):
    try: return float(v)
    except (TypeError, ValueError): return None


# ---------- real products (2026-10-12): "a box of bettergoods protein penne" should use the real box, not a guess ----------
# A packaged amount ("a box of", "a can of"...) is looked up first: USDA's database of branded foods (free, lists the
# package weight), and a Google search by the AI (like asking ChatGPT; limited on the free plan). What's found is
# handed to the model as reference, so it uses a real package size and label instead of its memory.
PACKAGES = ('box', 'bag', 'can', 'tin', 'jar', 'package', 'pack', 'packet', 'carton', 'bottle', 'container', 'pouch', 'tub')
SHORT = {'bx', 'bxs', 'pkg', 'pkgs', 'pk', 'pkt', 'btl', 'ctn', 'cntr'}     # how people shorten them in a hurry
_WORD = re.compile(r"[a-z]+", re.I)


def _package_word(w):
    """'box', 'boxes', 'packge', 'botle', 'bx' -> True. Misspellings count; short everyday words ('in', 'pan') don't."""
    w = w.lower()
    if w in SHORT or w in PACKAGES or (w.endswith('es') and w[:-2] in PACKAGES) or (w.endswith('s') and w[:-1] in PACKAGES): return True
    return len(w) >= 5 and bool(difflib.get_close_matches(w, PACKAGES, n=1, cutoff=0.8))


def packaged(text):
    return any(_package_word(w) for w in _WORD.findall(text))


_FILLER = re.compile(r'\b(a|an|one|two|three|half|of|the|whole|full|\d+(\.\d+)?)\b', re.I)


def package_grams(s):
    """'14.5 oz/411 g', '14.5 ONZ', '1 LB', '340 g' -> grams."""
    s = (s or '').lower()
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:g|grm|gram|grams)\b', s)
    if m: return float(m[1])
    m = re.search(r'(\d+(?:\.\d+)?)\s*(oz|onz|ounce|ounces|lb|lbs|pound|pounds|kg)\b', s)
    if not m: return None
    return round(float(m[1]) * {'oz': 28.35, 'onz': 28.35, 'ounce': 28.35, 'ounces': 28.35, 'kg': 1000}.get(m[2], 453.6), 1)


def _usda_products(q):
    key = os.environ.get('FDC_API_KEY') or 'DEMO_KEY'
    def fetch():
        d = api_food._get('https://api.nal.usda.gov/fdc/v1/foods/search?' + urllib.parse.urlencode(
            {'query': q, 'pageSize': 8, 'dataType': 'Branded', 'api_key': key}), timeout=8)
        return d.get('foods') or []
    try: raw = api_food._cached('usda-pkg:' + q.lower(), fetch)
    except Exception: return []
    out = []
    for f in raw:
        food = api_food._fdc_food(f)
        pg = package_grams(f.get('packageWeight') or '')
        if food and not (pg and pg > 2500): out.append({**food, 'package_g': pg})    # not food-service sizes (a #10 can is ~3 kg)
    return out[:5]


def product_refs(text, uid=None):
    """Reference products for each packaged amount in the message, as prompt lines ('' when there's nothing to look up).
    "2 apples which weigh 100 grams and a box of food lion penne" looks up only the penne, with its own words."""
    found = []
    parts = [p.strip() for p in re.split(r'[,;\n]|\band\b|\bplus\b|&|\bthen\b|\balso\b', text, flags=re.I) if p.strip()]
    jobs = []
    for part in [p for p in parts if packaged(p)][:3]:       # a few lookups at most per message
        q = ' '.join(w for w in _FILLER.sub(' ', part).split() if not _package_word(w))
        if len(q) >= 3: jobs += [(_usda_products, q)]
    if not jobs: return ''
    with concurrent.futures.ThreadPoolExecutor(len(jobs)) as pool:      # all at once: a message waits for the slowest, not the sum
        for r in pool.map(lambda j: j[0](j[1]), jobs):
            found += [r] if isinstance(r, dict) else (r or [])[:3]
    if not found: return ''
    line = lambda f: (f"{f.get('brand') or ''} | {f['name']} | package {f['package_g']:g} g | " if f.get('package_g') else f"{f.get('brand') or ''} | {f['name']} | package size unknown | ") + \
        ' '.join(f"{k} {f['per100'][k]:g}" for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g') if f['per100'].get(k) is not None)
    return REFS.format(lines='\n'.join(line(f) for f in found[:10]))


def ai_actions(text, items, uid=None):
    """Ask the model; returns (actions, reply). Only the dish's ingredients and the message are sent (and, for a packaged
    amount, the product words to USDA)."""
    lines = '\n'.join(f"{i['id']} | {i['name']} | " + (f"{i['grams']:g} g" if i.get('grams') else 'weight unknown') for i in items) or '(nothing yet)'
    with food_photo.ai_budget.scope(uid):
        out, data, model = food_photo.ask([{'text': PROMPT.format(items=lines, text=text, refs=product_refs(text, uid))}], SCHEMA, 'cook chat', timeout=45)
    u = data.get('usageMetadata', {})
    print(f"cook chat: model {model} actions {len(out.get('actions') or [])} tokens in {u.get('promptTokenCount')} "
          f"out {u.get('candidatesTokenCount')}", flush=True)
    return (out.get('actions') or [])[:20], ' '.join(str(out.get('reply') or '').split())[:300]


def _ai_item(a):
    """An 'add' from the model as a dish item, or None if its numbers can't be right (more calories than fat has, say)."""
    g, kcal = _n(a.get('grams')), _n(a.get('kcal'))
    name = ' '.join(str(a.get('name') or '').split())[:80]
    if not (name and g and 0 < g < 20000 and kcal is not None and kcal >= 0): return None
    per = {k: (_n(a.get(k))*100/g if _n(a.get(k)) is not None else None) for k in D.NUM}
    if per['kcal'] > 950 or any(v is not None and (v<0 or v>N.PER100_LIMITS[k]) for k,v in per.items()): return None
    amount = ' '.join(str(a.get('amount') or '').split())[:40]
    return {'name': name, 'amount': amount, 'grams': round(g, 1), 'source': 'ai', 'key': key(name), 'units': units_of(amount, g),
            'per100': {k: (round(v, 3) if v is not None else None) for k, v in per.items()}}


def _as_item(x):
    return {'id': secrets.token_hex(4), 'name': x['name'], 'grams': x['grams'], **D._item_values(x['per100'], x['grams']),
            'per100': x['per100'], 'source': x['source'], 'ref': x.get('ref'), 'amount': x.get('amount') or '',
            'key': x.get('key') or key(x['name']), 'units': x.get('units') or {}}


# ---------- the endpoint ----------
class SayIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    previous: str | None = Field(None, max_length=600)


def _ai_ready(uid):
    return bool(os.environ.get('GEMINI_API_KEY')) and coach.allowed(uid, 'food')


@router.post('/{did:int}/say')
def say(did: int, body: SayIn, user=Depends(current_user)):
    """Returns {dish, added: [item ids], changed, removed, reply, by: 'memory' | 'ai'}; or {fallback: true} (and
    needs_ok when only the person's OK is missing) when the app should search instead."""
    uid, text = user['id'], ' '.join(body.text.split())
    with db.connect() as c:
        d = D._get(c, uid, did)
        if body.previous:
            parsed=D.parse_line(numerals(text))
            if parsed.get('grams') and not parsed.get('query'):
                text=(text+' '+D.parse_line(numerals(body.previous))['query'])[:600]
        correction=bool(re.match(r'^(?:remove|delete|take|change|make|oops|replace|set)\b',text,re.I))
        if correction:
            words=set(key(text).split())
            targets=[it for it in d['items'] if set(key(it['name']).split()) and set(key(it['name']).split())<=words]
            if len(targets)>1:
                weights=[float(n) for n in re.findall(r'(\d+(?:\.\d+)?)\s*g\b',text,re.I)]
                targets=[it for it in targets if any(abs((it.get('grams') or 0)-g)<.2 for g in weights)]
            if len(targets)!=1:
                return {'dish':D._view(c,uid,d),'added':[],'changed':[],'removed':[],
                        'reply':'Which ingredient do you mean? Give its name and current amount so I change the right one.',
                        'clarification':text,'by':'clarification'}
        found = from_memory(text, memory(c, uid))
        if found is None and not correction:
            parsed=[D.parse_line(piece) for piece in pieces(text)]
            missing=next((p for p in parsed if not p.get('grams') or not p.get('query')),None)
            if missing:
                query=missing.get('query') or 'this ingredient'
                reply=f'How many grams of {query} went in? Include the food name if you are adding something different.' if missing.get('query') else 'Which food is that amount for? Please include its name and weight.'
                return {'dish':D._view(c,uid,d),'added':[],'changed':[],'removed':[],
                        'reply':reply,'clarification':text,'by':'clarification'}
            categories={'taco','tacos','sandwich','sandwiches','salad','soup','curry','smoothie','pizza','burrito','burritos'}
            if any(p['query'].lower() in categories for p in parsed):
                return {'dish':D._view(c,uid,d),'added':[],'changed':[],'removed':[],
                        'reply':'What kind was it, and what went into it? Include the amount of each ingredient, or use + to enter the nutrition you know.',
                        'clarification':text,'by':'clarification'}
    if found is None:
        if not _ai_ready(uid):
            from . import ai_access
            return {'fallback': True, 'query':text, 'needs_ok': ai_access.has(uid, 'food') and bool(os.environ.get('GEMINI_API_KEY')) and coach.enabled()}
        food_photo.brake(uid, DAILY_LIMIT, 'cook', 'messages')
        actions, reply = ai_actions(text, d['items'], uid)
        if not correction:
            remaining=[D.parse_line(piece) for piece in pieces(text)]
            mismatch=False
            for action in actions:
                match=next((p for p in remaining if action.get('op')=='add' and p.get('grams') and
                            abs((_n(action.get('grams')) or 0)-p['grams'])<.2 and key(str(action.get('name') or ''))==key(p['query'])),None)
                if match is None:mismatch=True;break
                remaining.remove(match)
            if mismatch:
                return {'dish':D._view(c,uid,d),'added':[],'changed':[],'removed':[],
                        'reply':'The lookup did not match the amounts you gave. Please check the food and weight, or enter its nutrition with +.',
                        'clarification':text,'by':'clarification'}
        elif any(a.get('op') not in ('change','remove') or str(a.get('id'))!=targets[0]['id'] or a.get('op')=='change' and (not D.parse_line(text).get('grams') or abs((_n(a.get('grams')) or 0)-D.parse_line(text)['grams'])>=.2) for a in actions):
            return {'dish':D._view(c,uid,d),'added':[],'changed':[],'removed':[],
                    'reply':'The lookup did not identify a single matching ingredient. Please give its name and current amount.',
                    'clarification':text,'by':'clarification'}
    else:
        actions, reply = None, None
    with db.connect() as c:
        items = D._get(c, uid, did, lock=True)['items']
        by_id = {i['id']: i for i in items}
        added, changed, removed, skipped = [], [], [], 0
        new = [_as_item(x) for x in found] if found is not None else []
        for a in actions or []:
            op, it = a.get('op'), by_id.get(str(a.get('id') or ''))
            if op == 'add':
                x = _ai_item(a)
                if x:x.update(amount=f"{x['grams']:g} g",units={})
                if x: new.append(_as_item(x))
                else: skipped += 1
            elif op == 'change' and it and (g := _n(a.get('grams'))) and 0 < g < 20000:
                if not it.get('per100'):
                    per={k:it.get(k)*100/g if it.get(k) is not None else None for k in D.NUM}
                    if any(v is not None and v>(1000 if k=='kcal' else 100) for k,v in per.items()):skipped+=1;continue
                    it.update(grams=round(g,1),per100=per)
                else:it.update(grams=round(g,1),**D._item_values(it['per100'],g))
                changed.append(it['id'])
            elif op == 'remove' and it and it['id'] not in removed:
                removed.append(it['id'])
        items = [i for i in items if i['id'] not in removed] + new
        if len(items) > D.MAX_ITEMS: raise HTTPException(400, f'A dish can have up to {D.MAX_ITEMS} ingredients')
        added = [i['id'] for i in new]
        if added or changed or removed: d = D._save_items(c, uid, did, items)
        if found is not None or new:
            reply = ('AI nutrition estimate. ' if found is None else '') + 'Added ' + ', '.join(f"{i['name'].lower()} ({i['grams']:g} g)" for i in new) + '.'
        if skipped: reply = (reply + ' ' if reply else '') + "Some numbers didn't look right, so I left that out - try it with a weight."
        return {'dish': D._view(c, uid, d), 'added': added, 'changed': changed, 'removed': removed,
                'reply': reply or "I couldn't tell what went in - try something like 2 apples or 200 g rice.",
                'by': 'memory' if found is not None else 'ai'}
