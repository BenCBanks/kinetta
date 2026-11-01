"""Food-chat understanding evaluation. Run inside a throwaway Kinetta app container (never the live server):

  docker compose -p <test> exec -T -e CHAT_EVAL_MODE=rules app python - < dev/evals/chat_eval.py      # free baseline
  docker compose -p <test> exec -T -e CHAT_EVAL_MODE=ai -e CHAT_EVAL_ACCEPT_PAID_CALLS=1 \\
      -e KINETTA_AI_DAILY_USD=<cap> ... app python - < dev/evals/chat_eval.py                            # paid, capped

Cases come from /tmp/chat_cases.py (copy dev/evals/chat_cases.py there). Setup messages build each card with the
code-only chat and stand-in catalog/estimator results; only the case's own message goes to the real model, through
the normal budget/attempt accounting (the server's daily dollar cap stops further calls). Fictional accounts are
deleted afterwards. Output: JSON summary on stdout plus per-case lines in CHAT_EVAL_OUTPUT if set.
"""
import json, os, re, sys, uuid, datetime as dt, time
from contextlib import ExitStack
from unittest.mock import patch
sys.path.insert(0, '/tmp'); sys.path.insert(0, '/srv')
from fastapi.testclient import TestClient
from app import db, auth, meal_chat, food_thread, food_thread_facts as facts
from app import food_thread_understand as U, food_thread_compose as compose
from app.main import app
import chat_cases

MODE = os.environ.get('CHAT_EVAL_MODE', 'rules')
if MODE == 'ai' and os.environ.get('CHAT_EVAL_ACCEPT_PAID_CALLS') != '1': sys.exit('Paid calls need CHAT_EVAL_ACCEPT_PAID_CALLS=1')
COMPARISON=os.environ.get('CHAT_EVAL_COMPARISON')=='1'
META=None
if COMPARISON:
    from food_eval_guard import provenance,setup,reserve,spending,output as capture_output
    META=provenance()
    if META['mode']=='candidate':from app import food_memory_understand as CONTEXTUAL
    else:CONTEXTUAL=None
PW = 'green teapot on the hill'
CALLS = []


def lookup(text): return {'kind': 'none', 'text': text, 'foods': []}


def estimate(body, user=None, strict=False):
    CALLS.append(body.note or '')
    items = []
    for chunk in re.split(r'\n|,| and | with ', body.note or ''):
        chunk = chunk.strip()
        if not chunk: continue
        m = re.match(r'(\d+(?:\.\d+)?)\s+(.*)', chunk); n = float(m[1]) if m else 1
        items.append({'name': (m[2] if m else chunk).capitalize()[:60], 'amount': f'{n:g} serving', 'grams': 100 * n, 'kcal': 100 * n, 'protein_g': 5, 'carbs_g': 10, 'fat_g': 4, 'fiber_g': 1})
    return {'items': items, 'notes': 'stand-in', 'model': 'stand-in'}


def words(text): return {w.rstrip('s') for w in meal_chat.name_words(text or '')} | set(meal_chat.name_words(text or ''))


def account():
    login = 'zz_test_chateval_' + uuid.uuid4().hex[:10]
    with db.connect() as c:
        uid = c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id', (login, 'Fictional', auth.hash_pw(PW))).fetchone()['id']
        c.execute("INSERT INTO profile(user_id,tz,ai_ok,ai_adult_at,birth_year,weight_kg,kcal_target,protein_target) VALUES (%s,'UTC',true,now(),1990,75,2000,110)", (uid,))
    cl = TestClient(app); cl.headers['Origin'] = 'http://testserver'
    assert cl.post('/api/login', json={'login': login, 'password': PW}).status_code == 200
    return uid, cl


def post(cl, text, draft, context):
    cid = str(uuid.uuid4())
    r = cl.post('/api/food/thread/messages', json={'client_id': cid, 'body': text, 'review_only': True, 'draft_id': draft, 'context': context or cid})
    return cid, r.json()['message']


def run_rules(cl, mid):
    n = len(CALLS)
    with ExitStack() as stack:
        stack.enter_context(patch('app.food_thread_understand.enabled',return_value=False))
        if COMPARISON and CONTEXTUAL:stack.enter_context(patch('app.food_memory_understand.enabled',return_value=False))
        data = cl.post(f'/api/food/thread/messages/{mid}/process', json={}).json()
    reply = next(m for m in data['messages'] if m.get('reply_to') == mid)
    if reply['result'].get('can_resolve'):
        data = cl.post(f'/api/food/thread/messages/{mid}/resolve', json={}).json()
        reply = next(m for m in data['messages'] if m.get('reply_to') == mid)
    return data, reply, CALLS[n:]


