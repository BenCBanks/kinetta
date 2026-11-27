"""Durable brakes for legacy note requests, separate from model-facing text."""
from . import account_email, db


def note(uid, limit):
    # Commit before generation: a retry, failure or another worker cannot refund
    # the slot. The existing note limit is a rolling 24 hours, not a UTC day.
    with db.connect() as c:
        exhausted = account_email.limited(c, f'coach-note:{uid}', limit, 24 * 60)
    if exhausted:
        raise ValueError('Daily limit for Kit’s notes reached - try again tomorrow.')
