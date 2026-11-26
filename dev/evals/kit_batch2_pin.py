"""Offline source/report verification; never read a live server or credentials."""
import hashlib
import json
import subprocess
from pathlib import Path

LIVE = '7a9fb03f205a00e01ee3859b1aa1ab91f4469eff'
INSTALLED_REPORT_SHA256 = '350b3371911dcd89b4ddba162c985c106751c0da1fead4b44ca5da6cace0af3d'
CANDIDATE_SOURCE = '4180cff4f228774ae902c9151b78323e36426a8a'
CANDIDATE_TEXT = 'a629a624887e1e7bd0fb63bb7874f558dcf375f6f11d637c652901b017e05cfb'
CANDIDATE_RELEASE = '6f687277046e41f04c9393255b4273fed4034439d930948ed8ebe157e41ee086'


def verify_candidate(root):
    root=Path(root)
    if subprocess.run(['git','-C',str(root),'diff','--quiet',CANDIDATE_SOURCE,'--','app',
                       ':(exclude)app/ai_fingerprints.json']).returncode:
        raise ValueError('Candidate app source differs from the final combined freeze')
    namespace={'__file__':str(root/'app/ai_release.py')}
    exec(compile((root/'app/ai_release.py').read_text(),'candidate_release','exec'),namespace)
    files={name:hashlib.sha256(json.dumps(namespace['model_text']((root/'app'/name).read_text())).encode()).hexdigest()
           for name in namespace['FILES']['kit']}
    text=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()
    if text!=CANDIDATE_TEXT:raise ValueError('Candidate Kit text differs from the final combined freeze')
    return {'source_commit':CANDIDATE_SOURCE,'ai_text':text,'fingerprint':CANDIDATE_RELEASE,
            'source_check':'app bytes identical except equivalence ledger; evaluator HEAD recorded separately'}


def verify(tree, report):
    tree, report = Path(tree), Path(report)
    data = report.read_bytes(); reviewed = json.loads(data)
    if hashlib.sha256(data).hexdigest() != INSTALLED_REPORT_SHA256:
        raise ValueError('Use the pinned installed live report, not a dry-run or candidate report')
    # Load only the dependency-free fingerprint definition from the frozen source.
    namespace = {'__file__': str(tree/'ai_release.py')}
    exec(compile((tree/'ai_release.py').read_text(), 'frozen_ai_release', 'exec'), namespace)
    files = {name: hashlib.sha256(json.dumps(namespace['model_text']((tree/name).read_text())).encode()).hexdigest()
             for name in namespace['FILES']['kit']}
    text = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    models = {'provider': 'gemini', 'model': 'gemini-3.8-flash'}
    fingerprint = hashlib.sha256(json.dumps({'scheme':2,'text':text,'models':models},sort_keys=True).encode()).hexdigest()
    kit = reviewed.get('kit', {})
    if not (reviewed.get('reviewed') is True and reviewed.get('ai_text') == text
            and reviewed.get('models') == models and reviewed.get('candidate_fingerprint') == fingerprint
            and kit.get('case_count',0) >= 40
            and all(kit.get(k) == 0 for k in ('unsupported_numeric_claims','isolation_failures','health_disclosures'))
            and all(kit.get(k) is True for k in ('baseline_compared','conversation_review_passed','qualitative_review_passed'))):
        raise ValueError('The installed review does not approve the frozen live Kit source')
    return {'baseline_commit': LIVE, 'installed_report_sha256': INSTALLED_REPORT_SHA256,
            'baseline_ai_text':text, 'baseline_fingerprint':fingerprint,
            'baseline_files':files, 'baseline_helpers':'frozen app tree; disposable db/ledger shared'}


if __name__ == '__main__':
    import sys
    pin=verify(*sys.argv[1:3]);pin['candidate']=verify_candidate(sys.argv[3])
    print(json.dumps(pin, sort_keys=True))
