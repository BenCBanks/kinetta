# Kinetta design system: Sky Blue

**Ben’s choice, 23 October 2026: B · Sky Blue from Claude’s mockups. Green is the runner-up.**
This supersedes Evergreen Agenda’s colours and serif headings, the unapproved colour draft #219 and the rejected
options in reference-only #224. The change is colours and heading font only: keep the existing logo, tab names and
order, layout, conditional panels, homepage structure and privacy rules. Do not merge those earlier proposals.

## One source of truth

`docs/design-tokens.json` owns standard colors for light/dark themes, sport/chart series, fonts, spacing, radii and touch
sizes. Run `python3 dev/design/build_tokens.py` to generate `app/static/theme.css` and `site/assets/theme.css`.
CI checks both generated files for drift and checks at least 4.5:1 contrast for core text and primary-action pairs.
Edit the JSON rather than creating another palette. Existing app/site CSS variable names are aliases of these tokens.

`app/static/style.css` owns app components; `site/assets/site.css` owns marketing components. Both load the generated
theme before their component styles. Update static cache versions and the service-worker shell after shared changes.
AGENTS.md and CLAUDE.md link here. This newer owner decision supersedes older palette/orbit guidance in shared references.
The generated `--share-*` colours use these same dark tokens so activity pictures keep a consistent dark appearance.

## Sky Blue colours and meaning · 23 October 2026

These are the implemented values; three light-mode colours are slightly darker than the chosen swatch to keep
all existing contrast checks passing without changing their hue. All other supplied palette values are unchanged.

| Token / role | Light | Dark |
| --- | --- | --- |
| `canvas` · Canvas | `#F3F5F7` | `#0E1113` |
| `surface` · Surface | `#FFFFFF` | `#171B1F` |
| `soft` · Soft surface | `#EDF0F3` | `#20262B` |
| `text` · Text | `#15191D` | `#F1F3F5` |
| `text-secondary` · Secondary text | `#4A535C` | `#B4BCC4` |
| `text-muted` · Muted text | `#646D77` | `#929BA4` |
| `divider` · Divider | `#E3E7EB` | `#2A3137` |
| `brand` · Brand: links and selection | `#1F55D0` | `#82AAF6` |
| `brand-soft` · Brand-soft: selection surface | `#E6EEFD` | `#18243A` |
| `action` · Action: main buttons | `#2563EB` | `#2F64D8` |
| `distance-muted` · Unselected total-distance bars | `#BFD3FA` | `#2A3F6B` |
| `on-action` · On action | `#FFFFFF` | `#FFFFFF` |
| `success` · Success | `#097C4D` | `#4CC98A` |
| `run` · Run | `#12924F` | `#4CC98A` |
| `ride` · Ride (teal) | `#0B8798` | `#4BC0CF` |
| `walk` · Walk | `#6F8A12` | `#A9C24E` |
| `hike` · Hike | `#B26A10` | `#E9A04E` |
| `workout` · Workout / lifting | `#D9532A` | `#FF8A5C` |
| `swim` · Swim | `#2A80BD` | `#5EB8E6` |
| `row` · Row | `#2A80BD` | `#5EB8E6` |
| `ski` · Ski | `#2F6FD6` | `#6EA6F2` |
| `other` · Other | `#78828C` | `#9AA3AC` |
| `series-1` · Series 1: protein | `#DD4B3B` | `#FF7D6E` |
| `series-2` · Series 2: fat | `#0B8798` | `#4BC0CF` |
| `series-3` · Series 3 | `#12924F` | `#4CC98A` |
| `series-4` · Series 4: carbs | `#B9790E` | `#F2BC5A` |
| `series-5` · Series 5 | `#2A80BD` | `#5EB8E6` |
| `achievement` · Achievement: streaks and wins | `#8A5F10` | `#F2C14E` |
| `nutrition` · Nutrition: same as text | `#15191D` | `#F1F3F5` |
| `error` · Error / destructive | `#C62828` | `#FF7B72` |
| `on-error` · On error | `#FFFFFF` | `#0E1113` |
| `warning` · Warning | `#925C00` | `#E8B85A` |
| `outline` · Control outline | `#7B8791` | `#82909C` |

Contrast adjustments: muted text `#66707A` → `#646D77`; success `#0A8754` → `#097C4D`;
achievement `#9A6A12` → `#8A5F10`. These retain the selected hue; the stricter tinted-surface checks still apply.
Error and warning retain their semantic colours. Heart-rate zones and the hard-workout cue remain distinct and unchanged;
they already pass on the new surfaces. Outline is neutral `#7B8791` / `#82909C`, with at least 3:1 contrast.

- Use a neutral base: light grey canvas, white surfaces, near-black text; neutral charcoal layers in dark mode. No cream.
- Colour belongs to main buttons, selected navigation/controls, links and actual data: charts, legends, sport icons,
  macro dots, streaks and results. Retain labelled error/warning states. Ordinary headings, eyebrow labels, settings
  icons and decorative surfaces are neutral. No coloured words in headlines. The homepage track (below) is brand, not decoration.
- Headings use the UI sans font via `--font-display: var(--font-ui)`, about 700 weight and slightly negative tracking.
  Existing logo/wordmark artwork, including its type and colours, stays unchanged. Do not redesign icons or branding assets.
- Nutrition headings use the normal text colour. Eyebrows use muted text. The calorie progress bar uses action blue;
  over-target warnings still use the error colour. Protein uses series-1 red, fat series-2 teal and carbs series-4 gold.
- Sport and macro charts use solid fills, named legends, units and values. No stripe/dot patterns or greyscale sport
  encoding. Maps may retain geographic basemap colours; route strokes use the corresponding sport token.
- Combined distance charts use one solid total per day/week/period, with rounded tops and a common labelled scale.
  Today/current period (or the selected bar) uses action blue; other bars use `distance-muted`. Use divider gridlines,
  muted axis labels and a value only above the highlighted bar. No sport stacks or sport legend. Tapping or focusing
  a bar shows its named per-sport breakdown; dismissing selection restores the current period. Preserve dates,
  calculations, privacy filtering and zero baselines. Tiny totals keep their true height; future days do not invent data.
- **Pills and distance-chart addendum, Ben, 23 October 2026:** pills/chips, including streaks, wins and Matched route,
  use `soft` backgrounds, normal `text`, 500 weight and fully rounded corners. Only the leading icon carries colour;
  streak/win icons use achievement gold. No tinted pill backgrounds or coloured pill text. Selected chips retain a
  visible neutral outline. Sport colours remain in activity lists, sport icons and sport-specific charts. These rules
  supersede the earlier sport-stacked distance and coloured-pill guidance below.
- Keep toasts neutral: near-black `#15191D` in light mode and a raised charcoal `#20262B` in dark mode, light text
  `#F1F3F5`, secondary `#B4BCC4` and blue Undo `#82AAF6`. Selected segments use `--segon` white / `#2A3137`;
  their base uses `--segbg` `#EDF0F3` / `#1C2125`. Preserve existing shapes, dimensions and interactions.
- Preserve the feed’s full-width divider and all existing activity/profile visibility, map trimming and consent rules.
  Colour never replaces a name, number, selection state or accessible description.

## Typography and rhythm

UI sans is the display face for page titles and section headings, about 700 weight with slightly negative tracking.
The existing Source Serif 4 logo artwork and bundled OFL font remain for the unchanged wordmark only. Native system sans is used for app controls, labels, body and numbers;
the marketing site retains Figtree body text. Use tabular numerals and explicit units. Ordinary bold text must not
inherit display sizes. App page titles are 30px, sections 20px, card titles 18px, summary figures 28px and secondary stats 20px at the default text size. Body copy stays 15–16px and small labels 11–13px. Use the `text-app-*` tokens (in rem) so this hierarchy grows with text enlargement; do not shrink the root font. Marketing display sizes remain separate.

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
  Omit the redundant This week heading. Use solid seven-day total-distance bars, blue for today/selection and light tint for the others, with muted day/date axes, a highlighted value and a neutral zero baseline. Show the sport breakdown on tap rather than a legend, without a comparison ring.
  Eligible Kit weekly reviews open from a small button beside the greeting; goals and fitness follow the primary content. Keep the persistent discovery/setup actions specified below separate from conditional data panels.
- **Five stable tabs:** Today, Activity, Progress, Nutrition, Me remain available on every screen. Feature-panel visibility
  must not hide a tab. Hide the entire bottom bar while the software keyboard is open, on every route and in sheets;
  restore it after dismissal, including swipe-down dismissal. Native keyboard events take precedence over viewport guesses.
  A focused field with a physical keyboard must not hide navigation. Use a full-width bottom bar, regular icons, readable
  labels, safe-area padding and a short active underline.
- **Activities:** use Friends feed and My activities. Friends feed contains your activities and approved friends’ shared
  activities, newest first. My activities contains your own history with search and filters. Keep the short scope line,
  privacy labels, comments, a compact reaction action and tappable reaction counts. Preserve a thin, full-width horizontal
  divider between each feed card’s activity content (including media controls) and its social actions. Use the theme
  divider color in both light and dark mode, including cards without media. The names match mutual friendships, not a new Follow model.
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

Apply the same UI sans headings, Sky Blue palette, blue actions and neutral surfaces across all seven website
pages. Header/footer copies must stay consistent. Screenshots are actual implemented demo screens, never generated
mockups presented as app evidence. Capture on an isolated clean demo install so test accounts do not appear publicly.

