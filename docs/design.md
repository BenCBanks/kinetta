# Kinetta design system: Evergreen Agenda

Approved direction, 14 October 2026. Read this before changing an app screen, marketing page, icon or screenshot.
This editorial ivory/evergreen system supersedes the earlier ruby palette and oversized colorful components.

## One source of truth

`docs/design-tokens.json` owns standard colors for light/dark themes, sport/chart series, fonts, spacing, radii and touch
sizes. Run `python3 dev/design/build_tokens.py` to generate `app/static/theme.css` and `site/assets/theme.css`.
CI checks both generated files for drift and checks at least 4.5:1 contrast for core text and primary-action pairs.
Edit the JSON rather than creating another palette. Existing app/site CSS variable names are aliases of these tokens.

`app/static/style.css` owns app components; `site/assets/site.css` owns marketing components. Both load the generated
theme before their component styles. Update static cache versions and the service-worker shell after shared changes.
AGENTS.md and CLAUDE.md link here; the shared DesignPrinciples agent guide contains the same approved direction.

## Standard colors and meaning

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | Ivory `#F8F7F1` | Forest `#101C18` |
| Surface | Near-white `#FDFCF8` | Forest surface `#172720` |
| Soft surface | `#EFEEE6` | `#22362D` |
| Main text | Deep green `#142923` | `#F3F5F4` |
| Secondary text | `#485A53` | `#C3C9C6` |
| Muted text | `#59665F` | `#A8B8AF` |
| Divider | `#DEE2D9` | `#34473D` |
| Links/selection | Evergreen `#115447` | Sage `#8AD0B5` |
| Primary action | Evergreen `#115447` | `#276D57` |
| On primary action | White `#FFFFFF` | White `#FFFFFF` |
| Success/progress | `#27715B` | `#8AD0B5` |
| Error/destructive | `#C62828` | `#FF7B72` |
| Warning | `#9A6200` | `#E8B85A` |

Color must explain something. Running uses evergreen, cycling slate blue, walking sage, swimming teal, hiking earth,
rowing muted violet and lifting olive. Protein is slate blue, carbs amber and fat clay. Full light/dark values are in
the JSON. Maintain these meanings across maps, charts, icons and legends; do not introduce random colorful tiles.
Errors, deletion and over-target warnings remain semantic; removing the ruby brand does not remove useful warnings.
Initials avatars use brand-soft surfaces and brand text; notification counts use the readable action/on-action pair.
Avoid decorative gradients, competing shadows and colored settings-icon boxes.

## Typography and rhythm

Source Serif 4 is the locally hosted display face for the wordmark, page titles and section headings. Its Latin subset
and OFL license are bundled with the app/site. Native system sans is used for app controls, labels, body and numbers;
the marketing site retains Figtree body text. Use tabular numerals and explicit units. Ordinary bold text must not
inherit display sizes. Page titles are about 38px (Today 44px), sections 23–25px, body 15–16px and small labels 11–13px.

The shared spacing scale is 4, 8, 12, 16, 22, 32 and 48px. Phones have 22px side margins, dropping to 16px when narrow.
Use 12px control radii, 16px media radii and 18px quiet card radii. Cards use about 16px padding and a fine border with
little or no shadow. Today uses open sections and dividers. Editing/settings/detail screens use contained surfaces.
Main actions are full width and centered, including buttons with a right-side arrow. Visible icons are about 18–24px
inside targets of at least 44px where practical. Secondary controls recede without losing labels or keyboard access.

Allow long names and important values to wrap; never clip or overlap moving time and pace. Long all-time profile totals
use compact decimal hours (for example 96.5 h); short histories retain minute/second durations. Keep full durations in
activity detail. Input text is at least 16px to avoid iPhone zoom. Account for both safe areas and fixed tab-bar space.

## Navigation and screen decisions

- **Today:** serif Kinetta wordmark, profile link, small local date, “Hi, [first name]” greeting, notifications and Add activity.
  An enrolled plan supplies a compact agenda. Nutrition appears under the existing current-day logged-food condition.
  With neither active, weekly distance/time/climb or activity count leads directly to a compact latest-activity link.
  Omit the redundant This week heading. Use evergreen seven-day bars with day/date/value labels, without a comparison ring.
  Eligible Kit weekly reviews open from a small button beside the greeting; goals and fitness follow the primary content. Keep the persistent discovery/setup actions specified below separate from conditional data panels.
- **Five stable tabs:** Today, Activity, Progress, Nutrition, Me remain available on every screen. Feature-panel visibility
  must not hide a tab. Hide the entire bottom bar while the software keyboard is open, on every route and in sheets;
  restore it after dismissal, including swipe-down dismissal. Native keyboard events take precedence over viewport guesses.
  A focused field with a physical keyboard must not hide navigation. Use a full-width bottom bar, regular icons, readable
  labels, safe-area padding and a short active underline.
- **Activities:** use Friends feed and My activities. Friends feed contains your activities and approved friends’ shared
  activities, newest first. My activities contains your own history with search and filters. Keep the short scope line,
  privacy labels, comments, Cheers and long-press people lists. The names match mutual friendships, not a new Follow model.
- **Activity media:** GPS map always comes first, followed by equally sized photos. Without GPS, photos lead. Retain
  swipe, arrows, keyboard navigation, positions, Map shortcut and full-screen zoom/pan. Never move server privacy trimming
  into the client. Today links to the latest activity without repeating its full card or media. Detailed media stays larger. Reserve a theme-colored top safe area so native status-bar text stays readable over bright maps/photos. Marketing photo examples may
  show Photo1 after an explicit swipe; that must not change the app’s default map-first behavior.
