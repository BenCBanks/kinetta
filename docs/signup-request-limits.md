# Public enrollment request limits

Public `POST /api/signup` and `POST /api/beta` share a source-level allowance of
**60 requests in a rolling five minutes and 240 in a rolling hour**. Every admitted
request counts before JSON decoding, model validation, email/age checks, password
hashing, account creation or mail scheduling. Invalid requests count too. Status
GETs, sign-in, recovery and administrator invitations keep their existing behavior.

These conservative pilot numbers leave room for ten people sharing Wi-Fi to make
five attempts each within five minutes. The hourly limit allows twelve submissions
per account for the existing maximum of twenty validated signup attempts/source/hour.
They bound repeated malformed requests without treating a typo as an abuse event.
The separate existing validated-signup/address and waitlist limits are unchanged;
this new allowance does not increase account admission or mail allowances.

Exhaustion returns HTTP 429 with plain retry text and a `Retry-After` header, calculated
from the oldest expiring slot in each exhausted window. Denied retries insert no
rows or refresh timestamps, so repeatedly pressing Submit cannot extend the wait.
Each source can have at most 240 current records; older records for that source
are removed on its next request. Existing authentication cleanup also removes
records older than a day. One short PostgreSQL advisory lock per source serializes
expiry, checks and admission across workers and restarts. Database work runs off
the async event loop; no form parsing or external service runs inside the lock.

The source uses the existing `auth.client_ip` boundary: Cloudflare's header only
when the operator has enabled that trust, otherwise the ASGI peer supplied by the
server's configured trusted proxies. Arbitrary forwarded headers gain no new trust.
Only a SHA-256 source digest and timestamp are stored in the existing private rate
counter table, with its existing SQL-reader restrictions. Form fields, email,
password, user agent and raw source address are not stored by this brake.

This is a request brake, not proof of a unique person, a global traffic or email
ceiling, or protection against rotating/distributed sources. Proxy correctness
remains an operator responsibility. No CAPTCHA, third-party service, new key,
migration, runtime setting, content change or AI fingerprint change is introduced.
The figures are proposed defaults for owner review in the Draft; assess false
positives using aggregate counts before changing them.
