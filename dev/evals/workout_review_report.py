"""Build a private Kit gate report from a complete capture and explicit owner review.

No provider calls. Preparation writes unanswered review fields; approval never comes
from validator acceptance alone. Keep all inputs and outputs outside the repository.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKS = ('numeric_supported', 'isolation_passed', 'health_disclosures_absent',
          'conversation_passed', 'qualitative_passed')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private_path(value):
    path = Path(value).expanduser().resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError('Keep evaluation material outside the public repository')
    return path


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.stat().st_mode & 0o077:
        raise ValueError('Output directory must have mode 0700')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def capture(path):
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if (len(rows) < 3 or rows[0].get('type') != 'metadata'
            or rows[-1].get('type') != 'summary' or rows[0].get('dry_run')):
        raise ValueError('A complete real-provider capture is required')
    metadata, summary = rows[0], rows[-1]
    cases = rows[1:-1]
    if (any(row.get('type') != 'case' for row in cases) or len(cases) < 40
            or len({row.get('case') for row in cases}) != len(cases)
            or summary.get('complete') is not True
            or summary.get('completed_cases') != len(cases)
            or summary.get('selected_cases') != len(cases)
            or metadata.get('case_count') != len(cases)):
        raise ValueError('Gate capture needs at least 40 complete distinct cases')
    if len({json.dumps(row.get('input'), sort_keys=True) for row in cases}) != len(cases):
        raise ValueError('Gate capture inputs must be distinct')
    for row in cases:
        if (row.get('rejection_code') is not None or row.get('error_type') is not None
                or not row.get('answer_text') or not row.get('rendered_answer')
                or not row.get('input') or type(row.get('tokens_in')) is not int
                or type(row.get('tokens_out')) is not int or row.get('cost_usd') is None):
            raise ValueError('Every case must have a successful recorded answer and usage')
    spec = importlib.util.spec_from_file_location('release_only', ROOT / 'app/ai_release.py')
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    if metadata.get('ai_text') != release.ai_text('kit'):
        raise ValueError('Capture does not match the current Kit text fingerprint')
    models = metadata.get('models')
    if models != {'provider':'gemini', 'model':'gemini-3.8-flash'}:
        raise ValueError('Unexpected model settings in capture')
    fingerprint = hashlib.sha256(json.dumps({'scheme':2, 'text':metadata['ai_text'],
        'models':models}, sort_keys=True).encode()).hexdigest()
    if metadata.get('candidate_fingerprint') != fingerprint:
        raise ValueError('Capture fingerprint does not match its text/model settings')
    if (not metadata.get('source_commit') or metadata.get('thinking') not in ('LOW','MEDIUM')
            or not 0 <= summary.get('spent_or_reserved_usd', -1) <= 1
            or summary.get('hard_cap_usd') != 1):
        raise ValueError('Missing source/thinking or invalid run accounting')
    return metadata, summary, cases


def build(capture_path, baseline_path, review_path=None):
    metadata, summary, cases = capture(capture_path)
    baseline = json.loads(baseline_path.read_text())
    baseline_kit = baseline.get('kit') or {}
    if (baseline.get('reviewed') is not True or baseline_kit.get('case_count', 0) < 40
            or not baseline.get('candidate_fingerprint')
            or any(baseline_kit.get(key) != 0 for key in
                ('unsupported_numeric_claims','isolation_failures','health_disclosures'))
            or any(baseline_kit.get(key) is not True for key in
                ('baseline_compared','conversation_review_passed','qualitative_review_passed'))):
        raise ValueError('Supply the existing reviewed Kit baseline report')
    binding = {'capture_sha256':digest(capture_path), 'baseline_report_sha256':digest(baseline_path),
               'candidate_fingerprint':metadata['candidate_fingerprint']}
    if review_path is None:
        return {**binding, 'reviewer':None, 'baseline_compared':None,
                'existing_chat_and_weekly_review_passed':None,
                'cases':[{ 'case':row['case'], **{key:None for key in CHECKS}} for row in cases]}
    review = json.loads(review_path.read_text())
    if (any(review.get(key) != value for key, value in binding.items())
            or not isinstance(review.get('reviewer'),str) or not review['reviewer'].strip()
            or review.get('baseline_compared') is not True
            or review.get('existing_chat_and_weekly_review_passed') is not True):
        raise ValueError('Review must bind these inputs and explicitly approve baseline/chat/weekly checks')
    reviews = review.get('cases')
    if (not isinstance(reviews,list) or len(reviews) != len(cases)
            or {row.get('case') for row in reviews} != {row['case'] for row in cases}
            or any(row.get(key) is not True for row in reviews for key in CHECKS)):
        raise ValueError('Every captured case needs all five explicit human review checks')
    return {'reviewed':True, 'candidate_fingerprint':metadata['candidate_fingerprint'],
            'ai_text':metadata['ai_text'], 'models':metadata['models'],
            'kit':{'case_count':len(cases), 'unsupported_numeric_claims':0, 'isolation_failures':0,
                   'health_disclosures':0, 'baseline_compared':True,
                   'conversation_review_passed':True, 'qualitative_review_passed':True},
            'workout_review_evaluation':{**binding, 'source_commit':metadata['source_commit'],
                'thinking':metadata['thinking'], 'reviewer':review['reviewer'],
                'review_sha256':digest(review_path), 'baseline_fingerprint':baseline['candidate_fingerprint'],
                'spent_or_reserved_usd':summary['spent_or_reserved_usd']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', required=True)
    parser.add_argument('--baseline-report', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare-review', help='Write private unanswered review JSON, never a gate report')
    mode.add_argument('--review', help='Explicitly completed private human review JSON')
    parser.add_argument('--output', help='New private gate-report path; required with --review')
    args = parser.parse_args()
    if bool(args.review) != bool(args.output):
        parser.error('--review and --output must be supplied together')
    try:
        result = build(private_path(args.capture), private_path(args.baseline_report),
                       private_path(args.review) if args.review else None)
        output = private_path(args.output or args.prepare_review)
        write_private(output, result)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'Report not written: {error}\n')
    print(('Reviewed gate report' if args.review else 'Unanswered human review') + f': {output}')


if __name__ == '__main__':
    main()