- **Nutrition:** compact calorie figure, eaten/goal context, editable goal and flat macro bars; logging is prominent.
  Meals contain logged items and Add, without suggested food rows. Add food offers Your Usuals without a second Recent
  tab. Preserve quantity editing, deterministic serving previews, uncertainty and clear failures.
- **Progress/Nutrition discovery:** three frequent views are directly visible, with a stable More control for deeper
  views. Keep filters in a separate row. More must fit on narrow screens rather than adopting a long clipped view name.
- **Plans, routes and lifting:** use the same headings, quiet cards, neutral totals and controls. Current-week planning
  comes before retrospective progress. A completed Today workout recedes in favor of the next workout. Keep history,
  manual completion and pace explanations. Tables scroll within their container; charts retain labels, units and legends.
- **Profiles:** public plain-text bio up to 280 characters, editable name/photo, overall and per-sport activity summaries.
  Edit profile is available from Me and your own profile. Name/bio save transactionally; invalid or failed saves preserve
  drafts. Summaries use exactly the same visibility/block filter as the profile feed. Do not expose private health/food.
- **Me/gear:** restrained list rows and small icons without large colored chips. Gear keeps mileage, retirement and
  replacement information. Explicit deletion preserves activities. Private body/account settings remain separate from
  public identity. AI and Health consent remain explicit.
- **Search/errors/sheets:** accessible search labels, visible failures and Retry while preserving query/local matches.
  Missing records provide a useful way back instead of an endless Retry. Sheets trap focus, support Escape and restore
  focus. Keep normal scrolling and drafts. A downward swipe outside the input dismisses the keyboard; exclude text
  selection, maps, horizontal galleries, photo viewers and pinch gestures. Native iOS uses interactive dismissal too.

## Website and brand assets

Apply the same typography, ivory/forest palette, evergreen actions and restrained surfaces across all seven website
pages. Header/footer copies must stay consistent. Screenshots are actual implemented demo screens, never generated
mockups presented as app evidence. Capture on an isolated clean demo install so test accounts do not appear publicly.

Preserve the homepage oval track and its moving ball behind the iPhone screenshot: the track uses the subtle divider
color and the ball uses the evergreen/sage brand token. Keep the phone in front, the oval within the viewport, and
start the ball on a visible side with an 18-second lap. Pause for reduced-motion preferences and provide a small
Play/Pause control beneath the phone, including explicit opt-in playback when reduced motion is enabled. This is an intentional brand detail requested by the owner.

Refresh captures daily and on app changes, then publish Pages. The capture manifest identifies the actual source and
UTC capture time; it must work when the converter runs outside the git checkout. An already-open homepage checks the
manifest and refreshes light/dark images when it changes, retaining usable pictures offline. Near-midnight staging keeps
the fictional workout on the displayed local day. PR screenshots are artifacts, not branch-changing bot commits.

Keep the existing route/point mark. App/home-screen icons use evergreen ground, ivory route and sage point; wordmarks use
Source Serif 4 outlines. Update vectors, web PNGs, documentation assets, social-preview image/URL, native 1024px opaque
RGB icon and launch images together. Social-preview URLs are versioned to avoid old ruby thumbnails. The new iPhone icon
arrives with the next installed build; public App Store artwork follows the released build through Apple’s normal process.

Source Serif 4 uses OFL 1.1; Phosphor regular supplies six navigation/sneaker silhouettes under MIT. Licenses and sources
are recorded in THIRD_PARTY.md. Retain existing standard icons elsewhere; avoid extra libraries and app font-network calls.

## Verification and reuse

Check major and secondary routes in light/dark at 330px, 390px and wide widths; examine conditional Today states,
empty/missing/failure states, search, profile save/reload/failed drafts, map/photo order and keyboard dismissal. Compare
rendered activity-only Today with the selected concept at the same viewport and density; the newer map-first request
supersedes its photo-first example. Save comparison history privately. Do not claim visual QA from a successful build.

For schema changes, check fresh install, upgrade preservation, authenticated isolation and blocked/private profiles.
Check generated-token freshness and core contrast in CI. Native Mac CI proves compilation and archive/signing checks;
actual iPhone keyboard animation, HealthKit, VoiceOver and OS Dynamic Type still need physical-device acceptance.
Keep implementation, merge, deployment, upload and Apple processing distinct in handoff notes.

## Research references

