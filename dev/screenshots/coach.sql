-- A made-up coach note for the homepage screenshot (the demo has no AI key). Throwaway install only.
UPDATE activities SET ai_note = 'Steady 2.98 miles at 8:18 per mile with an average heart rate of 149, quicker than your usual pace on this loop at the same effort. Heart rate barely drifted in the second half, a good sign your aerobic base is building. Next run: keep it easy and finish with four 20-second strides.'
WHERE id = (SELECT a.id FROM activities a JOIN users u ON u.id = a.user_id
            WHERE u.login = 'alex' AND a.sport = 'run' AND a.distance_m BETWEEN 4600 AND 4950 ORDER BY a.start_time DESC LIMIT 1);

-- A made-up review of Alex's eating and feedback on the traybake (food_coach.py), same reason.
INSERT INTO coach_notes (user_id, kind, period_start, text)
SELECT id, 'diet', current_date, $${"headline": "A steady, well-fuelled two weeks: calories on target, with protein a little short on rest days.",
  "going_well": ["You logged 13 of the last 14 days, so these numbers are reliable.", "Breakfast is consistent: oatmeal or eggs most mornings, about 380 kcal."],
  "try_next": ["Add 150 g Greek yogurt to your oatmeal on rest days: about 15 g more protein.", "Move the salmon and potatoes dinner to the night before your long run, for the carbs.", "Have a snack after evening walks; snacks are your emptiest meal."]}$$
FROM users WHERE login = 'alex'
ON CONFLICT (user_id, kind, period_start) DO UPDATE SET text = excluded.text, created = now();
UPDATE dishes SET ai_note = $${"summary": "A 400 g portion is about 440 kcal with 40 g protein: a solid recovery dinner with plenty of vegetables.",
  "ideas": [{"change": "Cut the olive oil from 27 g to 15 g", "effect": "About 30 kcal less per portion, same roast"},
            {"change": "Swap 200 g of the sweet potato for broccoli", "effect": "Around 40 kcal less and more fibre per portion"},
            {"change": "Add a 400 g can of chickpeas", "effect": "About 6 g more protein and 5 g fibre per portion"}]}$$,
  ai_note_at = now() + interval '1 minute'
WHERE name = 'Chicken and veg traybake' AND user_id = (SELECT id FROM users WHERE login = 'alex');
