"""Fails a PR whose model-facing AI text isn't recorded in app/ai_fingerprints.json, so a change that alters what a
model reads is noticed before merge, never discovered later as a feature that switched itself off on the live server.

If this fails:
- You changed a prompt, schema, tool description or other text a model reads: the feature needs a reviewed
  evaluation (dev/evals/README.md). Add the printed fingerprint as a new group, e.g. "kit": [[...old...], ["<new>"]].
- The changed strings are not model-facing (a log line, a dict key only code uses): append the printed fingerprint
  to the gate's current group and say why in the PR. The live feature then stays on with its existing review.
No paid calls; runs without the app's dependencies."""
import importlib.util, json, sys
from pathlib import Path

root = Path(__file__).resolve().parents[2] / 'app'
spec = importlib.util.spec_from_file_location('ai_release_only', root / 'ai_release.py')
release = importlib.util.module_from_spec(spec); spec.loader.exec_module(release)
ledger = json.loads((root / 'ai_fingerprints.json').read_text())
missing = []
for gate in release.FILES:
    text = release.ai_text(gate)
    if not any(text in group for group in ledger.get(gate, [])): missing.append(f'{gate}: {text}')
# The scheme ignores comments, docstrings and logic: prove it on a real file.
source = (root / 'kit_thread.py').read_text()
assert release.model_text(source) == release.model_text(source.replace('\n', '\n# a comment\n', 3) + '\ndef _unused():\n    """Doc."""\n    return 1\n')
assert release.model_text("x = 'Reply in one sentence.'") != release.model_text("x = 'Reply in two sentences.'")
if missing:
    print('AI text changed for ' + ', '.join(m.split(':')[0] for m in missing) + '. Read the top of dev/tests/ai_fingerprints.py.')
    print('\n'.join(missing)); sys.exit(1)
print('AI fingerprints: model-facing text for every gated feature is recorded; comments/logic ignored PASS')
