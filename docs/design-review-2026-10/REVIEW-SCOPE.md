# Full review: what is proposed and what remains

This records all four requested workstreams. It is a review and acceptance plan, not completed implementation. Findings combine source inventory, fictional-demo screenshots and the research linked in RESEARCH.md. Private infrastructure details and raw logs are excluded.

## 1. One visual system

The current app's cream surfaces, serif headings, coloured Nutrition title and multiple data/accent hues conflict with the new brief. A–C removed cream and serif headings but retained purple data. D removed purple and reduced colour further, yet was rejected. E tests a pure-white canvas and stronger hierarchy while keeping green. That history is evidence about preference, not a reason to implement E without approval.

After selection: edit the shared token source once, regenerate app/site themes, remove decorative colour uses, keep semantic errors meaningful, update the design guide and retain contrast checks. Check components as well as token pairs in both themes. The existing design guide remains the production reference until a later approved change replaces it.

## 2. A homepage with one story

Proposed order: “Your workouts and your food, in one app,” a real phone screenshot, a plain Works with row, then short Training, Food and Friends sections with one screenshot each. Repeat “Join the beta” as the sole primary CTA. Fold the three feature pages into the homepage; retain Compare, Guide and Privacy. Existing external links to folded pages need an explicit redirect/anchor plan, rather than silently breaking them.

The screenshots show this proposed structure at desktop and phone widths in both themes. Garmin is labelled limited beta in the mockups; do not promise public availability or unverified history. Apple Watch, Garmin, files and Strava export describe different paths, not equivalent direct integrations. Avoid implying access to Strava's API.

Owner review should cover whether the opening communicates the combined product immediately, the phone content is readable at its intended size, the sections are short enough, the actual integration wording is accurate, and the final implemented beta destination and signup journey work. Preview links were checked for the intended destination; that does not certify the future published journey. Homepage approval is separate from visual-direction selection and must precede publication. No feature pages are folded by this PR.

## 3. Friendlier app

| Area | Review finding | Proposed next work | Acceptance evidence still needed |
| --- | --- | --- | --- |
| First run | Signup reaches home without the proposed device/goal setup | Ask “What do you wear?” with Apple Watch, Garmin, nothing/skip; connect in context, then one goal question | Fresh signup, skipped setup, denied/unavailable data, reconnect and later discovery; no forced consent |
| Connections | Track → Connections is two taps in the inspected build; “three levels deep” is not universal | Improve early discovery without duplicating connection logic | User can find and complete a connection and recover from no data |
| Tabs | Current captures show Me, Activity, Track, Progress, Nutrition; the written design guide describes another stable arrangement | Test Today · Activity · Record · Progress · Food; reconcile owner intent, current routes and guide before implementation | Find profile/settings/connections; navigate consistently; Record opens a destination rather than starting immediately |
| See today | Already the launch screen: zero taps on launch, one from a different tab | Make Today label/priority clear | Task completion with representative people |
| Log food | Common route is Nutrition → Add food, two taps from home; home shortcut is conditional on food already logged | Offer a persistent, understandable entry while preserving conditional Today data panels | Reach logging before first food entry; preserve drafts, meal/day and review confirmation |
| Open workout | Latest own workout is one tap from home; an older one commonly needs Activity → My activities → workout | Make own history easy to discover without changing sharing rules | Recent/older workout tasks, search/filter, correct activity opened |
| Empty home/history/progress | Zero chart dominates new home; own-history/progress lack a useful next action in inspected states | One contextual action such as connect/import/record; avoid presenting zero as a failure | Fresh install, no permissions, no workouts, no plan; no contradictory setup prompts |
| Empty Food/Gear | Already have useful next actions | Preserve and refine only as needed | Actions visible and successful in both themes |
| Plain language | Technical terms such as “confirm cursor,” “empty read,” “Last pass” and ambiguous “Source” can leak into the experience | Rewrite visible status/error text around what happened and the next action | Review every visible state, including errors and retry paths; distinguish useful food provenance from internal jargon |
| Accessibility | Some fixed-size labels do not scale consistently; enlarged-text diagnostics exposed wrapping/density issues | Scalable hierarchy, wrapping, readable controls, VoiceOver names and focus order | Actual iPhone larger text, VoiceOver, contrast, reduced motion and keyboard checks |

