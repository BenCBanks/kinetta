# Weekly food review

Overview starts with a review of the last seven completed days in your profile's time zone. Today stays out so an unfinished day is not compared with a completed one. The range dates remain visible. No watch, body measurements, AI permission or calorie target is required.

A day counts as logged when it has any food entry. That is separate from the more selective days used in energy estimates; neither count proves that everything eaten was recorded. Missing days are not zero intake, and there are no streak penalties.

The review shows recorded protein by meal, fiber, sodium, total sugar and saturated fat, plus up to five recorded calorie sources. Values are totals across the seven days, not daily averages or measurements of actual intake. A reported zero stays zero. Missing source values and explicit unknown markers are excluded from totals and counted; mixed coverage is labelled as a known subtotal rather than a complete intake. An empty week does not produce a zero-stat review card.

One or two short suggestions come from these records only: reuse an already logged portion for easier logging, inspect protein distribution, fill missing label/recipe values, or check the saved portion of a frequent calorie source if it changed. These are optional observations, not a diagnosis or a prescription to eat less. No clinical threshold or automatic target change is introduced.

The authenticated `/api/food/weekly-review` reader selects only the signed-in person's rows. It writes no message, target, meal or AI attempt. Existing Kit prompts, tools and inputs stay unchanged; its optional review remains separate. The card keeps cached records visible during a failed refresh and offers Retry. A cold offline visit can require a connection; this read-only review does not add an offline data store.

Tests use synthetic weeks and throwaway accounts, including two local time zones around midnight, missing values, reported zero, current/old dates and owner isolation. Browser evidence covers330/390px, light/dark and large text. Physical-iPhone Dynamic Type, VoiceOver, keyboard and touch acceptance is separate.
