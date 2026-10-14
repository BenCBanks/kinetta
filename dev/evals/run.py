"""Explicitly opt-in paid benchmark collector; run in a reviewed isolated image with its own AI key.

Does not read user accounts or health records. Default case set is synthetic reference-grounded text;
reviewed manifests may include image fixtures. Results are private files, never committed.
"""
import argparse
import base64
import hashlib
import json
import os
import time
from pathlib import Path
from cases import cases as reference_cases

p = argparse.ArgumentParser()
p.add_argument('--manifest'); p.add_argument('--output', required=True); p.add_argument('--source-commit', required=True)
p.add_argument('--prices', required=True, help='Reviewed JSON: model -> input_per_million, output_per_million')
p.add_argument('--max-requests', type=int, default=10); p.add_argument('--budget-usd', type=float, required=True)
p.add_argument('--accept-paid-calls', action='store_true')
a = p.parse_args()
if not a.accept_paid_calls: p.error('No calls made: explicit --accept-paid-calls is required')
if not 1 <= a.max_requests <= 500 or not 0 < a.budget_usd <= 100: p.error('Set a bounded request count and budget')
if not os.environ.get('GEMINI_API_KEY'): p.error('A dedicated benchmark AI key is required')
from app import food_photo
manifest = Path(a.manifest).resolve() if a.manifest else None
fixtures = json.loads(manifest.read_text()) if manifest else reference_cases()
prices = json.loads(Path(a.prices).read_text())
observations = []
output = Path(a.output); output.parent.mkdir(parents=True, exist_ok=True)
metadata = {'mode': 'live', 'model': os.environ.get('GEMINI_FOOD_MODEL', 'gemini-3.1-flash-lite'),
            'prompt_version': hashlib.sha256((food_photo.PROMPT + food_photo.ROUNDING + json.dumps(food_photo.SCHEMA, sort_keys=True)).encode()).hexdigest(),
            'source_commit': a.source_commit, 'dataset_sha256': hashlib.sha256(json.dumps(fixtures, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'cost_basis': 'token usage at operator-supplied model prices; retries may add unobserved charges', 'complete': False}

def save(): output.write_text(json.dumps({'metadata': metadata, 'cases': fixtures, 'observations': observations}, indent=2))

save()
spent = 0
for case in fixtures[:a.max_requests]:
    if spent >= a.budget_usd: break
    parts = [{'text': food_photo.PROMPT.format(what='Estimate the food described; use the supplied reference facts.')}, {'text': case['input']}]
    if case.get('image'):
        if manifest is None: raise ValueError('Images need a reviewed manifest')
        image = (manifest.parent / case['image']).resolve()
        if not image.is_relative_to(manifest.parent) or image.suffix.lower() not in ('.jpg', '.jpeg', '.png'): raise ValueError('Image must be a fixture within the manifest folder')
        blob = image.read_bytes()
        if len(blob) > 4_000_000: raise ValueError('Fixture image is too large')
        parts.append({'inline_data': {'mime_type': 'image/png' if image.suffix.lower() == '.png' else 'image/jpeg', 'data': base64.b64encode(blob).decode()}})
    began = time.monotonic()
    response, raw, model = food_photo.ask(parts, food_photo.SCHEMA, 'benchmark')
    usage = raw.get('usageMetadata') or {}
    if model not in prices or 'promptTokenCount' not in usage or 'totalTokenCount' not in usage: raise ValueError('Cannot measure cost: missing token usage or reviewed model prices')
    price = prices[model]
    cost = (usage['promptTokenCount'] * price['input_per_million'] +
            max(0, usage['totalTokenCount'] - usage['promptTokenCount']) * price['output_per_million']) / 1_000_000
    observations.append({'id': case['id'], 'response': response, 'model': model, 'latency_ms': round((time.monotonic() - began) * 1000),
                         'cost_usd': cost, 'usage': usage})
    spent += cost; save()
metadata['complete'] = len(observations) == len(fixtures)
save()
print(json.dumps({'completed_cases': len(observations), 'total_cases': len(fixtures), 'estimated_cost_usd': spent, 'complete': metadata['complete']}))
