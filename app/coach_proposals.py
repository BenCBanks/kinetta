"""Algorithms generate allowed options; models only select IDs. Nothing applies before user confirmation."""
import datetime as dt
import hashlib
import json
import uuid

from fastapi import HTTPException
from pydantic import Field

from . import db, plans
from .api_food import EntryIn
from .coach_tools import AccountTools, Empty, complete_food, complete_dish


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def plan_options(current, load):
    """Conservative first set: keep the engine schedule or reduce upcoming load on the same day.

    No added intensity/distance, shifted race, reclaimed missed mileage or invented availability. The engine's
    progression, taper and rest days remain the ceiling. Larger rescheduling requires a separately reviewed rule.
    """
    if not current.get('plan'): return {'candidates': [], 'reason': 'No active plan', 'baseline': fingerprint(current)}
    today = current['today']
    upcoming = [w for wk in current['weeks'] for w in wk['workouts']
                if today < w['day'] <= (dt.date.fromisoformat(today) + dt.timedelta(days=7)).isoformat() and w['status'] == 'upcoming']
    recent = [w for wk in current['weeks'] for w in wk['workouts']
              if (dt.date.fromisoformat(today) - dt.timedelta(days=7)).isoformat() <= w['day'] < today]
    missed = sum(w['status'] == 'missed' for w in recent)
    latest = (load.get('days') or [None])[-1]
    tired = latest and latest['form'] < -20
    candidates = [{'candidate_id': 'keep', 'changes': [], 'reason': 'Keep the current schedule.'}]
    if tired or missed >= 2:
        reason = 'Recent training load is high relative to the longer-term estimate.' if tired else 'Several recent sessions were missed; avoid trying to catch up their distance.'
        for w in upcoming:
            if w['type'] in ('race', 'runwalk') or not w.get('dist'): continue
            reduced = round(w['dist'] * .8, 1)
            if reduced < max(.5, (w.get('original_dist') or w['dist']) * .5): continue
            change = {'day': w['day'], 'dist': reduced, 'type': 'easy' if w['type'] in ('tempo', 'intervals', 'hills', 'long_pace', 'fartlek') else w['type'],
                      'title': f"{('Easy' if w['type'] in ('tempo', 'intervals', 'hills', 'long_pace', 'fartlek') else 'Reduced')} run {reduced:g} {current['plan']['unit']}",
                      'detail': 'Run at a conversational effort. This reduces the original session; it adds no catch-up mileage.'}
            candidates.append({'candidate_id': w['day'] + ':reduce', 'changes': [change], 'reason': reason})
            if len(candidates) >= 4: break
    return {'candidates': candidates, 'baseline': fingerprint({'plan': current, 'load': load}),
            'constraints': ['User confirmation required', 'Future unfinished workouts only', 'Same dates and rest days',
                            'No volume or intensity increase', 'Race date and taper unchanged'],
            'facts': {'missed_last_week': missed, 'latest_load': latest}}


def validate_plan_changes(current, changes):
    originals = {w['day']: w for wk in current.get('weeks', []) for w in wk['workouts']}
    if len(changes) > 3 or len({w['day'] for w in changes}) != len(changes): raise ValueError('Too many or duplicate plan changes')
    for change in changes:
        old = originals.get(change['day'])
        if not old or change['day'] <= current['today'] or old['status'] != 'upcoming': raise ValueError('Only upcoming unfinished workouts can change')
        if old['type'] in ('race', 'runwalk') or not old.get('dist'): raise ValueError('This workout cannot be adapted')
        if not 0 < change['dist'] <= old['dist']: raise ValueError('Adaptation cannot increase distance')
        if change['dist'] < max(.5, (old.get('original_dist') or old['dist']) * .5): raise ValueError('Use a manual plan review for larger reductions')
        if change['type'] not in (old['type'], 'easy', 'recovery'): raise ValueError('Adaptation cannot add intensity')
        if set(change) != {'day', 'type', 'dist', 'title', 'detail'}: raise ValueError('Unsupported plan change')
    return changes


def options_for(uid, connection=None):
    tools = AccountTools(uid)
    current = tools.call('training_plan', {}, connection=connection)
    today = dt.date.fromisoformat(current.get('today') or dt.date.today().isoformat())
    load = tools.call('training_load', {'start': (today - dt.timedelta(days=14)).isoformat(), 'end': today.isoformat()}, connection=connection)
    return plan_options(current, load), current


