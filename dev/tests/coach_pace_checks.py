"""Pace/effort comparison on fictional accounts; no provider calls."""
import os
import subprocess
from pathlib import Path
from kc import Client, PW, person


def run():
    project=os.environ['KINETTA_PROJECT']
    assert project=='kinettatest' or project.startswith('kt-')
    a,b=person('zz_test_pace_a'),person('zz_test_pace_b')
    try:
        assert Client().post('/api/coach/tools',{'name':'pace_vs_effort','arguments':{'start':'2026-03-07','end':'2026-03-12'}})[0]==401
        for invalid in (
            {'start':'2026-03-07','end':'2026-03-12','limit':0},
            {'start':'2026-03-07','end':'2026-03-12','limit':51},
            {'start':'2026-03-07','end':'2026-03-12','user_id':1},
            {'start':'2026-03-07','end':'2026-03-12','sql':'SELECT * FROM activities'},
            {'start':'2026-03-07','end':'2026-03-12','end2':'2026-03-13'},
            {'start':'2025-02-28','end':'2026-03-01'},
        ):
            response=a.post('/api/coach/tools',{'name':'pace_vs_effort','arguments':invalid})
            assert response[0]==400,(invalid,response)
        subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],
            input=Path(__file__).with_name('coach_pace_incontainer.py').read_text(),text=True,check=True)
        response=a.post('/api/coach/tools',{'name':'pace_vs_effort','arguments':{
            'start':'2026-03-07','end':'2026-03-09','limit':1}})
        assert response[0]==200,response
        data=response[1]['data']
        assert data['coverage']['run_count']==4 and data['coverage']['paired_count']==2,data
        assert data['returned_count']==1 and data['truncated'] is True,data
        assert data['samples']==[{'day':'2026-03-08','pace_s_per_km':360.0,'effort':25.0}],data
        other=b.post('/api/coach/tools',{'name':'pace_vs_effort','arguments':{
            'start':'2026-03-07','end':'2026-03-09'}})
        assert other[0]==200 and other[1]['data']['coverage']['paired_count']==1,other
        assert 'zz_test' not in str(data),'tool output contains no login or private name'
        print('Pace/effort HTTP: auth, bounds, fixed fields, truncation and account isolation PASS')
    finally:
        a.post('/api/account/delete',{'password':PW}); b.post('/api/account/delete',{'password':PW})


if __name__=='__main__':run()
