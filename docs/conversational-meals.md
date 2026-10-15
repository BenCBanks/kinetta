# Describe a saved meal portion

In **Nutrition → Add food**, tap **Describe or snap** (or **Describe a meal** without AI). You can also open
**My meals → Describe a saved meal portion**. Try:

- “I had a 230 grams of the pasta I cooked on Monday for lunch.”
- “8 ounces of my stew.”
- “Half of the lentil soup.”
- “1.5 servings of my smoothie.” One whole saved meal is one serving.

Only your own cooked/saved Meals are searched. Saved combinations and friends’ shared meals still use their existing
manual log controls. Matching ignores capitalization and accents, checks complete name words and asks you to choose
if more than one meal matches. A shorter name such as “pasta” can match “Garden pasta”; an unknown name is never a
license to invent its nutrition. Twelve choices are shown at most; narrow the name or saved date if there are more.

**Dates mean when you saved the meal.** There is no separate cook-date field. The preview labels that date explicitly.
Weekdays mean the most recent occurrence in your profile time zone (including today); “last Monday” excludes today
when today is Monday. Today, yesterday and an explicit YYYY-MM-DD date also work. The selected log day stays visible
and is not changed by a saved-meal date. “For lunch” selects Lunch; otherwise the destination you opened stays selected.

Check the matched meal, portion, calories/macros and the **Adding to** day and meal. Nothing is logged until you tap
**Add to…**. You can say “make it 300 grams” to change the current portion; it is recalculated from the same meal.
If the weight or nutrition is missing, the app asks rather than guessing. You can edit the saved meal in My meals, or
use half/a quarter/whole-meal servings when there is no total weight. Gram portions use the stored total weight, which
may be an ingredients sum if you have not entered a weighed cooked total.

This is a constrained conversation: one named saved meal and one supported amount at a time. Extra foods, unsupported
units/dates and unclear phrasing ask for clarification. Use My meals for manual selection. It does not claim arbitrary
natural-language understanding. Search, barcode, Quick and ordinary meal logging remain available.

## Cost and future product access

Saved-meal matching uses fixed SQL and portion arithmetic: **zero model calls**, no embedding/vector database, no
recipe/history upload, no model-invented nutrition and no new dependency. A request reads at most the account’s
300 saved meals, returning only compact name/date/weight choices or the selected portion’s totals.

For other food, **Estimate as other food with AI** explicitly invokes the unchanged estimator. Photos use that same
existing AI path. They require the existing `food` entitlement, provider configuration and consent, and retain its
usage brakes, bounded five-message/2,000-character context, token limits and retry policy. The client never sends the
saved-meal catalog, ingredients, totals or lookup responses to that provider. Only the person's supplied description
and any photo go to it. A missing/ambiguous meal lookup never automatically triggers an estimate.

Future billing can gate model-powered food features through `app/ai_access.py`; no prices, purchase flow, grants or
new paywall are introduced here. Payment does not grant consent. Deterministic saved-meal logging remains available
without AI access. This change does not alter prompts/models or enable the evaluation-gated Kit tool coach. Tests use
stand-ins and fictional records; they are not evidence of real-model accuracy.

## Confirmation integrity

The resolve endpoint is authenticated/read-only and accepts no user ID, SQL, nutrition or arbitrary tool call.
The confirmation endpoint requires a strict `confirm: true`, binds ownership again, locks the account and saved meal,
checks a 15-minute preview fingerprint and calculates nutrition again on the server. Recipe changes reject stale
previews. The editable log day/meal are explicit confirmation inputs, independent of the saved-meal date.

A per-account client ID and stored request fingerprint make concurrent/repeated confirmations return one entry,
including a lost response followed by an edit/deletion of the original recipe. Reusing that ID for different inputs
is rejected. The existing `food_entries` RLS and unique index are reused; no schema migration is needed. Chat text and
pending previews are not saved. Logged entries keep their normal meal provenance and remain editable/deletable.
