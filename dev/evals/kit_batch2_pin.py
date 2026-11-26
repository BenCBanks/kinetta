"""Offline source/report verification; never read a live server or credentials."""
import ast
import hashlib
import json
from pathlib import Path

LIVE = 'ba8e9500049f25b2cb769d09a25d99fc4cb198c1'
INSTALLED_REPORT_SHA256 = '5aae49f41cb3ea4bb8091a34fee4459ca6e7d8cb857c3b82d37b4b361da0e568'


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
    print(json.dumps(verify(*sys.argv[1:]), sort_keys=True))
