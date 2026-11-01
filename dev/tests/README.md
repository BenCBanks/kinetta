# Browser spacing audit

Use a disposable local Compose copy with the fictional demo data already loaded, as described in
`run.sh`. Fixture preparation rejects a remote URL or a URL whose port does not match its Compose
project. It replaces only its named fictional fixture accounts; never point it at a real installation.

```sh
export KINETTA_URL=http://localhost:8798 KINETTA_PROJECT=kinettatest
python 3 dev/tests/spacing_prepare.py
npm install --prefix /tmp/spacing-browser playwright
/tmp/spacing-browser/node_modules/.bin/playwright install --with-deps chromium
node dev/tests/test_spacing_geometry.cjs
NODE_PATH=/tmp/spacing-browser/node_modules node dev/tests/test_spacing_dom.cjs
NODE_PATH=/tmp/spacing-browser/node_modules node dev/tests/spacing_audit.cjs
```

The audit opens 16 fixed scenes in four size/theme combinations: 390×844 with a 16px root and
330×667 with a 24px root, light and dark. It traverses page/sheet scrolling, waits for initialized
screens and stable geometry, and verifies that the intended fictional account remains signed in.
All saves, device operations, external maps, food lookup and model calls are blocked or replaced
with fictional stand-ins. These are browser measurements, not physical iPhone acceptance.

Failures name the screen, selector, measurement and required value. Set `KINETTA_SPACING_REPORT`
to choose the JSON report, and `KINETTA_SPACING_SHOTS` for screenshots. CI also writes a readable
job summary and retains fictional evidence. `KINETTA_SPACING_FIXTURES` selects the fixture manifest;
the default files are in `/tmp/<project>-spacing-*.json`. For a local subset only, set
`KINETTA_SPACING_SCREENS='Me,Lifting with sets'`; CI always runs the whole list.

The limits are 44×44px targets,8px neighbouring gaps,44px input height/16px input type, the type
scale in `docs/design.md`, one hero value per card/sheet, no horizontal page overflow and no
clipped text. Type maxima scale with enlarged root text; minima are not weakened. Inline sentence
links and the small, justified `spacing_exceptions.json` list are the only exceptions. Changing
an exception requires a specific selector, reason and metric; unfinished violations need a linked
issue. Each intentional overlay names its exact partner and requires exposed hit areas for both
controls at a reachable scroll position. That proof applies only to the same still-eligible
rule and pair, at no larger overlap; permanently blocked or clipped targets still fail.
Horizontal traversal uses overlapping half-width steps so card snapping cannot skip a corner.

To check a regression, temporarily set the lifting row gap to 2px in your local branch, rebuild
that disposable app, and run the lifting subset. It must exit nonzero and name the too-close row
controls. Restore the file and rebuild afterward. `test_spacing_geometry.cjs` also verifies this
case,43.9px targets,7.9px gaps, overlap, type limits, input limits and narrow exception boundaries.
`test_spacing_dom.cjs` verifies nested disclosures, hidden controls, checkbox labels, numeric
action labels, split heroes, units, placeholders and ancestor clipping.
