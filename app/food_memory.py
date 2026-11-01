"""Bounded own-food retrieval. Names are data; the server owns identity and nutrition."""
import datetime as dt
import hashlib
import json
import math
import os
import re
import urllib.parse
from difflib import SequenceMatcher
from fastapi import HTTPException
from . import db, meal_chat as M, nutrients as N

TABLES = {'history': 'food_entries', 'dish': 'dishes', 'combo': 'saved_meals', 'custom': 'custom_foods'}


def candidate(kind, row):
    return {'kind': kind, 'id': row['id'], 'name': row['name'], 'row': row}


def signature(uid, item, portion=None):
    # The authenticated account participates in the digest; IDs alone grant no access.
    portion={k:float(v) if type(v) in (int,float) else v for k,v in (portion or {}).items()}
    return hashlib.sha256(json.dumps([uid, item['kind'], item['id'], item['row'],portion],
                                    sort_keys=True, default=str).encode()).hexdigest()


def source(c, uid, kind, fid, *, lock=False):
    if kind not in TABLES: raise HTTPException(422, 'Choose a food from your suggestions')
    table = TABLES[kind]  # Fixed application table names, never model/client SQL.
    row = c.execute(f'SELECT * FROM {table} WHERE user_id=%s AND id=%s' + (' FOR UPDATE' if lock else ''), (uid, fid)).fetchone()
    if not row: raise HTTPException(404, 'That food was not found')
    if kind == 'dish' and M.dishes._empty(row): raise HTTPException(409, 'Add the recipe nutrition first')
    return candidate(kind, row)


def entries(c, uid, item, portion=None):
    kind = 'food' if item['kind'] == 'history' else item['kind']
    # Suggestions carry a resolved portion. Reinterpreting it as "times last time"
    # would change the shown amount if another food is logged before the tap.
    p, note = (portion, None) if portion is not None else M.settle(c, uid, {**item, 'kind': kind}, None)
    if p is None: return None, note
    rows, why = M.compute(c, uid, kind, item['row'], p)
    if why or M.too_big(rows): return None, why or 'Check the portion before using this food'
    row=item['row']
    if item['kind']=='history' and ((p.get('count')==row['amount']) or (row['unit']=='g' and p.get('grams')==row['amount'])):
        rows[0].update({k:row.get(k) if N.known(row,k) else None for k in N.ALL})
    origin={'name':item['name'],'kind':item['kind'],
            'day':str(item['row']['day']) if item['kind']=='history' else None}
    rows=[{**r,'ref':{**(r.get('ref') or {}),'nutrition_from':origin}} for r in rows]
    return rows, note


def public(c, uid, item):
    kind='food' if item['kind']=='history' else item['kind']
    portion,_=M.settle(c,uid,{**item,'kind':kind},None)
    rows, _ = entries(c, uid, item,portion)
    totals = {k: N.rounded(k, sum(r[k] for r in rows)) if rows and all(N.known(r, k) for r in rows) else None for k in N.ALL}
    return {'kind': item['kind'], 'id': item['id'], 'name': item['name'], 'brand':item['row'].get('brand'),
            'expected': signature(uid, item,portion),'canonical_portion':portion,
            'uses':item.get('uses'),
            'day': str(item['row']['day']) if item['kind'] == 'history' else None,
            'portion': [{'amount': r['amount'], 'unit': r['unit']} for r in rows or []],
            'totals': totals, 'ready': bool(rows) and totals['kcal'] is not None}


def relevance(name, query):
    words = M.name_words(name); said = M.name_words(query)
    if not words or not said: return 0
    phrase = ' '.join(words); text = ' '.join(said)
    exact = len(set(words) & set(said)) / min(len(set(words)),len(set(said)))
    fuzzy = max(SequenceMatcher(None, phrase, text).ratio(),
                sum(max(SequenceMatcher(None, w, q).ratio() for w in words) for q in said) / len(said))
    return (2 if phrase in text else 0) + exact + fuzzy


