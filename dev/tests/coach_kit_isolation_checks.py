"""Full Kit catalog account-isolation and Health-consent fixture; no provider calls."""
import os
import subprocess
from pathlib import Path
from kc import PW, person


def run():
    project = os.environ['KINETTA_PROJECT']
    assert project == 'kinettatest' or project.startswith('kt-')
    accounts = [person('zz_test_kit_iso_a'), person('zz_test_kit_iso_b'), person('zz_test_kit_iso_health_off')]
    try:
        subprocess.run(
            ['docker', 'exec', '-i', project + '-app-1', 'python', '-'],
            input=Path(__file__).with_name('coach_kit_isolation_incontainer.py').read_text(),
            text=True, check=True,
        )
    finally:
        for account in accounts:
            account.post('/api/account/delete', {'password': PW})


if __name__ == '__main__':
    run()
