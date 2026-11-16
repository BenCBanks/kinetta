# Groups: real-iPhone QA checklist

Use this for a TestFlight build containing Groups sharing (#1121), goal sports and start dates (#1132), and Monday recaps (#1133). Record the app version/build, iPhone model and iOS version with the results. Use throwaway accounts and fictional activity only.

## Prepare

- Use a test group with at least three active, visible members; combined totals and recap controls are hidden below that privacy floor.
- Choose and record the group time zone. The Monday recap is generated after 9:00 a.m. local Monday; do not change the phone clock to force it.
- Keep one member opted out of the recap and one opted-in member unmuted. Check that account-wide sharing is enabled only for test accounts intended to contribute.

## On-device checks

- [ ] **Join default:** accept a fresh group invite. Confirm the member joins without changing the existing shared total, and that their activity remains out of group progress by default (`just_in`). Rejoining after leaving should start private again. The current invite screen has only **Join** and **Not now**; it does not expose a per-group “Share my total” choice. If Ben expects that opt-in control here, record it as a UI gap rather than treating the default check as coverage of opt-in.
- [ ] **Sports filter:** create or use a test group scoped to Run, with a goal start date. For a preconfigured group with three eligible sharing members, confirm an in-range Run affects progress and weekly totals; Ride or Hike, an activity before the start date, and an activity set to Only me do not. Verify the selected sports are shown on the group goal.
- [ ] **Goal Cheers:** tap the reaction control on the goal card, choose a reaction, return to the group and confirm it remains selected. Remove your reaction and confirm the summary count drops by one.
- [ ] **Monday recap:** in a group with at least three active members, opt one member into **Get Monday recap** and leave another opted out. After the next local Monday 9:00 a.m. run, the opted-in, unmuted member should see one “Monday recap from …” item in the in-app bell; tapping it opens the group. Opted-out and muted members should not see the item, and turning the option off should remove it. This is **in-app only**: no APNs push/banner is sent by this build, so do not mark push delivery as tested.
- [ ] **Event recap name consent:** on a dated group’s event recap, include one participant who opted in and one who did not. Confirm only the opted-in name appears, and sharing the recap opens the native share sheet with the recap image.

## Record separately

Mark each item pass, fail or blocked. A browser/CI pass is not physical-iPhone evidence. If the run cannot reach a real local Monday, record the recap timing check as blocked rather than using a synthetic notification as proof of device delivery.

Refs: [#527](https://github.com/BenCBanks/kinetta/issues/527), [#1121](https://github.com/BenCBanks/kinetta/pull/1121), [#1132](https://github.com/BenCBanks/kinetta/pull/1132), [#1133](https://github.com/BenCBanks/kinetta/pull/1133).
