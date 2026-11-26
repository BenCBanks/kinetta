"""Historical cache counterfactuals: candidate rows and changed evidence identities cannot be reused."""
import copy
import unittest
from unittest.mock import patch
from kit_weekly_gate import cached_baseline,dates,LIVE,INSTALLED
from kit_gate_resume import preflight,serial_results


class WeeklyGate(unittest.TestCase):
    def cache(self):
        return dict(dates=dates(),baseline_commit=LIVE,installed_report_sha256=INSTALLED,
                    results=[dict(variant='baseline',case='meal',historical_baseline=True,provider_requests=2)])

    def test_cache_is_only_historical_baseline(self):
        cache=self.cache()
        self.assertEqual(cached_baseline(cache,[('meal',)],LIVE),cache['results'])
        for change in (dict(variant='candidate'),dict(case='unknown'),dict(historical_baseline=False)):
            bad=copy.deepcopy(cache);bad['results'][0].update(change)
            with self.assertRaises(ValueError):cached_baseline(bad,[('meal',)],LIVE)
        bad=copy.deepcopy(cache);bad['results']*=2
        with self.assertRaises(ValueError):cached_baseline(bad,[('meal',)],LIVE)

    def test_dates_live_source_and_installed_report_fail_closed(self):
        for change in (dict(dates=['1999-01-01']*2),dict(baseline_commit='other'),dict(installed_report_sha256='other')):
            with self.assertRaises(ValueError):cached_baseline(dict(self.cache(),**change),[('meal',)],LIVE)

    def test_forty_candidate_jobs_once_and_missing_baseline_only(self):
        done={('baseline',i) for i in range(31)}
        jobs=[(variant,i) for i in range(40) for variant in ('baseline','candidate') if (variant,i) not in done]
        calls=[]
        def run(job):calls.append(job);return dict(error=None)
        list(serial_results(run,jobs))
        self.assertEqual(len(calls),49)
        self.assertEqual(len([j for j in calls if j[0]=='candidate']),40)
        self.assertEqual(len(calls),len(set(calls)))
        plan=preflight(2.5,0,len(jobs))
        self.assertLess(plan['estimated_remaining_usd']+plan['reservation_headroom_usd'],2.5)


if __name__=='__main__':unittest.main()
