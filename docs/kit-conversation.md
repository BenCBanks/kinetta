# Conversational Kit answer contract

Ordinary Kit chat can return checked paragraphs and short lists. This backend contract is a Draft;
the compatible client renderer and reviewed evaluation are separate release requirements.
Weekly and workout reviews keep their dedicated response fields. General coach and food modes keep their schemas.

The model supplies `blocks`, `facts`, optional `selection`, `actions` and up to two `follow_ups`.
A block is exactly `{kind:"paragraph", text:string}` or `{kind:"list", items:string[]}`.
There are 1–10 blocks, paragraphs up to 1,600 characters, and 1–6 list items up to 600 characters each.
The prompt asks for at most 160 words unless the actual user explicitly requests detail (then 600).
The server enforces the 600-word absolute safety bound; a modest style-length miss is not a failed answer.
Remembered context or starter guidance cannot enable a longer answer.

Up to eight facts cite exact numeric paths and values in successful current-turn tool evidence.
`{e2:7}` refers to the eighth fact, which must belong to evidence `e2`. The application verifies its
permitted measurement path, finite value and evidence identity, then formats units and labels.
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
