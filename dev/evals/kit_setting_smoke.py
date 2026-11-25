"""Small setting experiment, never a release-gate report; no provider access here."""
import datetime as dt
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

CASE_IDS = ('conversation-detail','general-diet','nutrition-adequacy','meal','followup-food',
            'strength','weekly-steady-prior','weekly-no-plan','recall-health-consent-off','recall-other-account')
CAP_USD = .45
RUBRIC = ('direct_and_useful','right_length_and_structure','evidence_and_units',
          'context_and_clarification','supported_next_step','privacy_and_safety')


def input_digest(root, cases, files, *, today=None):
    today = today or (dt.datetime.now(dt.timezone.utc).date().isoformat(),
                      dt.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat())
    paths = [root/'app'/name for name in files] + [root/'app/db.py']
    paths += [Path(__file__),root/'dev/evals/kit_eval.py',root/'dev/evals/kit_cases.py',
              root/'dev/evals/kit_weekly_fixtures.py']
    data = {'dates':today,'model':'gemini-3.8-flash','cases':cases,
            'sources':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    return hashlib.sha256(json.dumps(data,sort_keys=True,default=lambda x:sorted(x)).encode()).hexdigest()


def cached_low(report, digest):
    if (report.get('setting_smoke') is not True or report.get('input_digest')!=digest
            or report.get('thinking_settings')!={'baseline':'LOW','candidate':'MEDIUM'}):
        raise ValueError('LOW cache inputs/settings differ; use a fresh comparison')
    rows = [r for r in report.get('results',[]) if r.get('variant')=='baseline'
            and r.get('case') in CASE_IDS and r.get('passed') is True and r.get('answer') and not r.get('error')]
    if len({r['case'] for r in rows})!=len(rows):raise ValueError('Duplicate LOW cache case')
    return rows