def classify_rules(message, data, reply):
    """What the code-only chat did, in the same vocabulary as the model's intents."""
    r = reply['result']; kind = r.get('kind'); text = reply['body']
    if kind == 'answer':
        return {'small_talk': 'chat', 'cancel': 'cancel', 'clarification_help': 'unclear'}.get(r.get('intent'), 'ask_log'), []
    if kind == 'edit':
        return ('remove' if text.startswith('Removed') else 'correct' if text.startswith('Changed') else 'move' if text.startswith('Okay,') else 'answer'), []
    foods = [{'name': p['text'], 'quantity': None} for p in r.get('parts', [])]
    continued = any(m.get('reply_to') and m['reply_to'] != reply['reply_to'] and (m['result'] or {}).get('kind') in ('continued', 'preview') and (m['result'] or {}).get('continued_to') for m in data['messages'])
    try: question = facts.classify(message, __import__('datetime').date.today())
    except Exception: question = None
    if question and question['kind'] == 'food_info': return 'ask_food', foods
    return ('answer' if continued else 'log'), foods


def score(case, intent, foods, u=None, card=''):
    checks = {'intent': intent in case['intents']}
    if case['foods']:
        found = all(any({meal_chat.stem(w).rstrip('s') for w in f['words']} <= words(p['name']) for p in foods) for f in case['foods'])
        checks['foods'] = found
        if u is not None:
            qty_ok = True
            for f in case['foods']:
                match = next((p for p in foods if {meal_chat.stem(w).rstrip('s') for w in f['words']} <= words(p['name'])), None)
                allowed = f['quantity'] if isinstance(f['quantity'], list) else [f['quantity']]
                if match and f['quantity'] is not None and match['quantity'] not in allowed: qty_ok = False
            checks['quantities'] = qty_ok
    if case.get('absent'):
        checks['no_repeats'] = not any(meal_chat.stem(w) in words(p['name']) for w in case['absent'] for p in foods)
    if u is not None:
        if case['missing']: checks['missing'] = u['missing'] in (case['missing'] if isinstance(case['missing'], list) else [case['missing']])
        if case['target']: checks['target'] = meal_chat.stem(case['target']) in words(u['target'] or '')
        if case['new_quantity'] is not None: checks['new_quantity'] = u['new_quantity'] == case['new_quantity']
        if case['meal']: checks['meal'] = u['meal'] in (case['meal'] if isinstance(case['meal'], list) else [case['meal']])
        if case['topic']: checks['topic'] = u['topic'] in (case['topic'] if isinstance(case['topic'], list) else [case['topic']])
        if case['nutrient']: checks['nutrient'] = u['nutrient'] == case['nutrient']
    return checks


