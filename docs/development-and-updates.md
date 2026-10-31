# Developing and releasing Kinetta

You can edit Kinetta in VS Code on a computer that is separate from the live server. GitHub carries the code between them; the live database stays on the server.

## What an update changes

| Changed files | How users receive the change |
| --- | --- |
| Python in `app/` | Deploy the server. Both the browser and installed iPhone app use the updated API. |
| Database migrations in `app/db.py` | Deploy the server. Startup applies only migrations that this database has not run. |
| JavaScript, HTML or CSS in `app/static/` | Deploy the server for browser users; build and release the iPhone app for its bundled screens. Content hashes stamp static URLs and the service-worker shell automatically during both builds. |
| Swift or Capacitor code in `mobile/` | Build and release a new iPhone version through TestFlight/App Store. |
| Website files in `site/` | The GitHub Pages workflow publishes the website after merge. |

The iPhone app packages a copy of `app/static/` during its build. It reads and writes account data through the selected server's API; it does not contain the PostgreSQL database. Deploying a server does not replace the files inside an already installed iPhone app. Older iPhone versions may stay installed, so server changes must continue to accept their requests.

## Work from VS Code

1. Clone the GitHub repository and create a feature branch.
2. Run a separate development app and PostgreSQL database with Docker Compose, using made-up accounts and data. Keep credentials out of Git.
3. Edit the code. If the schema needs to change, append a numbered SQL migration to `MIGRATIONS` in `app/db.py`. Never rewrite a migration that has already shipped.
4. Test a fresh installation and an upgrade from the current version using the same development database. Check that existing records survive. Run the API suite and relevant UI/native checks.
5. Push the branch, open a pull request, review the changes and merge after CI passes.
6. Deploy the approved server version separately. Back up the database first when its schema changes. Rebuild/recreate the app container while retaining the existing database volume. Startup runs the new migrations; check health, logs and the resulting schema.
7. When bundled screens or native code changed, release a matching iPhone build and test it against the deployed server.

Pushing or merging code does not automatically deploy the maintainer's live server. The repository workflows publish an image and build the iPhone app; the maintainer separately chooses the server release.

## Example: adding cycling power

A developer adds API logic for cycling power and a migration that adds its storage field. Tests run against a development database. After approval, deploying that commit runs the same migration against the live database, adding the field alongside existing activity records. Existing rows can leave it empty until power data is available.

If new Swift code is also required to read cycling power from Apple Health, users need the new iPhone build before their phones can send it. Deploy the compatible server first, then release the phone update.

Do not copy the development database over the live database to ship this feature. Schema changes travel as migrations; production records remain in the production database. A code rollback does not automatically undo a migration, so prefer additive changes and stage renames or removals across releases.

## Two ways to use VS Code

**Local clone:** files and test containers run on your computer. Push through GitHub, then deploy the approved version on the server.

**Remote SSH:** VS Code edits files on the server. This is convenient, but use a feature worktree and isolated test containers rather than editing the live checkout or experimenting against the live database. Editing files still does not update a running Docker image until it is rebuilt and deployed.


## Automatic web asset versions and draft checks

Keep `__ASSET_HASH__` in source asset URLs and `fit-shell-__SHELL_HASH__` in `sw.js`.
`app/asset_build.py` is the shared, dependency-free builder: Docker stamps its copied
`app/static` tree, and `npm run web` / `npm run sync` stamps a disposable `mobile/www/static`
copy before Capacitor copies it. Both unsigned and signed iPhone workflow builds call
`npm run sync`. Source files stay unchanged; do not commit generated output.
For a direct local web build, run `python3 -m app.asset_build app/static /tmp/kinetta-web`
with a new or empty output directory, then serve that output instead of source. Direct `uvicorn app.main:app` detects source placeholders and prepares a temporary stamped tree at startup without editing the checkout; restart it after local static edits.

Each URL carries the referenced file's SHA-256 prefix (32 hex characters). Embedded
logo and manifest-icon references resolve first, so their parent JavaScript/manifest
also gets a new URL when its actual output changes. The shell hash includes the
sorted names and canonical content of every static file, including additions,
deletions and worker changes. Canonicalising generated values avoids a hash cycle
and makes identical builds, including in-place rebuilds, byte-identical. Unchanged
file URLs stay unchanged. Private `/api/` photo versions retain their existing meaning.

Open PRs as drafts while changing them. The `quick` job runs syntax, existing pure
unit contracts and eleven API groups (accounts, ownership, activity, Health, food-related
profile data and notifications) with fictional data and no browser/native jobs; it
has a 10-minute limit. Locally use `dev/tests/run.sh --quick` against a seeded isolated
copy. Mark the PR ready when its final implementation is ready for full CI/review.
The `ready_for_review` event and pushes to ready PRs run the original complete
`tests` job and browser checks. Converting back to draft cancels the old run and
returns to quick checks. Main pushes still run the full suite.

Native build and Simulator jobs run only for ready PRs touching `mobile/`,
`app/static/`, `dev/tests/native-ui/`, the shared asset builder, native CI policy or
`ios.yml`. A git merge-base diff checks every changed path, including deletions and
renames, without an API file-count limit. Backend-only, docs-only and site-only PRs
skip them. Scheduled/manual release checks and signed-upload eligibility retain
their existing main-only boundaries. This change does not dispatch a release.

Require the full `tests` check on the final ready head in the repository's main
branch protection/ruleset; a draft's `quick` result is insufficient. Workflow YAML
cannot create repository protection settings. Reviewer verification after merge is
separate: confirm served index URLs and `/sw.js` contain hashes, change an asset and
check browser updating/offline behavior, and inspect the next owner-authorized
TestFlight bundle for the same stamping. Tests cover repeatable and changed builds,
Docker/mobile-copy parity and two disposable branches changing different parts of
one CSS file without either editing `index.html` or `sw.js`.
