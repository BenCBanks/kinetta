# Accessibility checks

The accessibility job shares the spacing audit's fictional accounts, login state, screen inventory and guarded browser contexts. It runs on every PR, including Drafts. All product writes, Health/GPS/push controls and external requests are blocked. Sign-up uses a read-only fictional open-enrollment response; it never creates an account or changes server settings.

Start and seed a throwaway copy using the [development guide](development-and-updates.md), then run the shared fixture preparation. For an already running disposable copy:

```sh
KINETTA_URL=http://localhost:8798 KINETTA_PROJECT=kinettatest python3 dev/tests/spacing_prepare.py
npm ci --prefix dev/tests/browser
# Install Chromium once: dev/tests/browser/node_modules/.bin/playwright install chromium
NODE_PATH="$PWD/dev/tests/browser/node_modules" KINETTA_URL=http://localhost:8798 KINETTA_PROJECT=kinettatest node dev/tests/accessibility_audit.cjs
```

Pinned axe checks run at 390 px in light and dark on Me, Activity, activity detail, Track before Start, Progress, Nutrition, Add food, Settings and sign-up. Serious and critical violations fail the job. Other findings and incomplete checks remain in `accessibility-evidence/report.json` for manual review; a zero failure count is not proof of full WCAG compliance. The job artifact includes screenshots and every applied exception. Exceptions name a rule, narrow selector, bounded count and written reason in `dev/tests/accessibility_exceptions.json`; never suppress a whole page or rule. Decorative avatar initials are not action labels: their explicit profile action and adjacent full name remain accessible.

## Large text: current coverage

The app scales its root and body text from the preferred body point size reported by UIKit. At 200% and the largest browser proxy, Nutrition, Add food, Choose food and sign-up are checked at 330 px in light and dark. These browser captures use 32 px and 52 px CSS roots; they are labelled proxies, not system Dynamic Type evidence. The large-text navigation keeps labels on one line and scrolls the selected tab into view. Choose food reflows its tabs, and the food composer and sign-up form remain scrollable with their primary controls reachable.

The required iPhone Simulator job adds four captures per theme at the actual `AccessibilityExtraExtraExtraLarge` category, without a forced CSS root. It verifies the UIKit category and body point size, computed text scaling, selected Nutrition tab visibility, and reachable actions on those four screens. The larger-text implementation continues in other #473 work for Activity, Me, Progress, Track and Settings. Passing this job does not establish physical iPhone, VoiceOver or switch-control acceptance.

## Real iPhone acceptance

Keep these unchecked in #471 until exercised on the combined pre-launch build:

- VoiceOver: navigate each tab, headings, chart descriptions, form fields, selected state and confirmation/errors; meaningful reading order and focus return after sheets.
- Voice Control and Switch Control: choose controls using their visible names; reach primary actions and dismiss sheets without traps.
- Largest Dynamic Type: five tabs, activity detail, Track before Start, Add food, Settings and sign-up; text wraps, content scrolls, controls remain reachable and nothing clips or overlaps.
- Software keyboard: the focused field and composer remain visible; background tap/swipe dismisses without losing drafts; selection and normal control actions still work.
- Light/dark and increased contrast/reduced transparency: readable text, visible focus/selection and chart explanations.

References: [Deque's Playwright integration](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md), [Apple's Dynamic Type guidance](https://developer.apple.com/videos/play/wwdc2024/10074/). Automated browser checks cannot establish VoiceOver, physical-keyboard or device behavior.
