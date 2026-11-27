# Signed-in member action limits

These rolling budgets apply to all accounts. They do not change visibility or consent checks. Existing recent-account, pending-request and per-group safety limits also apply.

| Action | Per account | Additional limit |
| --- | --- | --- |
| Comments and group updates, combined | 6/minute, 100/day | 10/hour to one recipient across targets; exact same target/text quietly reused for 60 seconds |
| Friend requests | 5/minute, 30/day | Resend after cancellation: 24 hours; after decline: 7 days |
| Directed group invitations | 30/day | 3/day to one recipient across groups |
| Group creation | 5/day | 20 active organized groups |
| Group challenge creation | 10/day | Existing 100/group limit; personal challenges unchanged |
| New or changed reactions across surfaces | 60/minute, 500/day | At most one new reaction notification per actor/recipient/hour; reactions still save |
| Member search | 30/minute, 1,000/day | Query text is never stored in the budget ledger |
| Reports across kinds | 10/hour, 50/day | Existing 20-open limits per report table; an open report for the same item returns its original receipt |

Blocking, unblocking, declining a friend request and removing a reaction use no member-action admission lock or budget. Exhausting another budget does not prevent protection. Deleting content does not refund its action budget. Rejected writes roll back their budget and receipts.

Group-update recipient budgets use the complete active group roster, independently of private block and mute choices. Delivery applies those choices separately. For new activity comments and directed invitations, independent audience/eligibility refusals keep their existing response (for example, a private activity or no accepted friendship). Otherwise admission precedes block checks, so a block cannot change an exhausted-budget response. Full access is still required before returning data or writing content; block refusals roll back admission and receipts. Matching committed retries remain free and recheck full access.

Admission takes a nonwaiting account transaction lock before existing write locks. Concurrent contention returns 503 with `Retry-After: 2`; exhausted rolling budgets return 429 with a computed `Retry-After`. The ordinary web and iPhone error paths display the delay. Comment failures preserve text and the request key for explicit retry. Group update retries retain their request key while that form is open.

Supported optional UUID request keys bind to the actor, target and action payload. A matching retry returns current authorized data without another write or budget charge; a changed payload is rejected. Existing group/challenge IDs and comment receipts retain their own replay protections. Keyless clients keep their existing semantics: pending invitations/requests and open reports are naturally reused, comments/updates have a 60-second duplicate window, and unchanged reaction POSTs cost no further budget. Reaction removals are always free and do not refund an earlier write. Current clients keep a reaction request key through a failed retry and create a new key for a new choice; a committed key cannot restore a later-removed reaction.

Migration 134 follows photo receipts (133). It adds action events, hash-only retry receipts and friend resend cooldowns, with row-level security. Events and cooldowns are server-only bookkeeping: SQL readers have no access and exports omit them because their presence can depend on another person's mute, block or decline choices. Own retry receipts have explicit SQL/export fields. The ledger stores hashes and result IDs, not comment bodies or search strings. Retry receipts expire after seven days (10,000 live/account); events are removed after eight days; expired cooldowns are removed. A fixed-size indexed cleanup runs once per minute. Account deletion cascades the account's rows, and another person's deletion clears recipient references or removes pair cooldowns.

The regression suite covers the actual migrations 1–133 as an upgrade baseline, applies 134 twice, and checks actor isolation, SQL-reader restrictions, exports, erasure, boundaries, races, rollback, restart persistence, cooldowns, deduplication, free unchanged retries, unthrottled removals/declines under contention, and block availability. Browser checks use fictional responses and native-bridge stand-ins; they are not physical-iPhone evidence.
