# Physical iPhone acceptance for #108 / #122 R

Status: **pending owner testing on an installed signed build**. Browser stand-ins and unsigned Apple SDK builds are engineering evidence, not proof of locked-screen GPS, Health delivery or battery use. No new recording feature is introduced by R.

Use a fictional `zz_test` account and a short safe outdoor route. Keep the phone owner in control; do not operate it remotely. Record build, iOS version, device, permission choices, duration, observed result and exported-route comparison. Do not publish personal locations, screenshots, tokens or Health records.

| Check | Expected result | Device result |
|---|---|---|
| Run/walk with screen locked for several minutes | Native points/time continue; no straight-line gap invented | Pending |
| Cycle/walk with another app foregrounded | Recording continues; visible iOS location indicator | Pending |
| Pause, lock, move, resume | Paused movement excluded; separate route section | Pending |
| Poor signal / reduced accuracy / permission denied or revoked | Honest status; no invented distance; safe retry/recovery | Pending |
| Lose network, finish, reopen, reconnect | Private pending save survives; upload exactly once | Pending |
| Interrupt/reopen without force quit | Recover the owner’s journal and correct running/paused state | Pending |
| Force quit / OS termination / reboot | Explain interruption; recover paused; no invented background points | Pending |
| Storage failure | Explain unsaved state; never claim saved; existing journal preserved | Pending |
| Sign out / switch account during recording or save | No cross-account draft, points or upload | Pending |
| Battery / accessibility | Reasonable battery usage; VoiceOver, Dynamic Type and controls usable | Pending |
| Health: end workout, open/resume Kinetta | Catch up; last-success/pending/error truthful; no permission prompt on open | Pending |
| Health: locked delivery, logout, offline/retry, later route details | Correct owner, dedupe and retry; Garmin delay/maps explained | Pending |

Compare the exported GPX/recording sections, time and distance with the route actually taken. Treat inaccuracies, missed points or false saved states as failures to fix before acceptance. Keep raw device evidence private. Once Ben supplies results, record a de-identified outcome and link any fixes; do not mark the table passed in advance.
