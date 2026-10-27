"""Finite run/walk definitions. Decimal input retains unit intent; no pace guesses.

This is the server contract for the browser builder, native runner and private results.
Targets are canonical seconds/metres, while authored decimal strings retain their units.
"""
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re

FACTORS = {'time': {'s': Decimal(1), 'min': Decimal(60)},
           'distance': {'m': Decimal(1), 'km': Decimal(1000), 'yd': Decimal('.9144'), 'mi': Decimal('1609.344')}}
MAX_STEPS = 1000


def fail(path, message):
    raise ValueError(f'{path}: {message}')


def fields(value, allowed, required, path):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        fail(path, 'Use the supported fields and include every required value.')


def text(value, maximum, path, empty=False):
    if not isinstance(value, str): fail(path, 'Enter text.')
    value = value.strip()
    if (not empty and not value) or len(value) > maximum or any(ord(c) < 32 for c in value):
        fail(path, f'Enter {"0" if empty else "1"}–{maximum} characters without control characters.')
    return value


def integer(value, low, high, path):
    if type(value) is not int or not low <= value <= high: fail(path, f'Enter a whole number from {low} to {high}.')
    return value


def identity(value, seen, path):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value) or value in seen:
        fail(path, 'Use a unique step or block ID.')
    seen.add(value)
    return value


def definition(raw):
    fields(raw, ['schema', 'name', 'description', 'blocks'], ['schema', 'name', 'blocks'], 'Preset')
    if raw['schema'] != 1 or type(raw['schema']) is not int: fail('Preset', 'This preset version is not supported.')
    name = text(raw['name'], 120, 'Name')
    description = text(raw.get('description', ''), 500, 'Description', empty=True)
    if not isinstance(raw['blocks'], list) or not 1 <= len(raw['blocks']) <= 50: fail('Blocks', 'Add 1–50 blocks.')
    blocks, expanded, seen, authored = [], [], set(), 0
    totals = {a: {'seconds': Decimal(0), 'metres': Decimal(0)} for a in ['run', 'walk']}
    for bi, block in enumerate(raw['blocks']):
        path = f'Block {bi+1}'
        fields(block, ['id', 'repeat', 'steps', 'omit_final_recovery'], ['id', 'repeat', 'steps'], path)
        bid = identity(block['id'], seen, path)
        count = integer(block['repeat'], 1, 100, path + ' executions')
        if not isinstance(block['steps'], list) or not 1 <= len(block['steps']) <= 50: fail(path, 'Add 1–50 steps.')
        steps = []
        for si, step in enumerate(block['steps']):
            sp = f'{path}, step {si+1}'
            fields(step, ['id', 'action', 'role', 'title', 'target'], ['id', 'action', 'target'], sp)
            sid = identity(step['id'], seen, sp)
            action, role = step['action'], step.get('role', 'effort')
            if not isinstance(action,str) or not isinstance(role,str) or action not in ['run', 'walk'] or role not in ['effort', 'recovery', 'warmup', 'cooldown']: fail(sp, 'Choose Run/Walk and a supported role.')
            target = step['target']
            fields(target, ['kind', 'amount', 'unit'], ['kind', 'amount', 'unit'], sp + ' target')
            kind, unit, amount = target['kind'], target['unit'], target['amount']
            if not isinstance(kind,str) or not isinstance(unit,str) or kind not in FACTORS or unit not in FACTORS[kind]: fail(sp, 'Choose a time or distance unit.')
            if not isinstance(amount, str) or not re.fullmatch(r'\d{1,12}(?:\.\d{1,6})?', amount): fail(sp, 'Enter a positive decimal amount (up to six decimal places).')
            value = Decimal(amount) * FACTORS[kind][unit]
            lo, hi = (5, 21600) if kind == 'time' else (10, 100000)
            if not lo <= value <= hi: fail(sp, f'Target must be {lo}–{hi} {"seconds" if kind == "time" else "metres"}.')
            amount = format(Decimal(amount), 'f')
            if '.' in amount: amount = amount.rstrip('0').rstrip('.')
            normalized = dict(id=sid, action=action, role=role, title=text(step.get('title', ''), 80, sp + ' title', empty=True), target=dict(kind=kind, amount=amount, unit=unit))
            steps.append(normalized); authored += 1
            if authored > 50: fail('Preset', 'Use at most 50 authored steps.')
        omit = block.get('omit_final_recovery')
        if omit is not None and (omit != steps[-1]['id'] or steps[-1]['action'] != 'walk' or steps[-1]['role'] != 'recovery'):
            fail(path, 'Only the explicitly marked final Walk recovery may be skipped.')
        normalized = dict(id=bid, repeat=count, steps=steps)
        if omit is not None: normalized['omit_final_recovery'] = omit
        blocks.append(normalized)
        for execution in range(1, count + 1):
            for step in steps:
                if execution == count and step['id'] == omit: continue
                target = step['target']; value = Decimal(target['amount']) * FACTORS[target['kind']][target['unit']]
                key = f'{bid}:{step["id"]}:{execution}'
                expanded.append(dict(key=key, block=bid, execution=execution, executions=count, action=step['action'], role=step['role'], title=step['title'], kind=target['kind'], target=float(value)))
                totals[step['action']]['seconds' if target['kind'] == 'time' else 'metres'] += value
                if len(expanded) > MAX_STEPS: fail('Preset', 'Use at most 1,000 expanded steps.')
    seconds, metres = sum(v['seconds'] for v in totals.values()), sum(v['metres'] for v in totals.values())
    if not expanded: fail('Preset', 'Keep at least one step after final recovery is omitted.')
    if seconds > 86400 or metres > 500000: fail('Preset', 'Explicit targets may total at most 24 hours and 500 km.')
    normalized = dict(schema=1, name=name, description=description, blocks=blocks)
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return dict(definition=normalized, content_hash=digest, steps=expanded, totals=dict(seconds=float(seconds), metres=float(metres), by_action={a:{k:float(v) for k,v in t.items()} for a,t in totals.items()}), mixed=bool(seconds and metres))