def retrieve(c, uid, query, day):
    """Read at most 40 frequent and 32 matching sources, plus today's 30 rows."""
    start = dt.date.fromordinal(max(1,day.toordinal()-89))
    frequent = c.execute('''WITH portions AS (
        SELECT lower(btrim(name)) AS nk,lower(btrim(coalesce(brand,''))) AS bk,amount,unit,
          count(*) AS n,max(created) AS seen,(array_agg(id ORDER BY created DESC,id DESC))[1] AS id
        FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s GROUP BY 1,2,3,4),
        ranked AS (SELECT *,sum(n) OVER(PARTITION BY nk,bk) AS uses,
          row_number() OVER(PARTITION BY nk,bk ORDER BY n DESC,seen DESC,id DESC) AS rn FROM portions)
        SELECT f.*,x.uses AS context_uses FROM ranked x JOIN food_entries f ON f.id=x.id
        WHERE x.rn=1 AND f.user_id=%s ORDER BY x.uses DESC,x.seen DESC,x.id DESC LIMIT 40''', (uid, start, day, uid)).fetchall()
    frequent_items=[]
    for row in frequent:
        uses=int(row.pop('context_uses'));frequent_items.append({**candidate('history',row),'uses':uses})
    pool = {('history', item['id']):item for item in frequent_items}
    terms = list(dict.fromkeys(M.name_words(query)))[:16]
    # Each trigram query uses the indexed lowercase name and fixed owner predicate.
    if terms:
        for kind, table in TABLES.items():
            text="lower(name||' '||coalesce(brand,''))" if kind in ('history','custom') else 'lower(name)'
            extra = ' AND day BETWEEN %s AND %s' if kind == 'history' else ''
            args = [uid, terms] + ([start, day] if kind == 'history' else []) + [query]
            rows = c.execute(f'''SELECT * FROM {table} WHERE user_id=%s AND {text} %%>> ANY(%s)
                {extra} ORDER BY word_similarity(%s,{text}) DESC,id DESC LIMIT 8''', args).fetchall()
            for row in rows:
                if kind == 'dish' and (M.dishes._empty(row) or row['name'] in M.dishes.PLACEHOLDERS): continue
                pool[(kind, row['id'])] = candidate(kind, row)
    score=lambda x:relevance(x['name']+' '+(x['row'].get('brand') or ''),query)
    ranked = sorted(pool.values(), key=lambda x: (-score(x), M.KIND_RANK.get(x['kind'], 3), -x['id']))
    matches = []; seen = set()
    for item in ranked:
        key = (M.norm(item['name']), M.norm(item['row'].get('brand') or ''), item['row'].get('unit'))
        if key in seen or score(item) < .8: continue
        seen.add(key); matches.append(item)
        if len(matches) == 12: break
    today = c.execute('''SELECT * FROM food_entries WHERE user_id=%s AND day=%s
                        ORDER BY position,id LIMIT 30''', (uid, day)).fetchall()
    return {'matches': [public(c, uid, x) for x in matches],
            'frequent': [public(c, uid, item) for item in frequent_items],
            'today': [public(c, uid, candidate('history', r)) for r in today]}