Keep the homepage track: the logo's oval behind the hero phone with the runner going round it, plus its play/pause
control (owner, 23 October 2026: "a critical piece to our brand"; briefly removed in #225 and restored). The oval uses
the quiet divider colour and the runner the brand blue. Keep the hero phone, existing copy, page sections, links and their order. Headline emphasis inherits normal heading colour and is not
italic; eyebrow labels use muted text. This colour-system decision does not fold feature pages into the homepage.

Refresh captures daily and on app changes. Publication remains a separate owner-authorized step; this colour PR must not publish or deploy. The capture manifest identifies the actual source and
UTC capture time; it must work when the converter runs outside the git checkout. An already-open homepage checks the
manifest and refreshes light/dark images when it changes, retaining usable pictures offline. Near-midnight staging keeps
the fictional workout on the displayed local day. PR screenshots are artifacts, not branch-changing bot commits.

Keep the existing route/point mark and all logo, icon, launch-artwork and social-preview assets unchanged in
this colour/heading pass. Wordmark artwork keeps its original Source Serif 4 outlines. A future asset change needs
separate scope; do not regenerate native icons or upload a new build as part of this PR.

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

Describing food is a conversation with as little effort as possible: one sentence can hold several foods, the log day and the meal; follow-ups change, add or remove foods. Match the person's own foods first (no AI). Each row shows name, amount and calories; ✕ removes, a tap offers Half/Double. Ambiguity asks for a choice; a name with extra words ("scrambled eggs" for your Eggs) asks "Is it one of your foods?" with a "something new" option, never picking silently; a meal never logged by weight offers All of it / Half / A quarter. Everyday unknown foods go to the AI estimator automatically (with access and consent), shown as “Kit’s estimate”; a named brand offers database products first; without AI they get plain database matches and a Search button. Add is the explicit confirmation. Never invent nutrition for a saved food that can't be found.

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
`dev/design/build_content.py`. Preserve the layout, screenshot refresh and shared feature catalog; the hero track is part of the brand and stays.
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

Cheers reacts on an ordinary tap immediately, without a double-tap delay. Hold for 500ms to reveal Cheers, Strong and Applause in an anchored picker; opening/releasing the picker alone must not send/remove a reaction. Slide onto a choice and release, or tap a choice. Cancel a hold on scroll, pointer cancellation or leaving the control. A visible choice button and keyboard access reach the same picker; Escape/outside tap dismiss it. Tap the reaction count to see people.
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

Kit's contextual entry point is the `kit-help` pill: the sparkle plus the word “Kit”, 44 px tall, with a neutral soft background and normal text (23 October 2026 pill addendum; the leading icon may carry colour). Put it with the screen's controls; open saved notes and explicit generation controls in a sheet after a tap. Do not insert a large inline Ask Kit invitation or generate a review just because the sheet opened. Keep saved notes readable when new generation is unavailable.

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

Owner revision, 20 October: remove the small date numbers beneath these bars, retaining weekday letters and the date range. Hover or keyboard focus shows the full day and its distance with units in the readout beneath the chart. Tap/click pins that day; tap again or Escape clears it. Arrow keys move between days. Keep zero-distance days selectable and expose each bar as a named button, including on authenticated profiles that share this chart.

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
- **Haptics:** sending Cheers gives a medium tap and removing it a light tap; holding Cheers to reveal choices gives a
  selection tick. The iPhone app uses the Taptic Engine (`NativeHaptics.swift`, respects System Haptics); Android
  browsers vibrate briefly; Safari has no haptics. Never make a buzz a required signal.
- **Navigation speed:** switching tabs shows the page instantly with no fade; screens opened inside a tab fade in
  in about 0.2 s (a fade only since 18 October: the slide's leftover transform left pinned bars cut off on iPhone). The tab bar persists between screens instead of being rebuilt, and it is solid, so no
  background blur is drawn behind it.
- **Less repetition:** Me drops its Training plan / Log food shortcut rows when the plan or food card above already
  shows that link or button. Progress's table is a slim fold row. Activity dates on the detail screen wrap instead of
  ending in an ellipsis.
- **Me greeting:** the Me tab's page title is "Hi, [first name]" with the local date above it; the tab itself is still
  called Me. Your photo at the top right (next to the bell) opens your profile and replaces the old name row. Fitness &
  freshness is one compact card: status word, then fitness/freshness/run score in a row. Friends, Goals, Shoes & bikes,
  Explore Kinetta and Help & contact share one list without a heading; Profile & settings stays last.
- **Contact:** the public support address is feedback@kinetta.app (privacy policy, website footers, SECURITY.md, Me ›
  Help & contact). Never ask for passwords by email.

## Nutrition-first onboarding — #122 Workstream A (October 2026)

Issue #122 is the accepted direction: nutrition leads, activity remains a strong second, and a watch/connector is
optional. This change implements A only; the home reorder, new navigation, food thread, adaptive check-in and
the remaining roadmap items have separate acceptance checks; training-day targets are now parked under #236. The eight owner decisions in #122 govern their implementation.

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

### Food-first Me — #122 Workstream B (superseded by #164 below)

Home opens with the greeting, Today’s food, the check-in slot (populated by G), today’s plan session when present, friends’ shared activities when present, and the 14-day distance chart when distance exists. Setup and tools follow. Training details remain in Progress and Activity; home does not show empty training cards or zero-distance charts.

Today has one primary Log food action and direct Describe, Snap, Scan and Usual shortcuts. They use the existing food logging paths and the expected meal; no extra meal form is required. The calorie hero shows calories remaining, with eaten and goal underneath. Without a goal it shows eaten totals and optional Set a goal. A completely empty log starts with an invitation, not zero totals. One macro bar has text equivalents for protein, carbs and fat. Today’s workouts link to their owner’s activity and label estimated calories. The next empty meal offers a preview of yesterday’s foods before logging, using the existing offline-capable entry path with Undo after an online save. Food is never added to the friends feed.

### Shared logging and Progress — #122 Workstream C (superseded by #164 below)

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

The earlier food-only Ask Kit prompt is superseded by the shared Kit conversation (20 October 2026; current standard below). Saved answers and reviews remain readable; a new question opens the shared conversation. Proposed meals still require the explicit review and confirmation sheet, and unknown nutrients remain unknown.

Evening food summaries, their settings/shortcut and optional daily Kit advice were retired on 20 October 2026. New notes are not generated; historical notes remain readable/exportable. Nutrition insights start through Kit on Nutrition.

Connections now leads with Garmin Connect (when the server has Garmin keys) and Apple Health status and Connect/Manage in the iPhone app, then Upload files. Health Auto Export remains under Advanced for power users; intervals.icu and the Garmin Personal API key were removed on 23 October 2026. A watch is optional. Garmin Health sharing can be delayed and excludes GPS tracks; on your own Health-sourced outdoor workout without a route, Add the map explains Garmin Connect website → activity → settings gear → Export Original, then uploads the original ZIP/FIT through the existing importer. Matching sport/time/distance enriches the existing activity and keeps user edits; other recordings remain separate. No provider connection is required.

Nutrition insights distinguish logged food, a rough burn/energy model and recorded scale trends. A discrepancy names water changes, missed or underestimated food and burn-estimate error, then points to the weekly check-in; agreement is described as broad consistency rather than proof. Weight text uses the account's units. No per-bodyweight advice is inferred from a fallback weight. Energy captions identify Apple Health resting + activity, imported daily burn or formula sources, and never equate being under the food goal with a measured deficit or modelled energy with actual fat loss. These wording changes do not alter targets, calorie arithmetic or Health's passive-only rule.

## Weekly check-in with explicit target acceptance (#122 G)

This supersedes the former rule that the measured check is never used for targets. Me and Progress share a deterministic weekly check-in, with no AI or watch dependency. The last 28 completed days need at least 7 sufficiently complete food days and 3 weigh-ins spanning 10 days. Today, very partial food days and days with unknown calories are excluded. The existing intake/weight-regression method infers daily burn; it is labelled as inferred, compared with the formula estimate and explained with water/logging/scale uncertainty. The card shows average intake, weekly weight-trend change, inferred daily burn, sample counts, period/as-of date and the calorie suggestion. Calories round to 5–10 kcal and weight to 0.1 in the account's units.

The saved goal and 0–1% weekly pace shape the suggestion, with the unrounded estimated resting burn as a floor. Accept alone changes the calorie target; macro targets, per-day overrides, activity setting and resting-source choice remain as set. Accept revalidates the displayed baseline; changed records/goal require another explicit tap on the refreshed suggestion. Replay cannot overwrite a later manual target. Not now hides Me's card until the next local Monday, with the decision/history still viewable in Progress. Accepted/deferred snapshots do not silently change; old weeks cannot apply. The most recent eight weekly records are available in Progress. New personal storage has owner RLS, export and account-delete cascades.

Me shows only a pending actionable check-in, demoting its Log food button to the shared quieter style while Accept is the one primary action. Logging remains directly available. On Progress, insufficient data shows one useful action (choose goal, log food or log weight), not empty statistics. How this works opens a plain explanation. Failures preserve the prior target and offer retry; account/session guards cover delayed reads/actions. Adult-only goal suggestions use the same safety policy as setup. Physical iPhone text/VoiceOver/touch checks remain separate.

Me's setup hints recognise any of the person's own saved food history as well as workout history, even when today is empty. The first-food/friends introduction stops after either kind of history exists. Food and activity responses may arrive in either order; setup redraws from the latest scoped results. Optional Apple Health remains visible on iPhone until enabled, and a setup heading never appears without rows. Shared facts/AI readers are unchanged; the extra history flag is on the authenticated HTTP day response only.

### Recipe links: fetch/parser foundation (#122 N1)

The server has an unexposed, bounded public-HTTPS reader and JSON-LD Recipe parser; this does not yet add an import button. The following review flow must show an editable My Recipes draft before saving, label site-published per-serving nutrition, preserve unknown values and ambiguous servings, and offer the existing screenshot path when structured data is absent. Multiple recipe candidates need an explicit choice. See [recipe-links.md](recipe-links.md) for the safety boundaries and pending integration.

### Recipe links: authenticated drafts (#122 N2)

An explicit authenticated recipe-link read now creates only a private parsed draft and deterministic own-food matches. Reopening/retrying its identity never refetches or logs food; discard prevents late responses from restoring it. Reads are capped per person and drafts expire. There is no new UI yet: the next slice adds candidate choice, editable My Recipes review, explicit save and source labels. A page with no schema offers the screenshot/typed-ingredient fallback. See [recipe-links.md](recipe-links.md).

### Recipe-link review/save foundation (#122 N3)

The authenticated draft API now separates Review from Save recipe. Review recalculates own-food matches and shows whole-recipe/per-serving values with per-nutrient site, matched-ingredient, entered or unknown sources. Save requires the displayed baseline and an explicit confirmation; changed source foods require another review/tap. Saving never logs food. Imported recipes remember their reviewed serving count; one logged serving is that fraction of the batch. Ordinary existing recipes keep their whole-meal serving convention. Unknown calories prevent logging; absent macros carry unknown flags rather than becoming recorded zeros. There is not yet a user-facing import screen; its UI and screenshots follow in N4.

### Recipe-link phone review (#122 N4)

My Recipes has a labelled Recipe from a link action. The path is Read → editable recipe draft → Review nutrition → explicit Save recipe; ingredient/name/serving edits stay on-device until review and no step logs food. Multiple candidates need a choice. Review separates per-serving amounts from whole-batch yield, labels each nutrient's site/matched/entered/AI/unknown source, and makes unmatched ingredients optional when site numbers are used. Unknown calories offer Save for later with a subsequent Add nutrition action rather than a zero statistic or a log button.

Link reads, draft recovery, stale-review rechecks and lost-acknowledgement save retries remain bound to server/account/draft identity. Delayed responses cannot restore a discarded or replaced draft. The source card, library and portion sheet use the reviewed serving count. Photos use the existing reviewed image/estimator path but create a held recipe draft, with an explicit serving count and AI portion assumptions; they never auto-log. Optional ingredient estimates require a separate explicit confirmation and use only unresolved lines. The form is skippable, scrollable with the keyboard and usable at330/390px in either theme with large text; physical iPhone acceptance remains separate.

Recipe portion logging now gives immediate Saving feedback, an offline pending row and toast Undo for both sent and queued portions, plus the existing light native haptic. Cancellation is durable and owner-bound; delayed uploads cannot resurrect the food. Read/import controls remain secondary to logging in My Recipes, with manual Create reduced to a labelled text action.

### Extra nutrient storage/source foundation (#122 O1)

Sodium (mg), total sugar (g) and saturated fat (g) now have nullable food/custom/known-recipe storage and optional profile limits, unset by default. Source mappings and authenticated direct food APIs preserve unknown versus reported zero. Day coverage reports the recorded subtotal with known/unknown counts, never treating a partial subtotal as complete intake. There is no new UI yet; pipeline integration and collapsed detail/day/Overview controls follow. No energy algorithm or AI recognition schema changes. See [nutrients.md](nutrients.md).

### Extra-nutrient logging pipeline (#122 O2)
Recipes, imported published nutrition, logged portions, food chat, manually entered thread foods, learned catalog foods and corrections preserve sodium (mg), total sugar (g) and saturated fat (g). Unknown stays unknown through receipts and Undo, including calories-only recipes with missing macros. Existing five-field AI schemas remain unchanged, so they do not provide the extra nutrients. No new taps or UI controls in this backend part; the food detail/day/Overview controls follow separately.

### Optional nutrient detail (#122 O3)
Sodium (mg), total sugar (g) and saturated fat (g) live behind a shared More nutrients disclosure on the daily card and portion detail. Daily totals are folded on entry; unknown values read Unknown, reported zeros stay zero, and mixed coverage shows Known subtotal · incomplete with the count of missing foods. Overview shows recorded totals for the selected range, explicitly separate from daily limits. No percentage/progress/within-limit claim is made from incomplete data. Empty days do not add an extra zero-stat card.
Manual food, quick add, thread numbers, recipe totals/import review and food edits use the same unit labels and blank-for-unknown rule. Existing source/AI/Edited labels remain visible; changing a portion and offline reuse carry all fields without filling missing macros with zero. Optional daily nutrient limits start blank, appear under their own disclosure in Daily targets, and are saved only by Save targets; they never change calorie goals. Common logging tap counts stay unchanged. Food detail adds one disclosure tap; limits take open targets → disclosure → Save after typing. New controls use scalable text and44px targets. Browser330/390light/dark and28px evidence is separate from iPhone Dynamic Type/VoiceOver acceptance. Existing label AI still supplies only its reviewed five-field schema; additional label values can be typed manually, and recognition expansion remains gated.

### Weekly food review (#122 Q)
Overview leads with a code-only review of seven completed local days; Kit's optional review stays separate. The count means days with any food entry, while energy tiles now say Days used in estimates. Dates, recorded-only scope and missing-data limits stay visible. Protein by meal, fiber/extra nutrients and top calorie sources use shared folded detail; one or two own-data suggestions stay plain and optional. There is no competing primary action or empty zero-stat review card. Numeric totals are explicitly weekly, never daily averages or inferred intake. New text/control sizes scale with root text size; disclosures use44px minimum targets and existing colors. Late account/view responses are ignored; failed refresh preserves existing records and offers Retry. See `docs/weekly-food-review.md`.

### Shared recipes (#122 J)
Saved/cooking recipes expose optional Share with… inline; the duplicate Meal options action is removed. Only approved friends can be chosen, identities wrap, each row says Share or Stop sharing, and Done is the sheet's single primary action. Recipients see Shared with you before their usual foods and at the top of the food-chat composer. Shared recipes use a compact horizontal list and the existing portion sheet, so default logging is two taps and includes toast Undo. The optional empty-chat introduction yields space when shared recipes are present; large text keeps the message field/Send above navigation. Full recipe and owner names appear in the portion sheet before logging. Native sharing confirmation uses a light haptic with visible text. Current permissions guard discovery, logs and notices; stale chips explain revoked sharing. No food log is shared. See `docs/shared-recipes.md`.

### Apple Health weight input foundation (#122 I1)

Weight reading is a separate, optional category, off by default. The authenticated backend requires an explicit confirmation before accepting an owner-bound Health sample batch. This foundation does not yet expose a permission button or run HealthKit queries; the native setup follows separately.

A Health UUID identifies an immutable measurement. Keep one latest measurement per profile-local day, label its source, and give existing manual/imported points priority. Empty reads mean unknown, never zero or deletion. Explicit Health deletion tombstones prevent replay; deleting a Kinetta day excludes older Health measurements for that day. A later measurement remains eligible. Turning sync off preserves private source samples, removes Health-derived projected points and invalidates in-flight batches. Deleted sample identities stay excluded across time-zone changes; manual re-entry lifts the local-day fence. Time-zone changes rebuild Health days and invalidate older batches too.

Imported weight feeds existing weight/energy/check-in calculations without changing budgets, macros or the selected resting-calorie source. Health-derived profile weight retains its provenance. Earlier workout/resting AI permission cannot authorize this new weight category: generic Health-dependent AI stays blocked until explicit weight consent is also recorded. Food-only tools remain restricted to food.

### Apple Health nutrition output foundation (#122 I2)

Writing food to Health is a separate confirmed opt-in, off by default and independent of weight reading. The backend journals every changed food day, including edits, moves, Undo and deletion, for the native client to reconcile. Output covers dietary energy, protein, carbs, total fat and fiber only. Each known value is the complete recorded total for that nutrient; missing/partial values remain unknown, and known zero stays zero. The log may still be incomplete even when every recorded entry has a value. Never describe this as measured intake.

A day with no entries is a deletion instruction for this app/account's own Health samples. Re-enabling or changing time zone refreshes all current and previously journaled dates, including deletion-only days. Day intervals use the profile's local calendar, including daylight-saving changes. Settings epochs fence stale fetches; owner-serialized revisions prevent cursors from skipping earlier uncommitted edits. The native client must acknowledge a cursor only after successful Health reconciliation and recheck account/settings before every write. This backend foundation itself does not write to Health or request permissions.

### Native Health bridge foundation (#122 I3)

Separate read-weight and write-nutrition permission methods never run automatically. A signed-in account binds all operations; logout/disconnect must await stop before replacing the account. Weight anchors advance only after server acknowledgement. Nutrition cursors advance only after successful operations for permitted types; show blocked types honestly, and reconcile history if the permission set changes. Use stable opaque account/day/type identifiers, revision-based replacement and app-owned/version-bounded deletion. The protected local state contains no credentials. UI controls and rendered source labels follow in I4; physical-iPhone acceptance stays pending.

### Optional Health setup and source labels (#122 I4)

Health setup leads with Nutrition to Health and Weight from Health, each off by default with its own explicit system permission action. Workout import remains independent, with details folded. All category actions are quiet; Done is the single primary action. Setup is skippable, reopening resumes current settings, and an existing weight/nutrition/resting connection counts as a Health setup connection. No new launch prompt.

Each category shows status, Sync now, Turn off and a direct Manage Health permissions action. Weight copy never claims an empty read means permission denial. Nutrition names the allowed/blocked types when grants are partial. Open/resume/online catch up; acknowledged food changes schedule nutrition reconciliation, including queued logs, recipes, chat, edits and Undo. These optional categories have no new background-delivery promise. A failed weight read does not block nutrition. Off stops the native bridge before changing server preferences; disconnected failure explicitly says this iPhone has stopped and the server setting still needs a retry.

Server/account/token/settings checks precede every read/upload/write/ack. Native stop precedes logout, account deletion and account/server replacement, and account deletion clears the protected local cursor file. Apple UUIDs are compared case-insensitively with server-normalized UUIDs before acknowledging a weight batch. Successful imports refresh the current profile without replacing the live composer. Source labels appear on current and historical weigh-ins; updating a Health point explicitly becomes manual. Kit consent names workouts, selected resting calories, weight and the configured AI provider; a newly enabled weight category cannot inherit old consent.

From the Health page, Read weight or Share nutrition then Apple's Done is two taps excluding individual system permission choices; the app's Done returns to Connections. No change to food targets or resting-energy source. Native behavior in browser review uses labelled stand-ins; permissions, real Health samples, lock behavior, VoiceOver, Dynamic Type and cross-device Health reconciliation still need a physical iPhone.

### Optional logging reminders (#122 K)

Meal-time reminders are a separate explicit opt-in, off by default, under Settings → Notifications and linked from Nutrition. They use native APNs only, require the existing server/device setup, and are easy to turn off even if that setup later becomes unavailable. No launch prompt, automatic subscription or guilt streak. Show the person's proposed usual times, with unavailable patterns described as building rather than invented. Fold the explanation behind How times work.

Learn from the first same-day daytime log per meal on each of the last28 completed profile-local days; at least3 distinct days are needed, rounded to15 minutes. Late past-day imports and night-time logs cannot create an artificial daytime median. Reminders only run7am–9pm, within5minutes after that usual time, and skip a meal already logged. One attempt per local meal/day prevents duplicate alerts across retries/workers. Current preference, logged meal, device/session ownership, quiet hours and claim age are rechecked before delivery. APNs expires optional reminders in5minutes; an already delivered alert cannot be recalled. Lock-screen text contains only a generic meal invitation, with no food, calorie, target, weight or Health details; no feed/bell row is created.

The current empty meal in today's Nutrition log offers Same as yesterday and Your usuals; other dates/meals stay quiet. Use the profile's timezone for the meal guess. Yesterday is a preview and needs an explicit Log this meal tap, preserving all8 nutrients, sources and unknown/zero values. Existing online toast Undo remains. The weekly days-logged count is the existing private Your week in food review; no competing streak tile. Physical APNs delivery remains pending #98 configuration/device acceptance.

### iPhone quick action and Shortcuts food entry (#122 T1)

Signed-in iPhones offer Log food from the home-screen app menu. It opens the same permanent food chat and requests composer focus; an existing draft stays intact. The Log food in Kinetta Shortcuts/Siri action takes text, requires device authentication and opens the app for review. It never sends or logs automatically. Physical keyboard/Siri behavior still needs an iPhone.

Native requests live only in a protected, backup-excluded app-container inbox scoped to a hashed server/account. Limit5 requests and4,000 UTF-16 text units; discard expired requests on the next read after24hours. Sign-out/deletion/expired login clear pending native entry and remove the dynamic action. Cold actions can stage under the last signed-in scope, but current server authentication and matching owner are checked before inserting text. Missing/unverifiable login retains or rejects the request without a food write.

Shortcut text appends to an existing draft without truncation. If the combined draft is too long or storage fails, keep both the existing draft and native request. Save text and accepted request IDs atomically in one owner-scoped draft record before acknowledging native delivery, so a lost acknowledgement/reload cannot duplicate the text. Retain accepted IDs when the message is sent; older plain-text drafts still load. No auth token or Health record is shared with another process. Share-to-Kinetta is a separate T2 implementation; this PR makes no share-extension claim.

### Supplied nutrition numbers in food chat (#122 D12)

Typed calorie/macro/nutrient clauses are nutrition facts to review, never separate food names for catalog search. A clear whole-portion statement becomes a Your numbers preview with the supplied values, including gram/milligram conversion, known zero and missing-as-unknown. It always needs an explicit Log tap, even with automatic logging enabled. Review numbers opens the shared, prefilled nutrition form without saving; the person's current day/meal is visible and editable. Ordinary quantified protein bars, protein powder, brown sugar and other foods retain their normal lookup path.

Duplicate/conflicting values, malformed/out-of-range/negative numbers, ambiguous decimal separators, unsupported energy units, per-serving/per100g bases, missing calories and another food after the numbers stay held. Preserve the original text and usable values; ask for a whole-portion review without sending macro words to a provider. A day/meal ambiguity must be explicitly resolved on the card before manual save. Resolver retries cannot turn a held numeric card into an automatic log, and catalog/portion choices cannot bypass its numbers review. Questions and existing corrections still route first.

No model, prompt, provider request, new table or target change is involved. Explicit save/reply/food rows commit together, source labels stay Your numbers, missing values do not become zero and existing Undo/replay/account protections apply.

### Undo for deliberate food uploads (#122 D13)

Quick numbers, usual foods, amount review, combinations, yesterday's meal and Log again return an Undo action after saving, including when queued offline. Undo cancels the original stable upload IDs in one account-scoped transaction; delayed retries through either current or older clients cannot recreate removed food. An intentional new log receives new IDs. Pending cancellation is saved before the original queued upload is removed, and a storage failure leaves that upload intact with Retry. Other accounts and unmatched items in a batch are preserved. Existing durable food-chat card Undo remains available after the toast ends. No migration, model or target change.

The offline/pending banner occupies document space above the page, with a rectangular shape that accommodates large text. It must not cover the heading or first controls.

### Food and activity together (#122 R)

Me and both Progress focuses share one private, folded summary of the last7 completed local days: workout count, distance, moving time (elapsed fallback), days with any food and days reaching the current protein target. Unknown protein is counted separately. Logged days are not described as complete, and a current-target comparison is not a historical adherence claim. No AI or writes happen on open.

Own activity detail links today's workout to its food-log energy number. Recorded calories take precedence over the existing distance/time estimate; imported daily burn is never incremented again, and missing Health resting calories keep total burn unknown. The food log links back to those same workouts even before any food is entered. Targets and resting-source choices remain independent. The friends feed receives no food information.

My activities shows optional Health sync status, latest successful native/foreground sync, pending uploads and Retry/Manage. Returning to the app catches up after a15-second rapid-event bound instead of waiting10minutes; quiet polling remains bounded. Sync never asks for permissions on launch. Garmin source delays and absent Health maps are explained. These are import improvements, not new recording features. Physical locked/background/poor-signal/offline recording acceptance remains required.

Empty combined weeks explain what food consistency and workout metrics will show, with a quiet Log food link. They never render zero distance/time as filler. Missing workout calories are labelled unavailable, and displayed energy is rounded to5kcal; new fold/Manage/retry controls keep44px minimum targets.


### Native food-share durability foundation (#122 T2)

Food Share jobs use immutable owner-bound UUIDs and a protected, backup-excluded local queue under a process-shared lock. Credentials live only in a separate device-only, unlocked Keychain item. Explicit jobs survive overnight and interruption; late acknowledgements and account changes cannot cross owners. Images commit before their checked metadata. No app/extension runtime path, entitlement or Share UI is enabled in this foundation. See [food-sharing.md](food-sharing.md); UI/runtime and physical-device acceptance follow separately.
Nutrition insights show recorded totals and chosen targets without generic recommendations based on fallback weight.

Weekly check-in GETs use a read-only transaction and return an unsaved preview. Only an explicit Accept or Not now materializes a private decision row. The preview ignores today’s weigh-in and excludes unknown-calorie days through the shared energy reader; replaying a saved decision is successful even after a new week starts.

Recipe reads hold a dedicated database session advisory lock, with no open transaction during network work. Polling only marks an interrupted pending read after the bounded fetch/matching period when its worker lock is gone. Matching has a 20-second bound and two-second statement limit, reuses the own-food preview, and retains minimal choices/nutrition only. Busy/timeouts are retryable with the same identity and do not use the UTC daily allowance. Discard clears URLs and content; a five-minute maintenance pass removes prior-UTC-day draft/rate identities. No schema migration was rewritten.

Imported recipe portions preserve missing nutrients through ref.unknown_nutrients; day totals, insight rows, Kit facts and the check-in energy reader honor that contract. The current Health module has no nutrition-export endpoint; the later I2 implementation must use the same unknown-aware readers. Serving arithmetic uses api_dishes.serving_count, including Kit candidates and recipe review context; the public dish response and portion-sheet preview expose/use that count. The legacy integer column remains compatibility storage for ordinary whole-meal recipes; imported fractional counts are in recipe_source.

Recipe review corrections: source labels share one server helper and one client map, including remembered AI identity. Imported weightless ingredients can be assigned their first weight without rescaling known nutrition or marking the site recipe changed; nutrition-value/ingredient-identity changes do mark it. A saved recipe offers an explicit, confirmed Leave this line out action for pending ingredients, then recomputes ingredient totals. Estimate keys always hash canonical cleaned text. Portion cancellation completes any legacy pending receipt and uses its normal Undo, preserving one original card; ordinary portions still create no chat receipt.

Shared-recipe review corrections: recipients use an owner’s recorded serving split; without a weight or split, they must explicitly choose a fraction of the whole recipe. Sharing controls stay available after nutrition is removed, and Add a friend closes the sheet first. All non-owner item views omit private source refs/memory keys while deliberately shared ingredient names/nutrition remain visible. Compact discovery joins owner names in one query. Reused recipe portions retain their recipe identity; other recent foods retain known gram references and their original logged unit, with no invented one-gram serving.

Health nutrition sharing starts on the first enablement day in the account time zone. Also add older days is a separate, explicit choice; native back-fill follows only that selected scope. Re-enabling retains the scope to reconcile prior writes. Each nutrient still requires a known value for every logged food that day, including fiber. Native sample identifiers use the server-issued stable opaque Health account ID, independent of domain aliases and settings epochs.

Native Health review: stable server-issued account identity avoids duplicate nutrition across URL aliases. Page writes batch saves and typed deletions; status waits for the active write. Corrupt saved state restarts safely, filtered forward cursors are accepted, and ignored out-of-range weight identities are excluded from later deletion uploads. No default historic back-fill: the server controls the explicit today/older scope. Physical equal-version replacement and permission/background tests remain pending.

Health session review: deletion first pauses uploads while preserving setup; a rejected password resumes the same setup. Confirmed deletion runs all local cleanup steps independently. Expired sessions pause Health without awaiting callbacks or clearing opt-ins. Logout stops once through native forget with bounded independent cleanup. Disconnect stops locally before server preference updates; owner-scoped pending updates retry online. Manual weight sync follows an in-flight nutrition-only pass, per-kind errors persist, and only food invalidation schedules nutrition sharing.

Reminder review: each account claims immediately before its own delivery in an isolated transaction; a corrupt profile cannot block others. Validate stored zones with a safe default, skip quiet hours before history work, cache timing per account/local day, and hold only the device lock during delivery. The shared native delivery boundary preserves session/account transfer and invalid-token handling. Reminder links retain their explicit meal even across a meal-time boundary. Browser notification guidance points to the iPhone app. Pure timing filters remain defensive for standalone callers.

Native food-entry review: session expiry/failed sign-in pause delivery without clearing the owner-bound inbox; the same account can stage a draft offline and posting still requires authentication. Deletion pauses setup until the password succeeds; logout clears once after the unsent-message warning and successful local chat erasure. Separate expiring receipt journals prevent Shortcut replay or a full-storage failure from restoring sent drafts. Oversized entries are skipped with feedback so later entries continue. Corrupt inbox contents recover; locked files remain retryable. Share to Kinetta photo/link extension remains deferred T2/T3 work, not delivered by this PR.

Activity/food review: known protein that already reaches the target counts as reached even with an unknown side. Daily burn is shared without loading complete food/chat detail. The native sync disclosure updates text in place; progress reads no Preferences, manual imports refresh the list, and completion timestamps prevent immediate render-triggered resync. Past and other-owner activities do not fetch the current-day food link; the food card keeps one workout breakdown.


## Activity-first home and original tabs (owner decision 18 October, #164)

This supersedes the home, navigation and Progress parts of #122 B and C, and the food-on-Me parts of G and R. The
nutrition features themselves are unchanged. **Keep it simple:** each feature has one obvious home, and people who
don't track food don't see food outside the Nutrition tab.

- **Tabs:** Me · Activity · Track · Progress · Nutrition, as on 16 October. No shared ＋ Log tab or sheet. A live or
  paused recording marks the Track tab, and one tap returns to it. Weigh-in lives in Nutrition → Weight (the weekly
  check-in keeps its own Log weight shortcut).
- **Food user:** a calorie goal, or food logged in the last 14 local days (`food_user` on `/api/me` and
  `/api/food/day`; food logged today also counts on Me). Anything else is not a food user.
- **Me:** greeting, the 14-day distance chart, latest activity, then **Your day**: the training plan card (or a
  Training plan row), and for food users a compact Food today card (Eaten, Left/Over or Goal not set, Protein, a goal
  bar) with a single Log food button, and a pending weekly check-in. Food users also get the folded food & training
  week. Then Friends recently, setup, goals and Fitness & freshness. No Describe/Snap/Scan/Usual row, Same as
  yesterday or workout calories on Me; those stay in Nutrition. New-account setup suggests Apple Health, recording an
  activity and finding friends, never a nutrition goal.
- **Progress** opens on Training. Only food users see the Food & weight / Training switch and the food & training
  week; their last choice is remembered per account on this device. Explicit `/progress?section=food` links still open
  and show the switch. Food progress also remains in Nutrition.
- **Food entry points:** the Nutrition tab (main), the single Log food button on Me for food users, and the optional
  iPhone quick action/Shortcut and meal reminders, which are off unless turned on.


## Clarity pass (18 October, after #164)

Small changes so each screen says what it does, keeping the simple, one-home-per-feature rule:

- **Track** offers one-tap Run, Ride, Walk, Hike and Lifting buttons in one row above the All activities list (the full
  list keeps every activity and stays in sync). The Connections row says what it covers.
- **Nutrition** has one clear My recipes & foods link under Add food instead of a run-on line of four links. Meal
  reminders live in the More menu (they also remain under notifications). Someone with no food history and no goal
  sees a three-step Start your food log card instead of a card of zeros. Same as yesterday, Your usuals and Copy
  yesterday appear only once there is food history. With no usual daily target, Set goal opens the full goal setup.
- **Food chat** names its search tool Search foods.
- **Progress Totals** shows at least eight weeks (or six months) on the chart, so a first week is a normal-width bar.
  The added periods are chart-only; averages, bests and the table use real periods.

## Food chat, simplified (18 October, owner: "busy and messy")

The food chat should feel like a quick messaging app. This supersedes the earlier food-chat layout notes where they differ;
behaviour (outbox, choices, Undo, corrections, daily note, Kit) is unchanged.

- **Chat mode:** no bottom tab bar while the chat is open. A small header has ‹ Nutrition (the way back), the title and a
  ⋯ for chat settings. A "Logging to …" line appears only when the chat was opened for a specific meal.
- **Messages:** your messages are right-aligned neutral bubbles, a grey clearly darker than the page in both themes (23 Oct 2026: the soft token nearly vanished on the light page); the per-message time is for screen readers only and day
  headings show the date. Replies are simple cards: each logged food is one row you tap to edit, with calories on the
  right; several foods get one total; Undo is a quiet link; ⋯ holds Correct in chat and Delete message text. A reply with
  nothing else to do keeps ⋯ beside its text. Waiting/offline status is a small line under the bubble.
- **Composer:** one rounded bar: +, the text field (grows to a few lines) and a round send arrow. Everything else (Snap,
  Photo, Scan, Search, Usuals, Recipes, Paste, the one-tap usual and Daily note) lives in the + menu as plain icon tiles (no circles), which
  closes when you type or pick a tool. Transient "Saved" messages clear themselves.

## Me as a landing pad (18 October, owner)

Me is a simple landing pad: the greeting, high-level stats (the 14-day chart), then six icon shortcuts with small round
icons to places one level deeper than the tab bar, never repeating a tab: Plan, Fitness, Records, Routes, Goals and
Friends (with a friend-request badge). Plain green icons, no circles behind them (owner, 18 October). Friends and Goals moved here from the list lower on Me. Then the latest activity. **Your day**
appears only when it has something: an enrolled plan, or food logged today (its compact card and any pending weekly
check-in). Nobody sees a food card on Me for a day with nothing logged; the food & training week also needs food today.
Friends recently, setup, goals and Fitness & freshness follow. The Plan shortcut replaces the old Training plan row.
Bottom action bars such as Start this plan are pinned above the tab bar and the page reserves room for them.


## Quick food log versus reusable recipes (18 October 2026)

Add food offers **Log food now** (Describe, snap or scan · Today) and **Create a Recipe**
(Build once, save for later). Quick logging starts a fresh conversation on every visit; the
previous conversation is not reopened. Already logged food stays in Nutrition. Durable pending
messages remain visible until sent or cancelled, including after leaving or reloading. New
quick-log messages default to the local day when sent, regardless of the Nutrition date or an
old link's date. Explicit correction controls remain available on logged food. Recipe creation
stores a reusable ingredient list; logging a portion is a separate action from My Recipes.


## Compact reactions and navigation clarity (19 October 2026)

One reaction action replaces the three permanent buttons in feed cards and activity detail. Tap sends Cheers or removes
the selected reaction; hold, desktop hover, the adjacent choice button or Arrow Down reveals a floating three-choice
picker. Selected icon and label follow the person's reaction. Opening the picker never writes. Each person still has
one reaction, count taps show the people list, failed saves roll back, and old-account or detached controls cannot write.
Keep labels, 44px targets, arrow-key choice navigation, Escape/focus restoration and no selection on scroll/dismissal.

On Me, the fourteen-day chart leads, followed by the latest activity and conditional Your day, then six smaller shortcuts.
The shortcut destinations and five tabs stay stable. Progress keeps its Training default and optional Food & weight focus,
with the focus choice in a compact labelled header menu. Track keeps five common sport choices; More activities reveals
the full list and a non-common selection stays named. Start comes before the smaller preview map; indoor visits do not
initialize a hidden map. Cache the recent lifting-session read briefly with the shared account-bound cache and retain
mutation invalidation. Nutrition keeps its goal action/macros visible; secondary goal explanations and resting-source
links live inside the existing energy breakdown when that breakdown is available. No target, privacy or recording
algorithm changes belong to this clarity pass. Physical iPhone interaction/performance acceptance stays separate.


## Smaller reactions and calmer type (19 October 2026)

The reaction chooser is a 146 × 54px icon strip at its default size, with three separate 44 × 44px
choices and 22px icons. Names appear on hover/keyboard focus and remain explicit accessible names; the selected
reaction still names itself on the main action. Keep the hold/slide, visible chooser and keyboard paths, count-to-people,
rollback and owner guards. Do not turn it back into three labelled tiles or shrink its touch targets.

App-only typography tokens reduce repeated display emphasis across Me, Activity, Progress, Nutrition, plans,
profiles and sheets: 30px page / 20px section / 18px card / 28px hero figure / 20px secondary statistic.
Cards use 14px padding and 12px separation; Me's decorative chart bars are shorter and latest-activity/day gaps tighter.
Body copy, privacy/source explanations and tab labels stay readable; inputs are at least 16px and grow with rem text.
Metric grids may wrap into fewer columns at enlarged text sizes. Live recording readouts retain their glanceable size.
The generated shared theme contains these app-only tokens; marketing does not consume them.

Research basis: [Facebook's published hold/hover pattern](https://about.fb.com/news/2016/02/reactions-now-available-globally/),
[Messages Tapbacks](https://support.apple.com/en-ie/guide/iphone/iph018d3c336/ios),
[Slack's three quick reactions](https://slack.com/help/articles/360056881694-Manage-one-click-emoji-reactions-for-your-workspace-or-organization),
and [Apple's target/readability guidance](https://developer.apple.com/design/tips/). These support a short icon chooser
and generous hit areas; Kinetta's exact dimensions and type scale are product decisions, not measured competitor sizes.


## Keyboard dismissal and short food descriptions (19 October 2026)

Do not add an app-supplied Done strip above the keyboard or reserve space for one. Keep the
software-keyboard tab visibility and visible-viewport sizing. Tap blank space/message text above the
keyboard or swipe down outside the input to dismiss; do not consume actions on buttons, links,
other fields, map/photo gestures or text selection. Native interactive scroll dismissal remains enabled.
Safari may display its own system accessory controls; those are not app UI.

This is the standing interaction standard for new and revised Kinetta flows. Preserve drafts,
keep the focused composer visible, and keep input text at least 16px to avoid focus zoom.
Food chat should ask a short, specific question about missing identity/type or quantity, carry
forward answered details and the original meal/day, and preserve source review, explicit
confirmation, account boundaries and retry safety. Never substitute catalog jargon for a helpful
question or invent nutrition. (Missing amounts: superseded below, 19 October 2026 — with AI estimates a
typical portion is assumed and stated.) Preserve valid saved-food matches. Verify dismissal,
visible input and drafts at phone width in both themes; cover successive food replies and retries
with regressions. Prompt/model changes still follow the AI architecture and evaluation requirements.

The implemented regression below covers a bare taco; it does not establish that every ambiguous
food description already follows this standard.

A new, unresolved bare “taco” asks its type and count before choosing a generic catalog food or
estimate. Existing exact saved foods retain their usual behavior. Count and filling can arrive in
either order; continue the food description, retain its original meal/day, close the earlier pending
question, and never invent a count or nutrition. Unrelated foods remain separate. Preserve specific
clarification wording instead of replacing it with a generic “remaining items” question. This is
deterministic routing/copy; no prompt/model change or model-accuracy claim.

## Food entry, named ingredients and recipe completion (19 October 2026)

Nutrition has one Add food action. All new food and recipe creation uses the same conversation and capture
tools. Enter ingredients first; manual, search, usual and saved-recipe picks stay in the draft. The final
**Review food** sheet offers **Save as a recipe for later** and independently **Log food today**. Only then
ask for a recipe name and explicit serving yield or whole cooked weight. No new food is auto-logged by
Send, even if an older client enabled auto-log. Existing recipe editing, imports and sharing remain available.

The + menu's Manual tool opens **Manually add a food**. Ask for its name and the nutrition of the actual
amount being added. Weight is optional; keep unknown nutrients and weight unknown. Store the named food
as an ingredient if a recipe is saved. A missing ingredient weight prevents a partial sum from being
presented as the whole cooked weight; an explicit cooked weight remains available.

The entered amounts are the default amount to log; do not ask users to repeat quantities they already
supplied. If they ate a portion of the recipe, choose servings or cooked weight and enter the yield and
amount eaten separately, with a nutrition preview. Meal is blank unless explicitly chosen earlier.
Saving without logging is supported. Recipe creation, log entries and their receipt commit together after
one explicit confirmation; retries cannot duplicate either. Changed source numbers require another tap
after showing the new values. Reload/navigation preserves unfinished ingredients and unsent text. Offline
confirmation waits durably and prevents adding more to that draft until acknowledged. Existing recipes
retain their legacy serving arithmetic until an explicit new yield is entered. Manual additions focus the
food name first when it is missing. Invalid numbers stay in that form with a labelled inline error, never
an uneditable retry queue. Recipe-link, extra nutrient and quick weigh-in fields retain a16px minimum.
Review preparation shows progress and blocks duplicate requests. An in-flight confirmation blocks new
capture even after the review is closed; keep the next unsent text. Completed receipts carry their linked
food rows, destination, saved-recipe acknowledgement and Undo, including replay and reload.

Food writes invalidate pending reads and notify a visible Nutrition log to reload, including delayed
conversation acknowledgements received after navigating away. Coalesce refreshes and guard the current
account/page; preserve active chats, offline queue identities and drafts. Portion saves and Undo update
the visible log without requiring another login. Browser checks cannot prove physical iPhone behavior.

Short unknown foods without an amount ask for quantity before catalog/model resolution; simple mixed
categories (taco, burrito, sandwich, salad, soup, curry, smoothie, pizza) ask for type too. Ready parts of
a mixed message stay in the draft while unresolved parts ask their own questions. Quantity-only replies retain
the original meal/day; unrelated foods remain separate. An exact saved food still asks for its amount if none was supplied; explicit learned-usual requests
keep their established quantities. Long descriptions, photos and source/portion review use the existing paths.
Ingredient chat requires a known remembered amount or explicit weight before a new estimate; ambiguous
corrections ask which ingredient. Model actions cannot silently change supplied weights or choose a
different correction target, and estimated household units are not learned from model-invented counts.
Existing consent/access/budget checks, public food catalogs and AI estimates remain; this does not add
web grounding, change model prompts or establish model accuracy. Broader semantic ambiguity still
requires reviewed real-provider evaluation under the AI architecture rules.

## Color roles and compact screen hierarchy (19 October 2026)

Keep the approved Sky Blue identity. There is no category requirement that a fitness or food app use a
particular hue; Kinetta's palette is a brand choice. Readability, consistent roles and meaningful states determine
whether it works. Use brand for navigation/actions, neutral text for ordinary numbers, named sport/macro series for
charts, and labelled warning/error states for actual problems. A calorie surplus/deficit is a signed, named quantity,
not a diagnosis or a moral judgement. Never make color the only way to understand a value, selection or chart.

Use 4.5:1 contrast for ordinary text, including placeholders, across the surface where it actually appears; large
text may use the WCAG 3:1 exception. Required control boundaries, focus and meaningful chart marks need 3:1 against
adjacent surfaces. The `outline` token is for fields; the quieter `divider` token remains decorative. `on-error`
pairs with the error fill; do not put white on the bright dark-theme error color. Selected segments and chips have a blue boundary in addition to their fill. Small chart badges use neutral
text plus a series mark. Calendar dates remain readable for adjacent months; solid food-status marks match their named legend and accessible statuses as well as their colors. Keep labels/direct values and existing
accessible descriptions alongside chart colors. Test real rendered combinations as well as canonical tokens.
The shared generator checks 262 text/action/semantic/outline/chart pairs in light and dark modes.

Light/dark appearances have their own colors; do not invert the entire screen. Map tile treatment is consistent
across preview, live, feed and detail maps; overlays and route strokes retain their own colors. Attribution uses an
opaque theme surface. Isolate Leaflet layers below navigation and use 44px map buttons. Prefer 44px touch targets
throughout Kinetta; WCAG's 24 CSS-pixel AA target criterion has spacing and other exceptions and is a different bar.
Respect enlarged text, reduced motion and increased contrast; compact layouts must not shrink inputs below16px.

Nutrition leads with its existing goal/calorie summary, three labelled macros and meals; more nutrients, energy
sources/breakdown and optional training explanations follow the meal log. Progress keeps Totals/Fitness/Records/More
stable and names the selected deeper view with a heading and selected More indicator. Explore keeps all searchable
help text, with a category selector and expandable feature rows. The admin portal keeps desktop navigation, uses a
labelled section selector on phones, balances metric cards in three/two columns and folds count methodology/daily
rows behind named disclosures. Identity/session details remain available. Food review groups whole-recipe yield
separately from today's destination/portion; its confirmation names the selected actions, follows the required fields and preserves drafts.

Research: [Apple Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode),
[Apple UI design tips](https://developer.apple.com/design/tips/),
[Material color roles](https://m3.material.io/m3/pages/color-roles),
[WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html),
[use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) and
[target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
This is a design standard, not a claim that every legacy component or physical iPhone flow is fully accessible.

## Food screenshot corrections (19 October 2026)

Nutrition macro bars stack vertically, one full-width bar per nutrient with its amount beside its label.
Add food is centered on the whole header, independent of the back-link width. Remove the Today/choose-a-meal
subtitle; the opening question sits16px below the header without a heading top margin. Meal/day selection stays
in review. A newer native client reaching an older server keeps review metadata and drafts, explains the needed
server update, and never retries through a legacy path that could log before confirmation.

Food-send recovery: reopening a review draft resumes a server-saved pending message using its existing ID. Never replay legacy auto-log messages on open. Sending has a bounded wait and visible Retry/Cancel; failed messages retain their own Retry/Cancel and do not block new messages or their review. New text does not inherit failed-message context. Evening food summaries were subsequently retired on 20 October 2026.

## Food chat should feel like texting (19 October 2026)

Sending text preserves composer focus and the visible keyboard. Send/Return submits, Shift+Enter adds a line, and
IME composition is never submitted halfway through. The newest sent message and reply stay visible through
keyboard/viewport/composer resizing; deliberate history scrolling stops automatic following until the person
returns to the bottom or sends again. Keep normal tap/swipe keyboard dismissal and photo/map selection rules.

Keep the supplied food type, amount and destination through short replies. Confusion such as “No idea what you
mean” is a request for help with the existing food, never a new food to measure. Explain the next useful action
in ordinary words. Known saved-food nutrition stays authoritative. When an otherwise usable plain database
entry cannot convert a stated household amount, reuse the existing consent/access/budget-gated estimator with
the completed food description. Incomplete catalog nutrition remains incomplete. Named brands still require
a product choice or an explicit request to estimate. Offer “Estimate calories with AI” for eligible unresolved
catalog choices; “estimate it” uses the same path and preserves already-given details. Estimates remain labeled
and wait for final review/confirmation. No model, prompt, release gate or consent default changes here.

## Food chat answers like a person (19 October 2026, owner review of #187/#188)

The owner found the chat assuming wrong, replying with nonsense and fighting the UI. Rules from that pass:

- **Only food becomes food.** Acknowledgements (“ok”, “lol”), “nothing”, “I skipped breakfast”, unrecognised
  questions and bare amounts (“2 slices”) get a short reply, never a food card asking “How much ok did you have?”.
  “Cancel” / “never mind” removes the latest unconfirmed card.
- **An amount already said is enough.** “A banana”, “large fries”, “glass of wine” go straight to an estimate.
  When the amount is missing and AI estimates are available, assume a typical portion and say so on the card
  (“I assumed a typical portion of coffee. Change it in Review food if that’s not right.”) — owner decision,
  competing with ChatGPT. Without AI, ask once: “Coffee — about how much? For example “1”, “1 cup”, “a large
  one” or “150 g”.” A bare dish word (“taco”) still asks what kind. Several new foods in one sentence where one lacks an amount (“coffee with milk”, “2 eggs and
  toast”) are one description, not one question per ingredient. When every food has its amount, each is still
  looked up exactly.
- **Answers continue the question.** Sizes (“medium”), dish types (“caesar with chicken” after salad), and extra
  detail are added to the same food; unrelated food (“banana” after taco) stays separate. “Not sure” estimates a
  typical version and says so; “what do you mean” explains the question.
- **Corrections work before review.** “Actually 3 eggs”, “remove the toast”, “it was lunch” change only the named
  food on the unconfirmed card.
- **Questions about a food look it up** (“how many calories in an avocado?”) and show a card; nothing is logged
  unless reviewed.
- **Quick replies.** Question cards offer one-tap answers (1, 2, Small, Medium, Large, Not sure; fillings for tacos).
- **Review is a slim strip on the composer**, not a full-width button: “3 foods · ≈ 405 kcal · Review ›”. It counts
  finished foods only. An unanswered question never blocks reviewing the others; that food stays in the chat.

## AI understanding in the food chat (19 October 2026, owner-approved)

When enabled, a small model call reads each message (log, answer, correct, remove, move, cancel, questions, chat)
and code does the rest. Its wording appears only for questions and small talk: short, plain, no compliments or
judgments about food (“delicious”, “healthy”), never says food was logged, and never contains a number the person
didn't type. Assumed portions show as a muted line on the card until reviewed.

## Food chat, iPhone feedback pass (19–20 October 2026, owner)

- **+ opens a bottom sheet** of tools (Camera, Photo, Barcode, Search, Usuals, Recipes, Manual). No inline panel
  and no "Add <usual food>" suggestion above the composer (owner: poor design; the suggestions were not good).
- **Remove** on an unlogged estimate row is a small link beside its source line ("Kit's estimate · Remove"), never its own row (owner, 23 Oct 2026).
- **Typing bubble** while a message is sent and checked; no interim "isn't in your foods yet" text.
- **Amounts change in the chat:** each unconfirmed food shows “− 3 servings +”; − / + change only that food.
  Corrections by message still work (“actually 3 eggs”).
- **Add to log** replaces Review: the composer strip reads “2 foods · ≈ 400 kcal · Add to log ›” and opens a short
  sheet: foods with calories, one total (macros smaller), meal buttons pre-chosen from the time of day, one
  **Add to log** button. Recipe saving and logging part of a recipe sit behind “Save as a recipe, or log part of it”.
- **Clear chat** in the chat’s … menu; the chat also starts fresh each day (conversation only; logged food stays).
- **Clarify a little:** generic words (“chips”, “cereal”, “taco”) get one “what kind?” question; once answered or
  “not sure”, the chat estimates. Clear foods (“banana”, “rice”, “2 eggs and toast”) are estimated straight away.
- **Keyboard (iPhone app):** the WebView keeps its size and the chat shrinks by the announced keyboard height with
  the keyboard animation, so the text box rides up with the keyboard rather than after it.

**Add to log sheet (20 October 2026, owner):** “Adding to <meal ⌄> today” at the top; each food with its amount and
a tappable calorie number (a dashed box) that turns into a small number field in place, so calories can be corrected
without another screen. The edited food’s other nutrients scale by the same ratio and the row says “Edited”. One total
with smaller macros. A “Save as a recipe” switch reveals the recipe name, measure and “what I ate” options. One button
that says what will happen (“Add to Snacks”, “Save recipe and add to Snacks”, “Save recipe”). The chat clears after.


## Social profiles and finding people (20 October 2026)

Profiles have explicit Edit profile and Share profile actions. One editor saves name and plain-text bio together, preserves both drafts after failure, and keeps drafts when the nested photo sheet is used. Public identity stays separate from private body/account settings. The owner's profile highlights Me; another person's profile highlights Activity.

Last 30 days shows visible workouts, distance (or active days for workouts without distance), time and active-day consistency, with the previous 30 days' workout count. All-time and sport summaries follow. Every number uses the same server visibility/block rule as the activity list, independently of pagination; the owner's friend preview excludes Only me. Dates follow the viewer's timezone. Profile links require sign-in and keep existing sharing choices. Managing workouts and Sharing & privacy are direct links; no bulk privacy change occurs when a profile link is shared.

Activity has a visible Find people entry. Friends accepts names and @usernames, shows known friend matches immediately, then debounces the server search and discards stale responses. Typed search shows one result list; clearing restores friends/requests. Browse people is explicit, rather than repeating friends in an always-open directory. Preserve the query when visiting a profile and returning, and retain it with Retry after failure. Name-search opt-out, exact-username discovery and blocking remain server-enforced. Remove/block sit in a named friendship-management sheet, available from Friends and a friend's profile, with confirmation and cache invalidation of previously opened shared details.

## Native notification invitation (20 October 2026)

After a native iPhone home screen has loaded, a signed-in account with a ready push server and supported/off device notifications may see one short Stay in the loop sheet: “Get notified when your workouts sync and friends cheer you on.” Use the existing shared sheet, full-width centered actions at least44px high, Turn on notifications and Not now. A denied Apple permission gets a plain explanation and Open iPhone Settings. Manual settings remain available.

The choice stays in device preferences per server/account, never in server analytics: Not now waits30days and there are at most two asks. An accepted invitation ends automatic asks; failures remain retryable in the sheet or manual settings. Recheck the current login before permission, registration and Settings actions. No invitation over another sheet, focused field/keyboard, workout recording or Health connection, or on a notification/deep-link/shortcut entry. Defer to a loaded, ordinary tab home; an external entry stays quiet until a later ordinary app entry. Browser evidence must visibly label the native bridge stand-in, with physical Apple prompts/device behavior pending.


## Seven-bar distance chart (20 October 2026, owner revision)

Me and authenticated profiles now default to seven daily bars for the current Sunday–Saturday week. A visually tiny Days / Weeks control switches to seven Sunday-starting weeks, including the current week so far. Keep comfortable44px control targets, explicit units and date-range readouts, hover/tap pinning and keyboard access. Daily bars have weekday names without date numbers beneath them; weekly bars have compact Sunday dates. Future daily slots say Not yet, and the current weekly readout ends today and says so far. Totals update with the selected period. Profile weekly totals use exactly the same server visibility/block rules as the profile feed; private workouts stay excluded from a friend's view. This replaces the earlier fourteen-bar presentation; legacy fourteen-day API data remains compatible.

## One Kit across the app (20 October 2026, owner revision)

Kit is available to AI-enabled accounts from the Me, Activity, Track, Progress and Nutrition homes, activity detail and training plan. All entries lead to the same assistant with a fresh private conversation each visit, retaining the entry context and a visible back link. Keep the five existing destinations; do not add a Kit tab. Before the first message, show three relevant starter questions as comfortable44px+ buttons. A tap sends its visible intent. Once a conversation starts, hide the starters and use Add food's existing bubble/composer/typing/scroll/keyboard treatment. Opening Kit never spends a model request.

Retain unsent or unanswered text as a draft after leaving/reload/error; never automatically resend it into a new visit. Bind sends to the account/server, conversation generation and visit. Show Retry within an active visit and discard late account/clear/leave results. Leaving or backgrounding ends only that visit; other devices keep their active chat. Kit may automatically retain up to twelve short preference/goal/routine statements, in the person’s own words, for six months. Make memory visible, individually removable, clearable and optional, also from Me → Your data when AI is off; turning it off removes saved memory. Current words and current tool records take priority. Workouts, plans, food and goals stay saved. Proposed plan or food changes open Review and still need confirmation; other app features open their normal editors. Facts display the measurements Kit verified, with missing data limits available in Details.

The evening food summary, setting and shortcut are retired. Nutrition insights come through Kit. Food source labels say “Kit’s estimate”; underlying source identifiers and AI/provider/privacy disclosures stay truthful. Preserve the existing Add food workflow, consent, Health category permissions and non-AI tools.


## Refresh, sharing and Kit discovery (20 October 2026, owner revision)

Me shows a compact Ask Kit invitation explaining “Your training & nutrition assistant” between the greeting and chart, for accounts with Kit available. Keep the approved activity-first hierarchy and all five tabs. Opening Kit costs no model request.

Read-only tab homes offer pull down from the top to refresh, with a release threshold, visible progress and no header refresh icon (owner revision, 22 October). Horizontal, map, input, selection and modal gestures keep their normal actions; chats/editors/recording are excluded. Retain cached content while fetching. Temporary server/network failures keep that content with an honest failure message. Returning to the app must not rebuild active chats/forms or move the page after the user starts scrolling. New read requests have a bounded wait and Retry.

New accounts default to Everyone on Kinetta for new activities. Show that choice during signup and allow Only me or approved friends before account creation/import. Preserve existing accounts’ saved defaults and every existing activity’s audience. Phone recordings follow the default and offer an audience selector before Save; a retry cannot change an already-saved recording. Shared maps keep server-enforced trimming and blocks. Food, body data, private notes and Kit remain private. Sharing controls roll back visibly when saving fails.

## Food photo context and itemization (20 October 2026)

Before a food-photo estimate, the existing photo review sheet includes an optional description followed by **Estimate with Kit**. Ingredient breakdown is automatic, as detailed below. Pre-fill from the food composer, retain edits when removing views, use 16px-or-larger input, and keep the action reachable when the sheet scrolls. Recipe and package-label photo review keep their existing controls. Preserve normal keyboard dismissal, drafts, privacy and final confirmation.

Itemized photo replies show ingredient names, estimated portions/calories, assumptions and a code-calculated total. Add food recognizes follow-up breakdown requests against the selected photo. Show unknown nutrition honestly. Reattaching a photo to itemize replaces an unlogged estimate rather than adding a second copy; failed/late work preserves the original or newer edited card. No photos are retained server-side.


## Automatic estimate breakdowns and temporary photo previews (20 October 2026)

Every Add food estimate shows its current food/ingredient rows, portions, calories, assumptions and an application-calculated total without needing a follow-up request or checkbox. This includes typed descriptions. A single food still shows one row and a total; missing calories make the total incomplete. Saved-food nutrition stays authoritative. The reviewed ingredient prompt automatically splits mixed foods when the existing food comparison approves the exact fingerprint; without that review, the ordinary estimator remains available and its actual rows stay visible without inventing a finer split. Explicit ingredient generation remains blocked before provider work when unapproved.

Selected photos appear in their sent chat bubble. Full images remain only in the account/server-bound on-device outbox while an upload is pending. Finished chat previews are small thumbnails held in WebView memory only, never server history, localStorage, service-worker caches or permanent food/recipe records. Clear chat, successful logging/review, cancellation, message deletion and account deletion remove the corresponding previews; a full app reload also drops completed previews. Failed logging keeps the photo for retry. Refresh reconciles clears/logging from another device. Late cleared or cancelled responses cannot restore the preview. Pending uploads retain their normal retry protection.


## Activity social row and easier refresh (21 October 2026, owner reference)

Activity cards use the owner's Facebook reference for a compact action row: reaction icon with total,
comments with count, a share-link action for already shared activities, and overlapping colored reaction badges
on the right. The badges open the people list. Keep the existing Cheers / Strong / Applause meanings, immediate
optimistic feedback and rollback, hold/slide choices, visible choice control and keyboard support. The picker
shows names under its symbols. Moving focus into its fixed menu must not scroll the page or dismiss the menu. Counts and accessible labels update together. Own-activity audience text sits
with date/sport metadata and remains visible. Sharing copies or sends the authenticated shared-activity URL;
it never widens the audience. Private activities do not offer that feed action.

Retain the neutral Sky Blue foundation. Use the shared data and achievement tokens for reaction badges and
selected feedback; sport marks use a stronger tint and outline in their existing sport color. Icons, names and
counts communicate meaning alongside color. This is a focused feed refresh, not a claim of a full app palette audit.

At the top of a read-only tab, a vertical pull may begin on the activity title/numbers link as well as background.
About90px reaches Release to refresh. Keep map/photo/horizontal/control/selection/editor gestures excluded,
keep the cached-data/error behavior with pull-to-refresh as the page refresh control, and consume the synthetic click after a drag
so refreshing cannot accidentally open an activity. Ordinary new taps and keyboard activation still work.


## Keep your place while browsing (21 October 2026, owner clarification)

General loading and navigation are the reported friction. Cached tabs continue to show useful content immediately
while reads refresh in the background. Friends feed keeps all pages loaded during this signed-in session, so opening
an activity and returning does not reduce the list to its first15 cards. Revalidate the loaded depth after its cache
expires using bounded feed pages and current server visibility; keep the small saved opening view on the phone.
Show more remains usable while cached content refreshes. A late first-page response cannot remove newly loaded
cards, and stale/account-changed pagination cannot replace the current list or leave its button permanently busy.

The router owns Back/Forward scroll restoration and records the outgoing page before replacing its content.
In-place refresh retains the current position; a new account starts fresh. List containers must have a measurable
height when restoring a deep position; maps remain lazy. Existing deliberate tab-home/reset behavior, filters,
keyboard gestures, recording and food drafts stay intact. Delayed data must never scroll a person back after they
have started interacting. Browser timings on a local fixture are diagnostic evidence, not physical-iPhone or
public-network performance measurements.


## Colour meaning and smooth social panels (22 October 2026, owner revision)

Preserve Sky Blue neutral surfaces, quiet cards, blue actions and links, the five stable tabs and the thin divider
above activity social controls. Colour communicates a labelled value or state:

- Today, shared profile and combined Progress distance charts follow the 23 October addendum above: a single
  solid total, rounded tops, action blue for the current/selected period and a light tint for others. Keep viewer-local
  Sunday boundaries and privacy filtering. The tapped/keyboard readout names the actual sports; no sport legend or
  stack. Zero/future days retain a neutral baseline; older payloads never guess a sport.
- The conditional Food today card shows protein, carbs and fat in red/gold/teal with grams, unknown values
  and targets when known. Its labelled calorie progress bar fills against the real saved goal. No goal means no
  invented fill. Nutrition headings use normal text; calorie progress uses action blue, and buttons/links use their blue tokens.
- Personal-record and streak pills use neutral soft backgrounds, normal medium-weight text and a gold leading
  icon, alongside their words/counts. Completed plan workouts and reached activity goals retain labelled gold icons.
  Do not turn food intake targets into achievement streaks.
- Heart-rate zones retain their existing thresholds and durations. Numbered zones and effort names use neutral,
  green, amber, orange and red from Z1 to Z5, with time and percentage labels, in both themes.
- Plan days show easy/recovery/run-walk in green, workouts/intervals in orange, long/medium-long runs in teal,
  and explicit rest days in grey. Completed workouts keep their type cue and gain a gold Done/check marker.
- Main tab pages refresh by pulling down, without a header refresh icon. Preserve gesture exclusions, the
  release/progress/error messages and cached content. No hidden Health sync or other write is added.
- Reaction and comment reads share one session-scoped in-flight request. Warm/cache reads may render immediately;
  newer writes win over late reads, and account/permission changes clear private cached people. Social sheets mount
  their composer immediately, keep it and unchanged comment rows mounted during updates, and preserve unsent text,
  focus and selection. Failures keep drafts and offer Retry. Cached reads are an interaction aid, not a privacy bypass.


### Loading follow-up (22 October 2026)

Start an owner's activity details and social read together, including on intentional activity-link prefetch. Reuse
the session's social read/cache when opening comments or returning to detail; retain the mounted composer, draft,
focused field and unchanged rows. Owner sharing metadata must survive reaction/comment replies, and an incomplete
summary cannot substitute for the authenticated sharing read. Reaction menus install global dismissal/scroll
listeners only while open. Compare saved markup fingerprints rather than serialized DOM when preserving controls.

Warm primary destinations on press/focus with existing read deduplication and ownership guards. Today may supply
Nutrition's cached day only when the returned date exactly matches the explicitly requested date. Never guess the
server's local date or reuse a different day's food. Keep cached content visible during a refresh; navigation,
privacy checks and unsent drafts retain their existing behavior. Browser timings with artificial delays are
diagnostic evidence, not a promise about a physical phone or public-network latency.


### Stable first paint and sheet motion (22 October 2026)

On a cold Me load, reserve room for the chart and show it as soon as its data arrives. Keep the conditional day,
latest activity and the actions below them together until their first plan, food, check-in and activity results
are known. Do not expose shortcuts and then push them down as these cards arrive. Cached first draws release
this immediately, including during stale revalidation; unrelated friends, fitness and goal reads do not block it.
Empty days still omit the agenda, failed reads release loading and preserve available retry feedback. Notify the
parent about food visibility only after its card and logging action are mounted. The stable five-tab navigation
and header controls remain available during loading.

Sheets use a short entrance and160ms exit; closing releases keyboard/drag handlers and focus immediately, while
only an inert, inaccessible visual shell remains for the exit. Start from the current position and opacity when
interrupted during opening or a drag. Rapid replacement removes that shell and cannot restore old focus later.
A new sheet dismisses an old plain notice that would cover it, while notices offering Undo remain available.
Reduced motion removes the sheet immediately. Never translate the whole page: fixed and sticky composers must
retain their existing viewport and keyboard behaviour. Browser geometry, delayed-network checks and animation
samples are evidence for the tested flows; physical iPhone keyboard/scroll/frame pacing still needs a device.

## Share pictures, notifications, refresh and notices (owner request, 23 October 2026)

**Share is a picture, not a link.** The share button on your own activities (feed card and activity page) opens
one sheet with a ready-made 1080 × 1350 picture and a single Share button. The picture always uses the dark
Sky Blue palette so it looks the same wherever it is sent: muted map, the route in its sport colour, then sport
and date, the name in UI sans, and Time, Pace (or Speed) and Distance as large numbers, with the
Kinetta mark and wordmark at the foot. Without GPS the Kinetta mark takes the map's place, in the sport colour,
with the same numbers. "Hide where it starts and ends" stays on by default and uses the person's trim distance.
Friends' activities have no share button: nobody can turn someone else's route into a picture. Profile links are unchanged.

**Notifications** group New and Earlier. Each row: 44 px avatar with a small badge coloured by meaning (cheers
achievement gold, friends blue, shared food neutral, new workouts run green), the person's name in bold and the action in
regular weight, a quoted comment on its own quieter line (two lines at most), a short time ("5 min ago") and a
brand dot for new items. No tinted row backgrounds and no card inside a card.

**Pull to refresh** has no text labels. On the four read-only home screens (Me, Activity, Progress,
Nutrition) the page follows the finger with resistance and a small round spinner turns in the gap above it;
released past the threshold, the page rests just below the spinner until the reads settle, then slides back. A
successful refresh shows nothing (screen readers hear "Up to date"); a failure keeps the existing notice. This is
the one place the page itself moves: those screens have no fixed composers. Keep it off chats, editors and sheets.

**Notices (toasts)** are compact snackbars above the tab bar: near-black with light text in light mode, a raised
charcoal surface in dark mode, 15 px text, an optional quieter second line (for example "Saved on this phone · sends
when you're back online") and Undo as a blue text button. A tap anywhere else on the notice puts it away.

## Smoother first moments (owner request, 23 October 2026)

Measured with a slowed network and processor, screens no longer jump once drawn and visited tabs open instantly;
the roughness was in the first moments. Standards:

- **Launch:** while the app starts, show the unchanged Kinetta mark (original logo colour, gently breathing) on the app
  background, matching the iPhone launch screen. Never the bare word "Loading…".
- **Placeholders are shaped like what's coming**, with no visible "Loading…" words (screen readers still hear a
  status). The activity page's placeholder is the lead map and the title card with three numbers.
- **Maps** show the soft surface colour, not Leaflet's grey, until tiles arrive; tiles fade in.
- **Profile pictures and activity photos** fade in once loaded; already-loaded ones appear at once.
- **Moving between screens:** opening something inside a tab slides it in a little (about 28 px, 0.26 s), and Back
  slides the other way. This uses the browser's view transitions, which animate snapshots, so the live page is
  never transformed and pinned/sticky bars keep their place (the reason the old transform slide was removed on
  18 October). Tab switches stay instant. Without support, with reduced motion or with a sheet open, it's a plain swap.


## Activity picture sharing and full-screen maps

The activity Share button opens the picture preview, including the checked start/end privacy control. Share hands the previewed picture to the system share sheet in the iPhone app (or Web Share / an image download in browsers); the person finishes posting in the app they choose.

On activity detail, a deliberate map tap opens the existing full-screen map. Pans, pinches, photo-rail swipes and Leaflet controls retain their gestures. The expand/close button remains keyboard accessible; Escape or Back closes the overlay before leaving the activity, restores focus and prior inert state, releases background scrolling and refits every route segment. Route/account navigation cleans up the overlay.

## Owner cleanup · October 24, 2026

Me is the daily summary, Activity is the feed/history, and your profile is your identity to other members. Preserve the current Me · Activity · Track · Progress · Nutrition navigation. Settings & account is a dedicated route (`/me/settings`) reached visibly from Me and your own profile. Account, connections, units, private body/AI settings and data controls live there. Log out is visible near the top, retaining offline/draft/Health/device cleanup checks. Existing body-setup links redirect there. Settings holds only settings, in this order (#232, 24 October 2026): Account (name, username, email with its confirmed state, password, Signed-in devices), Profile & sharing, Connections & notifications (one Notifications entry; the inbox is the bell), Units & body, Kit, Your data, Help (contact, Speed check). Features such as Training plan, Nutrition targets and Weight trend live on their own tabs, not in Settings. Your own profile has two buttons, Edit profile and Share profile, and one Settings link; no inline pencils.

**First run (#232 F/G).** A new account goes through four skippable welcome steps (`/welcome`): profile (photo, name, bio), who sees your activities, bring in your workouts, find friends (the person whose invite brought you, in one tap). Each step saves only on Continue; Skip and Not now save nothing. Until the account has any activity or food, Me leads with Get started and hides the empty 14-day chart.

Back controls on detail pages stay in a small solid theme-colored top bar, including activity pages with maps. Keep safe areas, prior filters/scroll restoration, keyboard dismissal and full-screen-map gestures.

Progress bars use the approved light sky blue; selection remains distinguishable. Fitness charts open a full-height sheet with exact numeric readouts by touch, hover or keyboard. Owner revision, 24 October: no date/month slider. Pinch or scroll to zoom, drag or scroll sideways to move through dates, and tap/hover to inspect. Show all dates resets the zoom; keyboard arrows choose dates, +/− zoom and 0 resets. Preserve the selected date and zoom across rotation. Small charts retain normal page scrolling. Analysis uses compact context headings (Training load / Running fitness), a small full-width date and adjacent labelled values; keep rem scaling for enlarged text and give the graph the remaining space. Retain date ranges, source units, labels and Escape/focus behavior. Training indicators are estimates, not diagnoses.

Sharing (owner decision, 24 October 2026, revised the same day) makes one picture, 4:5 (1080×1350), for texts, Instagram (post or Story) and anything else, with one Share button that opens the system share sheet. No size choice and no separate Instagram button. The map fills the picture; title, sport, date and numbers sit on one frosted, see-through rounded card near the bottom (blurred map under a light tint, never an opaque white panel). Start (green, play arrow) and finish (red, flag) markers appear on the picture when start/end hiding is off and on every route map, including an activity opened from the feed; on a loop they sit side by side. Me's top right holds the bell, a small Settings gear and the avatar, not a full-width Settings row.

The iPhone app hides activity-file and food-CSV imports, including stale deep links and help entries. Browser history imports and photo/barcode logging remain supported. Connections treats Garmin normally; setup invites people to connect Garmin/Apple Health without requiring either. Provider availability and permissions still apply.

Food on training days is retired from the active app, APIs and target calculation. Preserve old schema/history and the separate explicit per-day target. Archived implementation/rebuild requirements: [source archive](../dev/deferred/training-food/README.md), [issue #236](https://github.com/BenCBanks/kinetta/issues/236).

Rationale: [Apple’s settings guidance](https://developer.apple.com/design/human-interface-guidelines/settings) places account-wide preferences in an identifiable settings area, and [tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars) favors predictable top-level destinations. This cleanup separates Settings without changing the home tab. [Apple’s notification documentation](https://developer.apple.com/documentation/usernotificationsui/customizing-the-appearance-of-notifications) distinguishes short banners from expanded content: a short title plus real body is appropriate, but the app cannot guarantee exactly two visible lines. [Vickers & Vertosick (2016)](https://pubmed.ncbi.nlm.nih.gov/27570626/) found optimistic marathon projections from conventional short-race formulas; this supports clearer uncertainty and source efforts, not an unvalidated universal time penalty. The existing mileage-dependent calculation is retained.

### Admin launch tools (24 October 2026)

Administration remains a separate browser portal, with personal Settings in the phone app. Overview leads with numeric counts and queue links; Launch checks separates configuration from dated human evidence, never an overall green launch badge. Recovery, role and destructive actions name the account and require its exact username. Errors stay in the dialog with drafts retained; confirmed results remain visible after closing it. Sticky section and dialog controls keep navigation accessible while scrolling. Use the approved sans headings, 16px inputs and 44px targets in both themes.

Ordinary support shows account status, connection/import state and client-reported device versions before folded counts/history. Reported-item review is a separate narrow moderation exception: only the submitted target, no routes, measurements, meals or conversations. Type-specific removal and material-version checks prevent a stale review from changing newer content. The data-request register contains only workflow metadata and never offers a private-data download to administrators. See [the operator guide](admin-portal.md).


### App cleanup (25 October 2026)

Settings → Edit profile opens the same profile editor as your own profile, with name/bio drafts retained after a failed save. Food entry uses the permanent conversation and final review; the retired fallback chat, nutrition rings and unused reaction pile are removed. Keep the current compact nutrition bars, training-plan completion ring, photo review, reactions and keyboard behavior.

Final food review and recipe-portion previews label missing macros as unknown. Storage placeholders never count as known zero nutrients; a zero supplied by the person or source still displays as zero. A mixed-food total stays unknown if any included food lacks that nutrient.


### Planned routes and segment review (26 October 2026)

Routes lives in Track, retaining the five tabs. My routes/Shared routes plan ahead; Progress → More holds Matched routes and Segments & times for completed efforts. Planned routes remain editable and private; Matched routes still compares completed activities. The map editor offers a Points list alongside map gestures and requires mapped paths and labels unavailable heights. Pending/unavailable connections are never straight fallback lines and cannot be saved. GPX/activity guide points are replanned and reviewed. Creating a segment requires a final immutable-course review; names, descriptions, direction, sport and path cannot be edited later. Boards default on at release, with each member off until they choose to join. The browser admin portal adds Segments & times for open reports, appeals, held times and a service-wide pause, with minimal derived checks and recorded reasons. Course retirement and permanent takedown are separate confirmed actions. See [routes](routes.md) and [segments](segments.md) for scope and limitations.


### Deliberate route sharing (26 October 2026)

Routes gains a Shared routes sub-tab while retaining the five main tabs. Owner sharing has separate public name/description fields, a protected recipient map and explicit acknowledgement before publication; private notes are never prefilled. The published route stays fixed until another reviewed update. Shared originals reauthorize on reads/foregrounding and hide unverifiable data; deliberate private copies are independent. Discovery uses compact audience choices and folded filters, with map-area search initiated explicitly and no live location. Route report review remains in the separate browser admin portal, limited to the currently shared projection; removal and dismissal require current material and exact-account confirmation. See [route sharing](route-sharing.md).

Route following (#279 implementation): pre-start review keeps route choice separate from Start and activity audience. During a workout the pinned plan is dashed with direction arrows; the actual GPS trail is solid and location is a dot. Label all three and keep Pause/Resume/Finish large and reachable. Show along/remaining only with a confident match, and never turn planned length into measured totals. Downloads show their size/version and explicitly exclude an offline basemap. Browser native/GPS evidence remains labelled as a stand-in pending signed physical-iPhone checks.
## Run/walk intervals · Track (26 October 2026)

Intervals are an optional pre-start entry below Start, styled like Add a planned route and shown only for Run and Walk (or while intervals are loaded, so they can be removed). Simplified 27 October 2026 after owner review: the Intervals sheet shows what is in Track, the saved list (tap one to preview, use, edit or delete), New intervals and one short note (no Test voice button, owner decision 27 October). The builder is Run [amount unit], Walk [amount unit], Repeat [n] times, optional warm-up and cool-down walks, an optional name (auto-named otherwise), a one-line total and Save and use in Track. Older presets with other shapes still preview, start and delete but do not open in the builder. No alert switches, acknowledgement checkbox or draft buttons; no new main tab or retrospective Progress home. Loading a snapshot starts no recording and never changes sport or audience. A Run with Walk recovery stays one Run. Unsupported activity/platform selections require an explicit change or removal, including Lifting.

The live card names the current Run/Walk action, remaining target, execution and next step. Skip/End are deliberate secondary controls, while existing Pause/Finish remain primary. Completion/end leaves normal recording running. Saved planned/actual history is private, with unknown measurements and skipped/ended steps stated plainly. Source deletion cannot change the active pin.

Outdoor iPhone first; indoor later. Guidance is spoken only: no vibration option (owner decision, 27 October 2026). One short note says it is an early version and to check the prompts can be heard with the phone locked; a foreground voice test is not that evidence. No permission is requested by merely opening the preset editor. A quiet pre-start position may use an already granted permission, while a new location request requires Locate me or Start. Use current Sky Blue tokens, 16px inputs, native keyboard dismissal, retained account-bound drafts and stable recording controls. See [run/walk contracts](run-walk-intervals.md).

### Same as yesterday restored (26 October 2026)

Returning food users have a Same as yesterday action on empty Nutrition meals and in each populated meal’s Edit menu. It previews the previous day’s corresponding meal and names the source and selected destination dates before explicit Log this meal. Retries retain upload identities; the existing offline queue and durable Undo apply. It never replaces foods already logged or adds a competing Me shortcut. New users retain the food-log introduction.

### Pending food nutrition (#319)

Before logging, each food has one quiet Protein · Carbs · Fat line beneath its name, for the displayed amount. Missing values say unknown; known zero remains zero. Calories stay on the right. The name and macro line open a nutrition sheet with source-serving and chosen-amount columns, source, available brand/package details, and known fibre, sugars, saturated fat and sodium. A source's 100 g fallback is labelled per 100 g rather than presented as its package serving. Estimates keep their source label.

Change amount previews the chosen totals in place; the serving comparison stays fixed. Enter nutrition takes numbers for the stated source basis and changes only the selected draft food. Remove food removes only that food. Other foods and unsent chat text remain. Portion steppers update calories and macros together, block final review while saving and restore the authoritative card after failure. Keep the existing final Add to log review, compact rows, wrapping text, keyboard dismissal and both themes. Browser evidence does not establish physical iPhone or VoiceOver acceptance.

### Ask Kit start (27 October 2026)

After owner phone review ("big and clunky"), the empty Ask Kit screen is compact and sits just above the message box: a small sparkle with "What can I help with?", the three screen-specific suggestions as wrapping chips, and one fine-print line: new chat each visit, the AI provider in use, and a Memory link. Kit chat settings (the ••• button) still hold memory, permissions, earlier reviews and New chat.

### Progress, Activity and record polish (27 October 2026)

After owner phone review: Progress keeps the title row for the bell (and Nutrition help in Food & weight) with Kit at the far right like other pages; the Training | Food & weight toggle is a two-part control directly under the title, in the same place in both modes (it was a dropdown that moved between the header and its own row). The combined weekly summary is called Your week in review. The weekly check-in drops its "No watch or Kit needed" note. On Activity, Find your friends with no suggestions is one slim row with an Invite link. A record distance page lists every effort (fastest first, ten then Show all) under PR progression.

### Loading and first impressions (27 October 2026)

Owner asked for a more professional, launch-ready feel. Slow loads now show placeholders shaped like the content: feed cards (avatar, title, three stats, map), a stats-and-bars chart card (Me week, Progress totals) and the Nutrition summary plus meal cards. Full app restarts reuse the animated launch mark instead of plain "Loading…" text. The login newcomer line stays empty until the server says whether sign-up, the waitlist or invite-only applies, so the wrong line never flashes. Track activity chips wrap long names instead of clipping them.

### Post-recording summary (27 October 2026)

After owner phone review, Finish opens a summary rather than the live recording layout: sport and start time, a large Title field first, a stat card (distance, active time, average pace or speed, total time when pauses add 30 s or more, elevation gain when the iPhone recorded enough good altitudes; 3 m hysteresis; estimated calories using the same rule as the server's energy estimate with the profile weight, else 75 kg), splits per mile or km plus the last part, a small map fitted to the whole recording, then sharing, Save activity, Continue recording and Discard. In the iPhone app a soft page-coloured strip sits behind the status bar so scrolled content never runs under the clock and Dynamic Island (hidden while a sheet is open and on full-bleed map pages).

### Lifting summary and recording controls (28 October 2026)

After owner review, finishing a live lifting session opens a summary in the same style as the post-recording one: sport and start time, a large Title field, a stat card (duration, exercises, working sets, reps, volume, calories — the watch's number when merged, else the server's 5 MET estimate with the profile weight, else 75 kg), a New records card when any set beat an earlier best, each exercise with its sets and last time's, then sharing, Done (sends only a changed title or sharing) and Carry on with this session (reopens it within its 4 hours). The session is saved before the summary appears; leaving it keeps the default title and sharing. Editing an already finished session still returns straight to Track.

On the recording screen the title, numbers, map and round controls fill exactly the space between the status bar and the tab bar: the map takes what is left (at least 100 px; 72 px on short screens) instead of a fixed share of the screen, so Pause, Resume and Finish never sit under the tab bar on any iPhone size, with or without a status line or planned route. Short screens shrink the timer and hide the route legend and splits line under a route. The background note and Discard stay below, a scroll away.
