# Kit across Kinetta

Owner brief: 20 October 2026. Implementation and release are separate; this document records the intended behavior and assumptions for the accompanying PR.

## Product decisions and assumptions

- Kit is one assistant for training, nutrition, strength, goals and progress. The same Ask Kit action opens the same conversation from any tab. The current screen adds context, rather than creating another kind of coach.
- The first empty screen offers a few useful starting questions, relevant to the entry screen. A tap sends the chosen question. After the first message these suggestions disappear; the conversation uses the same bubbles, typing indicator, composer, scrolling and keyboard behavior as Add food.
- Assume one private ongoing conversation, synced across devices, with Clear chat. Food logging remains its own focused Add food flow. No automatic daily reset for Kit. The owner confirmed this retention choice.
- Kit can read the signed-in person's fitness/nutrition records through fixed, bounded application tools. This means relevant records on demand, not sending the entire database with every message. No credentials, precise route coordinates, other people's records or arbitrary SQL are model tools. Apple Health permissions still control Health disclosures.
- Algorithms calculate totals, trends and allowed changes. Quantitative claims must point to exact tool evidence. Unknown nutrients and unlogged days remain unknown. Kit may explain general nutrition/training concepts without fabricating personal evidence.
- Assume proposed changes require an explicit review/confirmation. Existing plan and known-food proposal validators remain authoritative. Other actions link to the actual app feature and its normal editor; model text never writes arbitrary fields. The owner confirmed review and confirmation for changes.
- Every AI-enabled account can find Kit. Provider readiness, consent, budgets and reviewed evaluation still control model work. No payment tier or new subscription is introduced.
- Retire evening food summaries entirely, including their settings, automatic triggers and older-client generation endpoints. Existing historical notes may remain readable. Nutrition insights start through Kit.
- Food-facing labels use Kit (for example “Kit’s estimate”); storage/source identifiers stay compatible. Explain AI providers and data sharing plainly in consent/privacy controls.

## Implementation plan

1. Reuse the existing authenticated tool runner, evidence checker, provider adapters, budget accounting and confirmation-only proposals. Add safe tools for all sports, detailed food records, strength sessions, goals, gear and app destinations, with bounds, ownership and Health checks.
2. Store Kit turns and a conversation generation in PostgreSQL, with RLS, export and account deletion. Use client UUIDs and generation checks for retry/clear safety; acquire a durable generation lease before paid work and discard late answers after clear, consent changes or account changes. Keep model calls outside database transactions.
3. Send only bounded recent conversation context. Resolve fresh facts through tools; previous answers are not current evidence. Preserve provider function-call IDs and response schemas.
4. Build one Add-food-style chat with durable account-scoped drafts, visible retry, cross-device history, starter prompts, evidence details and reviewable actions. Use existing keyboard/scroll helper and Evergreen Agenda tokens.
5. Unify existing Kit icons and retire the evening summary. Keep Add food, normal editors and non-AI tools independent.
6. Verify ownership/RLS, unknown/missing data, Health consent, numeric evidence, tool bounds, clear/retry/concurrency, upgrade, export/delete, phone light/dark/large text and keyboard behavior. Attach reviewed fictional screenshots to the PR.

## Evaluation and release

The owner authorized up to $5 total for paid model evaluations. Stand-in tests validate contracts and UI; they cannot establish model usefulness or accuracy. New prompts/tools/conversation behavior need matching reviewed real-provider evidence before enabling. Do not create a passing private report from test stand-ins. Record paid results and qualitative review honestly, compare the current and proposed versions on the same cases, and keep unrelated food-model gates intact.

The PR is the requested deliverable. Merge, live deployment and TestFlight need separate approval. Physical iPhone keyboard/VoiceOver and real provider acceptance remain distinct from browser and unsigned-build checks.

## Real-provider calibration

An initial comparison of the unchanged production coach and first Kit candidate exposed truncated JSON and repeated tool lookups. It was stopped after about$0.53 in conservative measured/reserved cost. The candidate now supplies one verified, food-safe profile context before the first provider turn, caches identical tool lookups, reserves its final bounded round for an answer, and uses LOW thinking for the configured Gemini3.8Flash conversation scope. Legacy reviews and food estimation keep their generation settings. See Google's [thinking guidance](https://ai.google.dev/gemini-api/docs/thinking) and [generateContent configuration](https://ai.google.dev/api/generate-content#ThinkingConfig). This is a prompt/configuration change included in the new scope's fingerprint and evaluation; it is not a rollout approval. The final comparison and total budget use are recorded in the PR.

## Owner-approved separate release gate

The owner confirmed that Kit should have its own reviewed release gate. `KINETTA_KIT_ENABLED=1` and a matching `KINETTA_KIT_EVAL_REPORT` enable only the shared Kit chat after its baseline, factual/isolation/Health, conversation and qualitative review requirements pass. The fingerprint covers Kit's actual runner, tools, proposal validation and configured coach model. Food estimation and food-only chat keep their existing release rules; a separate food-photo benchmark is not a prerequisite for the new Kit conversation. No reviewed approval or production setting is inferred from budget authorization.