def results(raw, active_seconds, measured_metres):
    """Validate private observations; never turn client results into recording totals/ranks."""
    from uuid import UUID
    if not isinstance(raw,dict) or len(json.dumps(raw,ensure_ascii=False))>900000: fail('Intervals','The saved session is too large.')
    pin=raw.get('pin')
    fields(pin,['id','version','content_hash','definition'],['id','version','content_hash','definition'],'Pinned preset')
    try: UUID(pin['id'])
    except (ValueError,TypeError,AttributeError): fail('Pinned preset','Invalid preset ID.')
    integer(pin['version'],1,2147483646,'Pinned version');plan=definition(pin['definition'])
    if pin['content_hash']!=plan['content_hash']: fail('Pinned preset','Content changed. Keep the original reviewed snapshot.')
    status=raw.get('status')
    if status not in ['complete','ended','finished']: fail('Intervals','Finish or end the interval session before saving.')
    rows=raw.get('results')
    if not isinstance(rows,list) or not 1<=len(rows)<=len(plan['steps']): fail('Interval results','Include one ordered result per visited step.')
    checked=[];last_time=0.0;last_distance=0.0;known_metres=0.0
    def number(v,path,optional=False):
        if v is None and optional:return None
        if type(v) not in [int,float] or not __import__('math').isfinite(v):fail(path,'Use a finite measured value.')
        return float(v)
    for i,row in enumerate(rows):
        phase=plan['steps'][i];path=f'Result {i+1}'
        fields(row,['key','outcome','start_time','end_time','start_distance','end_distance','unallocated_distance','distance_baseline_time'],['key','outcome','start_time','end_time'],path)
        outcome=row['outcome']
        if row['key']!=phase['key'] or outcome not in ['complete','skipped','ended','finished']:fail(path,'Results must follow the pinned step order.')
        if outcome in ['ended','finished'] and i!=len(rows)-1:fail(path,'Only the final visited step may be ended early.')
        start=number(row['start_time'],path);end=number(row['end_time'],path)
        a=number(row.get('start_distance'),path,True);b=number(row.get('end_distance'),path,True)
        unallocated=number(row.get('unallocated_distance') if row.get('unallocated_distance') is not None else 0,path);baseline_time=number(row.get('distance_baseline_time'),path,True)
        if not 0<=unallocated<=measured_metres+.5 or baseline_time is not None and not start-.001<=baseline_time<=end+.001:fail(path,'Invalid distance evidence boundary.')
        if abs(start-last_time)>.001 or end<start or end>active_seconds+.1:fail(path,'Active-time boundaries must be ordered and fit the recording.')
        if a is not None and not -0.000001<=a<=measured_metres+.5:fail(path,'Distance baseline exceeds the measured recording.')
        if b is not None and not -0.000001<=b<=measured_metres+.5:fail(path,'Distance boundary exceeds the measured recording.')
        if a is not None and a<last_distance-.01 or a is not None and b is not None and b<a-.01:fail(path,'Measured distance cannot go backwards.')
        if a is not None and b is not None:
            if unallocated>b-a+.01:fail(path,'Unallocated distance exceeds the observed span.')
            known_metres+=b-a-unallocated
        if b is not None:last_distance=b
        if outcome=='complete':
            actual=end-start if phase['kind']=='time' else b-a-unallocated if a is not None and b is not None else None
            if actual is None or abs(actual-phase['target'])>(.1 if phase['kind']=='time' else .02):fail(path,'A completed step must reach its pinned target.')
        last_time=end;checked.append(dict(key=row['key'],outcome=outcome,start_time=start,end_time=end,start_distance=a,end_distance=b,unallocated_distance=unallocated,distance_baseline_time=baseline_time))
    if known_metres>measured_metres+.5:fail('Results','Distance was counted more than once.')
    if status=='complete' and (len(rows)!=len(plan['steps']) or rows[-1]['outcome'] not in ['complete','skipped']):fail('Results','The complete sequence must contain every visited step.')
    if status in ['ended','finished'] and rows[-1]['outcome']!=status:fail('Results','An interrupted sequence needs its final partial-step outcome.')
    effects=raw.get('effects',[])
    if not isinstance(effects,list) or len(effects)>4096:fail('Alerts','Too many saved alert events.')
    events=[];sequence=0
    for event in effects:
        fields(event,['sequence','phase','logical_time','kind','voice','vibration','voice_attempt_time','voice_ack_time','vibration_attempt_time','vibration_ack_time'],['sequence','phase','logical_time','kind','voice','vibration'],'Alert')
        seq=integer(event['sequence'],1,2147483646,'Alert sequence');phase=integer(event['phase'],0,len(plan['steps']),'Alert step')
        when=number(event['logical_time'],'Alert time')
        if seq<=sequence or not 0<=when<=active_seconds+.1 or event['kind'] not in ['step','resume','complete']:fail('Alert','Invalid event ordering.')
        states=['pending','attempted','completed','suppressed','failed','unknown','disabled','unsupported']
        if event['voice'] not in states or event['vibration'] not in states:fail('Alert','Unknown delivery status.')
        for channel in ['voice','vibration']:
            attempt=number(event.get(channel+'_attempt_time'),'Alert attempt',True);ack=number(event.get(channel+'_ack_time'),'Alert acknowledgement',True)
            if attempt is not None and not when-.001<=attempt<=active_seconds+.1:fail('Alert','Attempt time must fit the recorded active clock.')
            if ack is not None and (attempt is None or not attempt<=ack<=active_seconds+.1):fail('Alert','Acknowledgement must follow its request.')
        sequence=seq;events.append({**event,'logical_time':when})
    return dict(schema=1,pin={**pin,'definition':plan['definition']},status=status,results=checked,effects=events,
                effects_omitted=integer(raw.get('effects_omitted',0),0,2147483646,'Omitted alert count'),
                summary=dict(visited_steps=len(checked),planned_steps=len(plan['steps']),completed_steps=sum(r['outcome']=='complete' for r in checked),skipped_steps=sum(r['outcome']=='skipped' for r in checked)),
                recorded_totals=dict(active_seconds=active_seconds,metres=measured_metres),
                delivery_evidence='Recorded logical events and API acknowledgements; not proof a person heard or felt an alert.')
