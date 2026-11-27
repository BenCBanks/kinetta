"""Account-state gate for paid work, including jobs without an HTTP session."""
from fastapi import HTTPException
from . import email_confirmation


def active(user_id, connection):
    # Match current_user: any outstanding password restriction blocks access,
    # including an expired one. Admin status never bypasses these conditions.
    return bool(connection.execute('''SELECT 1 FROM users WHERE id=%s
        AND suspended_at IS NULL AND password_change_expires IS NULL''',
        (user_id,)).fetchone())


def require(user_id, connection):
    if not active(user_id, connection):
        raise HTTPException(403, 'This account cannot use AI right now.')
    if email_confirmation.required(user_id, connection):
        raise HTTPException(403, email_confirmation.KIT_BLOCK)
