"""Compare saved provider observations against a reviewed production baseline; no API calls.

Input JSON contains metadata {mode: 'live'|'recorded', model, prompt_version, source_commit, dataset_sha256},
plus cases and observations. Private benchmark data/results stay outside the repository.
"""
import argparse
import hashlib
import json
from pathlib import Path
from scoring import aggregate, compare

p = argparse.ArgumentParser(); p.add_argument('baseline'); p.add_argument('candidate'); p.add_argument('--output', required=True)
a = p.parse_args()
baseline, candidate = (json.loads(Path(path).read_text()) for path in (a.baseline, a.candidate))
for run in (baseline, candidate):
    meta = run['metadata']
    assert meta.get('complete') is True, 'Partial runs cannot approve a release'
    assert len(run['cases']) >= 300, 'Use several hundred reviewed cases'
    assert all(case.get('reviewed') is True for case in run['cases']), 'Every ground-truth case requires review'
    assert {'text', 'photo', 'label', 'barcode', 'restaurant', 'correction'} <= {case['kind'] for case in run['cases']}, 'Real multimodal coverage required'
    assert meta['mode'] in ('live', 'recorded'), 'Synthetic contract results cannot approve a model release'
    assert all(meta.get(key) for key in ('model', 'prompt_version', 'source_commit', 'dataset_sha256')), 'Incomplete provenance'
    digest = hashlib.sha256(json.dumps(run['cases'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert digest == meta['dataset_sha256'], 'Dataset fingerprint differs'
assert baseline['cases'] == candidate['cases'], 'Different benchmark datasets'
metrics = [aggregate(run['cases'], run['observations']) for run in (baseline, candidate)]
result = {**compare(*metrics), 'baseline': metrics[0], 'candidate': metrics[1],
          'baseline_metadata': baseline['metadata'], 'candidate_metadata': candidate['metadata']}
Path(a.output).write_text(json.dumps(result, indent=2))
raise SystemExit(0 if result['passed'] else 1)
