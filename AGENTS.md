# Working on Kinetta: instructions for AI coding agents (Claude Code, Codex, and others)

Kinetta is "your workouts and your food, in one app": activity tracking (runs, rides, walks, lifting, training plans, routes) plus
food and health (calories, macros, barcode and photo logging, weight), with each person's data private to them.
The maintainer, Ben Banks, isn't a developer: write PR descriptions and summaries in plain language, say what you
tested and what you didn't, and explain any choice he has to make.

## This repository is public
Everything committed here is published on GitHub. Never commit personal data, real people's names or activities,
house or server details (addresses, IPs, hostnames), secrets or keys, or test output. Use only the made-up demo data
in `dev/demo/`. Signing keys and API keys belong in GitHub Actions secrets, which the maintainer sets up.

## How work gets to users
- Work on a branch and open a pull request. Never push to `main`: a merge to `main` publishes the homepage
  (`site/`, GitHub Pages at kinetta.app) and the Docker image (`ghcr.io/bencbanks/kinetta`).
- The maintainer's live server is updated separately. Cloud/code-only agents must not access it. A server-resident
  agent may deploy only with the owner's session authorization and applicable private house workflow.

## Layout
| Path | What |
|---|---|
| `app/` | FastAPI server (Python 3.12). `main.py` wires the routers; `api_*.py` are the endpoints; `db.py` has the schema |
| `app/static/` | The phone app: plain JavaScript, no build step (`app.js` core + charts, `pages.js`, `food.js`, `plan.js`, `social.js`, `cook.js`, `lift.js` lifting, `native.js` iPhone-app-only parts, `style.css`) |
| `mobile/` | The iPhone app: a Capacitor shell around `app/static` plus Apple Health (see `mobile/README.md`, `docs/ios.md`); built on a macOS runner by `.github/workflows/ios.yml` |
| `site/` | The kinetta.app website: one page per tab (`index` Home, `training`, `food`, `friends`, `compare`, `privacy`, `self-host`), shared styles in `assets/site.css`. Written copy lives in `site/content/*.md`; layouts in `site/templates/`. Run `python3 dev/design/build_content.py` after changes. The feature catalog stays shared with the app; see `docs/website-content.md` |
| `docs/` | Public guides (connecting phones, SQL access) |
| `dev/demo/` | Made-up demo data for testing and screenshots |
| `docker-compose.yml` | How people install it (app + PostgreSQL 17/PostGIS, passwords generated on first start) |

## Rules that keep people's data safe
- Every endpoint uses `current_user` and reads or writes only that person's rows (`WHERE user_id = %s`).
- Every new table holding personal data gets row-level security: `ENABLE ROW LEVEL SECURITY`, the `own_rows` policy and
  `GRANT SELECT ... TO fit_readers` (copy an existing example in `app/db.py`). Admin-only tables (invites, beta
  requests) get no grant at all.
- Admin-only endpoints call `_admin(user)` from `api_account.py`.
- Never weaken login protection, the password rules, cookies or the security headers in `main.py` without saying so.

## AI architecture and evaluation

Read `docs/ai-architecture.md` and `dev/evals/README.md` before changing AI behavior. Structured activity/food/weight
records stay in PostgreSQL; use fixed, authenticated RLS tools with no model-supplied SQL or user ID. Algorithms own
training/meal numbers and allowed changes. Writes need backend validation and explicit user confirmation. Compare
prompt/model changes with reviewed production baselines before rollout; synthetic contract tests are not model
accuracy evidence. New tool-based questions stay disabled until the matching reviewed report is supplied.

## Conventions
- Database changes: append a new SQL string to the end of `MIGRATIONS` in `app/db.py`, with a numbered comment. Never
  change the SQL of a migration that has shipped; real installs have already run it.
