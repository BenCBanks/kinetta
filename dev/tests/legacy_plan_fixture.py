"""Seed pre-upgrade settings-only plans for existing UI/completion/coach fixtures.

This is test storage setup, never a readiness bypass in the application API.
"""
import json
import os
import subprocess
from urllib.parse import urlparse


def legacy_plan(client, body):
    base=urlparse(os.environ['KINETTA_URL']);project=os.environ.get('KINETTA_PROJECT','kinettatest')
    assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
    user=client.get('/api/me')[1];assert user['login'].startswith('zz_test_')
    script='''from app import db,plans
import json
uid,body='''+repr((user['id'],body))+'''
with db.connect() as c:
 assert c.execute("SELECT login::text FROM users WHERE id=%s",(uid,)).fetchone()['login'].startswith('zz_test_')
 p=plans._settings(c,uid,plans.PlanIn(**body))
 c.execute('UPDATE training_plans SET active=false WHERE user_id=%s AND active',(uid,))
 keys=['race','level','weeks','runs','long_day','start_day','race_day','goal_s','unit','start_vol']
 row=c.execute('INSERT INTO training_plans(user_id,'+','.join(keys)+') VALUES('+','.join(['%s']*11)+') RETURNING id',(uid,*[p[k] for k in keys])).fetchone()
 print(json.dumps(row))
'''
    out=subprocess.check_output(['docker','exec','-i',project+'-app-1','python','-'],input=script,text=True)
    return 200,json.loads(out.strip().splitlines()[-1])
