"""Strict personal-record comparisons with disposable fictional accounts; no provider calls."""
import os
import subprocess
from pathlib import Path
from kc import Client, PW, person


def run():
    project=os.environ['KINETTA_PROJECT']
    assert project=='kinettatest' or project.startswith('kt-')
    a,b,empty=person('zz_test_records_a'),person('zz_test_records_b'),person('zz_test_records_empty')
    try:
        assert Client().post('/api/coach/tools',{'name':'personal_records','arguments':{}})[0]==401
        for invalid in ({'limit':0},{'limit':51},{'limit':True,'user_id':1},{'sql':'SELECT * FROM best_efforts'}):
            assert a.post('/api/coach/tools',{'name':'personal_records','arguments':invalid})[0]==400
        subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],
            input=Path(__file__).with_name('coach_records_incontainer.py').read_text(),text=True,check=True)
        result=a.post('/api/coach/tools',{'name':'personal_records','arguments':{'limit':2}})
        assert result[0]==200,result
        data=result[1]['data']
        assert data['total_personal_records']==4 and data['returned_count']==2 and data['truncated'] is True,data
        assert [(r['sport'],r['distance_m'],r['elapsed_s'],r['previous_best_s']) for r in data['records']]==[
            ('ride',1000.0,440.0,450.0),('run',1000.0,380.0,390.0)],data
        complete=a.post('/api/coach/tools',{'name':'personal_records','arguments':{}})[1]['data']
        assert complete['total_personal_records']==4 and complete['returned_count']==4 and complete['truncated'] is False
        assert [r['elapsed_s'] for r in complete['records']]==[440.0,380.0,480.0,390.0]
        other=b.post('/api/coach/tools',{'name':'personal_records','arguments':{}})
        assert other[0]==200 and other[1]['data']['total_personal_records']==1
        assert other[1]['data']['records'][0]['label']=='Fictional 1k B'
        no_history=empty.post('/api/coach/tools',{'name':'personal_records','arguments':{}})
        assert no_history[0]==200 and no_history[1]['data']['total_personal_records']==0
        assert no_history[1]['data']['records']==[] and no_history[1]['data']['truncated'] is False
        print('Personal records HTTP: authentication, bounds, strict ties/improvements, empty history, truncation and isolation PASS')
    finally:
        a.post('/api/account/delete',{'password':PW}); b.post('/api/account/delete',{'password':PW}); empty.post('/api/account/delete',{'password':PW})


if __name__=='__main__':run()