Dribbble exploration informed the selected direction; inspiration is not proof of usability. Primary implementation
references: [Source Serif 4](https://github.com/google/fonts/tree/main/ofl/sourceserif4),
[Phosphor](https://phosphoricons.com/), [Apple keyboard dismissal](https://developer.apple.com/documentation/swiftui/scrolldismisseskeyboardmode/interactively),
[Apple charts](https://developer.apple.com/design/human-interface-guidelines/charts),
[Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), and
[W3C target sizes](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Today refinement: personal and compact

Use “Hi, [first name]” as the heading (fallback “Hi there”), rather than repeating the Today tab name. Keep the date small.
Place a quiet sparkle/Kit weekly-review button beside the greeting when reviews are enabled or a saved review exists;
open the review in a sheet, never generate one just by opening Today. Preserve AI consent and manual generation.
Omit the “This week” heading; retain accessible weekly-total labels, three metrics and the dated day bars.
Show the latest activity as a compact labeled link to its detail screen, without duplicating its full gallery or cheers.
Keep feature enrollment/food conditions and the five tabs unchanged. These choices supersede the original Today mockup.

## Onboarding, discovery and optional AI (14 October follow-up)

The owner's newer request permits persistent discovery actions on Today. Keep the plan and food *data panels* under
their existing enrollment/logged-food conditions; add small, always-available Log food, Your training plan and Explore
Kinetta links. They are usable destinations, not fake empty totals. The setup checklist remains when a native user has
not enabled their account-scoped Health connection, even if activities were imported another way. Keep private body
settings guidance until missing weight, height, sex or birth year is supplied; these details remain optional and editable.

Explore Kinetta is a permanent searchable guide in Me and on Today, with categories, a short explanation, expandable
how-to and a real destination for every feature. The same 36-entry catalog generates the public website guide using
`node dev/design/build_guide.js`; CI checks drift. Explain why body inputs affect estimated needs without promising
medical accuracy or implying that these fields are public. No forced tour or one-time dismissal hides the guide.

Use **My Recipes** for reusable recipes, **My foods** for individual saved foods, and **Saved combinations** in user-facing app/site copy. My Recipes means log, edit or create;
provide explicit edit controls and retain unfinished named meals. Keep existing API/storage identifiers for compatibility.
Direct food search remains. New described foods are looked up in one request: a named brand offers that brand's USDA/Open Food Facts products to pick; everyday foods are estimated automatically with AI access and consent, or offer the closest plain database foods without it. A word that names plain foods (banana, apple) is never treated as a brand. Add logs whatever is ready and never waits for a lookup; unfinished foods stay on the page. Photo estimates remain separate. Today’s energy balance stays collapsed with its number inside the breakdown; past days retain their balance summary. Nutrition help links directly to private body settings. Describe, Snap or Scan opens a full page with the same composer pattern as Create a Recipe; scanning lives in its + menu.

Describing food is a conversation with as little effort as possible: one sentence can hold several foods, the log day and the meal; follow-ups change, add or remove foods. Match the person's own foods first (no AI). Each row shows name, amount and calories; ✕ removes, a tap offers Half/Double. Ambiguity asks for a choice; a name with extra words ("scrambled eggs" for your Eggs) asks "Is it one of your foods?" with a "something new" option, never picking silently; a meal never logged by weight offers All of it / Half / A quarter. Everyday unknown foods go to the AI estimator automatically (with access and consent), shown as "AI estimate"; a named brand offers database products first; without AI they get plain database matches and a Search button. Add is the explicit confirmation. Never invent nutrition for a saved food that can't be found.

A non-AI account gets clear manual food/ingredient search, barcode and known-total controls. Do not fill its screens
with locked AI prompts. Existing AI reviews remain readable; generation controls require both product access and
consent. Product access, provider configuration, consent, Health consent and release approval remain distinct states.

Health setup requests the combined read-only categories once on the main thread. A returned authorization request
is not proof that every category was allowed. Use “Sync enabled”, retain individual choices, and explain Health's access
settings. Do not hold the Connect button while background delivery or first import runs; show progress and bounded,
retryable errors. Keep account guards and import cursors intact on timeout. The browser cannot validate Apple's native
permission switches or device animation: those need an iPhone check.

## Discovery controls, native canvas and website copy

Feature category buttons use full pill radii (999px), including visible keyboard-focus outlines, with at least44px
targets. Native UIKit, WebView and scroll-view backgrounds match the app canvas in both themes; rounded keyboard
corners must never expose a default black backing. Browser screenshots cannot prove the actual keyboard animation.

Website prose is authored in `site/content/*.md` and injected into the existing `site/templates/` layouts by
`dev/design/build_content.py`. Preserve the layout, screenshot refresh/track animation and shared feature catalog.
Beta forms and successful confirmations always provide a return link to the public website.

Feed performance: reuse a fresh15-second cached first page and coalesce concurrent identical reads, avoiding duplicate
requests and unnecessary map/card reconstruction when refreshed records are unchanged. Preserve account guards, cache
invalidation after edits/Cheers and pagination. Validate network counts with delayed synthetic responses before claiming gains.

Async responses must belong to both the current account and the current read revision. Invalidation prevents an
older GET/prefetch/merged-feed response from restoring stale records after an edit. Delayed401s and notification
counts from a previous account must not change a new login. Food-search input invalidates older results immediately,
including during debounce; clearing/closing search cancels queued work. Preserve the fast cached-first behavior.

Food-entry editing places Meal and Day on separate full-width rows at phone widths (up to480px). Use the shared
`datefield` styling for visible native date inputs, with explicit minimum/maximum widths, so iOS date controls cannot
push beyond their grid cell. Preserve the native picker, readable date and44px-or-larger target.

## Activity notifications and social feedback (15 October)

Phone alerts use the native iPhone app and APNs only; browser/Home Screen push controls are retired. A workout that
arrives by itself (Apple Health/watch or Garmin sync) from the last 24 hours congratulates only its owner with the
activity name, distance in their units and duration. Workouts typed in or uploaded by hand, duplicates, enrichment and
older history stay quiet. New workouts off means no alert and no bell entry. The app icon's number follows the unread
count and clears when notifications are read. Logging out and back in to the same account keeps alerts on; only Turn
off on this iPhone forgets them. Explain the Cheers hold once with a tip, since phones show no tooltips. Never ask an AI model to compose these alerts.

Cheers reacts on an ordinary tap immediately, without a double-tap delay. Hold for500ms to see the people list;
release after a hold must not send/remove Cheers. Cancel a hold on scroll, pointer cancellation or leaving the control.
Keyboard activation still reacts; the context-menu key and visible people/count controls can open the list.
Comments opens its sheet before the network responds, with loading/failure/retry states. Posting shows pending feedback,
preserves the draft on failure and prevents duplicate submissions. Keep44px targets, both themes and rollback on failure.


Food-entry actions use centered icons/labels and visibly outlined theme surfaces. The reusable-food action is named
**Create a Recipe** wherever it is offered. A logged meal's pencil menu stays scoped to that meal and selected day:
show its food totals, per-item Edit and Remove, Add food to this meal, Copy to today (past days only) and Save these
foods as a combination (named inside the sheet, never a browser pop-up). In the log, swipe a food left to remove it;
Remove is also in the meal menu and the entry editor, with Undo restoring the original day, mealtime, amount and
nutrition. Don't put a Remove button on every log row: it competes with the calories. The entry editor puts Save changes
first and quieter Log again today / Remove links underneath; Move this food is secondary, and Save changes applies only to this entry. Recipe-backed logged portions
scale their recorded nutrients by amount when they lack a normalized per-serving/per-100g reference.

Kit's contextual entry point is the `kit-help` pill: the sparkle plus the word “Kit”, 44 px tall, tinted with the accent (2026-10-16: a bare sparkle read as decoration). Put it with the screen's controls; open saved notes and explicit generation controls in a sheet after a tap. Do not insert a large inline Ask Kit invitation or generate a review just because the sheet opened. Keep saved notes readable when new generation is unavailable.

Administration lives in the separate browser `/admin` portal, with the same theme tokens and fonts, explicit account roles and distinct password/MFA sign-in. Keep administrative controls out of the personal Me screen. Food photo batches use a local thumbnail review before submission; activity summary corrections remain separate from original sensor recordings.

## Me as home and Track (16 October owner request, issue #108)

The owner explicitly replaces Today with Track. The five stable destinations are, left to right, Me, Activity,
Track, Progress and Nutrition (owner, 16 October: Me is home, so it sits first on the far left); opening the app
leads to Me, and old `/today` URLs redirect there. This supersedes earlier
Today and five-tab wording above. The software-keyboard visibility rules still apply to all five tabs.

Me leads with the existing dated weekly bar chart and distance/time/climb totals, followed by a compact editable
public identity link, Start an activity and the latest activity. Every bar uses distance on one consistent scale;
indoor time never becomes a distance bar. Current plan and nutrition panels keep their enrollment/logged-food
conditions; plan/food discovery remains available. Setup, optional private body guidance, goals and fitness remain.
Goals, gear and Explore are visible tools; secondary identity/sharing/connections/body/account/AI/data controls
live under Profile & settings. Preserve every existing setting and consent.

Authenticated profiles add seven daily and eight weekly distance bars with dates, totals, units, zero days and
text equivalents. Aggregate before pagination with the exact feed visibility/block predicate, including own-profile
friend preview. Dates use the viewer's configured time zone. Food, private health and exact locations remain private.

Track starts with Run/Ride/Walk/Hike, optional foreground GPS, and an explicit background limitation. Yoga, Pilates
and HIIT are directly available as timers; More activities includes every supported manual activity kind. Lifting
opens the existing set logger and resumes an open session. Finish opens a review with editable name, explicit Save,
private-default explanation and recoverable errors. Pause/resume and destructive-discard confirmation are visible.
Drafts are scoped to server/account, survive reload as paused, and are removed after acknowledged save or deletion.
Active/paused drafts are reachable from a persistent return link on other pages.

Foreground recording pauses when hidden; GPS requires explicit permission and the self-only location policy.
Cached/poor/implausible fixes are rejected. Pauses and signal gaps create separate segments without joining distance.
Distance is recomputed on the server. Save retries, including concurrent requests after a lost acknowledgement,
return the same account-owned activity. No recording creates a device notification or calls an AI model.

The first recorder keeps the current single-line map schema. A segmented recording's saved map shows its longest
continuous section, clearly explained in review and the activity description; totals cover all recorded sections and
original points remain in the account export. Native background GPS, full segmented-map rendering, sensors, auto-pause,
training intervals and Health write-back are follow-up work. Compilation/browser evidence does not establish physical
GPS accuracy, locked-screen behavior, native permission prompts, VoiceOver or actual iPhone acceptance.

## Owner revision: Track-only creation, native GPS, fourteen days (16 October)

The newer issue #108 feedback supersedes the local first-pass recording/chart design above. Me and authenticated
profiles show exactly fourteen daily distance bars ending today, without period filters. Date labels, units, zeros,
text equivalents and identical feed visibility/block rules remain. Activity history/past analysis remains in Activity
and Progress. No start/resume/import controls or active-session panels appear there or on Me. Track's nav indicator
can signal a recording without adding controls to another screen.

Track uses a last-used sport selector, an outdoor map that finds the person as soon as an outdoor activity is chosen (owner, 16 October: like Strava, no repeated permission prompts; the iPhone app asks Core Location, which remembers the answer; a browser locates by itself only when already allowed), Locate me to re-centre, and one prominent Start action.
Outdoor GPS and every supported indoor kind are available in that selector, including lifting. The visible “More ways to add” list (formerly the closed Activity tools fold) holds
past entries/imports/connections/Health. During GPS recording, distance/active time/average pace or speed lead the
map; Map/Stats changes display. Pause is the only primary running control; Resume and Finish appear when paused.
Review/private Save stays in Track, followed by an optional link to the finished activity. Lifting uses Track routes
with its existing set/history/rest behavior. Old URLs redirect to the new Track destinations.

The iPhone Core Location recorder owns GPS/time/durable storage outside the WebView, with explicit permission,
background-location mode and system indicator. Browser mode remains foreground-only and states that limitation.
Native build/device acceptance is separate from stand-in browser evidence. See recording-design.md and
activity-tracking.md. Preserve ordinary activity editing, manual tools, consent, drafts and account isolation.

### Resting calories (issue109)
Nutrition owns the resting-source preference, distinct from the food goal and activity recording. Show Apple Health resting + existing activities, never an added active total/multiplier. Today is synced so far, missing data remains unknown, and switching source cannot edit a target. Keep the old target calculator optional and labeled as an estimate.

## Quicker feel and tap targets (16 October owner request)

- **Feed cards:** only the profile photo and the name open a person's profile. Every other part of a card (date line,
  sport mark, title, numbers, map, empty space, the gaps in the footer) opens the activity. Cheers, comments, photos,
  media arrows and other inner controls keep their own jobs. The card dips slightly (scale .985) under the finger.
- **Haptics:** sending Cheers gives a medium tap and removing it a light tap; holding Cheers to see people gives a
  selection tick. The iPhone app uses the Taptic Engine (`NativeHaptics.swift`, respects System Haptics); Android
  browsers vibrate briefly; Safari has no haptics. Never make a buzz a required signal.
- **Navigation speed:** switching tabs shows the page instantly with no fade; screens opened inside a tab slide in from
  the side in about 0.18 s. The tab bar persists between screens instead of being rebuilt, and it is solid, so no
  background blur is drawn behind it.
- **Less repetition:** Me drops its Training plan / Log food shortcut rows when the plan or food card above already
  shows that link or button. Progress's table is a slim fold row. Activity dates on the detail screen wrap instead of
  ending in an ellipsis.
- **Me greeting:** the Me tab's page title is "Hi, [first name]" with the local date above it; the tab itself is still
  called Me. Your photo at the top right (next to the bell) opens your profile and replaces the old name row. Fitness &
  freshness is one compact card: status word, then fitness/freshness/run score in a row. Friends, Goals, Shoes & bikes,
  Explore Kinetta and Help & contact share one list without a heading; Profile & settings stays last.
- **Contact:** the public support address is KinettaApp@gmail.com (privacy policy, website footers, SECURITY.md, Me ›
  Help & contact). Never ask for passwords by email.

## Nutrition-first onboarding — #122 Workstream A (October 2026)

Issue #122 is the accepted direction: nutrition leads, activity remains a strong second, and a watch/connector is
optional. This change implements A only; the home reorder, new navigation, food thread, adaptive check-in and
training-day targets remain separate workstreams. The eight owner decisions in #122 govern their implementation.

Me retains an unfinished setup list with an optional native **Connect Apple Health** step until sync is enabled,
including accounts with activity history. Never render a setup heading/card without rows. A returned Health
permission request is still not proof of every read grant. The existing native consent/import flow is unchanged.

Goal setup is a full page opened deliberately from Me or Nutrition, never a launch pop-up. Choose Lose weight,
Maintain, Build muscle, Eat healthier or Fuel training; choose everyday activity outside workouts, optionally enter
private body details, then review editable calorie/protein estimates. **See my estimate** does not save anything.
Only **Save targets** persists the goal, pace, supplied body details, everyday activity, calories and protein in one
transaction. Other macro targets, per-day overrides, resting source and consent are preserved. Not now/Back leave
account settings unchanged; unfinished choices resume within the same signed-in page session. Reload starts from
saved settings. Manual targets remain available in the existing sheet.

`energy.target_suggestion` uses the existing Mifflin–St Jeor resting estimate when possible, otherwise the existing
weight-only method (20 kcal/kg for female, 22 otherwise). Missing weight explicitly uses 75 kg, never presented as
measured. Everyday activity is ×1.2/1.3/1.45, excluding workouts. Weekly weight-change pace is 0–1% of body weight;
7,700 kcal/kg gives the initial adjustment. Calories round to 10 and cannot fall below resting burn rounded upward
to 10. The floor may slow loss; no rate is promised. Protein is 1.6 g/kg for loss/muscle/training goals and 1.2 for
maintenance/healthier, rounded to 5 g. These are general adult starting estimates, not medical advice. Weight-based
figures without full body details are labelled rough. No AI, measured-history adaptation or automatic Health choice.

One main action per step, quieter Not now/Change details, explicit labels/units, 44px targets, native keyboard rules,
shared theme tokens, wrapping and relative-sized text. Goal choices give a selection haptic and saving a success haptic,
with visible selection/confirmation. Browser evidence is distinct from physical Dynamic Type/VoiceOver/haptic/Health
permission acceptance, which requires an iPhone.

### Food-first Me — #122 Workstream B

Home opens with the greeting, Today’s food, the check-in slot (populated by G), today’s plan session when present, friends’ shared activities when present, and the 14-day distance chart when distance exists. Setup and tools follow. Training details remain in Progress and Activity; home does not show empty training cards or zero-distance charts.

Today has one primary Log food action and direct Describe, Snap, Scan and Usual shortcuts. They use the existing food logging paths and the expected meal; no extra meal form is required. The calorie hero shows calories remaining, with eaten and goal underneath. Without a goal it shows eaten totals and optional Set a goal. A completely empty log starts with an invitation, not zero totals. One macro bar has text equivalents for protein, carbs and fat. Today’s workouts link to their owner’s activity and label estimated calories. The next empty meal offers a preview of yesterday’s foods before logging, using the existing offline-capable entry path with Undo after an online save. Food is never added to the friends feed.

### Shared logging and Progress — #122 Workstream C

The tabs are Me, Nutrition, ＋ Log, Activity and Progress. ＋ Log opens the shared dismissible sheet immediately with equal Log food and Record a workout choices, plus Weigh in. Food opens the existing composer within the initiating tap; Snap, Scan and Paste are visible there. Workout opens Track, retaining its sport choice and account-bound recording draft. A live or paused draft marks the centre button and one tap returns to the recording. The foreground browser recorder still pauses when hidden; background and locked-screen GPS remain native iPhone behavior and require physical-device acceptance in R.

Quick weigh-in is today’s single weight field with units and explicit Save, prefilled with the latest weight when available. A late read never replaces typed input. It uses the existing durable offline write queue and gives visible confirmation plus a success haptic.

Progress opens Food & weight by default and remembers the selected Food & weight / Training half per account on this device. Food includes Overview, Weight and a food calendar; its More menu preserves the existing nutrition views. Training keeps the existing views and old direct URLs. Nutrition retains daily logging, foods and recipes. Connections and uploads are also reachable under Profile & settings. All old routes remain supported; no permission popup is introduced on launch.

### Persistent food conversation storage — #122 Workstream D, foundation

The food thread has private, durable text messages with stable per-account client identities. A retry after a lost acknowledgement returns the original message; reusing that identity for different text is rejected. Capture time is retained for offline arrivals and converted to the account’s timezone for day separators. History is paged from the newest messages; older pages have a stable cursor. No full food photos or thumbnails are retained in thread storage.

Message text and owner-bound links to logged foods are included in data export and removed with the account. Composite database foreign keys prevent linking another person’s message, reply or food. Personal SQL access is read-only under RLS. Deleting a message also removes its reply and links, while keeping already logged foods; food deletion remains an independent explicit action.

The agreed future thread defaults are auto-log ready items and Supportive feedback; an explicit preferences API supports require-a-tap and Just the numbers. These settings do not alter the existing Add flow yet. This foundation stores pending messages and does not process them, call AI or change food totals. The visible conversation, processing, feedback, offline client delivery and the remaining D acceptance follow in subsequent focused PRs. Conversation history must never be sent to an AI provider; only the current unknown text and explicitly referenced food context may be sent by the later consent-gated processor.

### Food-thread numbers and feedback — #122 D, part 2

The private thread can answer calories/macros remaining or logged, historic meals, weekly logged totals/averages and burn questions using application records, with no model call. Missing logs and unknown fiber stay unknown. Daily targets stay daily; weekly queries label their logged-day coverage rather than inventing a weekly allowance. Formula burn is labelled as a whole-day estimate; Apple Health resting data is labelled as synced and never changes the independently chosen food goal.

A numbers answer and its request state commit together under the account/message locks. Concurrent retries return the same stored answer, with its original as-of time. Ordinary food input remains pending for the later logging engine. Open advice only offers Kit with access and consent; this endpoint never invokes it. Day and insights data readers now accept the caller’s connection, so later logging feedback can see an uncommitted food write without borrowing a second pooled connection. Existing public day/insights endpoints use the same readers.

The reusable feedback function offers Supportive or Just the numbers, varied code-written lines for protein, room toward the saved goal, larger meals, recorded workouts and days with food logged. It uses real totals and labels approximate calories. A target below estimated resting burn, several low or incomplete logs, or a measured trend losing more than 1% of body weight per week replaces praise with a gentle prompt to review the records and target. It never congratulates low intake or treats food as moral success/failure. The full conversation UI, automatic food logging/edits, unknown-food fallback and remaining D acceptance still follow.

### Own-food thread logging — #122 D, part 3

A thread message that fully resolves against the person’s saved foods, recipes, combinations or logged history can now log automatically, as decided in #122. The require-a-tap preference produces a stored preview instead. Meal/day words override inference; otherwise the captured day, learned meal hour or the existing clock-based meal guess supplies the destination. Unknown or uncertain items are left unlogged with one detail to resolve; the unknown-food and correction layers follow separately.

Resolution, recalculated food writes, the factual feedback, reply and owner-bound links share one database transaction. A failure to store the reply rolls back the food write; retries and concurrent processing return one set of entries. The legacy Describe API retains its current bounds and explicit-confirm contract, while the thread accepts its own 4,000-character bounded text through the same parser. An explicit Log tap rechecks the stored preview; if nutrition changed or the preview expired, it refreshes the card and requires another tap instead of logging different numbers silently.

Undo removes only that message’s linked foods, updates the persisted card and can be retried safely. Message deletion remains independent of food deletion. There are no model/provider calls in this layer. Follow-up edits, choices, historic-food references, unknown-food fallback, durable AI caps, the visible thread and remaining D acceptance are still pending. Fifty independently calculated fictional phrases exercise saved-food portions, multiple foods, ordinary conversational prefixes, dates and meals without asking the person to rephrase.

### Thread corrections, choices and references — #122 D, part 4

Follow-ups change the most recent matching logged card: half/absolute quantities, whole saved-combination quantities, named removals and destination corrections use the current logged values, preserving manual nutrition edits. The original card is marked updated; the correction is stored separately. Bare quantities with multiple possible targets ask one selection question, and a bare quantity after Undo cannot silently change an older meal. Correction retries do not apply the change twice. Reply/food changes share the same transaction; a persistence failure rolls everything back.

Unresolved foods accept an explicit owned-food or portion choice. Require-a-tap remains effective after choices and reference quantities. Pending previews can continue through a quantity reply without retyping the food; superseded previews cannot also be logged. Source changes refresh a preview/question instead of silently applying different nutrition. Long text is retained while its reply stays compact. Day/meal edits move existing entries instead of copying them.

“Same as yesterday’s lunch, but no cheese” reads the person’s own food log. Only a separately recorded matching item is excluded automatically; a composite food is not silently treated as if one ingredient could be subtracted. An uncertain exclusion asks which recorded foods to leave out, and a typed answer is an exclusion choice, not a new food log. A copied meal can be scaled before an explicit Log tap. “The rest of the chili” resolves the food from history but asks how much was left: saved recipes have no reliable cooking-batch identity, so remaining grams are not invented. Known portions then use recorded nutrition, with no model call.

The final thread interface, offline queue and optional daily review remain the next D pieces. Unknown-food processing and durable AI cost controls are provided by the later D backend foundations below. No full food photos are retained and no conversation history is sent to a provider by this layer.

### Food estimator pauses (#122 D foundation)

An AI limit response explains that food search, barcodes and manual nutrition still
work. Do not discard the person's message or replace it with zero-calorie food.
Structured estimates share a durable daily service reservation; a failed/unknown
bill keeps its hold. This backend foundation adds no new screen. The thread UI must
present its fallback and retained text inline when it is implemented.

AI pause/busy replies apply consistently to food and Kit. Opening records never
spends tokens. A busy response must preserve pending food text and show the normal
search/manual fallback. Existing generated notes remain readable when AI is paused.

### Thread food resolution (#122 D backend; interface follows)

Ready parts of a message save once without waiting for unknown parts when automatic
logging is on. Require a tap holds ready parts for explicit Log. Each original
part keeps its identity as public catalog choices, portion chips, photos or manual
numbers resolve the rest. There is one clarification on the original card, with
all remaining choices below it; people keep their original words. Known calories
are not discarded when another food/provider fails. Undo covers the linked foods.

Stored nutrition wins when a model-identified food clearly matches a private food;
the portion remains marked as estimated. Otherwise AI foods retain their estimate
source, assumptions and model, and become editable private foods after logging.
A repeated description uses the saved foods without a model call. Portion edits
retain the original learned amount, so halving today's two bowls does not redefine
what "two bowls" means tomorrow. Changed saved nutrition refreshes a held preview
and needs another explicit Log tap. Published product values keep their source.

Capture/meal/day inference is independent of slow/offline delivery. Processing
leases and stable identities prevent duplicate estimates/saves; cancellation or
message deletion blocks late results/uploads. Deleting conversation text keeps
saved food but removes its job. Reuse aliases contain hashes, not another copy of
the conversation. The server retains no photo pixels or thumbnails. A photo that
never uploaded asks for the photo again while retaining its text.

Calorie-only manual entries mark omitted macros unknown. Daily/weekly factual
answers refuse to invent a remaining amount from incomplete nutrition; entering
that nutrient later clears its unknown flag. Feedback keeps the low-intake safety
check and explains incomplete protein rather than reporting zero.

These APIs add no app navigation/composer yet. The final thread interface must show
per-food origin/estimate and unknown-nutrient labels, quiet Edit/Undo and manual or
search fallbacks, preserve queued text, and use the shared sheets/components. No
real-provider accuracy, private switch test or physical-iPhone acceptance is implied
by the backend's stand-in tests.

### Pending writes and account changes (#122 Workstream D)

Food and weight uploads rejected by the server stay on the phone with their error.
The connection banner opens Pending items with Retry and Discard; failed validation
does not repeat automatically. A confirmed upload removes only its original queued
item, preserving additions made while it was sending. Storage failure leaves the
entry screen open rather than claiming a queued save.

Queues and saved screens belong to a server and account. Requests include an optional
expected-account constraint, verified against the authenticated session; it grants
no access. Legacy browser queues migrate only on their own origin. Older native
queues without a server identity remain retained and are not automatically sent;
they require a future recovery path that can establish their original server.
This is a supporting fix; the permanent conversation screen follows separately.

### Permanent food conversation interface (#122 Workstream D)

`Log food` opens one conversation at `/food/describe`, with the keyboard focused
and the previous conversation cached by server and account. The composer remains
the same DOM element as replies arrive. There is no meal/day form before Send;
each food card exposes its inferred destination for correction in the shared sheet.
Ready foods log according to the person's preference, with Edit and Undo. The
require-tap preference makes the latest ready card the primary action when the
composer is empty. Supportive and Just the numbers use the existing deterministic
feedback preference. A short status region announces changes; history is not live.

Send first commits a stable UUID, capture time and message to an account-bound
IndexedDB outbox. Network interruption preserves it. Account/session changes stop
processing; server-side identities and expected-account checks prevent cross-account
writes. Failed messages remain visible with Retry and Cancel. Pending photos remain
only in the device outbox until processing/cancellation, with no server image history.
Cancel is persisted before requesting the server tombstone. Reordered responses
cannot replace a cancellation with a new upload. Conversation deletion keeps food.

Snap, Photo library, Scan and Paste are labelled composer tools; keyboard dictation
uses the operating system microphone. Me's direct Snap/Scan actions enter this same
conversation. Search, usuals and My Recipes remain reachable through their shared
picker. List, usual and recipe-portion logging creates neutral food cards in the same
conversation, with a stable identity for retries and Undo. The optional daily note
is separate work; the private switch test and physical-iPhone acceptance remain release gates.

Calorie-only entries keep missing nutrients unknown in the thread, shared editor,
Me and daily totals. Incomplete totals show only the known amount and suppress
misleading target progress. Editing or rescaling a calorie-only entry keeps blank
macros unknown. Deleting an account also erases its on-device conversation cache,
draft and photo/message outbox; another server/account is unaffected.

### Picker receipts and delayed corrections (#122 Workstream D)

List, Search, Quick, usual and recipe-portion logging can request a conversation
receipt in the same transaction as the food. Each food has its own card; the UI
does not fabricate a user chat message. Replays keep the original food/card. Undo
or removal blocks a delayed replay from bringing the food back. Deleting only the
message keeps the food and never brings the deleted text back on a retry. Older
clients keep their existing API behaviour. Recipe portions have stable optional
client identities and can wait in the existing account-bound outbox.

The composer can offer a saved usual portion directly. Shared pickers remain
available, and their responses update chat without replacing its text box. Queued
food is described as saved on the phone, never as a confirmed server log. Blank
Quick nutrients stay unknown; deriving calories requires all three macros. Held
previews display their food sources, assumptions and numbers. Changed previews
refresh the card and explain the second explicit Log tap. Saved AI foods retain
the estimate and Edited labels in the library, picker and thread.

A correction remembers the visible food context when typing starts. It survives
a draft reload and delayed upload. Newer activity on another device cannot retarget
“make it half” to another plate. An unavailable context asks for an owned food
choice instead of silently changing another card. Numbers questions remain code
only. Edits/removals suppress old feedback whose nutrition no longer matches the
card. Legacy food sheets close or block submission after an account change.

Food chat offers a quiet “Ask Kit for a food suggestion” after a food-advice, reassurance or day-review answer, only when access, consent and the separately reviewed food-chat release gate allow it. The code answer stays first. AI interpretation is labelled, verified food records and limits can be expanded, and suggested meals use the shared explicit review/confirmation sheet. Asking never logs food. Provider work runs outside database locks; one durable job and one saved answer prevent duplicate calls. Retry preserves message and draft. Deleted messages/replies cannot be resurrected by late answers. Unknown nutrition stays unknown in tools; food-only Kit cannot access activity, body, weight or Health records. Generic Kit retains its Health consent gate. No new prompts or models; device checks and human accuracy review remain required.

Food-chat daily notes are off by default. Settings offer Off, Code summary, or Code summary + optional Kit. After explicit enablement, a code-only note is created on a food-chat visit after 8 pm in the account time zone; the quiet Daily note action can request it earlier. It shows an as-of time, known totals, an honest low/incomplete-day concern where needed, and at most one gentle idea. Supportive/numbers tone is respected. Code generation, food saves and history reads never request AI. The optional Kit version needs a separate tap and the existing evaluated food-only access/consent gate; one attempt per local day includes failures and crashed requests, survives reload/restart/toggling, and cannot be repeated after deleting the note. No notifications or food/target changes. Stored notes use the private thread's existing RLS/export/deletion rules.

The daily Kit cap also covers requests for older notes made on the same current local day. A separate durable local-day counter survives message/reply deletion; existing UTC service/provider budgets still apply independently.

Connections now leads with Apple Health status and Connect/Manage in the iPhone app, then Upload files. intervals.icu and Health Auto Export remain under Advanced for self-hosted installs and power users. A watch is optional. Garmin Health sharing can be delayed and excludes GPS tracks; on your own Health-sourced outdoor workout without a route, Add the map explains Garmin Connect website → activity → settings gear → Export Original, then uploads the original ZIP/FIT through the existing importer. Matching sport/time/distance enriches the existing activity and keeps user edits; other recordings remain separate. No provider connection is required.

Nutrition insights distinguish logged food, a rough burn/energy model and recorded scale trends. A discrepancy names water changes, missed or underestimated food and burn-estimate error, then points to the weekly check-in; agreement is described as broad consistency rather than proof. Weight text uses the account's units. No per-bodyweight advice is inferred from a fallback weight. Energy captions identify Apple Health resting + activity, imported daily burn or formula sources, and never equate being under the food goal with a measured deficit or modelled energy with actual fat loss. These wording changes do not alter targets, calorie arithmetic or Health's passive-only rule.

## Weekly check-in with explicit target acceptance (#122 G)

This supersedes the former rule that the measured check is never used for targets. Me and Progress share a deterministic weekly check-in, with no AI or watch dependency. The last 28 completed days need at least 7 sufficiently complete food days and 3 weigh-ins spanning 10 days. Today, very partial food days and days with unknown calories are excluded. The existing intake/weight-regression method infers daily burn; it is labelled as inferred, compared with the formula estimate and explained with water/logging/scale uncertainty. The card shows average intake, weekly weight-trend change, inferred daily burn, sample counts, period/as-of date and the calorie suggestion. Calories round to 5–10 kcal and weight to 0.1 in the account's units.

The saved goal and 0–1% weekly pace shape the suggestion, with the unrounded estimated resting burn as a floor. Accept alone changes the calorie target; macro targets, per-day overrides, activity setting and resting-source choice remain as set. Accept revalidates the displayed baseline; changed records/goal require another explicit tap on the refreshed suggestion. Replay cannot overwrite a later manual target. Not now hides Me's card until the next local Monday, with the decision/history still viewable in Progress. Accepted/deferred snapshots do not silently change; old weeks cannot apply. The most recent eight weekly records are available in Progress. New personal storage has owner RLS, export and account-delete cascades.

Me shows only a pending actionable check-in, demoting its Log food button to the shared quieter style while Accept is the one primary action. Logging remains directly available. On Progress, insufficient data shows one useful action (choose goal, log food or log weight), not empty statistics. How this works opens a plain explanation. Failures preserve the prior target and offer retry; account/session guards cover delayed reads/actions. Adult-only goal suggestions use the same safety policy as setup. Physical iPhone text/VoiceOver/touch checks remain separate.

Me's setup hints recognise any of the person's own saved food history as well as workout history, even when today is empty. The first-food/friends introduction stops after either kind of history exists. Food and activity responses may arrive in either order; setup redraws from the latest scoped results. Optional Apple Health remains visible on iPhone until enabled, and a setup heading never appears without rows. Shared facts/AI readers are unchanged; the extra history flag is on the authenticated HTTP day response only.
General protein-per-bodyweight ranges and training-day guidance belong in the H guidance flow. Nutrition insights show the account’s recorded totals and chosen targets; they do not add a generic g/kg recommendation. This keeps estimate wording separate from optional guidance and avoids advice based on fallback weight.

Weekly check-in GETs use a read-only transaction and return an unsaved preview. Only an explicit Accept or Not now materializes a private decision row. The preview ignores today’s weigh-in and excludes unknown-calorie days through the shared energy reader; replaying a saved decision is successful even after a new week starts.
