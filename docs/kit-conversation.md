# Conversational Kit answer contract

Ordinary Kit chat can return checked paragraphs and short lists. This backend contract is a Draft;
the compatible client renderer and reviewed evaluation are separate release requirements.
Weekly reviews use the same conversational blocks, with their app-owned `weekly_period` metadata.
Workout reviews keep their dedicated response fields. General coach and food modes keep their schemas.

The model supplies `blocks`, `facts`, optional `selection`, `actions` and up to two `follow_ups`.
A block is exactly `{kind:"paragraph", text:string}` or `{kind:"list", items:string[]}`.
There are 1–10 blocks, paragraphs up to 1,600 characters, and 1–6 list items up to 600 characters each.
The prompt asks for at most 160 words unless the actual user explicitly requests detail (then 600).
The server enforces the 600-word absolute safety bound; a modest style-length miss is not a failed answer.
Remembered context or starter guidance cannot enable a longer answer.

Up to eight facts cite exact numeric paths and values in successful current-turn tool evidence.
`{e2:7}` refers to the eighth fact, which must belong to evidence `e2`. The application verifies its
permitted measurement path, finite value and evidence identity, then inserts only the rounded value and unit.
Fact labels remain separate metadata; prose supplies its own metric name without internal tool labels.
The model cannot supply display units, unverified digits or a second value alongside a placeholder.
Selections still require an allowed app-generated candidate and explicit confirmation; no new writes or tools.

The checked API response contains `answer_blocks` with the same paragraph/list fields, all values already
formatted. Text is plain text, never HTML or Markdown; clients escape it and render p/ul/li elements.
`interpretation` contains the complete answer flattened with blank lines and bullet lines for older clients.
`facts`, `selection`, `actions` and `follow_ups` retain their existing meanings. Old verdict/reason responses
remain accepted for saved conversations and compatibility. Clients prefer a valid complete `answer_blocks`
array and otherwise use the existing interpretation path; they should never partially render an invalid array.

Numeric evidence checks are deterministic. Qualitative accuracy and coaching usefulness also require claim
validation and human-reviewed provider evaluation; contract fixtures alone do not establish model quality.

## Complete responses and token limits

Ordinary Gemini conversational answers reserve 8192 output tokens at LOW and 16384 at MEDIUM.
Thinking and visible JSON share that allowance. This is a ceiling, not an answer-length target:
by default the prompt asks for one or two short paragraphs, below 120 words, with only necessary facts.
Explicit detail requests allow up to 600 words. The live default remains LOW.

A `MAX_TOKENS` response is never displayed, even if its partial JSON happens to parse or has no content.
Production can make one correction with no tools, the same evidence and doubled output ceiling (16384 LOW,
32768 MEDIUM), requesting a short complete replacement. Consent, current visit, budgets and exact claim checks
still apply. A second truncation fails closed; there is no third call. Other validation errors retain the
existing single correction. The smoke experiment mirrors the same five-round/twelve-tool-call maximum and
one correction; its dollar cap still bounds the whole experiment.

Private evaluator rows include `provider_turns`: finish reason, thinking setting, requested output ceiling,
and prompt/candidate/thinking/total token counts per call. Unknown values stay null. Rejected text and errors
remain paired. The evaluator observes the existing settlement boundary for frozen older baselines, without rewriting their bytes;
finish reasons are null only when the provider omitted them.

Cost estimates use the app's configured Flash rates ($1.50/M input, $7.50/M output including thinking), not a
new live pricing claim. Raising a ceiling adds no fixed fee: the estimate is input_tokens × 0.0000015 +
(candidate_tokens + thinking_tokens) × 0.0000075. For example, 5000 input + 500 visible + 2000 thinking tokens
cost $0.02625. Output-only maxima for one full-budget initial response are $0.06144 LOW / $0.12288 MEDIUM;
one full-budget retry adds at most $0.12288 / $0.24576 output, plus its input. Tool turns cost separately.
Actual average change needs the next owner-run experiment; fewer failed correction calls may offset the
larger allowance. Existing dollar caps remain enforced, so a larger reservation may stop an experiment earlier.

## Final JSON shape and offline second-smoke replay

No-tools final and correction turns request Gemini `responseJsonSchema` for the same local conversational
model, including weekly reviews. Tool-enabled turns retain function calling; they cannot bypass local validation.
`actions` is an array of destination strings. An exact `{"screen":"plan"}` object can normalize to `"plan"`;
unknown destinations and extra fields fail. Facts, values, ownership and confirmation requirements are unchanged.
Activity goal targets are now formatted only when the goal has a recognized distance/time/elevation/count/calorie
metric. Training-plan run counts can cite the actual plan field as well as its summary.

A general suggestion to try logging a meal "for one week" is distinct from a claimed recorded count. The narrow
logging-advice allowance never authorizes numeric measurements, past quantities or medicine dosing. The weekly
connector "showing" can follow an exact reference without changing its topic checks. Weekly answers use the same
LOW/MEDIUM budgets and single `MAX_TOKENS` correction as conversation. A denied tool read stops with the existing
sharing-consent message instead of hiding the denial and asking the model to try another tool.

## Weekly conversation and exact captured-output replay

Weekly production requests use paragraphs: the main change against the preceding period, its practical meaning,
and one useful next step. The application supplies the same completed local-date periods and current-turn evidence;
the model cannot call tools or propose actions. Saved legacy weekly responses remain readable. Offline stand-ins
verify the new schema, correction, period and formatting, not provider-generated coaching quality.

Spelled-out logged/unlogged-day counts and completed sets of an explicitly named exercise can bind only to one
matching successful current-turn result and its exact count. Daily nutrition facts may cite supported finite
intake/target/difference paths. Ambiguous, mismatching, failed or absent evidence still fails. A consent-denied
tool read returns an application-authored paragraph with no facts or actions and `consent_refused:true`.

The fourth-smoke regression replays twelve exact fictional raw outputs: ten pass and two remain rejected for
explicit wrong units or unsupported rate framing. All ten distinct cases have a safe captured answer or the exact
consent refusal. Value-only substitution removes the duplicated labels; targeted guards reject the known broken
wording. Run `dev/tests/kit_smoke4_incontainer.py` with the fixture paths prepared by `dev/tests/run.sh`.

Second-smoke replay contains six exact captured raw strings: two now pass, three complete strings still contain
unreferenced quantities and stay rejected, and one incomplete weekly JSON stays rejected. The nine already accepted
rows have no saved raw model response; five capped rows never captured a final answer. Those missing outputs cannot
be counted as replayed successes. Explicit corrected stand-ins pass, including the truncated weekly path; this is
not a new measured provider acceptance rate. Opt-in reports now preserve successful final raw text and evidence too.
`dev/evals/replay_kit_capture.py --input /private/report.json` replays the retained raw strings without a provider.
