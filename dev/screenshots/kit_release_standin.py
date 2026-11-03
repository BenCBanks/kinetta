"""Materialize the screenshot-only Kit gate report from the current code fingerprint."""
import json
import re
from pathlib import Path

TEMPLATE = Path(__file__).with_name("kit-release.standin.json")


def render_report(fingerprint):
    data = json.loads(TEMPLATE.read_text())
    if data.get("fixture_only") is not True or data.get("real_evaluation_performed") is not False:
        raise ValueError("The Kit screenshot report must remain an explicitly non-evaluation fixture.")
    if data.get("evaluation_results") is not None or data.get("evidence") is not None:
        raise ValueError("The Kit screenshot report cannot contain evaluation results or evidence.")
    current = fingerprint()
    if not isinstance(current, str) or not re.fullmatch(r"[0-9a-f]{64}", current):
        raise ValueError("The Kit screenshot report needs the live 64-character code fingerprint.")
    data["candidate_fingerprint"] = current
    return data


def write_report(path, fingerprint):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(render_report(fingerprint), indent=2) + "\n")
