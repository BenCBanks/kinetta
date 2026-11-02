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

## Large text: current limit

The browser captures normal and doubled CSS root text (16/32px). These are labelled proxies, not system Dynamic Type evidence. The initial audit showed headings growing while the fixed 15 px body did not. Fixed pixel text elsewhere also needs a measured scaling pass; this first audit batch does not claim complete 200% support. The recorded enlarged proxies also retain crowded Activities/Distance labels on Me and midword wrapping/truncated descriptions in Track’s lower cards. Those remain layout fixes for the next measured batch under #473; zero serious/critical axe findings does not resolve them.

The read-only native display bridge now exposes the effective UIKit content-size category and preferred body point size. Debug evidence records these directly from the WebView's UIKit traits, independently of JavaScript. Recording the OS preference alone does not make web text scale. A largest-category Simulator run must omit the fixture's forced CSS root, verify the actual category/point size, and compare actual computed text and reachable controls. Existing root 24 px native captures cannot substitute for it. Full Dynamic Type support and largest-category acceptance remain work under #473.

## Real iPhone acceptance

Keep these unchecked in #471 until exercised on the combined pre-launch build:

- VoiceOver: navigate each tab, headings, chart descriptions, form fields, selected state and confirmation/errors; meaningful reading order and focus return after sheets.
- Voice Control and Switch Control: choose controls using their visible names; reach primary actions and dismiss sheets without traps.
- Largest Dynamic Type: five tabs, activity detail, Track before Start, Add food, Settings and sign-up; text wraps, content scrolls, controls remain reachable and nothing clips or overlaps.
- Software keyboard: the focused field and composer remain visible; background tap/swipe dismisses without losing drafts; selection and normal control actions still work.
- Light/dark and increased contrast/reduced transparency: readable text, visible focus/selection and chart explanations.

References: [Deque's Playwright integration](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md), [Apple's Dynamic Type guidance](https://developer.apple.com/videos/play/wwdc2024/10074/). Automated browser checks cannot establish VoiceOver, physical-keyboard or device behavior.
