# Recap clock-boundary review (1 November 2026, #450)

The reproduced nightly failure was an empty-state message overwriting a valid cached-data warning. The fixture
accounts explicitly use UTC, and the client normally receives that same timezone through `/api/me`; the reported
New York fallback mismatch did not cause this particular failure. Both status messages now remain visible, and
Share stays disabled for an empty picture.

Recap caching is also hardened: successful responses are stored under their returned period, start and timezone.
Offline reads validate all three, and reject an account or timezone change during the request. A loaded profile
or previously learned, owner-scoped server timezone is used; cache decisions have no hard-coded New York fallback.
A compatible older cache remains readable. Requests crossing midnight cannot save November facts under October's key.

The rendered suite uses a fixed reference instant and explicit browser timezone. Snapshot replies are calculated
by the real `recaps.facts(..., now=...)` against disposable SQL; only the browser transport is a stand-in. Additional
light/dark cases pin midday, shortly after UTC midnight, a Sunday/Monday boundary and a month boundary, with different
profile and browser timezones. Offline transport is then aborted to exercise the real cache. Backend aggregate,
ownership and period-range tests remain separate; there is no production clock override.

The following audit candidates still depend on the wall clock. These are review findings, not newly proven bugs;
changing their behavior is outside this fix.

| Area | Current dependency |
| --- | --- |
| `dev/tests/insights_fixture.py`, `weight_progress_fixture.py`, `plan_fixture.py`, `nutrition_fixture.py` | Fixtures derive dates from current time; paired rendered tests do not freeze Date. |
| `dev/tests/track_fixture.py` | Chooses a timezone according to the current weekday. |
| `dev/tests/activity_home_ui.cjs` | Uses UTC dates in a display-date assertion. |
| `dev/tests/test_progress_overview.py` | Now derives its comparison date from the server response, but still depends on current time. |
| `app/api_food.py` | Weight windows and validation use server `date.today()`; profile-local boundaries merit a separate review. |
| `app/static/pages.js` | A missing profile date falls back to UTC “today”. |
| `app/static/app.js` | Some display formatting compares browser-local years while formatting in the profile timezone. |

The date helpers outside Recaps have not been changed or declared fixed.
