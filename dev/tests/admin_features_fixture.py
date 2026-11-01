"""Seed fictional feature history and a private test-only portal session on the chosen test copy."""
import json
import os
import subprocess
from pathlib import Path

code=r'''
from app import db,auth,admin_auth,admin_features as F
import datetime as dt,json
with db.connect() as c:
 c.execute("DELETE FROM users WHERE login LIKE 'zz_test_feature_gallery%%'")
 day=c.execute("SELECT (now() AT TIME ZONE 'UTC')::date AS d").fetchone()['d']
 admin=c.execute("INSERT INTO users(login,name,pw_hash,is_admin,created) VALUES('zz_test_feature_gallery_admin','Fictional administrator',%s,true,now()-interval '2 years') RETURNING id",(auth.hash_pw('fictional feature gallery password'),)).fetchone()['id']
 c.execute('INSERT INTO profile(user_id) VALUES(%s)',(admin,));uids=[]
 for n in range(6):
  uid=c.execute("INSERT INTO users(login,name,created) VALUES(%s,'Fictional member',now()-interval '20 days') RETURNING id",('zz_test_feature_gallery_'+str(n),)).fetchone()['id'];uids.append(uid)
  c.execute("INSERT INTO profile(user_id,welcome_completed_day,health_setup_day,feature_metrics_ok,feature_metrics_at,feature_metrics_version) VALUES(%s,%s,%s,true,now(),'2026-11-01-v1')",(uid,day-dt.timedelta(days=18) if n<3 else None,day-dt.timedelta(days=17) if n<3 else None))
  for ago in range(30):
   when=dt.datetime.combine(day-dt.timedelta(days=ago),dt.time(12),dt.timezone.utc)
   c.execute("INSERT INTO activities(user_id,name,sport,source,start_time,created) VALUES(%s,'Fictional morning run','run','track',%s,%s)",(uid,when,when))
   c.execute("INSERT INTO food_entries(user_id,day,name,kcal,created,entry_method) VALUES(%s,%s,'Fictional lunch',400,%s,'search')",(uid,when.date(),when))
  if n<3:c.execute('INSERT INTO admin_account_days(user_id,day) VALUES(%s,%s)',(uid,day-dt.timedelta(days=11)))
 for n,uid in enumerate(uids):c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now()-interval '5 days')",(uid,uids[(n+1)%6]))
 c.execute('INSERT INTO admin_feature_state(singleton,started) VALUES(true,%s) ON CONFLICT(singleton) DO UPDATE SET started=excluded.started',(F.month_before(day,13),))
 for feature in F.VIEWS:
  for ago in range(90):
   people=2 if feature=='kit' and ago==5 else 3+ago%4;opens=people*(2+ago%3)
   c.execute('INSERT INTO admin_feature_counts(feature,day,people,opens) VALUES(%s,%s,%s,%s) ON CONFLICT(feature,day) DO UPDATE SET people=excluded.people,opens=excluded.opens',(feature,day-dt.timedelta(days=ago),people,opens))
 token=admin_auth.issue_session(c,admin)
print(json.dumps({'cookie':token,'members':uids}))
'''
project=os.environ.get('KINETTA_PROJECT','kinettatest')
r=subprocess.run(['docker','compose','-p',project,'exec','-T','app','python','-'],input=code,text=True,capture_output=True,check=True)
value=json.loads(r.stdout)
output=Path(os.environ.get('FEATURE_UI_SESSION','/tmp/kinetta-features-session.json'));output.parent.mkdir(parents=True,exist_ok=True)
descriptor=os.open(output,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
with os.fdopen(descriptor,'w') as f:json.dump(value,f)
os.chmod(output,0o600)
print('Fictional feature history prepared; private session saved without printing it.')
