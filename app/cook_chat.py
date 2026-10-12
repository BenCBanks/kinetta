"""Cooking mode in plain words (2026-10-12): type what went in the pot the way you'd text it ("2 apples", "a splash of
olive oil and 3 cloves of garlic", "oops, make that 200 g rice", "take the butter out") and it's added to the dish.

Cheap first, AI only when needed:
1. Memory (free): every ingredient this person has added before is remembered with its values per 100 g and, when they
   said it as a count or a spoon ("2 apples", "1 tbsp oil"), its grams per piece or spoon. A message made only of foods
   they've used before is added straight away, with no AI.
2. Otherwise one Gemini Flash-Lite call reads the whole message (adds, corrections and removals at once). Text only, so
   it costs about half a photo: roughly $0.0005 a message (~700 tokens in, ~250 out; a photo measured ~$0.001). What it
   adds goes into memory, so the next "2 apples" is free. Brake: 150 messages per person per day (at most ~$0.08).
3. No AI (no key on the server, or AI features off for this person): the app falls back to search-and-pick.

The cook's own dish only (api_dishes._get checks user_id). Nothing about the person is sent: just the dish's
ingredient names and amounts and their message.
"""
import os
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import api_dishes as D, coach, db, food_photo
from .auth import current_user

router = APIRouter(prefix='/api/dishes')
DAILY_LIMIT = 150
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
                m = mem.setdefault(k, {'name': it['name'], 'per100': it['per100'], 'units': {}})
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
        grams = p['grams'] or (p['amount'] * m['units'][p['unit'] or 'each'] if (p['unit'] or 'each') in m['units'] else None)
        if not grams or grams >= 20000: return None
        said = f"{p['amount']:g} {p['unit']}" if p['unit'] else f"{p['amount']:g}"
        out.append({'name': m['name'], 'amount': said, 'grams': round(grams, 1), 'per100': m['per100'], 'source': 'memory',
                    'key': key(p['query']), 'units': units_of(said, grams)})
    return out


# ---------- the AI, when memory doesn't know ----------
PROMPT = """You help someone log the ingredients of a dish while they cook, for a calorie and macro tracker. They type
in plain words, like texting a friend, often one ingredient at a time, sometimes several, sometimes a correction.

The dish so far (id | ingredient | grams):
{items}

Their message: \"\"\"{text}\"\"\"

Turn it into actions:
- "add" for each ingredient they put in. Keep their amount. Turn household amounts into grams with typical sizes
  (an apple ~180 g, an egg ~50 g, a tbsp of oil ~13.5 g, a cup of cooked rice ~160 g, a splash of oil ~5 g, a pinch ~0.4 g).
  Give kcal, protein_g, carbs_g, fat_g, fiber_g for THAT amount, using USDA-style values for the food as they'd weigh it
  (raw / dry / as bought) unless they say it's cooked or canned.
- "change" when they correct an ingredient already in the dish: its id and the new total grams.
- "remove" when they took something out or added it by mistake: its id.
name: short and plain, singular, capitalised ("Apple", "Olive oil", "Chicken thigh, skinless"). amount: their amount as
words ("2 medium", "1 tbsp", "200 g").
reply: one short, friendly sentence saying what you did and any size you assumed, e.g. "Added 2 medium apples (about 360 g)."
If the message isn't about food going into this dish, return no actions and say what you can help with."""

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


def ai_actions(text, items):
    """Ask the model; returns (actions, reply). Only the dish's ingredients and the message are sent."""
    lines = '\n'.join(f"{i['id']} | {i['name']} | {i['grams']:g}" for i in items) or '(nothing yet)'
    out, data, model = food_photo.ask([{'text': PROMPT.format(items=lines, text=text)}], SCHEMA, 'cook chat', timeout=45)
    u = data.get('usageMetadata', {})
    print(f"cook chat: model {model} actions {len(out.get('actions') or [])} tokens in {u.get('promptTokenCount')} "
          f"out {u.get('candidatesTokenCount')}", flush=True)
    return (out.get('actions') or [])[:20], ' '.join(str(out.get('reply') or '').split())[:300]


def _ai_item(a):
    """An 'add' from the model as a dish item, or None if its numbers can't be right (more calories than fat has, say)."""
    g, kcal = _n(a.get('grams')), _n(a.get('kcal'))
    name = ' '.join(str(a.get('name') or '').split())[:80]
    if not (name and g and 0 < g < 20000 and kcal is not None and kcal >= 0): return None
    per = {k: (max(_n(a.get(k)) or 0, 0) * 100 / g) for k in D.NUM}
    if a.get('fiber_g') is None: per['fiber_g'] = None
    if per['kcal'] > 950 or any((per[k] or 0) > 100 for k in D.NUM if k != 'kcal'): return None
    amount = ' '.join(str(a.get('amount') or '').split())[:40]
    return {'name': name, 'amount': amount, 'grams': round(g, 1), 'source': 'ai', 'key': key(name), 'units': units_of(amount, g),
            'per100': {k: (round(v, 3) if v is not None else None) for k, v in per.items()}}


def _as_item(x):
    return {'id': secrets.token_hex(4), 'name': x['name'], 'grams': x['grams'], **D._item_values(x['per100'], x['grams']),
            'per100': x['per100'], 'source': x['source'], 'ref': None, 'amount': x.get('amount') or '',
            'key': x.get('key') or key(x['name']), 'units': x.get('units') or {}}


# ---------- the endpoint ----------
class SayIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


def _ai_ready(uid):
    return bool(os.environ.get('GEMINI_API_KEY')) and coach.allowed(uid)


@router.post('/{did:int}/say')
def say(did: int, body: SayIn, user=Depends(current_user)):
    """Returns {dish, added: [item ids], changed, removed, reply, by: 'memory' | 'ai'}; or {fallback: true} (and
    needs_ok when only the person's OK is missing) when the app should search instead."""
    uid, text = user['id'], ' '.join(body.text.split())
    with db.connect() as c:
        d = D._get(c, uid, did)
        found = from_memory(text, memory(c, uid))
    if found is None:
        if not _ai_ready(uid):
            return {'fallback': True, 'needs_ok': bool(os.environ.get('GEMINI_API_KEY')) and coach.enabled()}
        food_photo.brake(uid, DAILY_LIMIT, 'cook', 'messages')
        actions, reply = ai_actions(text, d['items'])
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
                if x: new.append(_as_item(x))
                else: skipped += 1
            elif op == 'change' and it and (g := _n(a.get('grams'))) and 0 < g < 20000:
                it.update(grams=round(g, 1), **D._item_values(it['per100'], g)); changed.append(it['id'])
            elif op == 'remove' and it and it['id'] not in removed:
                removed.append(it['id'])
        items = [i for i in items if i['id'] not in removed] + new
        if len(items) > D.MAX_ITEMS: raise HTTPException(400, f'A dish can have up to {D.MAX_ITEMS} ingredients')
        added = [i['id'] for i in new]
        if added or changed or removed: d = D._save_items(c, uid, did, items)
        if found is not None:
            reply = 'Added ' + ', '.join(f"{i['name'].lower()} ({i['grams']:g} g)" for i in new) + '.'
        elif skipped: reply = (reply + ' ' if reply else '') + "Some numbers didn't look right, so I left that out - try it with a weight."
        return {'dish': D._view(c, uid, d), 'added': added, 'changed': changed, 'removed': removed,
                'reply': reply or "I couldn't tell what went in - try something like 2 apples or 200 g rice.",
                'by': 'memory' if found is not None else 'ai'}
