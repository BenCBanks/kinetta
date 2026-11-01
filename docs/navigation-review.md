# Named return links and map controls

Reviewed for #393/#394 on 31 October 2026. The route inventory contains 56 registered route families; its query/tab variants use the same headers. The shared policy tests every inventory example.

Regular page Back controls use the previous app entry when its account and local destination can be verified. Direct links and unknown entries use the named parent below. Replace, Back/Forward, reload and same-entry search changes keep their meaning. Sign-in/bootstrap pages and another account cannot supply an app return destination. Full-map history entries retain their existing close behavior; interrupted transient entries use the explicit parent.

| Page or route family | Named parent when no previous app entry is known |
| --- | --- |
| Me, Activity, Track, Progress home, Nutrition home | Main tabs; no page Back is needed |
| `/today` | Existing redirect to Me |
| `/me/activities` (including sport/search) | Me |
| `/activity/{activity}` (all analysis tabs) | Activity; both floating/sticky controls share the destination |
| `/activity/friends/{activity}` (all tabs) | Activity |
| `/route/{route}` | Routes |
| `/records/{sport}/{distance}` | Records |
| `/plan` | Progress |
| `/lift/{session}`, `/track/lift/{session}` | Existing Track/Activity parent for logger or summary |
| `/lift/ex/{exercise}` | Lifting |
| `/progress` detail views: totals, fitness, records, lifting, training/heatmap aliases | Existing named Progress link; filtered home and scroll are retained |
| `/progress/routes`, `/routes`, `/routes?view=matched` | Progress / existing matched-routes hub |
| `/progress/segments`, `/segments`, `/routes?view=segments` | Progress / existing segments hub |
| `/progress/trends`, `/progress/calendar`, `/progress/heatmap` | Existing named Progress link |
| `/routes/plan/{plan}` | Parked saved-route planning stays unavailable under #328 |
| `/segments/new` | Existing segments form navigation |
| `/segments/review` | New segment; the form draft is retained |
| `/segments/{segment}` | Segments |
| `/me/friends` | Me; an entry from Activity returns to Activity |
| `/people/{login}` | Me for your own profile, Friends for another profile |
| `/add/{invite}` | Activity |
| `/card/{card}`, including expired cards | Friends |
| `/me/challenges` | Activity; Challenges is available from its header for every account |
| `/me/challenges/{challenge}`, `/challenge/{challenge}` | Activity; explicit parent remains Activity even after another entry path |
| `/me/settings` | Me |
| `/me/people` | Me; administrator access is unchanged |
| `/me/import`, `/track/import` | Existing import route goes to Track |
| `/me/connections`, `/track/connections` | Existing connections route goes to Track |
| `/me/health`, `/track/health` | Connections |
| `/me/gear`, `/me/goals`, `/me/speed` | Me |
| `/me/devices` | Settings |
| `/me/sharing`, `/me/notifications` | Settings |
| `/notifications` | Me through the existing Today alias |
| `/me/explore`, `/me/milestones` | Me |
| `/food/meals` | Nutrition |
| `/food/cook/{recipe}` | Recipes for the owner, Nutrition for a shared recipe |
| `/food/recipe-link` | Existing named recipe/library return |
| `/food/import` | Nutrition's Food & weight view |
| `/food/weight`, `/food/trends` | Existing redirects to the matching Nutrition views |
| Nutrition detail views | Existing explicit Nutrition/Progress return, with the selected day preserved |
| `/food/describe` | Existing named Nutrition link keeps the selected day and food draft |
| `/food/setup` | Nutrition; its review step's Your goal control returns to the form |
| `/me/kit` | Existing named Me/Nutrition/Activity/Progress/Plan/Track link follows its saved context |
| `/welcome` | Onboarding has its own step navigation |

No route header retains a generic visible Back label. Missing-record screens also use the shared named control, retaining the page's declared parent or known prior page. Unregistered source URLs cannot claim a return destination merely by sharing an app prefix. A same-form or onboarding Back is a step control, with its existing draft/confirmation behavior. Progress, Nutrition and chat links already have explicit destination URLs and accessible destination names; no change was needed to those controls. The shared regular-page helper updates every copy, including Activity's floating and sticky headers.

No change was needed to the map constructor's coarse-pointer rule: it already omits zoom buttons and keeps pinch/full screen. Browser regressions check route detail, activity detail, feed maps, the private heatmap and Track's GPS preview, plus mouse zoom. Track uses the existing idle native-shell/location stand-in. Provider requests and recording writes are blocked. Credits remain visible in the maps; tile styles/providers are unchanged. Physical iPhone gestures and VoiceOver remain separate acceptance.
