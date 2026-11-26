"""Fixed batch-two model inputs; transport/storage are independently tested offline."""
import json
import uuid
from contextlib import ExitStack
from unittest.mock import patch

from kit_cases import CASES
from kit_gate_cases import GATE_CASE_IDS

# Replace eight basic retrieval cases; retain all ten weekly and safety cases.
REPLACED = {'protein', 'fiber', 'activity-all', 'ride', 'walk', 'runs', 'gear', 'food-help'}
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
 ('batch2-next-step', 'Given my saved goal and routine, suggest one specific next step. Ask one question if something essential is missing.', {'goals'},
  {'memory': 'I prefer walking and my available days are Tuesday and Saturday.'}),
 ('batch2-chart-unsupported', 'Show my running distance as a chart. If you cannot, say so without inventing a chart or data.', {'app_features', 'activities'}, {}),
]
BATCH2_CASES = [c for c in CASES if c[0] in GATE_CASE_IDS and c[0] not in REPLACED] + EXTRA


def run_case(case, variant, answer_fn, uids):
    """Real saved-thread/memory assembly and answer/save path; only gate access is bypassed.

    One new account per variant/case prevents baseline memory writes affecting the
    candidate. Prior text is a fictional fixture, not a paid or predicted answer.
    No goal confirmation is performed: the paid case may only create a preview.
    """
    from app import db, kit_thread, kit_history_api, ai_release, coach_chat, ai_budget
    cid, question, _, options = case
    user = {'id': None}
    with db.connect() as c:
        user['id'] = c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',
            ('zz_test_batch2_'+uuid.uuid4().hex, 'Fictional coach journey')).fetchone()['id']
        uid = user['id']; uids.append(uid)
        c.execute("""INSERT INTO profile(user_id,tz,ai_ok,ai_adult_at,health_ai_ok,garmin_ai_ok,
          health_weight_ai_ok) VALUES (%s,'UTC',true,now(),true,true,true)""", (uid,))
        c.execute("INSERT INTO goals(user_id,sport,period,metric,target) VALUES (%s,'run','week','distance',20000)", (uid,))
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
            context_seen.append({'question': args[1], 'history': kwargs.get('history', [])})
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
        return row['answer'], row['error'], requests, context_seen
