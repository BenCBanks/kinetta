"""Actual HTTP preset/retry/ownership and private activity-result contracts on the throwaway server."""
import copy,datetime as dt,json,uuid,concurrent.futures
from pathlib import Path
from kc import person,login,ALEX
owner=person('zz_test_interval_owner');other=person('zz_test_interval_other')
def req(c,method,path,body=None,status=200):
 code,data=c.req(method,path,body);assert code==status,(path,code,data);return data
try:
 assert req(owner,'GET','/api/interval-presets/capabilities')==dict(schema=1,private_results=1)
 fixture=json.loads((Path(__file__).parent/'fixtures/interval_presets.json').read_text())[0]
 raw=fixture['pin']['definition'];pid=str(uuid.uuid4());mutation=str(uuid.uuid4());body=dict(mutation_id=mutation,expected_version=None,definition=raw)
 saved=req(owner,'PUT','/api/interval-presets/'+pid,body);assert saved['version']==1 and len(saved['steps'])==6 and saved['totals']['seconds']==720
 assert req(owner,'PUT','/api/interval-presets/'+pid,body)['replayed']
 conflict=copy.deepcopy(body);conflict['definition']['name']='Different draft';req(owner,'PUT','/api/interval-presets/'+pid,conflict,409)
 req(other,'GET','/api/interval-presets/'+pid,status=404);req(other,'PUT','/api/interval-presets/'+pid,body,status=404)
 assert not req(other,'GET','/api/interval-presets')
 changed=copy.deepcopy(raw);changed['name']='Updated private preset';edit=dict(mutation_id=str(uuid.uuid4()),expected_version=1,definition=changed)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:edits=list(pool.map(lambda _:req(owner,'PUT','/api/interval-presets/'+pid,edit),range(4)))
 assert all(r['version']==2 for r in edits) and req(owner,'GET','/api/interval-presets/'+pid)['version']==2
 req(owner,'PUT','/api/interval-presets/'+pid,dict(edit,mutation_id=str(uuid.uuid4())),409)
 req(other,'DELETE','/api/interval-presets/'+pid,dict(expected_version=2),404)
 req(owner,'DELETE','/api/interval-presets/'+pid,dict(expected_version=1),409)
 req(owner,'DELETE','/api/interval-presets/'+pid,dict(expected_version=2));req(owner,'PUT','/api/interval-presets/'+pid,body,410)
 assert not req(owner,'GET','/api/interval-presets')
 # Source deletion cannot destroy a previously pinned full snapshot.
 pin={k:saved[k] for k in ['id','version','content_hash','definition']};time=0;rows=[]
 for step in saved['steps']:
  rows.append(dict(key=step['key'],outcome='complete',start_time=time,end_time=time+step['target'],start_distance=0,end_distance=0));time+=step['target']
 state=dict(pin=pin,status='complete',results=rows,effects=[])
 track=dict(client_id=str(uuid.uuid4()),sport='run',name='Fictional interval workout',start=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1000)).isoformat(),elapsed_s=900,moving_s=720,points=[],visibility='everyone',intervals=state)
 track['route_plan']=dict(source_kind='owned',route_id=123,version=1,name='Fictional planned route',distance_m=499999)
 first=req(owner,'POST','/api/activities/track',track);aid=first['id'];assert req(owner,'POST','/api/activities/track',track)==dict(id=aid,duplicate=True)
 assert req(owner,'GET',f'/api/activities/{aid}')['route_plan']['name']=='Fictional planned route'
 assert req(owner,'GET',f'/api/activities/{aid}')['distance_m']==0,'Neither planned length nor interval targets create measured distance'
 own=req(owner,'GET',f'/api/activities/{aid}/intervals');assert own[0]['summary']==dict(visited_steps=6,planned_steps=6,completed_steps=6,skipped_steps=0)
 assert own[0]['pin']['content_hash']==pin['content_hash']
 req(other,'GET',f'/api/activities/{aid}/intervals',status=404)
 shared=req(other,'GET',f'/api/shared/{aid}');assert 'Demo intervals' not in json.dumps(shared) and 'intervals' not in shared and 'pin' not in shared
 altered=copy.deepcopy(track);altered['intervals']['effects']=[dict(sequence=1,phase=0,logical_time=0,kind='step',voice='unknown',vibration='disabled')];req(owner,'POST','/api/activities/track',altered,409)
 bad=copy.deepcopy(track);bad['client_id']=str(uuid.uuid4());bad['intervals']['results'][0]['end_time']=179;req(owner,'POST','/api/activities/track',bad,422)
 bad=copy.deepcopy(track);bad['client_id']=str(uuid.uuid4());bad['intervals']['pin']['content_hash']='0'*64;req(owner,'POST','/api/activities/track',bad,422)
 bad=copy.deepcopy(track);bad['client_id']=str(uuid.uuid4());bad['sport']='ride';req(owner,'POST','/api/activities/track',bad,422)
 req(owner,'DELETE',f'/api/activities/{aid}');req(owner,'GET',f'/api/activities/{aid}/intervals',status=404)
 req(owner,'POST','/api/activities/track',track,409)
 print('PASS interval HTTP: exact previews, ownership, optimistic conflicts, concurrent replay, deletion tombstone, atomic pinned results, retry identity and social privacy')
finally:
 for name in ['zz_test_interval_owner','zz_test_interval_other']:
  login(*ALEX).delete('/api/admin/people/'+name)
