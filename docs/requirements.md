# Writing requirements that are ready to build

Keep one ordered roadmap in [ROADMAP.md](../ROADMAP.md), and one GitHub issue for each independently reviewable change. Plain language is enough; implementation details can be worked out during development.

For each issue, fill in:

```text
Title:
Problem: What is difficult or missing today? Who experiences it?
Outcome: What should the person be able to do afterwards?
Example: A concrete before/after situation.
Must have: Behaviors that are required, in priority order.
Out of scope: Things this task should leave for later.
Done when: Observable checks that prove the outcome.
Dependencies: Accounts, permissions, other work or decisions needed first.
Constraints: Privacy, devices, offline behavior, design and cost limits.
Release: Build/test only, PR, or approved deployment scope.
```

## Example: automatic Apple Health uploads

- **Problem:** People must open Kinetta to bring in a new workout.
- **Outcome:** iOS can bring in workouts in the background, and opening the app catches up after delays.
- **Example:** Finish a run while offline; after reconnecting or reopening Kinetta, the run appears once, with its available route and heart rate.
- **Must have:** Durable retry queue; consent for the selected account/server; upload acknowledgement before removal; logout/disconnect stops uploads; visible pending/error status.
- **Out of scope:** Android, reading sleep, editing Apple Health, guaranteed instant delivery.
- **Done when:** Build passes; physical iPhone tests pass for inactive/locked/offline/relaunch/expired-login/account-switch scenarios; repeated deliveries produce one workout; no cross-account uploads occur.
- **Dependencies:** Matching Apple signing capability and an owner-installed signed build.
- **Constraints:** Private by default; Health data only to the selected server; no AI sharing without separate consent.
- **Release:** Prepare code and tests; record the actual build/device/release status before calling it complete.

## Keep decisions easy to find

Write preferences as explicit rules: for example, "Food logging should take as few taps as possible" or "Each person sees only their own data." Put enduring rules in repository instructions or product requirements; keep temporary priorities in the roadmap.

Use **Now / Next / Later** to express order. Keep Now small and put its tasks in a numbered sequence. Say whether a Later item is a possible idea or an agreed requirement. When priorities change, change the order instead of leaving competing lists in chat.

You can give a rough brief in chat: "Here are the problems, in order, and what I want the result to feel like." The agent can turn it into testable requirements, identify missing decisions and propose scope. The owner decides priorities and release authority; the agent maintains progress and evidence.
