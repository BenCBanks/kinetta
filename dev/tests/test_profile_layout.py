"""Profile presentation, preview audiences and tied activity cursors on disposable accounts."""
import datetime as dt
import json
from urllib.parse import urlencode
from kc import person, PW

owner=person('zz_test_layout_owner','Layout Fixture')
viewer=person('zz_test_layout_viewer','Viewer Fixture')
checks=0


def req(client,method,path,body=None,status=200):
    global checks
    code,value=client.req(method,path,body)
    assert code==status,(method,path,code,value)
    checks+=1
    return value


try:
    defaults=req(owner,'GET','/api/me')
    assert defaults['profile_layout']['sections']==['recent','mileage','totals','sports','activities']
    assert defaults['setup_hidden'] is False
    layout={'sections':['activities','recent','sports'],'stats':['active_days','time'],'sports':['ride','run']}
    req(owner,'PUT','/api/account',{'name':'Layout Fixture','bio':'Draft saved together','profile_layout':layout})
    saved=req(owner,'GET','/api/me')
    assert saved['profile_layout']==layout and saved['bio']=='Draft saved together'
    assert req(viewer,'GET','/api/me')['profile_layout']!=layout
    for bad in [
        {'sections':['food']},{'sections':['recent','recent']},{'stats':[]},
        {'stats':['weight']},{'stats':['activities','distance','time','active_days']},
        {'sports':['run','run']},{'sports':['run','ride','walk','swim']},
        {'sports':['unlisted']},{'private_data':True},{'sections':'recent'},
    ]:
        req(owner,'PUT','/api/account',{'name':'Must not save','bio':'Must not save','profile_layout':bad},422)
    after=req(owner,'GET','/api/me')
    assert after['name']=='Layout Fixture' and after['profile_layout']==layout and after['bio']=='Draft saved together'
    req(owner,'PUT','/api/profile',{'setup_hidden':True})
    hidden=req(owner,'GET','/api/me');assert hidden['setup_hidden'] is True
    for field in ('ai_ok','health_ai_ok','health_weight_ai_ok','garmin_ai_ok','share_default'):
        assert hidden[field]==saved[field],field
    req(owner,'PUT','/api/profile',{'setup_hidden':None})
    assert req(owner,'GET','/api/me')['setup_hidden'] is True
    req(owner,'PUT','/api/profile',{'setup_hidden':'yes'},422)
    req(owner,'PUT','/api/profile',{'setup_hidden':False})
    assert req(owner,'GET','/api/me')['setup_hidden'] is False
    assert req(viewer,'GET','/api/me')['setup_hidden'] is False

    start=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=1)).replace(microsecond=0).isoformat()
    ids=[]
    for i in range(7):
        result=req(owner,'POST','/api/activities/manual',{'sport':'ride','start':start,'duration_s':600,'distance_m':1000*(2**i),'name':f'Tied activity {i}','avg_hr':140})
        ids.append(result['id'])
        req(owner,'PUT',f"/api/activities/{result['id']}/sharing",{'visibility':('me','friends','everyone')[i%3]})
    stranger=req(viewer,'GET','/api/people/zz_test_layout_owner/profile')
    assert stranger['layout']==layout and stranger['overview']['activities']==2
    assert stranger['overview']['active_days']==1
    req(viewer,'GET','/api/people/zz_test_layout_owner/profile?preview=friend',status=403)
    req(owner,'GET','/api/people/zz_test_layout_owner/profile?preview=invalid',status=422)
    friend=req(owner,'GET','/api/people/zz_test_layout_owner/profile?preview=friend')
    public=req(owner,'GET','/api/people/zz_test_layout_owner/profile?preview=member')
    assert friend['overview']['activities']==4 and public['overview']['activities']==2
    assert public['overview']==stranger['overview'] and public['sports']==stranger['sports']
    assert {a['id'] for a in public['items']}=={a['id'] for a in stranger['items']}
    assert {a['id'] for a in friend['items']}.isdisjoint({ids[0],ids[3],ids[6]})
    for field in ('weight_kg','health_ai_ok','garmin_ai_ok','setup_hidden','ai_ok','avg_hr'):
        assert field not in json.dumps(public),field
    # Layout hides presentation only; changing it never changes activity visibility.
    req(owner,'PUT','/api/account',{'profile_layout':{'sections':[],'stats':['time'],'sports':[]}})
    profile=req(viewer,'GET','/api/people/zz_test_layout_owner/profile')
    assert profile['layout']['sections']==[] and len(profile['items'])==2
    req(viewer,'POST','/api/friends',{'login':'zz_test_layout_owner'})
    req(owner,'POST','/api/friends/zz_test_layout_viewer/accept')
    assert req(owner,'GET','/api/me')['friend_count']==1
    for client,path,wanted in [(owner,'/api/activities',ids),(viewer,'/api/feed/friends',[ids[1],ids[2],ids[4],ids[5]])]:
        found=[];query={'limit':2}
        while True:
            rows=req(client,'GET',path+'?'+urlencode(query))
            if not rows:break
            found.extend(row['id'] for row in rows)
            query.update(before=rows[-1]['start_time'],before_id=rows[-1]['id'])
        assert found==sorted(wanted,reverse=True),(path,found,wanted)
    for path in ('/api/activities?before=invalid','/api/feed/friends?before=invalid'):
        req(owner,'GET',path,status=422)
    print(f'Profile layout: {checks} API checks, atomic validation, persistence, audience projection, consent isolation and tied pagination PASS')
finally:
    owner.post('/api/account/delete',{'password':PW});viewer.post('/api/account/delete',{'password':PW})
