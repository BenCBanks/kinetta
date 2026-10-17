"""Add past days to Nutrition (2026-10-09): weight, calories eaten, macros and calories burned (or the deficit) from
another app or a spreadsheet - pasted text, a CSV file's text, or one day typed in.

Columns are found by their header names (Date, Weight, Calories, Protein, Carbs, Fat, Fiber, Burned/Expenditure/TDEE,
Deficit); several rows for the same date (e.g. one per meal) are added up. Weight is in the person's units unless the
header says kg or lb.

Saving: weight -> weights (source 'import'); calories + macros -> one food entry "Day total (imported)" (source 'import')
unless that day already has food logged here (then it is skipped - no double counting); burned (or eaten + deficit)
-> day_energy, which replaces the estimate for that day everywhere. "Remove imported data" deletes only source 'import'.
"""
import csv
import datetime as dt
import io
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import current_user

router = APIRouter(prefix='/api/food/history')
LB = 2.20462
COLS = {   # field -> header words that mean it (lower case, letters only)
    'date': ('date', 'day'),
    'weight': ('weight', 'weightlb', 'weightlbs', 'weightkg', 'bodyweight', 'scaleweight', 'bodymass', 'kg', 'lb', 'lbs'),
    'eaten': ('calories', 'kcal', 'calorieseaten', 'caloriesin', 'caloriesconsumed', 'intake', 'eaten', 'energy', 'energykcal', 'foodcalories', 'totalcalories'),
    'protein_g': ('protein', 'proteing'), 'carbs_g': ('carbs', 'carb', 'carbohydrates', 'carbsg', 'carbohydratesg', 'netcarbs'),
    'fat_g': ('fat', 'fatg', 'totalfat'), 'fiber_g': ('fiber', 'fibre', 'fiberg'),
    'burned': ('burned', 'caloriesburned', 'caloriesout', 'expenditure', 'energyexpenditure', 'tdee', 'totalburned', 'burn'),
    'deficit': ('deficit', 'caloriedeficit', 'dailydeficit'),
}
DATE_FORMATS = ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%Y/%m/%d', '%b %d, %Y', '%B %d, %Y', '%d %b %Y', '%m-%d-%Y')


def _key(h): return re.sub(r'[^a-z]', '', (h or '').lower())


def _date(v):
    v = (v or '').strip().split('T')[0].split(' ')[0] if re.match(r'^\d{4}-\d\d-\d\d', (v or '').strip()) else (v or '').strip()
    for f in DATE_FORMATS:
        try: return dt.datetime.strptime(v, f).date()
        except ValueError: pass
    return None


def _num(v):
    m = re.search(r'-?\d+(?:\.\d+)?', (v or '').replace(',', ''))
    return float(m.group()) if m else None


