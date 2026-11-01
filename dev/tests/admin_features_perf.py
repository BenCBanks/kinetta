"""Bounded synthetic workload probe on the selected throwaway fixture database."""
import json
import os
import statistics
import subprocess
import time
import urllib.request
from pathlib import Path

base=os.environ.get('KINETTA_URL','http://localhost:8798')
project=os.environ.get('KINETTA_PROJECT','kinettatest')
session=json.loads(Path(os.environ.get('FEATURE_UI_SESSION','/tmp/kinetta-features-session.json')).read_text())
uids=session['members']
code='''from app import db
with db.connect() as c:
 c.execute("INSERT INTO activities(user_id,name,sport,source,start_time,created) SELECT (%s::bigint[])[1+i%%6],'Fictional performance activity','run','track',now()-make_interval(days=>i%%365),now()-make_interval(days=>i%%365) FROM generate_series(1,50000) i",(%s,))
 c.execute("INSERT INTO food_entries(user_id,day,name,kcal,entry_method,created) SELECT (%s::bigint[])[1+i%%6],current_date-i%%365,'Fictional performance food',100,'search',now()-make_interval(days=>i%%365) FROM generate_series(1,50000) i",(%s,))
 c.execute('ANALYZE activities');c.execute('ANALYZE food_entries')
'''
# SQL placeholders remain parameters inside the container, not interpolated source values.
code=code.replace('(%s,)','('+repr(uids)+',)')
cmd=['docker','compose','-p',project,'exec','-T','app','python','-']
cleanup="""from app import db
with db.connect() as c:
 c.execute("DELETE FROM activities WHERE user_id=ANY(%s) AND name='Fictional performance activity'",(%s,))
 c.execute("DELETE FROM food_entries WHERE user_id=ANY(%s) AND name='Fictional performance food'",(%s,))
""".replace('(%s,)','('+repr(uids)+',)')
try:
 subprocess.run(cmd,input=code,text=True,capture_output=True,check=True)
 times=[]
 for _ in range(5):
  start=time.monotonic();request=urllib.request.Request(base+'/api/admin/features?period=12m&bucket=month',headers={'Cookie':'kinetta_admin='+session['cookie']})
  with urllib.request.urlopen(request,timeout=5) as response:
   data=json.load(response);assert response.status==200 and len(data['rows'])>20
  times.append((time.monotonic()-start)*1000)
 print(json.dumps({'synthetic_activities':50000,'synthetic_food_entries':50000,'spread_days':365,'period':'12m','milliseconds':[round(x,2) for x in times],'median_ms':round(statistics.median(times),2),'max_ms':round(max(times),2)}))
 assert max(times)<1000,'Synthetic year report exceeded1second'
finally:
 subprocess.run(cmd,input=cleanup,text=True,capture_output=True,check=True)
