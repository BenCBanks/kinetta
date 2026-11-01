"""Disposable food evaluation provenance and a cumulative allowance shared by both datasets.

Copy this file, both case files and the collectors to /tmp in an isolated app image. Keep one
run UUID per revision/database across retries. Never use on production or reset its database
during a paid comparison. Tables contain only fictional evaluation metadata and attempt IDs.
"""
import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from app import ai_release, ai_budget, db


def digest(paths):
    return hashlib.sha256(b''.join(name.encode()+b'\0'+Path(path).read_bytes()+b'\0'
        for name,path in sorted(paths))).hexdigest()


def provenance():
    mode=os.environ.get('FOOD_MEMORY_EVAL_MODE')
    dry=os.environ.get('FOOD_MEMORY_EVAL_DRY_RUN')=='1'
    if mode not in ('baseline','candidate') or not dry and os.environ.get('FOOD_MEMORY_EVAL_ACCEPT_PAID_CALLS')!='1':
        raise RuntimeError('Explicit comparison mode and paid authorization required')
    revision=os.environ.get('FOOD_MEMORY_EVAL_SOURCE_COMMIT','')
    if not re.fullmatch('[a-f0-9]{40}',revision):raise RuntimeError('Record the exact full source commit')
    actual=digest([(p.relative_to('/srv').as_posix(),p) for p in Path('/srv/app').rglob('*.py')])
    if os.environ.get('FOOD_MEMORY_EVAL_APP_DIGEST')!=actual:raise RuntimeError('Image/source digest mismatch')
    cap=float(os.environ.get('KINETTA_AI_DAILY_USD','5'))
    if not 0<cap<=2:raise RuntimeError('Each revision must stay within its cumulative $2 allowance')
    dataset=digest([(name,Path('/tmp')/name) for name in ('chat_cases.py','food_memory_cases.py')])
    collectors=digest([(name,Path('/tmp')/name) for name in
        ('food_eval_guard.py','chat_eval.py','food_memory_eval.py','food_memory_score.py')])
    gates=['understanding']+(['food_memory'] if mode=='candidate' else [])
    return {'mode':mode,'dry_run':dry,'source_commit':revision,'app_digest':actual,
        'dataset_digest':dataset,'collector_digest':collectors,
        'run_id':str(uuid.UUID(os.environ['FOOD_MEMORY_EVAL_RUN_ID'])),
        'models':{gate:ai_release.models(gate) for gate in gates},
        'fingerprints':{gate:ai_release.gate_fingerprint(gate) for gate in gates},
        'ai_text':{gate:ai_release.ai_text(gate) for gate in gates},
        'gate_overrides':['understanding enabled for evaluation']+(['food_memory enabled for evaluation'] if mode=='candidate' else []),
        'rates_per_million':{model:[str(x) for x in rates] for model,rates in ai_budget.RATES.items()},
        'pricing_review_by':str(ai_budget.review_by()),'reviewed':False,'cap_usd':2}


def setup(meta):
    with db.connect() as c:
        c.execute('''CREATE TABLE IF NOT EXISTS zz_test_food_eval_runs(
            id uuid PRIMARY KEY,dataset_digest text NOT NULL,mode text NOT NULL,cap_micros bigint NOT NULL)''')
        c.execute('''CREATE TABLE IF NOT EXISTS zz_test_food_eval_attempts(
            run_id uuid REFERENCES zz_test_food_eval_runs(id),attempt_id uuid PRIMARY KEY REFERENCES ai_food_attempts(id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS zz_test_food_eval_provenance(
            run_id uuid PRIMARY KEY REFERENCES zz_test_food_eval_runs(id),metadata jsonb NOT NULL)''')
        for table in ('zz_test_food_eval_runs','zz_test_food_eval_attempts','zz_test_food_eval_provenance'):
            c.execute('ALTER TABLE '+table+' ENABLE ROW LEVEL SECURITY')
            c.execute('REVOKE ALL ON '+table+' FROM PUBLIC')
        # One paid allowance per disposable database, even if a caller accidentally changes the UUID.
        c.execute('SELECT pg_advisory_xact_lock(451,451)')
        others=c.execute('SELECT run_id FROM zz_test_food_eval_provenance WHERE metadata->>\'dry_run\'=\'false\' AND run_id<>%s',(meta['run_id'],)).fetchall()
        if others and not meta['dry_run']:raise RuntimeError('This database already belongs to another paid comparison run')
        c.execute('INSERT INTO zz_test_food_eval_runs VALUES(%s,%s,%s,2000000) ON CONFLICT DO NOTHING',
            (meta['run_id'],meta['dataset_digest'],meta['mode']))
        row=c.execute('SELECT * FROM zz_test_food_eval_runs WHERE id=%s',(meta['run_id'],)).fetchone()
        if (row['dataset_digest'],row['mode'],row['cap_micros'])!=(meta['dataset_digest'],meta['mode'],2000000):
            raise RuntimeError('Run allowance identity changed')
        c.execute('INSERT INTO zz_test_food_eval_provenance VALUES(%s,%s) ON CONFLICT DO NOTHING',(meta['run_id'],json.dumps(meta)))
        saved=c.execute('SELECT metadata FROM zz_test_food_eval_provenance WHERE run_id=%s',(meta['run_id'],)).fetchone()['metadata']
        if saved!=meta:raise RuntimeError('Comparison provenance changed; preserve the original run and report partial results')


def reserve(meta,attempt_id):
    with db.connect() as c:
        row=c.execute('SELECT cap_micros FROM zz_test_food_eval_runs WHERE id=%s FOR UPDATE',(meta['run_id'],)).fetchone()
        c.execute('INSERT INTO zz_test_food_eval_attempts VALUES(%s,%s) ON CONFLICT DO NOTHING',(meta['run_id'],attempt_id))
        spent=c.execute('''SELECT coalesce(sum(a.charged_micros),0) AS n FROM zz_test_food_eval_attempts e
            JOIN ai_food_attempts a ON a.id=e.attempt_id WHERE e.run_id=%s''',(meta['run_id'],)).fetchone()['n']
        over=spent>row['cap_micros']
    if over:raise RuntimeError('Cumulative comparison allowance exhausted before provider send')


def spending(meta):
    with db.connect() as c:
        row=c.execute('''SELECT count(*) AS attempts,coalesce(sum(a.charged_micros),0) AS charged_micros,
            count(*) FILTER(WHERE a.state='reserved' OR a.state='failed' AND a.charged_micros>0) AS unknown_cost_attempts
            FROM zz_test_food_eval_attempts e JOIN ai_food_attempts a ON a.id=e.attempt_id WHERE e.run_id=%s''',
            (meta['run_id'],)).fetchone()
        return {key:int(value) for key,value in row.items()}


def output(path,meta,suite):
    """Append completed cases; refuse to mix a different capture or silently overwrite paid evidence."""
    path=Path(path);sidecar=path.with_suffix(path.suffix+'.meta.json')
    identity={**meta,'suite':suite}
    if sidecar.exists():
        if json.loads(sidecar.read_text())!=identity:raise RuntimeError('Output belongs to a different capture')
    else:
        if path.exists() and path.stat().st_size:raise RuntimeError('Existing output has no provenance')
        with sidecar.open('x') as stream:json.dump(identity,stream,indent=2)
    previous=[]
    if path.exists():
        for line in path.read_text().splitlines():
            if line:previous.append(json.loads(line))
    return path,previous
