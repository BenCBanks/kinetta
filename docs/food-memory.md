# Food references, analogues and reuse

Issue #451 adds two separate paths. Own-food reuse chips work with AI off. Contextual model understanding stays
behind the existing food-chat switch and a new reviewed `food_memory` report block. No runtime setting or report
is enabled by this implementation. Contract tests with stand-ins do not approve model accuracy.

Typing offers up to three own-food matches. Choosing one stages the exact source and portion for the existing
review. A lost response retries the same request identity. The composer draft remains available. Source edits or
deletion require choosing the current food again; login, selection and staging do not log food.

The bounded reader uses the authenticated account, fixed SQL and the read-only RLS role. It searches the last
90 local calendar days and saved foods, recipes and combinations with indexed PostgreSQL trigram matching.
Forty frequent foods use their most frequently logged portion, with a recent tie-break. Brand variants remain
distinct. Today's records and recent turns are bounded; turns belong to the selected draft and include their dates.
Historical recipe entries retain their historical numbers. They are separate from the current saved recipe.

Model output can choose only a supplied candidate token. The backend rereads that source, checks its digest and
does portion arithmetic. A newly named food retains its new name and says **Nutrition from: …** with the source
day. Unknown nutrients stay unknown. Public-catalog analogues retain the new food name and say **Estimated from …**.
A source-backed household weight supplies a typical slice where available; a 100g reference is never silently
called a slice. Without a usable household weight, the existing amount question remains.

The USDA detail endpoint exposes food portions with published gram weights and descriptions; see the
[official API guide](https://fdc.nal.usda.gov/api-guide/) and its linked OpenAPI specification. Only a numeric
public USDA food ID is used for that lookup. Catalogue values and portion sizes can still differ from the food
actually eaten, so the person can edit the review. Manual replacement removes copied/analogue provenance.

Only enabled, unexpired, own Kit preferences enter this food scope; Health-marked notes are excluded. Context
is untrusted data and cannot grant tools or writes. A committed message lease prevents concurrent interpretation
charges. Account access, consent, memory version, message state and lease are rechecked before every provider
attempt and before retaining a result. Deletion and revocation discard late results.

References, analogues and messages with more than two items use the configured stronger model first. The
internal `GEMINI_FOOD_CONTEXT_MODEL` defaults to `GEMINI_FOOD_FALLBACK_MODEL`; no client chooses a model. Ordinary
food calls keep their existing policy. Instructions and a stable, compact own-food/preferences prefix precede
dynamic context. Google's [implicit caching](https://ai.google.dev/gemini-api/docs/caching) may reuse an eligible
prefix; no padding, cache hit or discount is assumed. Existing reservations conservatively charge full input.

At the locally reviewed rates, 300 single understanding calls with 2,000 input and 300 output/thinking tokens
cost $0.285 on Lite, $1.575 on Flash, or $0.801 at a hypothetical 40% Flash mix. One additional Lite estimate per
message would bring that last example to $1.086 before retries. These are scenarios, not measured results.
The roughly $1/heavy-user/month goal must be checked against all actual attempts and reuse savings. Existing
daily spend/request/concurrency guards remain; monthly reporting is not a monthly hard spending cap.

Keep the existing understanding benchmark and add the 51 cases in `dev/evals/food_memory_cases.py`, including
41 multi-item messages. Compare actual production and candidate responses on the same fictional sources.
Score source choice, retained names, exact copied/scaled numbers, unknowns, analogue bases, habits/overrides,
follow-up necessity, isolation, latency and total cost separately. Owner review and activation remain release steps.
