"""Target comparison checks against fictional stored food/targets; no providers."""
import math
import os
import subprocess
from pathlib import Path
from kc import Client, PW, person


def run():
    project=os.environ['KINETTA_PROJECT']
    assert project=='kinettatest' or project.startswith('kt-')
    a,b=person('zz_test_adequacy_a'),person('zz_test_adequacy_b')
    args={'start':'2024-06-01','end':'2024-06-06'}
    try:
        assert Client().post('/api/coach/tools',{'name':'nutrition_adequacy','arguments':args})[0]==401
        for invalid in ({**args,'user_id':1},{**args,'sql':'SELECT * FROM users'},
                        {'start':'2024-06-06','end':'2024-06-01'},
                        {'start':'2023-06-01','end':'2024-06-01'}):
            assert a.post('/api/coach/tools',{'name':'nutrition_adequacy','arguments':invalid})[0]==400
        subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],
                       input=Path(__file__).with_name('coach_adequacy_incontainer.py').read_text(),text=True,check=True)
        result=a.post('/api/coach/tools',{'name':'nutrition_adequacy','arguments':args})
        assert result[0]==200,result
        data=result[1]['data']
        assert data['timezone']=='America/New_York' and data['excluded_days']==0
        assert data['days'][0]['kcal']['logged_total']==0 and data['days'][0]['kcal']['comparable']
        assert data['days'][0]['kcal']['target_ratio']==0 and data['days'][0]['kcal']['difference']==-2000
        assert data['days'][2]['kcal']['logged_total']==1250 and data['days'][2]['protein_g']['logged_total'] is None
        assert data['days'][2]['protein_g']['known_subtotal']==50 and data['days'][2]['protein_g']['unknown_items']==1
        assert data['days'][3]['kcal']['logged_total'] is None and data['days'][3]['kcal']['known_subtotal']==0
        assert data['days'][3]['protein_g']['logged_total']==80
        assert data['days'][4]['kcal']['target']==1200 and data['days'][4]['kcal']['difference']==100
        assert data['summary']['kcal']['full_range_comparable'] is False
        assert data['summary']['kcal']['full_range_difference'] is None
        assert data['summary']['kcal']['comparable_days']==5
        other=b.post('/api/coach/tools',{'name':'nutrition_adequacy','arguments':args})
        assert other[0]==200 and other[1]['data']['logged_days']==1
        assert other[1]['data']['days'][1]['kcal']['target'] is None
        assert other[1]['data']['days'][1]['protein_g']['comparable'] is False
        decimal=a.post('/api/coach/tools',{'name':'nutrition_adequacy','arguments':{'start':'2024-01-01','end':'2024-01-01'}})
        value=decimal[1]['data']['days'][0]['protein_g']['logged_total']
        assert isinstance(value,(int,float)) and math.isclose(value,0.1,rel_tol=1e-6),decimal
        print('Nutrition adequacy HTTP: bounds, unknown-vs-zero, day override, complete-range gate, isolation and fractional JSON PASS')
    finally:
        a.post('/api/account/delete',{'password':PW}); b.post('/api/account/delete',{'password':PW})


if __name__=='__main__': run()
