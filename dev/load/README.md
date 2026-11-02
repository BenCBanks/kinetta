# Disposable launch load report

Run against this checkout's **fresh, fictional deployment only**. No live target is supported. The guard requires a
loopback URL, matching project/checkout/port, fixture marker, database and project-owned data/secret volumes.
The provider transport, email, push and import-coach hooks are stand-ins. The app blocks outgoing Python sockets
except its database; the database network is internal. No real API keys are needed. Never copy runtime settings.

```sh
# Choose an unused local port and an image tag unique to this worktree.
export KINETTA_PORT=8899 KINETTA_VERSION=dev-launch-load
docker compose -p kt-launch-load-example -f docker-compose.yml -f dev/load/compose.yml up -d --build
# Wait for /__load_fixture to return exactly {"fictional_load_fixture":1}.
python3 dev/load/test_guard.py
python3 dev/load/run.py --url http://127.0.0.1:8899 --project kt-launch-load-example --output /tmp/load-evidence
# Remove ONLY this disposable project when evidence collection is complete.
docker compose -p kt-launch-load-example -f docker-compose.yml -f dev/load/compose.yml down -v
```

Defaults: 100 fictional accounts (the hosted cap documented in docs/ios.md, not an inspected live setting),
30 activities, 90 food records and 10 saved foods each; ten minutes, one closed-loop worker per person,
one-second jittered think time. The mix selects tab/detail reads65%, food search15%, manual logging7%,
food-message/process/resolve/review/explicit confirmation5%, reactions/comments6%, fresh FIT imports2%.
Import completion requires one added activity, zero duplicates/failures; cursors survive repeat runs.
Tab bundles include Me's statistics/activity-food/plan/food, Nutrition's thread, and Track's plan/connections.
Calls are sequential within a person's bundle; the people run concurrently. Workflow and HTTP timings are separate.
Repeated descriptions may legitimately ask for a saved-source choice. Those are recorded as held workflows,
not HTTP failures; this baseline leaves that explicit choice unresolved. Only confirmed receipts count as
completed descriptions. Precreated sessions exclude sign-up, email and login-burst capacity.
Keep separate output directories for separate deployments. Sessions are private: never publish sessions.json,
browser profiles, raw resource output, addresses or host details. Reports and test output stay out of git.

Fake model latency is200ms and fake catalog latency50ms. Real catalog normalization/cache/pacing, auth,
account isolation, request logging and estimator budget accounting remain active. Understanding/context
release gates stay off; this is no model-accuracy evaluation or measurement of real provider latency.
Success and failure/rejection percentiles are separate; a fast rejection never counts as a successful page load.
The report includes per-endpoint p50/p95/p99/status counts, complete describe/import workflows, normalized
pg_stat_statements totals and own-container resource samples. It is a closed-loop benchmark, not proof of
public-network latency, an open-loop capacity limit or production hardware performance. Review the report
and agree on fixes before changing application code.

For authenticated mobile loading, install external development tools Playwright1.63.0 and Lighthouse13.6.0
(Apache-2.0) outside the source tree, point NODE_PATH at their node_modules and use:

```sh
node dev/load/mobile.cjs http://127.0.0.1:8899 kt-launch-load-example /tmp/load-evidence/sessions.json /tmp/mobile-evidence
```

This separately measures a cold390×844 Me overview at150ms/1600Kbps/4×CPU and writes Lighthouse mobile
JSON/HTML plus actual JS/CSS transfer/decoded sizes and first-useful readiness. Providers and product writes
are blocked in the browser. Lighthouse uses simulated throttling; the explicit first-useful probe uses CDP
throttling. Keep those measurements distinct. Run it outside the load interval to avoid benchmark contention.
See the [official Lighthouse CLI documentation](https://github.com/GoogleChrome/lighthouse#using-the-node-cli).
