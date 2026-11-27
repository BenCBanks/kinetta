# Public enrollment request limits

Public `POST /api/signup` and `POST /api/beta` share a source-level allowance of
**60 requests in a rolling five minutes and 240 in a rolling hour**. Every admitted
request counts before JSON decoding, model validation, email/age checks, password
hashing, account creation or mail scheduling. Invalid requests count too. Status
GETs, sign-in, recovery and administrator invitations keep their existing behavior.

Main's separate password-work protection still runs before signup's route wrapper:
its existing shared public-source budget (60 unsuccessful/in-flight requests per
minute, including signup and sign-in) and one-at-a-time public worker stay intact.
That protection can reject signup first with its own 429/503 and Retry-After;
such a request never reaches or spends enrollment allowance. Waitlist has no
password work. An exhausted enrollment window never applies to sign-in, and
password expiry does not reset enrollment's five-minute/hour windows.

These conservative pilot numbers leave room for ten people sharing Wi-Fi to make
five attempts each within five minutes. The hourly limit allows twelve submissions
per account for the existing maximum of twenty validated signup attempts/source/hour.
They bound repeated malformed requests without treating a typo as an abuse event.
The separate existing validated-signup/address and waitlist limits are unchanged;
this new allowance does not increase account admission or mail allowances.

Exhaustion returns HTTP 429 with plain retry text and a `Retry-After` header, calculated
from the oldest expiring slot in each exhausted window. Denied retries insert no
rows or refresh timestamps, so repeatedly pressing Submit cannot extend the wait.
Each source can have at most 240 current records. Source admission uses a
non-blocking PostgreSQL advisory lock: contention returns 429 with “Sign-up is
busy. Please try again.” and Retry-After: 1, without consuming an allowance.
Before scheduling a worker, each process admits at most two simultaneous counter
checks. Excess requests return the same response immediately instead of queuing
threads. Pool acquisition is bounded at 100 ms, statements at 250 ms and database
lock waits at 50 ms. Exhausted pool/statement/lock waits fail closed with that
controlled response. These bounds apply only to counter admission, not the
subsequent normal signup transaction. No form parsing or external service runs
inside the source lock; no database or server configuration is changed.

Expired counters are pruned per source on admission and by an independent worker
at startup and every minute, including sources that never return. Migration 130
adds a partial created-time index for only enrollment counters; the existing
(key, created) index serves source counts. Each maintenance pass deletes at most
2,000 expired rows, skips locked rows, and is bounded by a 100 ms pool wait and
500 ms statement/50 ms lock limits. Failed/skipped cleanup retries next minute;
a backlog may require multiple passes. Other rate-limit keys are untouched.
The worker is stopped and joined at application shutdown.

The source uses the existing `auth.client_ip` boundary: Cloudflare's header only
when the operator has enabled that trust, otherwise the ASGI peer supplied by the
server's configured trusted proxies. Arbitrary forwarded headers gain no new trust.
Only a SHA-256 source digest and timestamp are stored in the existing private rate
counter table, with its existing SQL-reader restrictions. Form fields, email,
password, user agent and raw source address are not stored by this brake.

This is a request brake, not proof of a unique person, a global traffic or email
ceiling, or protection against rotating/distributed sources. Proxy correctness
remains an operator responsibility. No CAPTCHA, third-party service, new key,
runtime setting, content change or AI fingerprint change is introduced. Migration
130 adds only the cleanup index; existing counter data, RLS and grants are unchanged.
The figures are owner-approved pilot defaults; assess false positives using
aggregate counts before changing them.

The route wrapper explicitly allows only POST /api/signup and POST /api/beta.
Other methods and paths bypass it even if a future administrator route shares
that router class. Existing signup and waitlist handlers show either 429 message,
keep entered values/choices and re-enable Submit for an explicit retry; the
browser suite covers both web and the iPhone bridge/native signup transport.
Physical iPhone networking and shared-network false-positive rates still need
operational observation; these browser fixtures do not claim that evidence.
