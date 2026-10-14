"""Actual SQL/RLS tools and confirmation flows on throwaway accounts, no AI requests."""
import datetime as dt
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from kc import Client, PW, person, login

n = 0

def check(ok, message):
    global n
    assert ok, message
    n += 1


def tool(client, name, arguments=None):
    status, result = client.post('/api/coach/tools', {'name': name, 'arguments': arguments or {}})
    assert status == 200, (name, status, result)
    return result['data']


def sql(code):
    return subprocess.run(['docker', 'compose', '-p', os.environ.get('KINETTA_PROJECT', 'kinettatest'), 'exec', '-T', 'app', 'python', '-c', code], check=True)


a, b = person('zz_test_coach_a'), person('zz_test_coach_b')
try:
    check(Client().post('/api/coach/tools', {'name': 'profile'})[0] == 401, 'tools require auth')
    check(a.post('/api/coach/tools', {'name': 'profile', 'user_id': 2})[0] == 422, 'top-level identity forbidden')
    check(a.post('/api/coach/tools', {'name': 'profile', 'arguments': {'user_id': 2}})[0] == 400, 'tool identity forbidden')
    check(a.post('/api/coach/tools', {'name': 'SELECT * FROM food_entries'})[0] == 400, 'arbitrary SQL forbidden')
    check(a.post('/api/coach/tools', {'name': 'nutrition_summary', 'arguments': {'start': '2026-10-03', 'end': '2026-10-01'}})[0] == 400, 'reversed range forbidden')
    check(a.post('/api/coach/tools', {'name': 'nutrition_summary', 'arguments': {'start': '1900-01-01', 'end': '2026-10-01'}})[0] == 400, 'unbounded range forbidden')
    empty = tool(a, 'nutrition_summary', {'start': '2026-10-01', 'end': '2026-10-03'})
    check(empty['average_per_logged_day']['protein_g'] is None, 'empty is unknown, not zero intake')
    for day, protein in [('2026-10-01', 60), ('2026-10-03', 100)]:
        a.post('/api/food/entries', [{'day': day, 'meal': 'lunch', 'name': 'Usual test bowl', 'amount': 1, 'unit': 'serving', 'kcal': 400, 'protein_g': protein}])
    b.post('/api/food/entries', [{'day': '2026-10-01', 'name': 'Other private food', 'kcal': 9999, 'protein_g': 999}])
    summary = tool(a, 'nutrition_summary', {'start': '2026-10-01', 'end': '2026-10-03'})
    check(summary['totals']['protein_g'] == 160 and summary['average_per_logged_day']['protein_g'] == 80, 'exact SQL protein average')
    check(summary['logged_days'] == 2 and summary['unlogged_days'] == 1, 'unlogged day excluded')
    check(summary['totals']['kcal'] == 800, 'other account excluded')
    a.put('/api/food/targets', {'kcal_target': 2200, 'protein_target': 150})
    for _ in range(3):
        a.post('/api/food/entries', [{'day': '2026-10-02', 'meal': 'lunch', 'name': 'Usual test bowl', 'amount': 1, 'unit': 'serving', 'kcal': 400, 'protein_g': 30}])
    day = a.get('/api/plans/options')[1]['today']
    options = tool(a, 'meal_combinations', {'day': day})
    check(options['candidates'] and options['candidates'][0]['totals']['kcal'] == 400, 'meal values are stored numbers')
    choice = options['candidates'][0]['candidate_id']
    before = len(a.get(f'/api/food/day?d={day}')[1]['entries'])
    status, proposal = a.post('/api/coach/proposals', {'kind': 'food', 'day': day, 'meal': 'lunch', 'candidate_id': choice})
    check(status == 200 and proposal['confirmation_required'], 'proposal created pending')
    check(len(a.get(f'/api/food/day?d={day}')[1]['entries']) == before, 'proposal does not log food')
    path = f'/api/coach/proposals/{proposal["id"]}/confirm'
    check(b.post(path, {'confirmed': True})[0] == 404, 'cannot confirm another account proposal')
    check(a.post(path, {})[0] == 422 and a.post(path, {'confirmed': False})[0] == 422 and a.post(path, {'confirmed': 1})[0] == 422, 'explicit confirmation required')
    a.put('/api/food/targets', {'kcal_target': 2100})
    check(a.post(path, {'confirmed': True})[0] == 409, 'stale target rejects proposal')
    _, fresh = a.post('/api/coach/proposals', {'kind': 'food', 'day': day, 'meal': 'lunch', 'candidate_id': choice})
    path = f'/api/coach/proposals/{fresh["id"]}/confirm'
    def confirm_once(_): return login('zz_test_coach_a').post(path, {'confirmed': True})
    with ThreadPoolExecutor(max_workers=8) as executor: confirmations = list(executor.map(confirm_once, range(8)))
    check(all(status == 200 for status, _ in confirmations), 'concurrent confirmation retries succeed')
    check(sum(not result['already_applied'] for _, result in confirmations) == 1, 'one concurrent application; no pool deadlock')
    count = len(a.get(f'/api/food/day?d={day}')[1]['entries'])
    check(count == before + 1, 'exactly one food entry')
    check(a.post(path, {'confirmed': True})[1]['already_applied'], 'replay idempotent')
    check(len(a.get(f'/api/food/day?d={day}')[1]['entries']) == count, 'replay adds nothing')
    check(a.post('/api/coach/proposals', {'kind': 'food', 'day': day, 'candidate_id': 'invented', 'kcal': 5})[0] == 422, 'model macros rejected')
    # Plan history is backdated only on the isolated test database, to exercise missed sessions.
    check(a.post('/api/plans', {'race': 'marathon', 'level': 'beginner', 'weeks': 18, 'runs': 4, 'long_day': 6})[0] == 200, 'plan created')
    sql("from app import db\nwith db.connect() as c:\n c.execute(\"UPDATE training_plans SET start_day = start_day - 14, race_day = race_day - 14, created = created - interval '14 days' WHERE user_id = (SELECT id FROM users WHERE login='zz_test_coach_a') AND active\")")
    plan = a.get('/api/plans/current')[1]
    options = tool(a, 'plan_options')
    check(len(options['candidates']) > 1, 'missed sessions yield constrained options')
    candidate = options['candidates'][1]
    change = candidate['changes'][0]
    old = next(w for wk in plan['weeks'] for w in wk['workouts'] if w['day'] == change['day'])
    check(change['dist'] < old['dist'], 'engine reduces, never catches up distance')
    _, proposal = a.post('/api/coach/proposals', {'kind': 'plan', 'candidate_id': candidate['candidate_id']})
    check(a.get('/api/plans/current')[1] == plan, 'proposal leaves schedule unchanged')
    path = f'/api/coach/proposals/{proposal["id"]}/confirm'
    check(a.post(path, {'confirmed': True})[0] == 200, 'confirmed plan applied')
    changed = a.get('/api/plans/current')[1]
    got = next(w for wk in changed['weeks'] for w in wk['workouts'] if w['day'] == change['day'])
    check(got['adjusted'] and got['dist'] == change['dist'], 'engine shows confirmed adjustment')
    check(changed['plan']['race_day'] == plan['plan']['race_day'], 'race date unchanged')
    check([w['day'] for wk in changed['weeks'] for w in wk['workouts']] == [w['day'] for wk in plan['weeks'] for w in wk['workouts']], 'scheduling/rest preserved')
    check(a.post(path, {'confirmed': True})[1]['already_applied'], 'plan confirmation idempotent')
    check(not tool(b, 'training_plan')['plan'], 'other account has no plan')
    # Prove RLS even with the WHERE intentionally omitted in trusted test code; prove pool cleanup after failure.
    sql("from app import db\nfrom psycopg import errors\nwith db.connect() as c:\n uid=c.execute(\"SELECT id FROM users WHERE login='zz_test_coach_a'\").fetchone()['id']\n other=c.execute(\"SELECT id FROM users WHERE login='zz_test_coach_b'\").fetchone()['id']\nwith db.coach_connect(uid) as c:\n assert c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(other,)).fetchone()['n']==0\n assert all(r['user_id']==uid for r in c.execute('SELECT user_id FROM food_entries').fetchall())\n assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'\ntry:\n with db.coach_connect(uid) as c: c.execute('DELETE FROM food_entries')\nexcept (errors.InsufficientPrivilege,errors.ReadOnlySqlTransaction): pass\nelse: raise AssertionError('Coach role wrote data')\nwith db.connect() as c:\n assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_app'\n assert c.execute(\"SELECT nullif(current_setting('kinetta.coach_user_id', true), '') AS uid\").fetchone()['uid'] is None\n print('RLS own rows, read-only and pooled role/identity cleanup passed')")
    check(True, 'database RLS role tested directly')
finally:
    a.post('/api/account/delete', {'password': PW}); b.post('/api/account/delete', {'password': PW})
print(f'coach tools and proposals: {n} checks passed')