def main():
    previous=[]
    if COMPARISON:
        setup(META)
        path,previous=capture_output(os.environ['CHAT_EVAL_OUTPUT'],META,'existing-understanding')
        out=path.open('a')
    else:out = open(os.environ['CHAT_EVAL_OUTPUT'], 'w') if os.environ.get('CHAT_EVAL_OUTPUT') else None
    done={row['i'] for row in previous}
    started=time.monotonic()
    totals = {'cases': 0, 'passed': 0, 'intent_ok': 0, 'food_cases': 0, 'foods_ok': 0, 'invented_amounts': 0, 'reply_number_violations': 0, 'model_failures': 0}
    uids = []
    if previous:
        for line in previous:
            for key,value in line['totals_delta'].items():totals[key]+=value
    with ExitStack() as stack:
        stack.enter_context(patch('app.meal_chat.lookup',side_effect=lookup))
        stack.enter_context(patch('app.food_photo.estimate',side_effect=estimate))
        if COMPARISON:
            from app import ai_budget,food_photo
            stack.enter_context(ai_budget.after_reserve(lambda aid:reserve(META,aid)))
            stack.enter_context(patch('app.food_thread_understand.enabled',return_value=True))
            if CONTEXTUAL:stack.enter_context(patch('app.food_memory_understand.enabled',return_value=True))
            if META['dry_run']:
                stack.enter_context(patch('app.food_photo.ask',return_value=({'intent':'unclear','foods':[],'reply':'Dry run.'},{},'dry-run')))
        for i, case in enumerate(chat_cases.CASES[:int(os.environ.get('CHAT_EVAL_LIMIT', '100000'))]):
            if i in done:continue
            before_totals=dict(totals);begin=time.monotonic()
            uid, cl = account(); uids.append(uid); draft = str(uuid.uuid4()); context = None
            for text in case['setup']:
                cid, m = post(cl, text, draft, context); run_rules(cl, m['id']); context = cid
            cid, m = post(cl, case['message'], draft, context)
            u = None; card = ''
            if MODE == 'rules':
                data, reply, _ = run_rules(cl, m['id']); intent, foods = classify_rules(case['message'], data, reply); said = reply['body']
            else:
                with db.connect() as c:
                    row = c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE id=%s', (m['id'],)).fetchone()
                    ctx = U.context(c, uid, row); card = ctx['card']
                    if COMPARISON and CONTEXTUAL:
                        contextual=CONTEXTUAL.context(c,uid,row);key=str(uuid.uuid4());contextual['lease']=key
                        until=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=180)).isoformat()
                        c.execute("UPDATE food_chat_messages SET result=result||%s::jsonb WHERE user_id=%s AND id=%s",
                            (json.dumps({'_memory_lease':{'id':key,'until':until}}),uid,row['id']))
                try:
                    if COMPARISON and CONTEXTUAL:
                        raw,_,_=CONTEXTUAL.ask_model(uid,row,contextual,ctx)
                        u=CONTEXTUAL.clean(raw,case['message'],contextual)
                    else:u = U.clean(U.ask_model(uid, row, ctx), case['message'])
                except Exception as error: u = None; print('model failure', type(error).__name__, str(getattr(error, 'detail', ''))[:120], file=sys.stderr)
                if u is None:
                    totals['model_failures'] += 1; u = {'intent': None, 'foods': [], 'missing': None, 'target': None, 'new_quantity': None, 'meal': None, 'topic': None, 'nutrient': None, 'reply': ''}
                intent, foods, said = u['intent'], u['foods'], u['reply']
                typed = set(re.findall(r'\d+', case['message'] + ' ' + card))
                if any(n not in typed for n in re.findall(r'\d+', said or '')): totals['reply_number_violations'] += 1
                # An amount was said if the message has a number, article, size or unit anywhere.
                said_amount = compose.has_amount(case['message']) or re.search(r"\b(?:a|an|one|grande|venti|tall)\b", case['message'].lower())
                if not case['setup'] and not said_amount:
                    if any(f['quantity'] is not None for f in foods): totals['invented_amounts'] += 1
            checks = score(case, intent, foods, u, card)
            ok = all(checks.values())
            totals['cases'] += 1; totals['passed'] += ok; totals['intent_ok'] += checks['intent']
            if 'foods' in checks: totals['food_cases'] += 1; totals['foods_ok'] += checks['foods']
            line = {'i': i, 'setup': case['setup'], 'message': case['message'], 'expected': case['intents'], 'got': intent, 'ok': ok,
                    'failed': [k for k, v in checks.items() if not v], 'foods': [(f['name'], f.get('quantity')) for f in foods], 'reply': said,
                    **({k: u[k] for k in ('missing', 'target', 'new_quantity', 'meal', 'topic', 'nutrient')} if u else {})}
            line['seconds']=round(time.monotonic()-begin,3)
            line['totals_delta']={key:totals[key]-before_totals[key] for key in before_totals}
            if COMPARISON:
                with db.connect() as c:
                    line['attempts']=c.execute('SELECT model,state,input_tokens,output_tokens,thinking_tokens,charged_micros FROM ai_food_attempts WHERE user_id=%s ORDER BY created',(uid,)).fetchall()
                    c.execute('DELETE FROM users WHERE id=%s',(uid,))
                uids.remove(uid)
            if out: out.write(json.dumps(line,default=str) + '\n'); out.flush()
            print(i,'PASS' if ok else ','.join(line['failed']),flush=True) if COMPARISON else None
    with db.connect() as c:
        spent = c.execute('SELECT coalesce(sum(charged_micros),0) AS s, count(*) AS n FROM ai_food_attempts WHERE user_id=ANY(%s)', (uids,)).fetchone()
        if not COMPARISON:c.execute('DELETE FROM ai_food_attempts WHERE user_id=ANY(%s)', (uids,))
        c.execute('DELETE FROM users WHERE id=ANY(%s)', (uids,))
    if COMPARISON:
        lines=[json.loads(line) for line in path.read_text().splitlines() if line]
        attempts=[a for line in lines for a in line.get('attempts',[])]
        spent={'n':len(attempts),'s':sum(a['charged_micros'] for a in attempts)}
    totals.update(mode=MODE, attempts=spent['n'], spent_usd=round(float(spent['s']) / 1e6, 4),
                  intent_accuracy=round(totals['intent_ok'] / totals['cases'], 3), pass_rate=round(totals['passed'] / totals['cases'], 3),
                  food_accuracy=round(totals['foods_ok'] / max(1, totals['food_cases']), 3))
    if COMPARISON:
        totals.update(**META,cumulative_spending=spending(META),complete=totals['cases']==len(chat_cases.CASES),seconds=round(time.monotonic()-started,3),
            estimator='stand-in; this existing benchmark scores interpretation only')
        path.with_suffix('.summary.json').write_text(json.dumps(totals,indent=2))
    print(json.dumps(totals))


main()
