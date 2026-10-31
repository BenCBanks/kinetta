"""Use the guarded Track fixtures, plus a private fictional mapped activity for the header check."""
import track_fixture
import json,subprocess,datetime as dt,uuid
from kc import login
c=login('zz_test_track_empty');uid=c.get('/api/me')[1]['id']
r=c.post('/api/activities/manual',{'sport':'run','name':'Fictional header check','start':(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=2)).isoformat(),'duration_s':1800,'distance_m':3000});assert r[0]==200,r;aid=r[1]['id']
assert c.put(f'/api/activities/{aid}/sharing',{'visibility':'me'})[0]==200
fields=('geom','start_pt','end_pt','chart','distance_m','moving_s','elapsed_s')
sql='UPDATE activities a SET '+','.join(f'{f}=d.{f}' for f in fields)+f" FROM (SELECT a.* FROM activities a JOIN users u ON a.user_id=u.id WHERE u.login='alex' AND a.geom IS NOT NULL AND a.sport='run' LIMIT 1) d WHERE a.id={aid} AND a.user_id={uid};"
r=subprocess.run(['docker','exec','-i',track_fixture.project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
preset={'schema':1,'name':'Fictional steady run and walk intervals with a long name','description':'','blocks':[{'id':'main','repeat':3,'steps':[{'id':'run','action':'run','role':'effort','title':'','target':{'kind':'time','amount':'3','unit':'min'}},{'id':'walk','action':'walk','role':'recovery','title':'','target':{'kind':'time','amount':'1','unit':'min'}}]}]}
r=c.put('/api/interval-presets/'+str(uuid.uuid4()),{'mutation_id':str(uuid.uuid4()),'definition':preset});assert r[0]==200,r
print(json.dumps({'activity':aid,'preset':r[1]}))
