# Comment draft storage

Each server/account/session/activity draft has its own local storage key. Its retry UUID stays with the text. When Web Locks are available, the origin-wide `fit.comment-drafts` lock covers every draft write, explicit deletion, expiry cleanup, 40-draft eviction and sign-out cleanup. Queued work checks the session and generation again after acquiring the lock. Sign-out fences stale work immediately, before waiting for cleanup.

Without Web Locks, cross-key cap eviction is skipped. Expiry cleanup removes an expired key only if a fresh read immediately before removal still matches the expired value. This reduces the race but cannot make read-and-remove atomic: another tab can still rewrite between those two operations. That browser fallback has no strict 40-draft cap. Explicit edits/deletes to the same activity follow last-write-wins storage order.

Web Locks persistence is asynchronous. A page killed or closed before a queued write runs can lose that latest unsaved change; storage rejection keeps the open-tab copy only. Physical-iPhone background termination and storage availability need device verification. No draft text or session token is sent to a provider; sign-out/account deletion clears device draft namespaces.
