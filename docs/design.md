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
