# Parked: food on training days

Removed from the active app at the owner's request on October 24, 2026. This is a source archive, not an enabled feature. No file here is loaded by the app or included in its Docker image.

Original integrated source: commit `4fc1a9c`, originally delivered in PR #162. The archived Python engine, client module, stylesheet, design notes, settings API, goal-policy integration and tests preserve its behavior. `git show 4fc1a9c:app/api_food.py` and `git show 4fc1a9c:app/energy.py` recover surrounding integration if needed.

Current behavior: the usual saved calorie target applies every day. An explicit per-day goal still takes priority. No plan-based allowance, training-day target control, carbohydrate guidance or long-day prompt runs. Recorded workouts and energy expenditure remain available. Existing schema columns, accepted check-in metadata, exports and historical migrations stay intact for installed database compatibility; their presence does not enable the feature.

Before rebuilding:

1. Obtain a new product decision about its purpose, placement and opt-in behavior. Do not restore the old automatic defaults by accident.
2. Review the archived adult eligibility, minor handling, unavailable measurements, nonnegative allowance and accepted-check-in exercise protection. Preserve explicit per-day goals, own-account SQL/RLS and unknown nutrition.
3. Reconcile with current `energy.day_goals`, food day readers, calendars/insights, check-ins and AI tool context. One shared calculation must supply every view; planned and recorded exercise must never be added twice. Updating model-visible tool output also requires current AI evaluation and release gates.
4. Add a clear off switch and explain the proposed target before any change. Keep the regular food log complete without the feature. Review published nutrition references again before adding guidance.
5. Restore/adapt tests for target consistency, explicit saves, adult/minor/unknown cases, two-account isolation, retries, account changes and rollback. Test fresh installs and any new migration on an upgrade; never rewrite migration 57.
6. Check phone light/dark/large-text behavior and update the feature/help catalog, cache versions, design guide and release notes. Do not re-enable it merely because archived tests pass.
