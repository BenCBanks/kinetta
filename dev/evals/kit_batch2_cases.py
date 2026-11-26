"""Fixed batch-two model inputs; transport/storage are independently tested offline."""
import json
import datetime as dt
import uuid
from contextlib import ExitStack
from unittest.mock import patch

from kit_cases import CASES
from kit_gate_cases import GATE_CASE_IDS

# Replace nine basic retrieval cases; retain all ten weekly and safety cases.
REPLACED = {'protein', 'fiber', 'activity-all', 'ride', 'walk', 'runs', 'gear', 'food-help', 'strength-max'}
EXTRA = [
 ('batch2-saved-history', 'Which days did I say I can train? Suggest one next step.', {'goals', 'app_features'},
  {'prior': 'I can train on Tuesday and Saturday only.', 'resume': True}),
 ('batch2-history-correction', 'Actually, I can train on Sunday only. Suggest one practical next step.', {'goals', 'app_features'},
  {'prior': 'I can train on Tuesday and Saturday only.', 'resume': True}),
 ('batch2-memory-use', 'Use my saved routine to suggest one practical next step toward my activity goal.', {'goals'},
  {'memory': 'My available days are Tuesday and Saturday.'}),
 ('batch2-memory-off', 'What training days have I told you? Do not guess if you cannot see them.', {'app_features'},
  {'memory': 'My available days are Tuesday and Saturday.', 'memory_off': True}),
 ('batch2-goal-preview', 'Change my weekly running distance goal to 25 km.', {'goals', 'goal_change_options'}, {}),
 ('batch2-goal-clarify', 'Change my running goal. Ask me what you need before offering a change.', {'goals', 'app_features'}, {}),
 ('batch2-next-step', 'Review my training. Given my saved goal and routine, suggest one specific next step. Ask one question only if something essential is missing.', {'goals'},
  {'memory': 'I prefer walking and my available days are Tuesday and Saturday.', 'training_records': True}),
 ('batch2-current-overrides-memory', 'I prefer cycling now, and I can train on Sunday only. Suggest one next step using my current preference and saved goal; do not change a goal automatically.', {'goals'},
  {'memory': 'I prefer running and my available days are Tuesday and Saturday.',
   'prior': 'I prefer running on Tuesday and Saturday.', 'resume': True}),
 ('batch2-chart-distance', 'Show my recorded running distance by workout over the past week as a chart.', {'chart_series'}, {'chart_records': True}),
]
BATCH2_CASES = [c for c in CASES if c[0] in GATE_CASE_IDS and c[0] not in REPLACED] + EXTRA


def chart_records(today):
    return [{'sport':'run','source':'manual','name':'Fictional chart run',
             'start_time':dt.datetime.combine(today-dt.timedelta(days=days),dt.time(12),dt.timezone.utc).isoformat(),
             'distance_m':distance,'moving_s':seconds}
            for days,distance,seconds in [(6,3000,900),(4,5000,1500),(2,7000,2100)]]


def training_records(today):
    # Three distinct measured weeks inside the six-week review, independent of weekday.
    return [{**record,'name':'Fictional training review run',
             'start_time':dt.datetime.combine(today-dt.timedelta(days=days),dt.time(12),dt.timezone.utc).isoformat()}
            for record,days in zip(chart_records(today),(6,20,34))]


def required_shape(case_id, variant, answer):
    if case_id=='batch2-next-step' and variant=='candidate' and answer:
        chart=answer.get('chart') or {}
        if (chart.get('presentation')!='weekly_totals' or chart.get('metric')!='distance'
                or chart.get('aggregate')!='sum' or chart.get('group_by')!='week' or chart.get('sport')!='all'):
            return 'Required app-owned six-week training distance totals are missing.'
        points=chart.get('points',[])
        if (len(points)!=6 or sorted(p['value'] for p in points if p.get('value') is not None)!=[3000,5000,7000]
                or chart.get('summary',{}).get('overall')!=15000):
            return 'Training chart does not match the three measured own-account weeks.'
    if case_id=='batch2-chart-distance' and variant=='candidate' and answer:
        chart=answer.get('chart') or {}
        if chart.get('metric')!='distance' or chart.get('sport')!='run' or chart.get('group_by')!='workout':
            return 'Required running distance chart by workout is missing.'
        if [p.get('value') for p in chart.get('points',[])]!=[3000,5000,7000]:
            return 'Supported chart does not match the own-account fictional records.'


