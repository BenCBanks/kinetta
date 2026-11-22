"""Fixed-clock consistency checks with real SQL/RLS; fictional accounts, no providers."""
import os
import subprocess
from pathlib import Path
from kc import Client, PW, person


def run():
    project = os.environ['KINETTA_PROJECT']
    assert project == 'kinettatest' or project.startswith('kt-')
    a, b = person('zz_test_consistency_a'), person('zz_test_consistency_b')
    args = {'start':'2024-06-03', 'end':'2024-06-12'}
    try:
        assert Client().post('/api/coach/tools', {'name':'consistency','arguments':args})[0] == 401
        for invalid in ({**args,'user_id':1}, {**args,'sql':'SELECT * FROM users'},
                        {'start':'2024-06-12','end':'2024-06-03'}, {'start':'2024-01-01','end':'2025-01-01'}):
            assert a.post('/api/coach/tools', {'name':'consistency','arguments':invalid})[0] == 400
        subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],
                       input=Path(__file__).with_name('coach_consistency_incontainer.py').read_text(), text=True, check=True)
        status, data = a.post('/api/coach/tools', {'name':'consistency','arguments':{**args,'end':'2024-06-09'}})
        assert status == 200 and data['data']['training_plan']['attendance_fraction'] == 0.5, data
        assert b.post('/api/coach/tools', {'name':'consistency','arguments':args})[1]['data']['recorded_workout_days'] == 1
        print('Consistency HTTP: auth/schema, numeric serialization and two-account isolation PASS')
    finally:
        a.post('/api/account/delete', {'password':PW}); b.post('/api/account/delete', {'password':PW})


if __name__ == '__main__':
    run()