- After changing a file in `app/static/`, bump its `?v=` number in `app/static/index.html`, or phones keep the old copy.
- Match the code around you: short functions, comments that explain why, plain-language text in the UI.
- UI: phone first. Centered, full-width buttons; roomy spacing; charts that explain themselves without helper text;
  colors from the CSS tokens in `style.css`, in both light and dark mode.
- Kinetta is source-available (PolyForm Noncommercial 1.0.0) and also sold under commercial licenses, so new
  dependencies must allow use in a commercial, closed product: permissive licenses (MIT, BSD, Apache-2.0, ISC) or
  file-level copyleft (MPL-2.0), or LGPL libraries used unchanged as separate packages (like psycopg); never GPL or
  AGPL. Add them to `THIRD_PARTY.md`.

## Working in parallel
Several agents may work on different parts at once, each on its own branch (ideally its own git worktree and its own
test copy on its own `KINETTA_PORT` and `-p` project name). Before opening a pull request, rebase on the latest `main`:
if `main` gained a migration, renumber yours to come after it, and re-bump `?v=` numbers from `main`'s values. Keep
style changes in the section of `style.css` for your area, so changes from different branches merge cleanly.

## Run and test
```sh
KINETTA_PORT=8798 docker compose -p kinettatest up -d --build      # a throwaway copy
curl localhost:8798/api/health
KINETTA_URL=http://localhost:8798 python3 dev/demo/seed.py ...    # optional demo data, see dev/demo/README.md
docker compose -p kinettatest down -v                             # remove it, data included
```
- Open http://localhost:8798: on an empty install the first account you create is the admin. Test accounts are
  named `zz_test...`.
- Before you finish: `python -m py_compile app/*.py`, `node --check app/static/*.js`, a fresh-install test, and, if you
  added a migration, an upgrade test (start on `main`, then switch to your branch on the same database).
- The test suite is `dev/tests/run.sh` (API tests with zz_test accounts, plus AI and push tests inside the container with
  stand-ins); `.github/workflows/tests.yml` runs it on every pull request. How to run it locally is at the top of the
  script. Add a test there for anything you build or fix, and check pages in a browser (Playwright) at phone width
  (390 px), light and dark, with no console errors.

## Where it's heading (the maintainer's plan, October 2026)

Read `ROADMAP.md` and its linked requirements before choosing follow-up work. It is the current ordered queue;
the historical outline below gives context. `docs/requirements.md` explains the issue format. Keep implementation,
verification, merge and release status distinct, and follow the owner's current authorization for external actions.
1. **Hosted beta**: testers ask to join at `/beta`; the admin invites them from Me > People. Done.
2. **Before more testers**: a privacy policy page, delete-my-account in the app (Apple requires it), data export. Done: Me > Your data (the iPhone app downloads through a one-time link opened in Safari).
3. **iPhone app**: a Capacitor shell around `app/static/`, reading workouts (and weight, resting heart rate, sleep)
   from Apple Health and sending them to the server. Health uploads include only records and categories a source actually writes and the user permits. Apple Watch outdoor
   GPS can include routes; Garmin may omit GPS. See `docs/apple-watch-routes.md`. The maintainer has no Mac, so builds and TestFlight uploads run on GitHub
   Actions macOS runners (for example with fastlane), with signing secrets he adds. Health data sent to an AI coach
   needs the person's explicit consent first. Android (Health Connect) comes after.
4. **Social**: friends you approve, a sharing choice per activity (only me / friends / everyone; private by default),
   hidden map start and end around home, kudos and comments, a friends feed.

Other routes for automatic uploads were ruled out: Strava's API terms forbid showing a person's Strava data to anyone
else or using it with AI, and direct Garmin access needs separate provider eligibility/approval; verify its current official terms before advising. (Uploading your own Strava
export file is different and is fine.)

## Design agent reference

Read `docs/design.md` before any UI, brand, website or screenshot work. Evergreen Agenda is the approved design system; it supersedes the old ruby palette. Preserve the conditional Today panels, stable five-tab navigation and profile/activity privacy rules described there.
