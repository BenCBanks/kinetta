"""Opt-in paid evaluation for Kit's workout-review answer path.

Run only inside a disposable app/database with fictional fixtures. Captures contain
model answers and must stay outside this public repository in a private directory.
This runner has not been executed as part of the PR.
"""
import argparse
import urllib.error
import urllib.request
import json
import os
import sys
import time
import uuid
from pathlib import Path
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'dev' / 'tests'))
from app import ai_budget, ai_release, coach, db, kit_workout_review
from workout_review_fixtures import selected_fixtures

MODEL = 'gemini-3.8-flash'
RUN_CAP_MICROS = 1_000_000
class RunBudgetReached(RuntimeError):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=int, choices=(20,40), default=40, help='40 distinct gate inputs (default), or 20 smoke inputs')
    parser.add_argument('--source-commit', required=True, help='Exact source revision supplied by the wrapper')
    parser.add_argument('--thinking', choices=('LOW', 'MEDIUM'), default='LOW')
    parser.add_argument('--output', required=True, help='Private JSONL output path outside the repository')
    parser.add_argument('--accept-paid-calls', action='store_true', help='Required; provider calls incur cost')
    parser.add_argument('--dry-run', action='store_true', help='Write only a private metadata header; never contact a provider')
    args = parser.parse_args()

    # Both --dry-run and paid execution validate this exact selected set before
    # creating output files or touching provider/database code.
    cases = selected_fixtures(count=args.cases)

    output = Path(args.output).expanduser().resolve()
    repo = ROOT
    if output == repo or repo in output.parents:
        parser.error('Evaluation answers must be written outside the public repository')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.parent.stat().st_mode & 0o077:
        parser.error('Use a private output directory with no group/other permissions')
    if output.exists():
        parser.error('Refusing to overwrite an existing evaluation capture')
    metadata = {'type':'metadata','source_commit':args.source_commit,'model':MODEL,
        'thinking':args.thinking,'case_count':len(cases),'run_cap_usd':1.0,
        'fixture_source':'dev/tests/workout_review_fixtures.py'}
    if args.dry_run:
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(json.dumps({**metadata,'dry_run':True,'provider_calls':0}) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        print(f'Dry run: wrote header only; no provider calls. Output: {output}', flush=True)
        return
    if not args.accept_paid_calls:
        parser.error('No calls made: explicit --accept-paid-calls is required')
    if os.environ.get('KINETTA_WORKOUT_REVIEW_EVAL_ISOLATED') != '1':
        parser.error('Set KINETTA_WORKOUT_REVIEW_EVAL_ISOLATED=1 only inside the disposable fictional-data environment')
    if not os.environ.get('GEMINI_API_KEY'):
        parser.error('GEMINI_API_KEY must be supplied through the environment; never use a command-line key')
    if not coach.enabled() or not ai_budget.enabled():
        parser.error('Enable Kit/provider access only inside the disposable evaluation environment')

    os.environ['GEMINI_MODEL'] = MODEL
    metadata.update(ai_text=ai_release.ai_text('kit'), models=ai_release.models('kit'),
                    candidate_fingerprint=ai_release.kit_fingerprint())
    os.environ['KINETTA_AI_DAILY_USD'] = '1'
    os.environ['KINETTA_AI_USER_DAILY_MICROUSD'] = str(RUN_CAP_MICROS)
    os.environ['KINETTA_AI_USER_DAILY_ATTEMPTS'] = str(len(cases))

    user_login = 'zz_test_kit_workout_review_' + uuid.uuid4().hex[:12]
    attempts = []
    rows_written = 0
    spent_micros = 0

    def record(line):
        nonlocal rows_written
        if rows_written == 0:
            descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            stream_context = os.fdopen(descriptor, 'w', encoding='utf-8')
        else:
            stream_context = output.open('a', encoding='utf-8')
        with stream_context as stream:
            stream.write(json.dumps(line, ensure_ascii=False, separators=(',', ':')) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        rows_written += 1

    def reserved_total():
        if not attempts:
            return 0
        with db.connect() as connection:
            row = connection.execute(
                'SELECT coalesce(sum(charged_micros),0) AS total FROM ai_food_attempts WHERE id=ANY(%s)',
                (attempts,)).fetchone()
        return int(row['total'])

    def before_send(attempt_id):
        attempts.append(attempt_id)
        if reserved_total() > RUN_CAP_MICROS:
            raise RunBudgetReached('The per-run $1 reservation cap was reached before provider send')

    uid = None
    try:
        with db.connect() as connection:
            uid = connection.execute(
                'INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',
                (user_login, 'Fictional workout review evaluator')).fetchone()['id']
            connection.execute("""INSERT INTO profile(user_id,tz,units,ai_ok,ai_adult_at,
                ai_access_allowed,health_ai_ok,health_weight_ai_ok,garmin_ai_ok,
                weight_health_derived,kcal_target,protein_target)
                VALUES (%s,'UTC','metric',true,now(),true,false,false,false,false,2200,120)""", (uid,))

        record(metadata)
        for case in cases:
            if spent_micros >= RUN_CAP_MICROS:
                break
            with db.connect() as connection:
                connection.execute('UPDATE profile SET units=%s WHERE user_id=%s',(case['units'],uid))
            captured = {}
            def turn(messages, definitions):
                body={'systemInstruction':{'parts':[{'text':kit_workout_review.SYSTEM}]},
                      'contents':messages,
                      'generationConfig':{'temperature':.2,'maxOutputTokens':1200,
                          'thinkingConfig':{'thinkingLevel':args.thinking},
                          'responseMimeType':'application/json'}}
                request=urllib.request.Request(
                    f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
                    json.dumps(body,default=str).encode(),
                    {'Content-Type':'application/json','x-goog-api-key':os.environ['GEMINI_API_KEY']})
                attempt=ai_budget.reserve(MODEL,'Kit workout review evaluation',payload=body)
                try:
                    with ai_budget.lease(attempt),urllib.request.urlopen(request,timeout=45) as response:
                        result=json.load(response)
                except urllib.error.HTTPError as error:
                    ai_budget.release_failed(attempt,error.code)
                    raise ValueError('Kit workout review provider request failed') from None
                except (urllib.error.URLError,TimeoutError):
                    raise ValueError('Kit workout review provider request failed') from None
                else:
                    ai_budget.settle(attempt,result)
                finally:
                    ai_budget.finish(attempt)
                content=(result.get('candidates') or [{}])[0].get('content')
                if not content:
                    raise ValueError('Kit workout review provider returned no content')
                calls=[part['functionCall'] for part in content.get('parts',[]) if 'functionCall' in part]
                text=''.join(part.get('text','') for part in content.get('parts',[]) if not part.get('thought'))
                usage=result.get('usageMetadata') or {}
                captured.update(answer_text=text, usage=usage, calls=len(calls))
                return calls, text, usage

            started = time.monotonic()
            rejection = None
            error_type = None
            rendered_answer = None
            try:
                with ai_budget.after_reserve(before_send), ai_budget.scope(
                        uid, uuid.uuid4(), feature='Kit workout review evaluation'):
                    rendered_answer = kit_workout_review.answer(
                        uid, 'Review this recorded workout.',
                        {'comparison':case['data'],'required_consents':{'health':False,'garmin':False},
                         'health_included':False}, turn=turn)
            except RunBudgetReached:
                spent_micros = reserved_total()
                break
            except HTTPException:
                spent_micros = reserved_total()
                break
            except kit_workout_review.WorkoutReviewRejected as error:
                rejection = error.reason_code
            except Exception as error:
                error_type = type(error).__name__
            latency_ms = round((time.monotonic() - started) * 1000)
            usage = captured.get('usage') or {}
            input_tokens = usage.get('promptTokenCount')
            output_tokens = usage.get('candidatesTokenCount')
            thinking_tokens = usage.get('thoughtsTokenCount', 0)
            cost_micros = None
            if (type(input_tokens) is int and type(output_tokens) is int
                    and type(thinking_tokens) is int and input_tokens >= 0
                    and output_tokens >= 0 and thinking_tokens >= 0):
                cost_micros = ai_budget.price(MODEL, input_tokens, output_tokens + thinking_tokens)
            spent_micros = reserved_total()
            record({'type':'case','case':case['name'],'rejection_code':rejection,
                    'error_type':error_type,'tokens_in':input_tokens,'tokens_out':output_tokens,
                    'thinking_tokens':thinking_tokens,'latency_ms':latency_ms,
                    'answer_text':captured.get('answer_text'),'rendered_answer':rendered_answer,
                    'input':{'units':case['units'],'comparison':case['data']},'cost_usd':None if cost_micros is None else cost_micros / 1_000_000,
                    'run_spent_or_reserved_usd':spent_micros / 1_000_000})
            status = f"rejection_code={rejection or 'none'}"
            if error_type:
                status += f' error={error_type}'
            print(f"{case['name']}: {status}", flush=True)
            if spent_micros >= RUN_CAP_MICROS:
                break
        record({'type':'summary','completed_cases':rows_written - 1,'selected_cases':len(cases),
                'spent_or_reserved_usd':spent_micros / 1_000_000,'hard_cap_usd':1.0,
                'complete':rows_written - 1 == len(cases)})
        print(f'Evaluation output: {output}', flush=True)
        print(f'Cases completed: {rows_written - 2}/{len(cases)}', flush=True)
        print(f'Total cost: ${spent_micros / 1_000_000:.6f} charged or reserved; $1.00 hard cap', flush=True)
        if rows_written - 2 != len(cases):
            raise RuntimeError('Incomplete evaluation; capture cannot approve a gate')
    finally:
        if uid is not None:
            with db.connect() as connection:
                connection.execute('DELETE FROM users WHERE id=%s AND login=%s',(uid,user_login))


if __name__ == '__main__':
    main()
