# Verification and limits

## Existing evidence behind these proposals

The proposals were rendered against an isolated fresh-install demo environment, using fictional records. App captures cover Today, Food, workout detail and the friends feed at 390px in both themes. Homepage previews were inspected at desktop and phone widths. Earlier audit work captured 48 states, including first run, empty screens, settings and enlarged-text diagnostics. That is a coverage description, not 48 usability participants or 48 passing acceptance tests.

Each palette passed the existing 262 token contrast checks during preview preparation. Those pairs do not cover every rendered icon, chart boundary, state or map. Preview checks included chart Days/Weeks and Food navigation, 330px layout, a 24px root/body text diagnostic, and food-draft retention after background tap and reload. The latest white proposal rendered a white light-mode body on the four captured app routes. Homepage screenshot loading, phone layout, focus visibility and beta destinations were checked. Full raw test output and session exports are intentionally excluded from this public packet.

These records describe earlier preview verification; this packaging PR does not rerun or certify the unchanged product. Current-source Python compile and JavaScript syntax checks passed during the original exploration. No full API-suite, upgrade, native-device or production regression claim is made for the visual proposals.

## Packaging checks

The packaging pass checks that every relative gallery/document image link resolves, copied PNG files decode, the gallery opens locally, and the package contains only review documents and curated demo images. It also checks the branch diff against main: no app, site, mobile, workflow, token or existing design-guide changes. Claude's completed read-only review and follow-up notes are in CLAUDE-REVIEW.md.

Packaging results: 85 curated PNGs passed structural/CRC checks; 168 local references resolved before the Claude report was added. The gallery loaded all 72 inline images with no horizontal overflow, missing image descriptions or page errors at 1440px, 390px and 330px. Direction links worked, and direct local-file opening worked. Additional PNGs are available through the linked image folders. The browser image decoder verified the inline captures; these results do not re-test the product.

Final package checks after adding the Claude report: 174 local references resolved; every one of the 85 PNGs matched an original preview image byte for byte. The portable ZIP passed integrity checks. No mockup image was revised in response to the review.

## Remaining checks after a design is selected

- Task testing with representative people: see today, log food, open a recent and an older own workout. Count taps, wrong turns and recovery; do not equate fewer taps with success by itself.
- Actual iPhone Dynamic Type, VoiceOver order/names, dark mode, focus, touch targets and software-keyboard visibility/dismissal. The 24px browser diagnostic is not OS text-scaling acceptance.
- Chart identification with multiple sports, patterned tiny stacks, low vision, colour-vision differences and greyscale. Distinct macro names/numbers must remain legible when hues disappear.
- Full homepage readability, image accuracy, disclosures and available integrations; content review before publication.
- Fresh-install/full regression checks appropriate to implementation; migration upgrade checks only if a future change adds a migration.
- Native store exports, reviewer access, provider approval/real pushes, off-site backup restore and delivered alert evidence. None is established by a screenshot.

No outcome data establishes improved conversion, retention, accessibility conformance, meal-estimation accuracy or training results. Those claims require their own evidence.
