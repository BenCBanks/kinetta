# Account email and username choices

Signup and invitations check an email before creating an account, consuming an invitation, creating a session or
scheduling confirmation mail. The same check applies to the beta waitlist. An existing address gets the owner-approved
message, “There's already a Kinetta account with this email”, with Log in and Reset password actions. A rejected
attempt sends no notice email; legitimate address-change security notices remain.

Addresses are trimmed and lowercased consistently. A confirmed address stays on its account while a replacement
awaits confirmation. An unused confirmation token reserves its address, including after the link expires: expiry
ends the link, not the account's claim. The same account can resend; replacing its pending address or deleting its
account releases that pending claim. Existing ambiguous pending accounts are retained; the first valid confirmation
wins the existing unique index, and a later conflict gets the same friendly response.

A short database advisory lock serializes email claims before account, invitation and confirmation-token locks.
The existing username and email unique indexes remain the final guards. Enrollment attempts commit their counters even
when creation is rejected: five per hour per IP and canonical email. Email-change attempts retain their separate
account limit. Rate keys serialize counting under concurrency; email values are hashed in enrollment limiter keys.
No migration, new dependency, AI call or external availability service is needed.

Usernames are trimmed and case-insensitive everywhere. They use 2–30 lowercase letters, numbers or underscores,
starting with a letter. Reserved service names and their numeric variants are rejected. Existing accounts can keep
an unchanged reserved handle; the handle never grants an administrator role. Automatic suggestions skip reserved
names. The public availability endpoint returns only handle status and a suggestion, with a 60-per-minute IP limit.
The authenticated session identifies an unchanged handle, never a supplied account ID.

Email-first signup keeps automatic username generation, with an optional picker. Signup and username editing check
after a 400 ms pause, show no error initially, and discard detached or stale replies. Availability is advisory;
the final save still checks uniqueness. Server errors appear beside the field with live status announcements.
The original input and draft remain intact, including password visibility/autofill controls when present.

An existing account accepts an admin invitation only through its explicit authenticated button. That records the
inviter without creating an account, session, friendship, card connection or challenge membership. Repeating that
acceptance is safe for the same account; an expired unused invitation or one used by someone else is unavailable.
Login and password recovery retain only a validated local invitation return path. Acceptance, cancellation and an
expired-link result clear it. Friend/card/challenge links retain their own deliberate choices.
