"""AI features stay off until a reviewed comparison matches what the model actually reads, and then stay on.

A fingerprint covers the model-facing text of each feature's files (prompts, answer schemas, tool names and
descriptions: their string literals) plus the model settings. Code logic, comments, docstrings, SQL and HTTP error
text don't count, so ordinary fixes no longer switch a reviewed feature off on the live server (Ben, 25 October 2026:
AI going on and off degrades the experience). `ai_fingerprints.json` records text fingerprints that a person judged
equivalent, and `dev/tests/ai_fingerprints.py` fails a PR whose model-facing text isn't recorded there, so any real
change is caught (and re-reviewed) before merge instead of after deploy.
"""
import ast
import hashlib
import json
import os
import re
from pathlib import Path


from functools import lru_cache

ROOT=Path(__file__).parent
FILES={
    'general':['ai_access.py','coach.py','coach_chat.py','coach_tools.py','coach_proposals.py','food_photo.py','cook_chat.py','food_coach.py','food_thread_kit.py','food_thread_photo.py','food_thread_compose.py','food_thread_resolve.py'],
    'understanding':['food_thread_understand.py','food_photo.py','food_thread_choices.py','food_thread_compose.py','food_thread_log.py','food_thread_photo.py','ai_budget.py'],
    'kit':['kit_thread.py','kit_memory.py','kit_tools.py','coach_chat.py','coach_tools.py','coach_proposals.py','coach.py','ai_access.py','ai_budget.py'],
}
SQL=re.compile(r'\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP)\b',re.I)


def model_text(source):
    """The string literals a model can read, in source order: no docstrings, SQL or HTTPException messages."""
    tree=ast.parse(source);skip=set()
    for node in ast.walk(tree):
        if isinstance(node,(ast.Module,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and node.body and \
           isinstance(node.body[0],ast.Expr) and isinstance(node.body[0].value,ast.Constant):skip.add(id(node.body[0].value))
        if isinstance(node,ast.Call) and getattr(node.func,'id',getattr(node.func,'attr',None))=='HTTPException':
            skip.update(id(n) for a in node.args[1:]+[k.value for k in node.keywords] for n in ast.walk(a))
    found=[n for n in ast.walk(tree) if isinstance(n,ast.Constant) and isinstance(n.value,str) and id(n) not in skip and not SQL.match(n.value)]
    return [n.value for n in sorted(found,key=lambda n:(n.lineno,n.col_offset))]


@lru_cache(maxsize=8)
def _file_text(name,data):
    return hashlib.sha256(json.dumps(model_text(data.decode())).encode()).hexdigest()


def ai_text(gate):
    """One hash of the model-facing text across a feature's files."""
    files={n:_file_text(n,(ROOT/n).read_bytes()) for n in FILES[gate]}
    return hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()


def models(gate):
    from . import coach
    food={'food_model':os.environ.get('GEMINI_FOOD_MODEL','gemini-3.1-flash-lite'),
          'food_fallback':os.environ.get('GEMINI_FOOD_FALLBACK_MODEL','gemini-3.8-flash')}
    if gate=='understanding':return food
    coach_model=os.environ.get('GEMINI_MODEL','gemini-3.8-flash') if coach.provider()=='gemini' else coach.MODEL
    if gate=='kit':return {'provider':coach.provider(),'model':coach_model}
    return {**food,'coach_model':coach_model,'coach_fallback':os.environ.get('GEMINI_FALLBACK_MODEL','gemini-3.1-flash-lite')}


def gate_fingerprint(gate):
    return hashlib.sha256(json.dumps({'scheme':2,'text':ai_text(gate),'models':models(gate)},sort_keys=True).encode()).hexdigest()


def fingerprint():return gate_fingerprint('general')
def understanding_fingerprint():return gate_fingerprint('understanding')
def kit_fingerprint():return gate_fingerprint('kit')


def ledger():
    try:return json.loads((ROOT/'ai_fingerprints.json').read_text())
    except (OSError,ValueError):return {}


def reviewed_for(gate,block):
    """A report block approves today's code when its fingerprint matches exactly, or when it recorded the same
    model settings and a text fingerprint that the ledger lists as equivalent to today's."""
    if not isinstance(block,dict):return False
    if block.get('candidate_fingerprint')==gate_fingerprint(gate):return True
    text,current=block.get('ai_text'),ai_text(gate)
    if not text or block.get('models')!=models(gate):return False
    return any(isinstance(group,list) and text in group and current in group for group in ledger().get(gate,[]))


def kit_enabled():
    if os.environ.get('KINETTA_KIT_ENABLED')!='1':return False
    report=os.environ.get('KINETTA_KIT_EVAL_REPORT')
    if not report:return False
    try:
        data=json.loads(Path(report).read_text())
        if not isinstance(data,dict):return False
        kit=data.get('kit',{})
        if not isinstance(kit,dict):return False
        return (data.get('reviewed') is True and reviewed_for('kit',data)
                and kit.get('case_count',0)>=40 and kit.get('unsupported_numeric_claims')==0
                and kit.get('isolation_failures')==0 and kit.get('health_disclosures')==0
                and kit.get('baseline_compared') is True and kit.get('conversation_review_passed') is True
                and kit.get('qualitative_review_passed') is True)
    except (OSError,ValueError,TypeError):return False


def food_photo_itemization_enabled():
    """Use the existing reviewed food comparison, independent of Kit/coach approval."""
    report=os.environ.get('KINETTA_AI_EVAL_REPORT')
    if not report:return False
    try:
        data=json.loads(Path(report).read_text())
        if not isinstance(data,dict) or not isinstance(data.get('food'),dict):return False
        return (data.get('reviewed') is True and reviewed_for('general',data)
                and data['food'].get('passed') is True)
    except (OSError,ValueError,TypeError):return False


def enabled(scope=None):
    if scope=='kit':return kit_enabled()
    if scope not in (None,'food'):return False
    if os.environ.get('KINETTA_COACH_TOOLS_ENABLED') != '1': return False
    report = os.environ.get('KINETTA_AI_EVAL_REPORT')
    if not report: return False
    try:
        data = json.loads(Path(report).read_text())
        general=(data.get('reviewed') is True and reviewed_for('general',data)
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