def meal_combinations(options):
    """Rank known food combinations using exact stored numbers. AI may explain/select, never supply macros."""
    from itertools import combinations
    foods = options['candidates']
    remaining = options['remaining']
    candidates = []
    for count in (1, 2):
        for group in combinations(foods, count):
            if len({(f['source'], f['source_id']) for f in group}) != count: continue
            totals = {k: round(sum(float(f[k] or 0) for f in group), 1) for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g')}
            if remaining['kcal'] is not None and (remaining['kcal'] <= 0 or totals['kcal'] > remaining['kcal']): continue
            score = (max(0, (remaining['protein_g'] or 0) - totals['protein_g'])
                     + abs((remaining['kcal'] or totals['kcal']) - totals['kcal']) / 30)
            candidates.append({'candidate_id': '+'.join(f['candidate_id'] for f in group), 'foods': list(group), 'totals': totals, 'score': score})
    candidates.sort(key=lambda x: (x['score'], x['candidate_id']))
    return {'day': options['day'], 'remaining': remaining, 'candidates': candidates[:8],
            'baseline': fingerprint(options), 'limitations': options['limitations']}


class ProposalIn(Empty):
    kind: str = Field(pattern='^(plan|food)$')
    candidate_id: str = Field(min_length=1, max_length=80)
    day: dt.date | None = None
    meal: str = Field('dinner', pattern='^(breakfast|lunch|dinner|snacks)$')


def create(uid, body):
    if body.kind == 'plan':
        options, current = options_for(uid)
        candidate = next((x for x in options['candidates'] if x['candidate_id'] == body.candidate_id), None)
        if not candidate or not candidate['changes']: raise HTTPException(400, 'No permitted plan change selected')
        validate_plan_changes(current, candidate['changes'])
        payload = {'plan_id': current['plan']['id'], 'candidate': candidate}
    else:
        if body.day is None: raise HTTPException(400, 'Choose a day')
        options = meal_combinations(AccountTools(uid).call('meal_options', {'day': body.day.isoformat()}))
        candidate = next((x for x in options['candidates'] if x['candidate_id'] == body.candidate_id), None)
        if not candidate: raise HTTPException(400, 'No permitted food combination selected')
        payload = {'day': body.day.isoformat(), 'meal': body.meal, 'candidate': candidate}
    pid = uuid.uuid4()
    with db.connect() as c:
        c.execute("DELETE FROM coach_proposals WHERE user_id = %s AND expires < now() AND status = 'pending'", (uid,))
        c.execute('INSERT INTO coach_proposals (id, user_id, kind, payload, baseline) VALUES (%s, %s, %s, %s, %s)',
                  (pid, uid, body.kind, json.dumps(payload, default=str), options['baseline']))
    return {'id': str(pid), 'kind': body.kind, 'payload': payload, 'status': 'pending', 'confirmation_required': True}


def confirm(uid, pid, *, thread=False):
    with db.connect() as c:
        from . import food_thread_receipts as receipts
        c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(uid,))
        # Serialize independent confirmations for this account before checking current state.
        c.execute('SELECT pg_advisory_xact_lock(%s)', (-uid,))
        row = c.execute('SELECT *, expires < now() AS expired FROM coach_proposals WHERE user_id = %s AND id = %s FOR UPDATE', (uid, pid)).fetchone()
        if not row: raise HTTPException(404, 'Proposal not found')
        if row['status'] == 'applied':
            if thread and row['kind']=='food':
                clients=[f'{pid}-{i}' for i in range(len(row['payload']['candidate']['foods']))]
                ids=[r['id'] for r in c.execute('SELECT id FROM food_entries WHERE user_id=%s AND client_id=ANY(%s)',(uid,clients))]
                return {'status':'applied','already_applied':True,'messages':receipts.create(c,uid,ids),'entry_ids':ids,'removed_after_apply':not bool(ids)}
            return {'status':'applied','already_applied':True}
        if row['expired'] or row['status'] != 'pending': raise HTTPException(409, 'This proposal is no longer available')
        payload = row['payload'];ids=[];messages=[]
        if row['kind'] == 'plan':
            c.execute('SELECT id FROM training_plans WHERE user_id = %s AND id = %s AND active FOR UPDATE', (uid, payload['plan_id']))
            options, current = options_for(uid, connection=c)
            if options['baseline'] != row['baseline']: raise HTTPException(409, 'Your plan or training changed. Review a fresh proposal.')
            candidate = next((x for x in options['candidates'] if x['candidate_id'] == payload['candidate']['candidate_id']), None)
            if candidate != payload['candidate']: raise HTTPException(409, 'This adjustment is no longer allowed')
            try: validate_plan_changes(current, candidate['changes'])
            except ValueError as e: raise HTTPException(409, str(e)) from e
            for change in candidate['changes']:
                workout = {k: v for k, v in change.items() if k != 'day'}
                c.execute('''INSERT INTO plan_adjustments (user_id, plan_id, day, workout) VALUES (%s, %s, %s, %s)
                             ON CONFLICT (plan_id, day) DO UPDATE SET workout = excluded.workout, created = now()''',
                          (uid, payload['plan_id'], change['day'], json.dumps(workout)))
        else:
            options = meal_combinations(AccountTools(uid).call('meal_options', {'day': payload['day']}, connection=c))
            if options['baseline'] != row['baseline']: raise HTTPException(409, 'Your food or targets changed. Review a fresh proposal.')
            candidate = next((x for x in options['candidates'] if x['candidate_id'] == payload['candidate']['candidate_id']), None)
            if candidate != payload['candidate']: raise HTTPException(409, 'This combination is no longer available')
            for i, food in enumerate(candidate['foods']):
                if food['source']=='dish':
                    source=c.execute('SELECT * FROM dishes WHERE user_id=%s AND id=%s FOR SHARE',(uid,food['source_id'])).fetchone()
                    if not source or not complete_dish(source):raise HTTPException(409,'That recipe changed. Review a fresh proposal.')
                    from .api_dishes import _totals,_weight
                    current=_totals(source);share=food.get('share',food['amount'])
                    if source['name']!=food['name'] or any(current.get(k) is None or round(current[k]*share,1)!=food[k] for k in ('kcal','protein_g','carbs_g','fat_g')):
                        raise HTTPException(409,'That recipe changed. Review a fresh proposal.')
                    ref={'dish_id':source['id'],'dish_kcal':_totals(source)['kcal'],'weight_g':_weight(source)};origin='dish';fiber=_totals(source).get('fiber_g')
                    fiber=fiber*food.get('share',food['amount']) if fiber is not None else None
                else:
                    source=c.execute('SELECT source,ref,fiber_g,amount,name,unit,kcal,protein_g,carbs_g,fat_g FROM food_entries WHERE user_id=%s AND id=%s FOR SHARE',(uid,food['source_id'])).fetchone()
                    if not source or not complete_food(source,source.get('ref')) or any(source[k]!=food[k] for k in ('name','amount','unit','kcal','protein_g','carbs_g','fat_g')):
                        raise HTTPException(409,'That food changed. Review a fresh proposal.')
                    ref=source['ref'];origin=source['source'];fiber=source['fiber_g']
                entry = EntryIn.model_validate({**{k: food[k] for k in ('name', 'amount', 'unit', 'kcal', 'protein_g', 'carbs_g', 'fat_g')},
                                               'day': payload['day'], 'meal': payload['meal'], 'source':origin,'fiber_g':fiber,'ref':ref,'client_id':f'{pid}-{i}'})
                saved=c.execute('''INSERT INTO food_entries (user_id, day, meal, name, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, source, ref, client_id, position)
                             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                               (SELECT coalesce(max(position), 0) + 1 FROM food_entries WHERE user_id = %s AND day = %s)) RETURNING id''',
                          (uid, entry.day, entry.meal, entry.name, entry.amount, entry.unit, entry.kcal, entry.protein_g, entry.carbs_g,
                           entry.fat_g, entry.fiber_g, entry.source, json.dumps(entry.ref) if entry.ref else None, entry.client_id, uid, entry.day)).fetchone()
                ids.append(saved['id'])
            if thread:messages=receipts.create(c,uid,ids)
        c.execute("UPDATE coach_proposals SET status = 'applied' WHERE user_id = %s AND id = %s", (uid, pid))
    return {'status':'applied','already_applied':False,**({'messages':messages,'entry_ids':ids} if thread else {})}
