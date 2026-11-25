"""Confirmation gate for AI work and new photo uploads, independent of AI consent."""
from fastapi import HTTPException
from . import db

KIT_BLOCK = 'Confirm your email to use Kit.'
PHOTO_BLOCK = 'Confirm your email to upload photos.'


def required(user_id, connection=None):
    if connection is None:
        with db.connect() as c:
            return required(user_id, c)
    row = connection.execute('SELECT needs_email_confirm AND email_verified_at IS NULL AS required '
                             'FROM users WHERE id=%s', (user_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Account unavailable')
    return row['required']


def require_upload(user_id, connection=None):
    if required(user_id, connection):
        raise HTTPException(403, PHOTO_BLOCK)
