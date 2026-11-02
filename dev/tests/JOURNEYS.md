# Journeys and intended link destinations

These checks use fictional accounts on a disposable local deployment. The independent
guard requires this checkout, its marked app, its own named volumes and a loopback-only
published port. Use `dev/tests/journeys-compose.yml` alongside the normal Compose file.
Never point the scripts at an existing installation or another checkout.

Start a fresh test project and load the normal `dev/demo/seed.py` and
`dev/screenshots/stage.py` fixtures as described in `dev/screenshots/README.md`, then run:

```sh
export KINETTA_URL=http://localhost:8798 KINETTA_PROJECT=kinettatest
python3 dev/tests/test_journeys_guard.py
node dev/tests/test_link_contract.cjs
python3 dev/tests/journeys_prepare.py
node dev/tests/journeys.cjs
node dev/tests/links.cjs
```

Playwright must be installed. GPS/recording transport, Kit availability/conversation and
notification delivery are stand-ins; notification destinations come from the backend's
actual kind-to-link function. Only the recording-save and food-review journeys may save
fictional records. The food journey checks that a draft adds nothing and explicit review
adds exactly one entry. Other navigation writes are blocked or acknowledged without saving.

Add a row to `journey_scenes.cjs`: `start`, real control selectors in `taps`, and `end`
with the expected URL, visible title and loaded key element. Optional `back` checks the
app's Back control; use `startReady` for asynchronous starting screens. The same module
reuses the spacing scene list for link collection and the later gallery work.

`KINETTA_JOURNEY_CASE=me-profile` runs one case for debugging. Its report is explicitly
partial and cannot satisfy the complete link check. Reports default to
`/tmp/<project>-journeys-report.json` and `/tmp/<project>-links-report.json`; override with
`KINETTA_JOURNEY_REPORT` and `KINETTA_LINK_REPORT`. Failed cases still appear in the report
and the process exits nonzero. Set `KINETTA_JOURNEY_SHOTS` to retain destination/failure images.

The link checker rejects unknown routes, ignored view selectors, mismatched control labels
and unapproved external links. Downloads cannot follow a redirect outside the fixture.
It temporarily breaks the real View progress link to `view=training` and proves that the
same checker rejects it; a hidden-heading proof protects title checks. `--rendered-only`
is a clearly labelled partial diagnostic, never complete dynamic `go()` acceptance.

Record both scripts' reported durations; their added normal runtime should stay below
five minutes. Workflow wiring awaits the Core handoff. Browser/native before-and-after
galleries are separate later steps of #429; this first step does not claim them.