Tap counts describe inspected routes; they are not a controlled usability study. Fewer taps are useful when comprehension and error recovery stay sound. Proposed tab labels in the screenshots are visual overlays; profile relocation and navigation architecture have not been built or validated.

Preserve existing conditional Today panels, five stable destinations, private personal data, per-activity sharing, server-side map privacy, explicit food confirmation and retry safety. Do not quietly change the signup sharing default while changing colours. Existing keyboard standards still apply: no app-supplied Done bar, drafts survive dismissal, focused fields remain visible, and normal controls/text selection work. Browser checks cannot certify the physical iPhone keyboard.

## 4. Launch readiness

| Work | What the review establishes | What is required before calling it ready |
| --- | --- | --- |
| App Store screenshots | Website/proposal captures exist; they are not store exports | Selected implemented design, current approved store sizes, truthful captions, light/dark/device checks |
| Privacy form | Public policy and native manifest do not complete App Store privacy answers | Trace actual collection, linking, sharing and AI/provider behaviour; owner validates App Store Connect responses |
| Store compliance fields and account controls | Account deletion already exists in the project; a complete store acceptance packet is not verified here | Verify in-app deletion in the reviewer journey, age rating/export compliance answers, Health permission usage text and HealthKit-specific disclosures |
| Review notes/demo access | No complete reviewer acceptance packet verified here | Working fictional reviewer account, login/setup instructions, reachable backend and feature notes, tested reviewer path |
| Terms, support, FAQ | Dedicated pages still need a content decision | Accurate terms with appropriate legal review, usable support contact/help and short FAQ; avoid invented legal/privacy promises |
| Off-site backups | Successful off-site recovery has not been established by this review | Protected encrypted off-site copy, retention, verified recent success, restore into an isolated environment and documented recovery steps |
| Monitoring | A report or health endpoint does not establish an alert reaches the owner | External availability/error checks, actionable thresholds, chosen destination and a verified test alert |
| Garmin real pushes | Code/connection alone is not end-to-end workout acceptance | A real permitted activity arrives once, duplicate/retry safe, expected fields/GPS and consent/privacy preserved |
| Garmin daily health | Steps, sleep and resting heart rate remain requested scope | Confirm actual program access, implement permitted payloads, ownership/consent/time-zone handling and real payload acceptance |
| Garmin opening/review | Public docs cannot establish the account's exact scopes or review clearance | Verify program/tier and history rights, prepare provider review evidence; owner approves opening access after acceptance |
| Security findings | Issue closure does not prove private review findings were accepted | Reconcile the actual findings individually with fixes and verification; retain private details outside public artifacts |
| Food chat and AI (#122) | Existing implementation is substantial; closed issue and stale roadmap descriptions disagree | Reconcile shipped behaviour, reviewed model evidence, consent and beta/device acceptance; explicitly finish or defer remaining scope |

Track each later launch item with separate implementation status, acceptance status, evidence date and named accepting role; none is automatically accepted by this checklist.

The backup and alert rows are public acceptance criteria, not a disclosure of private configuration. No backup, alert, provider, security or model-evaluation changes are made here. [Issue #122](https://github.com/BenCBanks/kinetta/issues/122) and [issue #98](https://github.com/BenCBanks/kinetta/issues/98) were closed when inventoried; that administrative status alone is not a release check.

For remaining AI work, follow the repository's architecture/evaluation rules: authenticated fixed tools, algorithm-owned numbers, backend validation, explicit write confirmation and reviewed model evidence before enabling new behaviour. Do not rebuild existing food chat because a historical plan calls it unfinished. Remaining feature/device/provider acceptance must be reconciled first; any scope cut needs an explicit owner decision.

## Proposed order after review

1. Owner selects/refines the visual direction. Claude's review informs that decision without making it.
2. Prepare the shared app/site implementation in its own PR; review the homepage mockup before any publication.
3. Run the app usability pass and launch acceptance work as separately scoped lanes, each with its own evidence and dependencies. Coordinate shared token/navigation files rather than making parallel conflicting edits.
4. Produce App Store assets only from the accepted implemented design. Record implementation, tests, merge, deployment, TestFlight and public launch separately.

This package approves none of those next actions by itself.
