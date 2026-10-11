-- A made-up coach note for the homepage screenshot (the demo has no AI key). Throwaway install only.
UPDATE activities SET ai_note = 'Steady 2.98 miles at 8:18 per mile with an average heart rate of 149, quicker than your usual pace on this loop at the same effort. Heart rate barely drifted in the second half, a good sign your aerobic base is building. Next run: keep it easy and finish with four 20-second strides.'
WHERE id = (SELECT a.id FROM activities a JOIN users u ON u.id = a.user_id
            WHERE u.login = 'alex' AND a.sport = 'run' AND a.distance_m BETWEEN 4600 AND 4950 ORDER BY a.start_time DESC LIMIT 1);
