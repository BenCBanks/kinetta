"""Internal service regression coverage in a disposable database; no provider requests."""
import os
import subprocess
from pathlib import Path
from kc import PW, person


def run():
    project=os.environ.get('KINETTA_PROJECT','kinettatest')
    assert project=='kinettatest' or project.startswith('kt-')
    people=[person('zz_test_series_'+name) for name in ('a','b')]
    try:
        assert people[0].get('/api/progress/series')[0]==404, 'internal reader has no HTTP route'
        source=Path(__file__).with_name('progress_series_incontainer.py').read_text()
        subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],input=source,text=True,check=True)
    finally:
        for client in people: client.post('/api/account/delete',{'password':PW})


if __name__=='__main__': run()
