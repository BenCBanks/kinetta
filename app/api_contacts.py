"""Minimal contact matching (#644): a caller sends only salted hashes; names and unmatched contacts stay on the device."""
import hashlib
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from . import account_email, db
from .auth import current_user

router = APIRouter(prefix='/api/contacts')
PHONE_RE = re.compile(r'^\+[1-9][0-9]{7,14}$')
PHONE_INPUT_RE = re.compile(r'^\+?[0-9\s().-]+$')
SALT_RE = r'^[A-Za-z0-9_-]{32,64}$'


class ContactSettingsIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    phone_e164: str | None = Field(None, max_length=40)
    find_by_email: StrictBool | None = None
    find_by_phone: StrictBool | None = None


class ContactHash(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['email', 'phone']
    digest: str = Field(pattern=r'^[0-9a-f]{64}$')


class ContactMatchIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    salt: str = Field(min_length=32, max_length=64, pattern=SALT_RE)
    hashes: list[ContactHash] = Field(min_length=1, max_length=2000)


def normalize_phone(value: str | None) -> str | None:
    """Accept a display-formatted international number and store only E.164."""
    if value is None or not value.strip():
        return None
    value = value.strip()
    if not PHONE_INPUT_RE.fullmatch(value):
        raise HTTPException(400, 'Enter a phone number with a country code.')
    normalized = re.sub(r'[\s().-]', '', value)
    if not PHONE_RE.fullmatch(normalized):
        raise HTTPException(400, 'Enter a phone number with a country code.')
    return normalized


def contact_digest(salt: str, kind: str, normalized: str) -> str:
    """PR2 protocol: lowercase email or E.164 phone, domain-separated, then salted SHA-256."""
    return hashlib.sha256(f'{salt}:{kind}:{normalized}'.encode('utf-8')).hexdigest()


def _settings(c, uid):
    row = c.execute("""SELECT u.phone_e164,
        (u.email IS NOT NULL AND u.email_verified_at IS NOT NULL AND NOT u.needs_email_confirm) AS email_ready,
        p.find_by_email, p.find_by_phone
        FROM users u JOIN profile p ON p.user_id=u.id WHERE u.id=%s""", (uid,)).fetchone()
    if not row:
        raise HTTPException(404, 'Account not found.')
    return {'phone_e164': row['phone_e164'], 'email_ready': bool(row['email_ready']),
            'find_by_email': bool(row['find_by_email']), 'find_by_phone': bool(row['find_by_phone'])}


@router.get('/settings')
def contact_settings(user=Depends(current_user)):
    with db.connect() as c:
        return _settings(c, user['id'])


@router.put('/settings')
def update_contact_settings(body: ContactSettingsIn, user=Depends(current_user)):
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(400, 'Choose a setting to save.')
    phone = normalize_phone(body.phone_e164) if 'phone_e164' in fields else None
    profile_values = {key: getattr(body, key) for key in ('find_by_email', 'find_by_phone') if getattr(body, key) is not None}
    with db.connect() as c:
        if 'phone_e164' in fields:
            c.execute('UPDATE users SET phone_e164=%s WHERE id=%s', (phone, user['id']))
        if profile_values:
            c.execute(f"UPDATE profile SET {', '.join(f'{key}=%s' for key in profile_values)} WHERE user_id=%s",
                      (*profile_values.values(), user['id']))
        return _settings(c, user['id'])


@router.get('/salt')
def contact_salt(user=Depends(current_user)):
    # A fresh server-generated salt lets the device hash this check without sending raw contacts.
    return {'salt': secrets.token_urlsafe(32)}


@router.post('/match')
def match_contacts(body: ContactMatchIn, user=Depends(current_user)):
    # Salted SHA-256 is not private-set-intersection: a captured hash and salt can be guessed offline because
    # emails and phone numbers have low entropy. The owner accepts this ephemeral protocol; never log, persist,
    # or include this request body in errors or reports. Access logs retain only the route and response status.
    with db.connect() as c:
        limited = account_email.limited(c, f'contacts-check:{user["id"]}', 1, 24 * 60)
    if limited:
        raise HTTPException(429, 'Contacts were checked in the last 24 hours. Try again tomorrow.')

    wanted = {(item.kind, item.digest) for item in body.hashes}
    with db.connect() as c:
        # Duplicate phone claims match nobody, including when one account has opted out. Email is matched only
        # when its owner confirmed it. Neither identifier is returned or stored; only matching account IDs leave here.
        rows = c.execute("""WITH phone_counts AS (
              SELECT phone_e164, count(*) AS n FROM users WHERE phone_e164 IS NOT NULL GROUP BY phone_e164
            )
            SELECT u.id,
              CASE WHEN p.find_by_email AND u.email_verified_at IS NOT NULL
                         AND NOT u.needs_email_confirm THEN lower(u.email::text) END AS email,
              CASE WHEN p.find_by_phone AND pc.n=1 THEN u.phone_e164 END AS phone_e164
            FROM users u JOIN profile p ON p.user_id=u.id
            LEFT JOIN phone_counts pc ON pc.phone_e164=u.phone_e164
            WHERE u.id<>%s AND u.suspended_at IS NULL AND NOT u.needs_email_confirm""", (user['id'],)).fetchall()

    matched = set()
    for row in rows:
        email = row['email']
        phone = row['phone_e164']
        if email and ('email', contact_digest(body.salt, 'email', email.strip().lower())) in wanted:
            matched.add(row['id'])
        if phone and ('phone', contact_digest(body.salt, 'phone', phone)) in wanted:
            matched.add(row['id'])
    return {'member_ids': sorted(matched)}
