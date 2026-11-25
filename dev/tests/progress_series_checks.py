"""HTTP contract and isolated real SQL regression coverage; no model/provider requests."""
import os
import subprocess
from pathlib import Path
from kc import Client, PW, person


def run():
    project=os.environ.get('KINETTA_PROJECT','kinettatest')
    assert project=='kinettatest' or project.startswith('kt-')
    people=[person('zz_test_series_'+name) for name in ('a','b')]
    try:
        assert Client().get('/api/progress/series')[0]==401
        for query in ('metric=sql','aggregate=median','group_by=week%27','sport=run%27',
                      'period_unit=years','period_count=0','period_count=53','user_id=1',
                      'metric=pace&aggregate=sum','metric=avg_hr&aggregate=sum','metric=workouts&aggregate=average'):
            assert people[0].get('/api/progress/series?'+query)[0]==422, query
        status,result=people[0].get('/api/progress/series?period_count=3')
        assert status==200 and len(result['points'])==3 and result['workouts']==0, (status,result)
        source=Path(__file__).with_name('progress_series_incontainer.py').read_text()
        subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],input=source,text=True,check=True)
    finally:
        for client in people: client.post('/api/account/delete',{'password':PW})


if __name__=='__main__': run()
