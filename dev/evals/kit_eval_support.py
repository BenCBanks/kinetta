"""Harness-only baseline loading, isolated caps and bounded gate scheduling."""
import importlib.util
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

DEFAULT_BUDGET_USD = 2.50


def valid_budget(amount):
    return math.isfinite(amount) and 0 < amount <= DEFAULT_BUDGET_USD


def load_baseline(path):
    # Pydantic resolves forward annotations through the defining module's namespace.
    # Register before executing; never rewrite the frozen baseline source.
    name = 'app._kit_baseline'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(name)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous
        raise
    return module


def configure_budget(amount):
    if not valid_budget(amount):
        raise ValueError('Budget must be positive and at most $2.50 per run')
    # Evaluator process only; reserve 10% of the approved allowance as headroom.
    os.environ.update(KINETTA_AI_DAILY_USD=str(amount * .9),
                      KINETTA_AI_USER_DAILY_MICROUSD=str(round(amount * .9 * 1e6)),
                      KINETTA_AI_USER_DAILY_ATTEMPTS='1000',
                      KINETTA_AI_DAILY_ATTEMPTS='1000',
                      KINETTA_AI_CONCURRENT='8', KINETTA_AI_USER_CONCURRENT='2')


def capped(error):
    return bool(error and error.startswith(('HTTPException: 429:', 'HTTPException: 503:'))
                and ('AI is paused' in error or 'today.' in error))


def bounded_results(run, jobs, *, workers=2):
    # Do not eagerly queue the entire paid run. Finish at most the two in-flight
    # responses, then stop on a reservation/attempt cap and retain partial evidence.
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for offset in range(0, len(jobs), workers):
            batch = list(pool.map(run, jobs[offset:offset + workers]))
            yield from batch
            if any(capped(row.get('error')) for row in batch):
                return
