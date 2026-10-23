# Claude review and follow-up notes

Claude Code completed an independent, read-only review on 23 October 2026, using the existing subscription. It could read only the curated packet; command execution, writes, network access and further agents were unavailable. Its report follows unchanged apart from removing a preliminary progress sentence. Its visual judgments and hypotheses are review input, not owner approval or verified product defects. No screenshots or product files were changed in response.

## Packaging follow-up by Codex

- **Map provenance confirmed:** these are generated demo activities, not recorded personal tracks. [The demo generator](https://github.com/BenCBanks/kinetta/blob/main/dev/demo/gen_gpx.py) creates synthetic timing/heart-rate records along OpenStreetMap route shapes around a public park; [the demo guide](https://github.com/BenCBanks/kinetta/blob/main/dev/demo/README.md) records provenance and licences. Real street names belong to the public basemap, not a real person's activity or home. Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Existing photos retain the credits and licences in the demo guide.
- **Today content clarified:** the preview overlay places the conditional Food panel before the conditional plan panel. The plan was not deleted; it can be below the captured viewport. This is an unapproved ordering choice, not merely a colour change. A selected implementation must separately review this order and retain both conditions.
- **Packaging links added:** the gallery now links verification, this report, D's greyscale charts and E's secondary-screen board. The decision checkpoints are now numbered together. Images retain their original historical captions and statuses; isolated image sharing should carry the rejected/unapproved label from the decision sheet.
- **Verification timing clarified:** packaging results were added while Claude was reviewing an earlier version of VERIFICATION.md. The completed checks are recorded there. Raw test output remains excluded from the public repository. Existing preview beta links were checked for the intended destination; final implemented-site links and the actual signup journey still need acceptance before publication.
- **Research limits clarified:** device-first ordering is a proposal informed by contextual onboarding guidance, not an Apple requirement. Material 1 empty-state guidance is a legacy reference. Claude did not independently fetch or verify the external research sources.
- **Store checklist expanded:** account deletion, age rating, export compliance and Health permission text need store/reviewer acceptance even where functionality already exists. No claim of missing account deletion is made.

The design findings remain open for owner review: selection/panel consistency, text weight, chart identification, progress-track and Goal affordance, homepage CTA frequency, Friends evidence, spacing and mobile legibility. Different control types may need different selected treatments; the question is whether their hierarchy is coherent. No new palette or implementation is selected here.

---

# Independent review: Kinetta design packet (23 Oct 2026)

**What I looked at:** the four documents and the brief, `index.html`, the five overview boards, both E comparison boards, all eight E app screens, the E desktop and mobile homepages in light and dark, and `e-brighter-white/secondary-review.png`. I did not open the A–D individual screens, the `current/` screens one by one, or D's greyscale charts. I had no network access, so I could not check the research links. **[Defect]** means I can see the problem in a screenshot or document. **[Hypothesis]** means it needs a user or device check.

## 1. Findings ranked by impact

1. **[Hypothesis, privacy] The map routes appear to sit on real streets.** The activity and friends maps (`light-activity.png`, `light-friends.png`) and the homepage captures show named, real-looking places: Freedom Park, Princeton Ave, Sugar Creek, Myers Park, Cotswold, Oakhurst. If either route came from a real recording, the start marker and the loop could reveal where a real person lives or trains. The packet says the people and data are fictional, but it doesn't say the routes are synthetic. The owner should confirm this before the PR stays public, because the README says this PR makes the copies public.
2. **[Defect] E uses at least four different ways to show "selected".** Tab bar: filled green. Friends feed/My activities and Overview/Splits: outlined pill. Food log: green underline. Days/Weeks: black underline. This is the clearest gap in the "more definition" goal (`light-food.png`, `light-friends.png`, `light-today.png`).
3. **[Defect] Panels use three different treatments.**
   - White card with a border and shadow (This week, meal cards).
   - Grey fill with no border (Latest activity).
   - Grey fill with a border (calorie summary).

   The header icons don't match either: the bell sits in a white circle with a shadow, while the avatar is a flat grey circle (`light-today.png`, `light-food.png`). In dark mode the shadows disappear and the cards are close in tone, so depth there comes from borders alone (`dark-food.png`).
4. **[Defect] The Today tab still uses the old "Me" person icon with a "4" badge.** That badge repeats the bell's "4" and attaches a notification count to "Today" (`today-comparison.png`). This is consistent with the README's "labels only" caveat, but it makes the proposed tabs look unfinished. It also leaves open where profile and settings go.
5. **[Hypothesis] Does the content still feel flat, and is the type too heavy?** The white canvas and green are clearly delivered. However, all the data is charcoal or grey: bars, the calorie and protein bars, and the macro dots. Green appears only in buttons, links and the selected tab. The flatness may have moved from the canvas into the content.

   At the same time, nearly every piece of text is semibold or bold: meal names, labels, tab labels, "Hi, Alex". Combined with the near-black numbers and a filled green tab, this risks feeling heavy. Only the owner can judge this.
6. **[Defect] Two smaller visual problems on the Food screen:**
   - The calorie progress bar has no visible track on the grey summary panel. It reads as a dark pill rather than a proportion, while the protein bar directly below does show a track.
   - "Goal" has lost its button container in E compared with the current app and D, so it may no longer look tappable.

   Both are in `light-food.png` and `overview.png`.
7. **[Hypothesis] The Today screen may have lost or reordered content.** The current app's Today shows "Your day → 10K plan / Easy run 4 mi". E shows "Your day → Food today" in the same viewport (`today-comparison.png`). Yet the index says both use the same demo records, and the scope says to preserve the conditional Today panels. Confirm the plan panel still appears and in what order.
8. **[Hypothesis] Charts that rely on grey and patterns may be slow to read.**
   - The busiest pattern (Ride stripes) sits on the tallest bar, drawing the eye away from today (Fri).
   - Walk's dotted pattern on the 2.1 and Tue stacks is small.
   - Carbs and Fat use identical grey dots.

   The labels mean colour isn't the only cue. Whether people can read it quickly is still untested, as RESEARCH and VERIFICATION already admit.
9. **[Hypothesis] Some green text in dark mode may be hard to read.** "My recipes & foods", "Open log", "+ Add" and "Edit" are a pale, low-saturation green (`dark-food.png`, `dark-today.png`). The 262 token contrast checks are reported but not included in the packet, and they don't cover rendered components.

## 2. Are the choices, statuses and checkpoints clear?

Mostly yes:
- A–D are consistently marked Rejected, and E is "Latest proposal; unapproved", in the README, the index and the decision table.
- "None yet" is explicitly a valid answer.
- Selecting a visual direction and approving homepage publication are both stated as separate checkpoints (README "Homepage story" row, REVIEW-SCOPE §2).

Gaps:
- The two checkpoints are never listed together as "Checkpoint 1 / Checkpoint 2", so a reader has to put them together across files.
- The A–D boards carry no "Rejected" marking inside the images. The A–C boards say "Proposed tabs… follow your checkpoints", so an image shared on its own could read as a live candidate.
- The README's "no purple or neon in the next implementation" is effectively a constraint already decided. That's fine, but it should be labelled as owner preference, not as research.

## 3. Homepage

- **Workouts and food:** the headline says both immediately. **[Hypothesis]** The hero phone shows a workout-heavy Today screen, with Food today cut off at the macros, so the image leans towards training. A quick 5-second test would settle it. There is no conversion evidence, and none should be implied.
- **Calls to action:** "Join the beta" is the only primary action, which is coherent. **[Defect]** It appears six times (nav, hero, three sections, footer section). On mobile that means five full-width green bars, which feels repetitive and heavy. Whether that hurts anything is a hypothesis.
- **Section screenshots:**
  - Training (activity detail) and Food (food log) are relevant.
  - **[Defect]** Friends shows only "You", with no friend's activity, cheer from someone else or approval step, so it doesn't show social sharing.
  - The Training capture shows a "Demo data" label, which is good for honesty.
- **Layout:**
  - **[Defect]** The desktop page has large empty bands between sections.
  - **[Defect]** On mobile, the "Works with" row wraps unevenly, leaving "Strava export" alone on its own line.
  - **[Hypothesis]** The phone captures shown inside the mobile page are very small. Text in them is likely unreadable on a real device.
- **Dark versions:** they match the light versions. The dark map tiles and white route line work. The dark CTA green is softer than the light one.

## 4. Data encoding, contrast, text scaling, first run, tabs and top-three jobs

- **Data encoding:** the limits are stated honestly. D's greyscale chart images exist but aren't linked anywhere, and E has no equivalent.
- **Contrast:** the result is reported as passed but no output is included, and it covers token pairs only. Rendered icons, chart patterns and dark green links remain to be checked.
- **Text scaling:** only a 24px browser diagnostic exists. VERIFICATION correctly says this is not acceptance of iOS text scaling.
- **First run:** this is a written proposal with no screens, so there is no visual evidence. Reading RESEARCH's own Apple guidance, which favours asking for permissions in context, does not obviously support asking about devices immediately after signup. The packet should call that a judgment, not something the source supports.
- **Tabs:** the change is labels only, and that is clearly stated. Where profile and settings move to is unresolved. Record is correctly required to open a destination, with Start as a separate explicit action (RESEARCH and REVIEW-SCOPE). No screenshot shows the Record destination.
- **Top three jobs:** see today, log food, and open a recent or older workout are defined well in VERIFICATION, which warns against equating fewer taps with success. E doesn't show the proposed always-available food entry for someone with no food logged yet. The tap counts come from inspected routes, not from a study.

**What static screenshots cannot show:** I cannot verify VoiceOver, iOS text scaling, the device keyboard, real usability, real provider pushes, backup restoration or alert delivery from these screenshots.

## 5. Launch checklist

The checklist separates "what the review establishes" from "what's required" well, and it explicitly treats dashboards, closed issues, code and public docs as not counting as acceptance.

Gaps:
- There is no column for status, evidence date or who accepted each item, so "implemented" and "externally accepted" can't be recorded separately later.
- Possible App Store items aren't listed: in-app account deletion, the age rating and export compliance answers, and the HealthKit-specific privacy and usage text. I haven't checked whether these already exist.
- REVIEW-SCOPE still lists "final beta destination works" as needing review, while VERIFICATION says "beta destinations were checked". Clarify which one is true.

## 6. Unsupported claims, completion statements, privacy and packaging

- **Research:** the limits are stated well throughout. Two notes:
  - Material empty states cites Material 1 (`m1.material.io`), which is a legacy source.
  - The Garmin Starter and CISA statements depend on pages I couldn't check.
- **Completion statements:**
  - VERIFICATION reports the contrast checks, the 330px check and the draft-retention check in the past tense, but includes no output.
  - The "Packaging checks" section describes what the checks do but doesn't say they passed, or when.
- **Privacy:** see finding 1. The "Private preview" captions are acknowledged. No credentials or real records are visible.
- **Packaging:**
  - `index.html` doesn't link `VERIFICATION.md`.
  - `e-brighter-white/secondary-review.png` and D's two greyscale chart images are in the packet but nothing links to them.
  - The index says that approving a direction "would authorize a later implementation proposal". That is softer than the README's wording; align the two.

## 7. What the owner should review next (I am not choosing a direction)

1. Confirm the map routes and start points are synthetic (finding 1).
2. Look at E's light and dark Food and Today screens at actual size. Decide whether the white canvas, the grey data and the bold type feel right or still too flat or too heavy, and whether the shadows are welcome. "None yet" remains valid.
3. Separately, review the homepage story: the number of CTAs, the Friends screenshot, and how readable the phone captures are on mobile.
4. If E or a variant moves forward, ask for one consistent "selected" style and one panel style before any implementation PR. Then run a chart-identification check and a task test of the top three jobs.

These recommendations don't authorize implementation, publication or merging.