def parse(text, units):
    text = (text or '').strip().lstrip('﻿')
    if not text: raise HTTPException(400, 'Paste some rows or choose a file')
    first = text.splitlines()[0]
    delim = '\t' if '\t' in first else ';' if first.count(';') > first.count(',') else ','
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    head = [_key(h) for h in rows[0]]
    col = {}
    for field, names in COLS.items():
        for i, h in enumerate(head):
            if i in col.values(): continue
            if h in names or (field == 'weight' and h.startswith('weight')) or (field == 'eaten' and h.startswith('calories') and 'burn' not in h and 'out' not in h):
                col[field] = i; break
    if 'date' not in col:
        raise HTTPException(400, 'The first row must be column names, with a Date column (e.g. Date, Weight, Calories, Protein, Carbs, Fat, Burned)')
    if len(col) < 2: raise HTTPException(400, 'Found a Date column but none of: Weight, Calories, Protein, Carbs, Fat, Fiber, Burned, Deficit')
    whead = rows[0][col['weight']].lower() if 'weight' in col else ''
    w_kg = 'kg' in whead or (units == 'metric' and 'lb' not in whead)
    kj = 'eaten' in col and 'kj' in rows[0][col['eaten']].lower()
    days, problems = {}, []
    for n, r in enumerate(rows[1:], start=2):
        if not any(x.strip() for x in r): continue
        get = lambda f: _num(r[col[f]]) if f in col and col[f] < len(r) else None
        d = _date(r[col['date']] if col['date'] < len(r) else '')
        if not d: problems.append(f'Row {n}: no date I can read'); continue
        if d > dt.date.today() or d.year < 2000: problems.append(f'Row {n}: date {d} is out of range'); continue
        o = days.setdefault(d, {'day': d.isoformat()})
        w = get('weight')
        if w: o['weight_kg'] = round(w if w_kg else w / LB, 2)
        for f in ('eaten', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'):
            v = get(f)
            if v is not None: o[f] = round(o.get(f, 0) + (v / 4.184 if f == 'eaten' and kj else v), 1)   # several rows a day add up
        for f in ('burned', 'deficit'):
            v = get(f)
            if v is not None: o[f] = v
    out = []
    for d in sorted(days):
        o = days[d]
        if o.get('burned') is None and o.get('deficit') is not None and o.get('eaten') is not None: o['burned'] = o['eaten'] + o['deficit']
        if o.get('eaten') is None and o.get('burned') is not None and o.get('deficit') is not None: o['eaten'] = o['burned'] - o['deficit']
        o.pop('deficit', None)
        for k, hi in (('weight_kg', 400), ('eaten', 15000), ('burned', 15000)):
            if o.get(k) is not None and not (0 < o[k] <= hi):
                problems.append(f"{d}: {k.replace('_kg', '')} {o[k]:g} looks wrong - left out"); o.pop(k)
        if len(o) > 1: out.append(o)
    if len(out) > 3000: raise HTTPException(400, 'That is more than 3,000 days - split it into smaller pieces')
    return out, problems[:30], sorted(col)


class TextIn(BaseModel):
    text: str = Field(max_length=2_000_000)


@router.post('/preview')
def preview(body: TextIn, user=Depends(current_user)):
    with db.connect() as c:
        units = (c.execute('SELECT units FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('units') or 'imperial'
        rows, problems, cols = parse(body.text, units)
        days = [r['day'] for r in rows]
        logged = {str(r['day']) for r in c.execute("""SELECT DISTINCT day FROM food_entries WHERE user_id = %s AND source <> 'import'
                                                       AND day = ANY(%s::date[])""", (user['id'], days)).fetchall()}
        weighed = {str(r['day']) for r in c.execute('SELECT day FROM weights WHERE user_id = %s AND day = ANY(%s::date[])', (user['id'], days)).fetchall()}
    for r in rows:
        r['food_logged_here'] = r['day'] in logged
        r['weight_replaces'] = 'weight_kg' in r and r['day'] in weighed
    return {'rows': rows, 'problems': problems, 'columns': cols}


class DayIn(BaseModel):
    day: dt.date
    weight_kg: float | None = Field(None, gt=0, le=400)
    eaten: float | None = Field(None, ge=0, le=15000)
    protein_g: float | None = Field(None, ge=0, le=1000)
    carbs_g: float | None = Field(None, ge=0, le=2000)
    fat_g: float | None = Field(None, ge=0, le=1000)
    fiber_g: float | None = Field(None, ge=0, le=300)
    burned: float | None = Field(None, ge=0, le=15000)


class SaveIn(BaseModel):
    rows: list[DayIn] = Field(max_length=3000)
    replace: bool = False      # day-by-day grid: an empty box removes that day's imported value


@router.post('')
def save(body: SaveIn, user=Depends(current_user)):
    uid, n = user['id'], {'weights': 0, 'days_food': 0, 'skipped_food': 0, 'burned': 0}
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(uid,))
        from . import api_health_weights as H
        state=H.profile(c,uid)
        for r in body.rows:
            if r.day > dt.date.today(): continue
            if body.replace:   # only imported values are removed; food and weights logged in the app stay
                if r.weight_kg is None: c.execute("DELETE FROM weights WHERE user_id = %s AND day = %s AND source = 'import'", (uid, r.day))
                if r.eaten is None: c.execute("DELETE FROM food_entries WHERE user_id = %s AND day = %s AND source = 'import'", (uid, r.day))
                if r.burned is None: c.execute("DELETE FROM day_energy WHERE user_id = %s AND day = %s AND source = 'import'", (uid, r.day))
            if r.weight_kg:
                H.lift_exclusion(c,uid,r.day,state['tz'] or db.DEFAULT_TZ)
                c.execute("""INSERT INTO weights (user_id, day, kg, source) VALUES (%s, %s, %s, 'import')
                             ON CONFLICT (user_id, day) DO UPDATE SET kg = excluded.kg, source = 'import',health_sample_id=NULL,source_name=NULL""", (uid, r.day, r.weight_kg)); n['weights'] += 1
            if r.eaten is not None:
                if c.execute("SELECT 1 FROM food_entries WHERE user_id = %s AND day = %s AND source <> 'import' LIMIT 1", (uid, r.day)).fetchone():
                    n['skipped_food'] += 1          # food already logged here that day: keep it, don't double count
                else:
                    existing = c.execute("SELECT id FROM food_entries WHERE user_id = %s AND day = %s AND source = 'import' ORDER BY id FOR UPDATE", (uid, r.day)).fetchall()
                    if len(existing) == 1:
                        c.execute("UPDATE food_entries SET kcal=%s, protein_g=%s, carbs_g=%s, fat_g=%s, fiber_g=%s WHERE id=%s AND user_id=%s", (r.eaten,r.protein_g or 0,r.carbs_g or 0,r.fat_g or 0,r.fiber_g,existing[0]['id'],uid))
                        n['days_food'] += 1
                    else:
                        if existing and c.execute('SELECT 1 FROM food_chat_entries WHERE user_id=%s AND entry_id=ANY(%s)', (uid,[e['id'] for e in existing])).fetchone():
                            raise HTTPException(409, 'Imported foods are linked to your conversation. Review them before replacing this day.')
                        c.execute("DELETE FROM food_entries WHERE user_id = %s AND day = %s AND source = 'import'", (uid, r.day))
                        c.execute("""INSERT INTO food_entries (user_id, day, meal, name, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, source)
                                 VALUES (%s, %s, 'snacks', 'Day total (imported)', 1, 'day', %s, %s, %s, %s, %s, 'import')""",
                                  (uid, r.day, r.eaten, r.protein_g or 0, r.carbs_g or 0, r.fat_g or 0, r.fiber_g)); n['days_food'] += 1
            if r.burned:
                c.execute("""INSERT INTO day_energy (user_id, day, burned_kcal, source) VALUES (%s, %s, %s, 'import')
                             ON CONFLICT (user_id, day) DO UPDATE SET burned_kcal = excluded.burned_kcal, source = 'import'""", (uid, r.day, r.burned)); n['burned'] += 1
        H.rebuild(c,uid,state['tz'] or db.DEFAULT_TZ,days=[r.day for r in body.rows])
        from .api_food import _latest_weight
        _latest_weight(c,uid)
    return {'ok': True, **n}


@router.get('/days')
def days_view(start: dt.date, end: dt.date, user=Depends(current_user)):
    """What is already saved for each day start..end (at most 62 days), for the day-by-day grid."""
    if end < start or (end - start).days > 61: raise HTTPException(400, 'Pick at most 62 days')
    uid = user['id']
    with db.connect() as c:
        w = {r['day']: r for r in c.execute('SELECT day, kg, source FROM weights WHERE user_id = %s AND day BETWEEN %s AND %s', (uid, start, end)).fetchall()}
        f = {r['day']: r for r in c.execute("""SELECT day, sum(kcal) FILTER (WHERE source = 'import') AS imp, sum(kcal) FILTER (WHERE source <> 'import') AS app,
                    sum(protein_g) FILTER (WHERE source = 'import') AS p, sum(carbs_g) FILTER (WHERE source = 'import') AS cb, sum(fat_g) FILTER (WHERE source = 'import') AS ft
                    FROM food_entries WHERE user_id = %s AND day BETWEEN %s AND %s GROUP BY day""", (uid, start, end)).fetchall()}
        b = {r['day']: r for r in c.execute('SELECT day, burned_kcal FROM day_energy WHERE user_id = %s AND day BETWEEN %s AND %s', (uid, start, end)).fetchall()}
    out, d = [], start
    while d <= end:
        wr, fr, br = w.get(d), f.get(d) or {}, b.get(d)
        out.append({'day': d.isoformat(), 'weight_kg': wr['kg'] if wr else None, 'weight_in_app': bool(wr) and wr['source'] != 'import',
                    'eaten': round(fr['imp']) if fr.get('imp') is not None else None, 'eaten_in_app': round(fr['app']) if fr.get('app') is not None else None,
                    'protein_g': fr.get('p'), 'carbs_g': fr.get('cb'), 'fat_g': fr.get('ft'), 'burned': round(br['burned_kcal']) if br else None})
        d += dt.timedelta(days=1)
    return out


@router.get('/summary')
def summary(user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute("""SELECT (SELECT count(*) FROM weights WHERE user_id = %(u)s AND source = 'import') AS weights,
                                (SELECT count(*) FROM food_entries WHERE user_id = %(u)s AND source = 'import') AS days_food,
                                (SELECT count(*) FROM day_energy WHERE user_id = %(u)s AND source = 'import') AS burned,
                                (SELECT min(day) FROM (SELECT day FROM weights WHERE user_id = %(u)s AND source = 'import' UNION ALL
                                   SELECT day FROM food_entries WHERE user_id = %(u)s AND source = 'import' UNION ALL
                                   SELECT day FROM day_energy WHERE user_id = %(u)s AND source = 'import') x) AS first""", {'u': user['id']}).fetchone()
    return r


@router.delete('')
def remove(user=Depends(current_user)):
    """Remove everything that came from an import (food logged in the app and normal weigh-ins stay)."""
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(user['id'],))
        a = c.execute("DELETE FROM food_entries WHERE user_id = %s AND source = 'import'", (user['id'],)).rowcount
        removed = c.execute("DELETE FROM weights WHERE user_id = %s AND source = 'import' RETURNING day", (user['id'],)).fetchall();b=len(removed)
        from . import api_health_weights as H
        state=H.profile(c,user['id']);H.rebuild(c,user['id'],state['tz'] or db.DEFAULT_TZ,days=[r['day'] for r in removed])
        from .api_food import _latest_weight
        _latest_weight(c,user['id'])
        d = c.execute("DELETE FROM day_energy WHERE user_id = %s AND source = 'import'", (user['id'],)).rowcount
    return {'ok': True, 'days_food': a, 'weights': b, 'burned': d}