def suggestions(uid, query, day=None):
    with db.coach_connect(uid) as c:
        zone = (c.execute('SELECT tz FROM profile WHERE user_id=%s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        today = c.execute("SELECT (now() AT TIME ZONE %s)::date AS day", (zone,)).fetchone()['day']
        found = retrieve(c, uid, query, day or today)
        return {'items': [x for x in found['matches'] if x['ready']][:3]}


def label_entries(part):
    analogue=part.get('analogue')
    if not analogue or part.get('manual'):return
    for entry in part.get('entries') or []:
        entry['name']=analogue['name']
        entry['ref']={**(entry.get('ref') or {}),'estimated_from':analogue['base']}
        if analogue.get('typical_unit'):entry['ref']['typical_portion']=analogue['typical_unit']


def household_portion(food,unit):
    """Use a published USDA household weight; never call 100g a slice or invent grams."""
    from . import api_food as F
    if food.get('source')!='usda' or not re.fullmatch(r'\d{1,12}',str(food.get('id') or '')):return food
    fid=str(food['id']);wanted=M.stem(unit or 'serving')
    try:
        def fetch():
            url='https://api.nal.usda.gov/fdc/v1/food/'+fid+'?'+urllib.parse.urlencode({'api_key':os.environ.get('FDC_API_KEY') or 'DEMO_KEY'})
            return F._get(url).get('foodPortions') or []
        portions=F._cached('usda-portions:'+fid,fetch)
    except Exception:return food
    candidates=[]
    for p in portions[:80]:
        try:grams=float(p.get('gramWeight'));amount=float(p.get('amount') or 1)
        except (ValueError,TypeError):continue
        if not math.isfinite(grams) or not 0<grams<=20000 or not math.isfinite(amount) or not 0<amount<=100:continue
        measure=p.get('measureUnit') or {}
        label=p.get('portionDescription') or f"{amount:g} {measure.get('name') or ''} {p.get('modifier') or ''}".strip()
        words=set(M.product_words(label));household=words&{'slice','piece','cup','bowl','serving','portion'}
        if not household or wanted not in household and wanted not in ('serving','portion'):continue
        candidates.append((p.get('sequenceNumber') or 999,label[:100],grams,next(iter(sorted(household)))))
    if not candidates:return food
    _,label,grams,chosen=min(candidates)
    return {**food,'serving':{'label':label,'g':grams,'is_default':False},'typical_unit':chosen}


def reference_portion(c,uid,item,quantity,unit,original):
    """A described measure must match a stored unit/label or a known weight conversion."""
    if quantity is None:return original
    try:valid=math.isfinite(float(quantity)) and 0<quantity<=100000
    except (ValueError,TypeError,OverflowError):valid=False
    if not valid:raise HTTPException(422,'Use a positive portion within the food-entry limit.')
    unit=(unit or '').lower().strip();row=item['row'];kind='food' if item['kind']=='history' else item['kind']
    if not unit:return M.settle(c,uid,{**item,'kind':kind},{'count':quantity})[0]
    normalize=lambda value:' '.join(M.stem(w) for w in re.findall(r'\w+',str(value).lower()))
    recorded=row.get('unit') if kind=='food' else 'serving'
    if normalize(unit)==normalize(recorded):return {'count':quantity,**({'unit':recorded} if kind=='food' else {})}
    if unit in M.MASS:
        if kind=='food' and str(recorded).lower() in M.MASS:return {'count':quantity*M.MASS[unit]/M.MASS[str(recorded).lower()],'unit':recorded}
        return {'grams':quantity*M.MASS[unit]}
    label=(row.get('ref') or {}).get('serving',{}).get('label') if kind=='food' else row.get('serving_label') if kind=='custom' else (row.get('recipe_source') or {}).get('serving_label') if kind=='dish' else None
    if label:
        described,remaining=M.amount(M.raw(label))
        described_unit=(described or {}).get('unit') or ' '.join(remaining or [])
        if described and described.get('count') and normalize(described_unit)==normalize(unit):
            count=quantity/described['count']
            if kind=='food' and str(recorded).lower() in M.MASS:
                grams=(row.get('ref') or {}).get('serving',{}).get('g')
                if type(grams) not in (int,float) or not math.isfinite(grams) or grams<=0:
                    raise HTTPException(422,'That saved household portion has no known weight. How much did you have?')
                return {'count':count*grams/M.MASS[str(recorded).lower()],'unit':recorded}
            if kind!='food' or normalize(recorded) in ('serving','portion'):
                return {'count':count,**({'unit':recorded} if kind=='food' else {})}
    raise HTTPException(422,'Your saved food uses '+str(recorded or 'a different portion')+'. How much of that saved portion did you have?')
