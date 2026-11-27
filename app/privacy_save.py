"""Bound setting writes for every client, without tickets, reservations or GET gates.

The eight-second budget starts at server admission (not at phone dispatch). db.connect
uses the same absolute deadline, including PostgreSQL 17 transaction_timeout. A timed-out
worker cannot later open/commit another setting transaction. Requests delayed upstream,
concurrent devices and legacy client presentation are outside this guarantee.
"""
import asyncio
from contextvars import ContextVar
import re
import time

from fastapi import HTTPException
from fastapi.responses import JSONResponse

REQUEST_SECONDS = 8
LOCK_MS = 1000
STATEMENT_MS = 2000
_deadline = ContextVar('setting_write_deadline', default=None)
_PATHS = re.compile(r'/api/(?:sharing|profile|account|contacts/settings|card(?:/new)?|segment-settings|'
                    r'activities/[0-9]+/(?:sharing|leaderboards|segment-assistance)|coach/conversation/memory(?:/[0-9]+)?|'
                    r'achievements/showcase/(?:pin|pins)|dishes/[0-9]+/share(?:/[^/]+)?|'
                    r'groups(?:/.*)?|group-(?:friend-)?invites/[^/]+/(?:accept|decline)|'
                    r'challenges(?:/.*)?|friends(?:/.*)?|friend-links/[^/]+)')


def applies(request):
    return request.method in ('POST', 'PUT', 'PATCH', 'DELETE') and bool(_PATHS.fullmatch(request.url.path))


def remaining():
    deadline = _deadline.get()
    if deadline is None:
        return None
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise HTTPException(504, 'Setting not confirmed. Retry.')
    return seconds


async def guarded(request, call_next):
    token = _deadline.set(time.monotonic() + REQUEST_SECONDS)
    async def dispatch():
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 65536:
                raise HTTPException(413, 'Setting is too large')
            chunks.append(chunk)
        request._body = b''.join(chunks)
        return await call_next(request)
    try:
        return await asyncio.wait_for(dispatch(), timeout=REQUEST_SECONDS)
    except (TimeoutError, HTTPException) as error:
        status = error.status_code if isinstance(error, HTTPException) else 504
        detail = error.detail if isinstance(error, HTTPException) else 'Setting not confirmed. Retry.'
        return JSONResponse({'detail': detail}, status_code=status)
    finally:
        _deadline.reset(token)
