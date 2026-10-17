"""Queued writes cannot follow a changed cookie into another account."""
import json, urllib.request, urllib.error
from kc import BASE, PW, person

a=person('zz_test_queue_owner_a'); b=person('zz_test_queue_owner_b')
aid=a.get('/api/me')[1]['id']; bid=b.get('/api/me')[1]['id']
def request(client, expected, path='/api/food/entries', method='POST'):
    body=[{'day':'2026-10-17','meal':'lunch','name':'Fictional oats','kcal':120,'protein_g':4,'carbs_g':20,'fat_g':2}]
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if method=='POST' else None,method=method,
        headers={'Content-Type':'application/json','Origin':BASE,'X-Kinetta-Account':str(expected)})
    try:
        with client.op.open(req) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
try:
    code,body=request(b,aid);assert code==409 and body['detail']['code']=='account_changed',(code,body)
    assert b.get('/api/food/day?d=2026-10-17')[1]['entries']==[],'mismatched queued write must not reach another account'
    assert request(a,aid)[0]==200
    assert request(b,bid)[0]==200
    assert request(a,bid,'/api/food/day?d=2026-10-17','GET')[0]==409,'constraint also protects private reads'
    assert request(a,'not-an-id')[0]==409
    assert a.get('/api/me')[0]==200,'old clients and identity discovery continue working'
    # The header never authenticates a request: the session remains mandatory.
    from kc import Client
    assert request(Client(),aid)[0]==401
    print('expected account: wrong cookie/malformed identity blocked, correct/legacy clients work, no authentication bypass PASS')
finally:
    for client in (a,b):client.post('/api/account/delete',{'password':PW})
