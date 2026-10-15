# Kinetta roadmap

Last reviewed: October 15, 2026. This is the ordered work queue; [FEATURES.md](FEATURES.md) is the inventory of built features.
Requirements live in GitHub issues. Use [the requirements guide](docs/requirements.md) to make an item ready to build.

## Now — dependable workout imports

1. [#59: Apple Health background sync](https://github.com/BenCBanks/kinetta/issues/59). Native observer, durable account-specific queue, acknowledgement-based retry and secure disconnect merged. Combined permission/progress recovery, rich GPS/heart-rate enrichment and account-scoped replay have merged and are deployed (schema 39; signed TestFlight build 240). Physical iPhone/Watch acceptance remains. See [Apple Watch route checks](docs/apple-watch-routes.md). Garmin Connect does not write GPS tracks to Health; its full routes need an alternative source.
2. [#60: Conservative duplicate detection](https://github.com/BenCBanks/kinetta/issues/60). Native upload authentication has shipped; compatible sport/duration matching and replay/concurrency coverage remain.
3. [#61: Alternative-source recovery](https://github.com/BenCBanks/kinetta/issues/61). intervals.icu history and outage catch-up, format-aware imports, Health Auto Export fixtures, then real-account validation.

## Next — five-person beta

4. [#62: Installation, onboarding and beta acceptance](https://github.com/BenCBanks/kinetta/issues/62). Invite/auth tests, clear install/support instructions, isolated backup restore and five people independently using the app for a week. Owner setup and signing run alongside engineering; follow [beta-readiness.md](docs/beta-readiness.md).
5. [#64: Remaining readability and chart checks](https://github.com/BenCBanks/kinetta/issues/64). Label contrast and spacing improvements have shipped. Verify the remaining chart legends/scales, large text and truthful sync states; do not delay beta for optional visual changes.

## Separate track

- Owner queue: [#86 native owner-only workout notifications](https://github.com/BenCBanks/kinetta/issues/86),
  [#87 responsive Comments and Cheers](https://github.com/BenCBanks/kinetta/issues/87), and
  [#88 long-press Cheers people list](https://github.com/BenCBanks/kinetta/issues/88) are in development.
  Native delivery requires APNs account setup and a newly signed iPhone build; see [notification setup](docs/ios-notifications.md).

- Owner-requested social/activity polish is implemented in [PR #75](https://github.com/BenCBanks/kinetta/pull/75): double-tap Cheers people, live user search, user profiles constrained by activity visibility, visible gear deletion, shorter Me AI text and equal-sized photo/map slides. Fresh API/privacy, migration upgrade and phone/desktop browser checks passed. Native compilation and server deployment passed; physical-device acceptance remains separate.
- Evergreen UI, keyboard navigation, persistent setup/discovery, Meals and optional food/coach access controls have shipped. Website prose is now editable through [Markdown content](docs/website-content.md).
- Food logging simplification and the deterministic Kit/evaluation foundation have merged. The new tool coach stays disabled until reviewed accuracy results pass its rollout gate.
- [#63: Direct Garmin access](https://github.com/BenCBanks/kinetta/issues/63). Owner identity and provider intake/approval required. Apple Health and intervals.icu beta work can proceed independently.

## Later — candidates, not scheduled commitments

- Additional Apple Health data: weight, resting heart rate and sleep.
- Android Health Connect.
- App Store release after beta acceptance.
- Adaptive nutrition targets from food intake and weight trends.

## How to select the next task

Read this file and the linked issue, then inspect recent work and the actual branch/release state. Select the first unfinished item in **Now** whose dependencies are satisfied. If it is blocked on the owner or a provider, record the exact missing input and work on the next ready item. Update this file after a milestone: implemented, tested, merged and released are different states.

Roadmap placement expresses priority. It does not itself authorize publishing, deployment, contacting people, spending money or changing real user data; follow the current owner instructions and repository rules.
