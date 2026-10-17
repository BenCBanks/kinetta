"""Original fictional FIT/ZIP enriches an own Health summary without duplication."""
import datetime as dt
import io,json,time,urllib.request,uuid,zipfile
from kc import BASE,PW,person
from fit_fixture import original_fit
owner=person('zz_test_original_map');other=person('zz_test_original_other')
start=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=12)).replace(microsecond=0)
try:
 assert owner.put('/api/profile',{'ai_ok':False})[0]==200
 assert other.put('/api/profile',{'ai_ok':False})[0]==200
 summary={'id':'demo-original-map-'+uuid.uuid4().hex,'type':'running','start':start.isoformat(),'end':(start+dt.timedelta(seconds=600)).isoformat(),'duration_s':600,'distance_m':1600,'calories':100}
 status,result=owner.post('/api/health/workouts',{'workouts':[summary]});assert status==200 and result['added']==1
 aid=result['results'][0]['activity_id'];assert not owner.get(f'/api/activities/{aid}')[1]['line']
 assert other.get(f'/api/activities/{aid}')[0]==404
 owner.patch(f'/api/activities/{aid}',{'name':'Fictional edited title','distance_m':1650})
 raw=original_fit(start);buffer=io.BytesIO()
 with zipfile.ZipFile(buffer,'w') as z:z.writestr('demo-original.fit',raw)
 def upload(name,body):
  boundary='kinetta-fictional-map';payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+body+f'\r\n--{boundary}--\r\n'.encode()
  request=urllib.request.Request(BASE+'/api/import',data=payload,method='POST',headers={'Origin':BASE,'Content-Type':'multipart/form-data; boundary='+boundary})
  with owner.op.open(request) as response:job=json.load(response)['job']
  end=time.monotonic()+20
  while time.monotonic()<end:
   jobs=owner.get('/api/imports')[1];state=next(j for j in jobs if j['id']==job)
   if state['status'] in ('done','failed'):break
   time.sleep(.05)
  assert state['status']=='done' and not state['failed'],state
  return state
 for name,body in [('original.zip',buffer.getvalue()),('original.fit',raw)]:
  job=upload(name,body);assert job['added']==0 and job['duplicates']==1,job
  activity=owner.get(f'/api/activities/{aid}')[1];assert activity['line'] and activity['name']=='Fictional edited title' and activity['distance_m']==1650
  assert len(owner.get('/api/activities')[1])==1
  assert other.get(f'/api/activities/{aid}')[0]==404
 assert not other.get('/api/activities')[1]
 print('Add map: fictional original FIT and ZIP enrich same Health activity; edited title/distance kept, replay no duplicates, other account isolated PASS')
finally:
 owner.post('/api/account/delete',{'password':PW});other.post('/api/account/delete',{'password':PW})
