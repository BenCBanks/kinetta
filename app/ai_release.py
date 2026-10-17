"""New coach functionality stays off until a reviewed comparison matches its actual code/prompts/models."""
import hashlib
import json
import os
from pathlib import Path


def fingerprint():
    from . import coach, coach_chat, food_photo
    root = Path(__file__).parent
    files = ['ai_access.py', 'coach.py', 'coach_chat.py', 'coach_tools.py', 'coach_proposals.py', 'food_photo.py', 'cook_chat.py', 'food_coach.py', 'food_thread_kit.py', 'food_thread_facts.py']
    config = {'files': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files},
              'coach_model': os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash') if coach.provider() == 'gemini' else coach.MODEL,
              'coach_fallback': os.environ.get('GEMINI_FALLBACK_MODEL', 'gemini-3.1-flash-lite'),
              'food_model': os.environ.get('GEMINI_FOOD_MODEL', 'gemini-3.1-flash-lite'),
              'food_fallback': os.environ.get('GEMINI_FOOD_FALLBACK_MODEL', 'gemini-3.8-flash')}
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def enabled(scope=None):
    if scope not in (None,'food'):return False
    if os.environ.get('KINETTA_COACH_TOOLS_ENABLED') != '1': return False
    report = os.environ.get('KINETTA_AI_EVAL_REPORT')
    if not report: return False
    try:
        data = json.loads(Path(report).read_text())
        general=(data.get('reviewed') is True and data.get('candidate_fingerprint') == fingerprint()
                and data.get('food', {}).get('passed') is True
                and data.get('coach', {}).get('case_count', 0) >= 30
                and data.get('coach', {}).get('unsupported_numeric_claims') == 0
                and data.get('coach', {}).get('isolation_failures') == 0
                and data.get('coach', {}).get('qualitative_review_passed') is True)
        if not general or scope is None:return general
        food=data.get('food_chat',{})
        return (food.get('case_count',0)>=30 and food.get('unsupported_numeric_claims')==0
                and food.get('isolation_failures')==0 and food.get('health_disclosures')==0
                and food.get('qualitative_review_passed') is True)
    except (OSError, ValueError, TypeError): return False
