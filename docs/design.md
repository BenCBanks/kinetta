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
  Eligible Kit weekly reviews open from a small button beside the greeting; goals and fitness follow the primary content. Do not invent feature switches, empty promos or setup nags.
- **Five stable tabs:** Today, Activity, Progress, Nutrition, Me always remain visible. Feature-panel visibility must not
  hide a tab. Use a full-width bottom bar, regular icons, readable labels, safe-area padding and a short active underline.
- **Activities:** use Friends feed and My activities. Friends feed contains your activities and approved friends’ shared
  activities, newest first. My activities contains your own history with search and filters. Keep the short scope line,
  privacy labels, comments, Cheers and double-tap people lists. The names match mutual friendships, not a new Follow model.
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
pause the ball for reduced-motion preferences. This is an intentional brand detail requested by the owner.

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
