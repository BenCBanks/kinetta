"""Versioned service agreement. A draft cannot be enabled by deployment configuration."""
import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import db
from .auth import current_user

DOCUMENT = json.loads(Path(__file__).with_name('terms_document.json').read_text())
router = APIRouter(prefix='/api/terms')


def active_version():
    requested = os.environ.get('KINETTA_TERMS_VERSION', '').strip()
    if not requested:
        return None
    if DOCUMENT['draft'] or requested != DOCUMENT['version']:
        raise ValueError('Terms activation requires the published document version')
    return requested


def public_status():
    version = active_version()
    return {'version': version, 'document_version': DOCUMENT['version'], 'draft': DOCUMENT['draft'],
            'url': DOCUMENT['url'], 'privacy_url': DOCUMENT['privacy_url']}


def state(profile):
    version = active_version()
    return {'version': version, 'required': bool(version and profile.get('terms_version') != version),
            'accepted_version': profile.get('terms_version'),
            'accepted_at': profile.get('terms_accepted_at'), 'url': DOCUMENT['url'],
            'privacy_url': DOCUMENT['privacy_url']}


def check_agreement(version):
    required = active_version()
    if required and version != required:
        raise HTTPException(428, {'code': 'terms_required', 'message': 'Read and accept the current Terms of Use first.',
                                  'version': required, 'url': DOCUMENT['url']})


def require_accepted(c, uid):
    version = active_version()
    if not version:
        return
    profile = c.execute('SELECT terms_version FROM profile WHERE user_id=%s', (uid,)).fetchone() or {}
    check_agreement(profile.get('terms_version'))


@router.get('')
def status():
    return public_status()


class AgreementIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: str = Field(min_length=1, max_length=64)


@router.post('/accept')
def accept(body: AgreementIn, user=Depends(current_user)):
    version = active_version()
    if not version:
        raise HTTPException(409, 'There are no published terms to accept yet.')
    check_agreement(body.version)
    with db.connect() as c:
        if not c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],)).fetchone():
            raise HTTPException(404, 'Account not found')
        row = c.execute('''UPDATE profile SET terms_version=%s,
          terms_accepted_at=CASE WHEN terms_version=%s THEN coalesce(terms_accepted_at,now()) ELSE now() END
          WHERE user_id=%s RETURNING terms_version,terms_accepted_at''',
          (version, version, user['id'])).fetchone()
    return {'ok': True, **state(row)}