def run_case(case, variant, answer_fn, uids):
    """Real saved-thread/memory assembly and answer/save path; only gate access is bypassed.

    One new account per variant/case prevents baseline memory writes affecting the
    candidate. Prior text is a fictional fixture, not a paid or predicted answer.
    No goal confirmation is performed: the paid case may only create a preview.
    """
    from app import db, kit_thread, kit_history_api, ai_release, coach_chat, ai_budget
    cid, question, _, options = case
    user = {'id': None};today=dt.datetime.now(dt.timezone.utc).date()
    records=training_records(today) if options.get('training_records') else chart_records(today) if options.get('chart_records') else []
    with db.connect() as c:
        user['id'] = c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',
            ('zz_test_batch2_'+uuid.uuid4().hex, 'Fictional coach journey')).fetchone()['id']
        uid = user['id']; uids.append(uid)
        c.execute("""INSERT INTO profile(user_id,tz,ai_ok,ai_adult_at,health_ai_ok,garmin_ai_ok,
          health_weight_ai_ok,units) VALUES (%s,'UTC',true,now(),true,true,true,'metric')""", (uid,))
        c.execute("INSERT INTO goals(user_id,sport,period,metric,target) VALUES (%s,'run','week','distance',20000)", (uid,))
        for record in records:
            c.execute('''INSERT INTO activities(user_id,sport,source,name,start_time,distance_m,moving_s)
              VALUES (%s,%s,%s,%s,%s,%s,%s)''',(uid,*record.values()))
        generation = kit_thread.locked(c, uid)
        if options.get('memory'):
            c.execute("INSERT INTO kit_memories(user_id,text,kind,source) VALUES (%s,%s,'routine','user')", (uid,options['memory']))
        if options.get('memory_off'):
            c.execute('UPDATE kit_conversations SET memory_enabled=false WHERE user_id=%s', (uid,))
    with ExitStack() as stack:
        stack.enter_context(patch.dict('os.environ', {'KINETTA_KIT_HISTORY_ENABLED': '1'}))
        # The evaluator does not install/forge a reviewed report or change app settings.
        stack.enter_context(patch.object(ai_release, 'enabled', return_value=True))
        stack.enter_context(patch.object(coach_chat, 'answer', answer_fn))
        view = kit_history_api.create(kit_history_api.ThreadIn(generation=generation,
            conversation_id=uuid.uuid4(), visit_id=uuid.uuid4()), user=user)
        if options.get('prior'):
            body = kit_thread.MessageIn(client_id=uuid.uuid4(), generation=generation,
                visit_id=view['visit_id'], question=options['prior'])
            prior = kit_thread.create(body, user=user)
            with db.connect() as c:
                c.execute("UPDATE kit_turns SET state='answered',answer=%s WHERE user_id=%s AND client_id=%s",
                    (json.dumps({'interpretation': 'Tell me what you would like to review.', 'facts': []}), uid,prior['client_id']))
        if options.get('resume'):
            kit_thread.end_visit(view['visit_id'], user=user)
            view = kit_history_api.resume(view['conversation_id'], kit_history_api.ResumeIn(
                generation=generation, visit_id=uuid.uuid4()), user=user)
        context_seen = []
        def observed(*args, **kwargs):
            context_seen.append({'question': args[1], 'history': kwargs.get('history', []), 'fixture_records':records})
            return answer_fn(*args, **kwargs)
        stack.enter_context(patch.object(coach_chat, 'answer', observed))
        body = kit_thread.MessageIn(client_id=uuid.uuid4(), generation=generation,
            visit_id=view['visit_id'], question=question)
        row = kit_thread.create(body, user=user)
        row = kit_thread.generate(row['client_id'], kit_thread.GenerationIn(
            generation=generation, visit_id=view['visit_id']), user=user)
        with db.connect() as c:
            requests = c.execute('SELECT count(*) AS n FROM ai_food_attempts WHERE user_id=%s',(uid,)).fetchone()['n']
            target = c.execute('SELECT target FROM goals WHERE user_id=%s',(uid,)).fetchone()['target']
        if target != 20000: raise AssertionError('Evaluation must never confirm a goal change')
        if not isinstance(row,dict):
            return None, 'HTTPException: '+str(row.status_code)+': '+row.body.decode(), requests, context_seen
        return row['answer'], row['error'] or required_shape(cid,variant,row['answer']), requests, context_seen
