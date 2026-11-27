# Draft quick timing and coverage

The 26 November 2026 cancellations were job timeouts, not failed assertions:

| PR/head | Evidence | Time spent before cancellation |
| --- | --- | --- |
| #1608 / `902be929` | [quick job](https://github.com/BenCBanks/kinetta/actions/runs/45906615832/job/140204765077) | Unit/API checks finished around 22:46:57 UTC. Changed-screen preparation and spacing ran until 22:52:56; spacing alone took about 4m10s and passed 152 cases with zero violations. Serial browser checks were still passing when the job was canceled at 22:59:58. |
| #1612 / `92c6cbba` | [quick job](https://github.com/BenCBanks/kinetta/actions/runs/45908449785/job/140210750945) | Setup/demo 1m43s; unit/API 57s; changed-screen checks 12m32s before cancellation. Spacing passed 56 cases with zero violations at 23:08:06, followed by nine more minutes of passing browser checks. The Features portal step was never reached. |

Both jobs had the existing 15-minute maximum. The serial changed-screen runner combines spacing, several browser suites and contract suites; broad source changes can schedule far more work than fits that budget.

The fix retains the 15-minute limit and all assertions:

- Run each deduplicated browser suite on exactly one of three Draft quick runners, with independent app/database fixtures and `fail-fast: false`.
- Keep the existing full `spacing` job mandatory in the aggregate gate and stop repeating its audit inside quick. Local `changed.sh` still audits spacing by default.
- Keep syntax/unit/API checks on every runner; keep the aggregate Features portal check on runner 1.
- Include the core loading audit in the same deterministic suite schedule. No source mappings or contract suites are removed.

For the exact changed paths of these heads, `changed.sh --list-tests` schedules #1608's 28 unique suites as 10/9/9 and #1612's 24 as 8/8/8. These are coverage/partition counts, not measured new hosted runtimes. Broad-PR wall-clock improvement still needs a hosted run; no claim that new timings were measured locally.

`test_ci_tiering.py` checks the union and multiplicity against unsharded dispatch for both broad mappings and every tracked static path, rejects malformed shard selectors, checks nonzero suite failure propagation, and guards the unchanged limits, isolated databases, single Features check and required full spacing job. The workflow aggregate consumes the matrix result, so any failed shard remains a failed Draft.
