"""Paid comparison: the production food-estimate prompt vs a candidate, on brand_cases.py (25 October 2026).

Run inside a throwaway Kinetta app container built from the candidate branch (never the live server):
  docker cp dev/evals/brand_cases.py <app>:/tmp/ ; docker cp <baseline PROMPT text> <app>:/tmp/baseline_prompt.txt
  docker exec -e BRAND_EVAL_ACCEPT_PAID_CALLS=1 -e KINETTA_AI_DAILY_USD=<cap> -i <app> python - < dev/evals/brand_eval.py
Both prompts answer every case through the normal estimator and budget accounting (the daily dollar cap stops calls).
A fictional zz_test account is created and deleted. Prints a JSON summary; per-case results go to BRAND_EVAL_OUTPUT.
"""
import json, os, sys, uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, '/tmp')
from app import db, food_photo
from app.food_photo import PhotoIn
import brand_cases

if os.environ.get('BRAND_EVAL_ACCEPT_PAID_CALLS') != '1': sys.exit('Paid calls need BRAND_EVAL_ACCEPT_PAID_CALLS=1')
PROMPTS = {'baseline': Path('/tmp/baseline_prompt.txt').read_text(), 'candidate': food_photo.PROMPT}
with db.connect() as c:
    uid = c.execute("INSERT INTO users(login,name,pw_hash) VALUES (%s,'Fictional','x') RETURNING id", ('zz_test_brand_' + uuid.uuid4().hex[:8],)).fetchone()['id']
    c.execute("INSERT INTO profile(user_id,tz,ai_ok) VALUES (%s,'UTC',true)", (uid,))
def charged():
    with db.connect() as c:
        return int(c.execute('SELECT coalesce(sum(charged_micros),0) AS n FROM ai_food_attempts WHERE user_id=%s', (uid,)).fetchone()['n'])
rows, summary, before = [], {}, charged()
try:
    with patch('app.food_photo.brake'):
        for case in brand_cases.cases():
            row = {**case}
            for name, prompt in PROMPTS.items():
                with patch.object(food_photo, 'PROMPT', prompt):
                    try:
                        out = food_photo.estimate(PhotoIn(note=case['text']), {'id': uid}, strict=True)
                        kcal = sum(i['kcal'] or 0 for i in out['items'])
                        row[name] = {'kcal': kcal, 'items': [f"{i['name']} ({i['amount']})" for i in out['items']], 'notes': out['notes'],
                                     'ok': case['range'][0] <= kcal <= case['range'][1]}
                    except Exception as e: row[name] = {'error': str(getattr(e, 'detail', e))[:200], 'ok': False}
            rows.append(row)
            if os.environ.get('BRAND_EVAL_OUTPUT'): Path(os.environ['BRAND_EVAL_OUTPUT']).write_text(json.dumps(rows, indent=1))
finally:
    spent = charged() - before
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=%s', (uid,))
for group in ('branded', 'informal', 'control'):
    g = [r for r in rows if r['group'] == group]
    summary[group] = {name: {'within': sum(r[name]['ok'] for r in g), 'of': len(g),
                             'mean_abs_error': round(sum(abs(r[name].get('kcal', 0) - r['kcal']) for r in g) / len(g), 1) if group == 'branded' else None}
                      for name in PROMPTS}
summary['charged_usd'] = spent / 1e6
if os.environ.get('BRAND_EVAL_OUTPUT'): Path(os.environ['BRAND_EVAL_OUTPUT']).write_text(json.dumps(rows, indent=1))
print(json.dumps(summary, indent=1))
