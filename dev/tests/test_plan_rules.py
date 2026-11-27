"""Exhaustive launch-rule regressions; original generator bodies, fictional data, stdlib only."""
import ast
import copy
import datetime as dt
import importlib.util
import itertools
import json
import math
from pathlib import Path
import sys
import types
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from app import plan_prescription as rules

# Execute the actual pure plan functions without importing DB/HTTP/provider infrastructure.
analysis={ 'math':math }
tree=ast.parse((ROOT/'app/analysis.py').read_text())
exec(compile(ast.Module([n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('_vo2_of_speed','_pct_of_duration','vdot','race_time')],[]),'analysis.py','exec'),analysis)
class Rejected(Exception):
    def __init__(self,status_code,detail): self.status_code,self.detail=status_code,detail
G={'dt':dt,'math':math,'plan_prescription':rules,'HTTPException':Rejected,'PlanIn':types.SimpleNamespace,'analysis':types.SimpleNamespace(**analysis)}
functions={'_speed_at','paces','fmt_pace','_pace_txt','_r','_build_legacy','build','_quality','_monday','_settings','_summary'}
constants={'MI','RACES','LEVELS','RACE_PACE','LEVEL_NAMES','DAYS','RUNWALK','EFFORT'}
tree=ast.parse((ROOT/'app/plans.py').read_text())
exec(compile(ast.Module([n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in functions or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in constants for t in n.targets)],[]),'plans.py','exec'),G)
BASE=dt.date(2027,3,8)
def setting(race='marathon',level='beginner',weeks=18,runs=4,long_day=6,unit='mi',dow=None):
    return dict(race=race,level=level,weeks=weeks,runs=runs,long_day=long_day,unit=unit,start_day=BASE,race_day=BASE+dt.timedelta(weeks=weeks-1,days=long_day if dow is None else dow),goal_s=None,start_vol=0)
def history(p):
    L=G['LEVELS'][p['race']][p['level']]
    volume=L.get('vol',(3,3))[0]*rules.MI
    longest=L.get('long',(1,1))[0]*rules.MI
    # A consistent base including a measured long run, not a fabricated empty-history seed.
    return dict(as_of=str(BASE),source='logged_running',weekly_m=volume,week_totals_m=[volume]*4,
                run_days_per_week=p['runs'],longest_m=longest,days_since_run=1,
                recent_runs=[{'day':str(BASE-dt.timedelta(days=i)),'distance_m':longest if i%7==1 else volume/5} for i in range(1,29)])
def make(p,h=None,P=None):return rules.make(p,P or {},h or history(p),G['_build_legacy'],G['_pace_txt'])

class RulesTest(unittest.TestCase):
    def test_all_offered_and_race_weekdays(self):
        count=0;approved=0;refused=0
        for race,R in G['RACES'].items():
            for level,L in G['LEVELS'][race].items():
                for W,runs,ld,unit in itertools.product([9] if level=='first' else R['weeks'],range(L['runs'][0],L['runs'][1]+1),(5,6),('mi','km')):
                    for dow in range(7):
                        p=setting(race,level,W,runs,ld,unit,dow);h=history(p);snap=make(p,h);weeks=rules.weeks(snap);count+=1
                        flat=[w for wk in weeks for w in wk['workouts']]
                        issues=rules.validate(snap,p,L)
                        if issues:
                            refused+=1
                            self.assertTrue(all(isinstance(reason,str) and len(reason)>20 for reason in issues))
                        else:
                            approved+=1
                            self.assertTrue(all(wk['workouts'] for wk in weeks[:-1]))
                            if level!='first':
                                self.assertGreaterEqual(max(sum(w.get('distance_m',0) for w in wk['workouts'] if w['type']!='race') for wk in weeks),R['m'])
                                self.assertGreaterEqual(max((w['distance_m'] for w in flat if w['type']=='long'),default=0),R['m']*.6)
                        self.assertEqual(len({w['day'] for w in flat}),len(flat));self.assertEqual(sum(w['type']=='race' for w in flat),1)
                        self.assertFalse(any(w['day']==p['race_day']-dt.timedelta(days=1) for w in flat))
                        recent=[(dt.date.fromisoformat(r['day']),r['distance_m']) for r in h['recent_runs']];prior=h['weekly_m'];stress=None
                        for wk in weeks:
                            total=0
                            for w in wk['workouts']:
                                self.assertLessEqual(w['day'],p['race_day']);self.assertGreaterEqual(w['day'],wk['start']);self.assertLess(w['day'],wk['start']+dt.timedelta(days=7))
                                if w['type'] in ('race','runwalk'):continue
                                m=w['distance_m'];self.assertEqual(m,sum(rules._distance(s) for s in w['segments']))
                                self.assertAlmostEqual(w['dist']*(rules.MI if unit=='mi' else 1000),m)
                                self.assertLessEqual(m,max([v for d,v in recent if w['day']-dt.timedelta(days=30)<=d<w['day']] or [h['longest_m']])*1.1+1e-6)
                                recent.append((w['day'],m));total+=m
                                if w['type'] in ('long','medium_long','tempo','intervals','hills','fartlek'):
                                    if stress:self.assertGreaterEqual((w['day']-stress).days,2)
                                    stress=w['day'];self.assertLess(w['day'],p['race_day']-dt.timedelta(days=3))
                            if level!='first':
                                factor=.8 if wk['phase']=='Cutback' else .75 if wk['phase'] in ('Taper','Race week') else 1.15
                                self.assertLessEqual(total,prior*factor+1e-6);prior=total
                        q={**p,'unit':'km' if unit=='mi' else 'mi'};other=make(q,h)
                        self.assertEqual([[w.get('distance_m') for w in x['workouts']] for x in snap['weeks']],[[w.get('distance_m') for w in x['workouts']] for x in other['weeks']])
        self.assertEqual(count,2772)
        self.assertGreater(approved,0);self.assertGreater(refused,0)
        print(f'Finished-build audit: {approved} supported variants meet the build floors; {refused} require a stronger base/another race.')

    def test_unsupported_lengths_and_no_compression(self):
        G['_ctx']=lambda c,u:('UTC','mi',BASE);G['recent_weekly']=lambda *a:20
        for race,R in G['RACES'].items():
            for level,L in G['LEVELS'][race].items():
                for W,runs in itertools.product(range(4,25),range(3,7)):
                    b=types.SimpleNamespace(race=race,level=level,weeks=W,runs=runs,long_day=6,race_day=None,goal_s=None)
                    valid=level=='first' or W in R['weeks']
                    if valid:
                        p=G['_settings'](None,1,b)
                        self.assertEqual(p['weeks'],9 if level=='first' else W)
                        self.assertEqual(p['runs'],max(L['runs'][0],min(runs,L['runs'][1])))
                    else:
                        with self.assertRaises(Rejected):G['_settings'](None,1,b)
        b=types.SimpleNamespace(race='marathon',level='beginner',weeks=18,runs=4,long_day=6,race_day=BASE+dt.timedelta(weeks=5),goal_s=None)
        with self.assertRaises(Rejected):G['_settings'](None,1,b)

    def test_old_client_choices_normalize_before_safety_checks(self):
        G['_ctx']=lambda c,u:('UTC','mi',BASE);G['recent_weekly']=lambda *a:0
        b=types.SimpleNamespace(race='5k',level='first',weeks=8,runs=6,long_day=6,race_day=None,goal_s=None)
        p=G['_settings'](None,1,b)
        self.assertEqual((p['weeks'],p['runs']),(9,3))
        self.assertEqual(len(make(p)['weeks']),9)
        # An old eight-week selection never shortens the actual nine-week progression.
        b.race_day=BASE+dt.timedelta(weeks=7,days=6)
        with self.assertRaises(Rejected) as caught:G['_settings'](None,1,b)
        self.assertEqual(caught.exception.status_code,400)
        self.assertIn('too soon for the full plan',caught.exception.detail)

    def test_first_plan_date_allows_time_to_reach_the_milestone(self):
        G['_ctx']=lambda c,u:('UTC','mi',BASE);G['recent_weekly']=lambda *a:0
        for dow in range(7):
            p=setting('5k','first',9,3,dow=dow)
            b=types.SimpleNamespace(**{k:p[k] for k in ('race','level','weeks','runs','long_day','race_day','goal_s')})
            if dow<3:
                with self.assertRaises(Rejected):G['_settings'](None,1,b)
            else:
                G['_settings'](None,1,b)
                workouts=[w for wk in make(p)['weeks'] for w in wk['workouts'] if w['type']=='runwalk']
                self.assertIn('30 min',workouts[-1]['title'])

    def test_missing_low_base_and_time_off(self):
        p=setting();h=history(p);L=G['LEVELS']['marathon']['beginner']
        self.assertTrue(rules.readiness(h,'beginner',4,L)['eligible'])
        for changed in ({'weekly_m':0,'week_totals_m':[0]*4},{'days_since_run':35},{'days_since_run':None},{'longest_m':100}):
            self.assertFalse(rules.readiness({**h,**changed},'beginner',4,L)['eligible'])
        self.assertFalse(rules.readiness(h,'beginner',4,L,14)['eligible'])
        self.assertTrue(rules.readiness({**h,'weekly_m':0},'first',3,G['LEVELS']['5k']['first'])['eligible'])

    def test_race_eve_cutback_and_units_counterexamples(self):
        p=setting(weeks=12,dow=0);weeks=rules.weeks(make(p))
        self.assertFalse(any(w['day']>=p['race_day']-dt.timedelta(days=3) and w['type'] in ('long','medium_long','tempo','intervals','hills','fartlek') for wk in weeks for w in wk['workouts']))
        p=setting(level='intermediate',weeks=12,runs=4,unit='km');snap=make(p)
        for wk in snap['weeks']:
            for w in wk['workouts']:
                if w['type']=='intervals':self.assertEqual(w['distance_m'],sum(rules._distance(x) for x in w['segments']))
        for wk in snap['weeks']:
            self.assertLessEqual(sum(w.get('distance_m',0) for w in wk['workouts'] if w['type']!='race'),history(p)['weekly_m']*1.15**wk['n']+1e-5)

    def test_high_base_long_run_keeps_the_longest_slot(self):
        p=setting('half','beginner',12,3,unit='km');h=history(p)
        h.update(weekly_m=52000,week_totals_m=[52000]*4,longest_m=13000,recent_runs=[{'day':str(BASE-dt.timedelta(days=i)),'distance_m':13000} for i in range(1,29)])
        for wk in make(p,h)['weeks']:
            long=next((w for w in wk['workouts'] if w['type']=='long'),None)
            if long:self.assertEqual(long['distance_m'],max(w.get('distance_m',0) for w in wk['workouts']))

    def test_recent_low_week_bounds_start_and_future_rebounds(self):
        p=setting();h=history(p);h['week_totals_m'][0]=h['weekly_m']*.6
        previous=h['week_totals_m'][0]
        for wk in make(p,h)['weeks']:
            value=sum(w.get('distance_m',0) for w in wk['workouts'] if w['type']!='race')
            self.assertLessEqual(value,previous*1.15+1e-6);previous=value

    def test_older_strong_weeks_and_token_run_cannot_approve_a_collapsed_build(self):
        p=setting();h=history(p);L=G['LEVELS'][p['race']][p['level']]
        h.update(week_totals_m=[100,40000,40000,40000],weekly_m=30025,days_since_run=1)
        self.assertFalse(rules.readiness(h,'beginner',4,L)['eligible'])
        snapshot=make(p,h)
        self.assertTrue(any(not wk['workouts'] for wk in snapshot['weeks'][:-1]))
        self.assertTrue(rules.validate(snapshot,p,L),'a race appended to empty weeks never makes a valid build')

    def test_finished_build_is_checked_even_after_readiness_passes(self):
        p=setting(weeks=12);h=history(p);L=G['LEVELS'][p['race']][p['level']]
        self.assertTrue(rules.readiness(h,'beginner',4,L)['eligible'])
        self.assertIn('race distance',' '.join(rules.validate(make(p,h),p,L)))
        h.update(weekly_m=50000,week_totals_m=[50000]*4,longest_m=13000)
        p=setting(weeks=18);snapshot=make(p,h)
        self.assertEqual(rules.validate(snapshot,p,L),[])
        # Removing a whole week or reducing it to token sessions is rejected independently of readiness.
        for value in (0,100):
            broken=copy.deepcopy(snapshot)
            for w in broken['weeks'][4]['workouts']:w['distance_m']=value
            self.assertTrue(rules.validate(broken,p,L))

    def test_logged_break_cannot_be_overridden_by_missing_or_zero_answer(self):
        p=setting();h=history(p);L=G['LEVELS'][p['race']][p['level']]
        h['recent_runs']=[{'day':str(BASE-dt.timedelta(days=i)),'distance_m':10000} for i in (36,33,30,4,2,1)]
        for reported in (None,0,14):
            result=rules.readiness(h,'beginner',4,L,reported)
            self.assertFalse(result['eligible']);self.assertIn('After time off',' '.join(result['reasons']))
            self.assertEqual(result['observed_break_days'],25)
            self.assertEqual(result['resumed_on'],str(BASE-dt.timedelta(days=4)))
            self.assertEqual(result['reported_break_days'],reported)
        class C:
            def execute(self,*args):raise AssertionError('Pre-break efforts must not supply returning-runner paces')
        self.assertEqual(rules.fresh_paces(C(),1,'UTC',BASE,h,G['paces'],42195,None,None),{})
        # The SQL history rollup itself excludes the old base and longest run.
        class HistoryC:
            def execute(self,*args):return self
            def fetchall(self):return [{'day':dt.date.fromisoformat(r['day']),'distance_m':r['distance_m']} for r in h['recent_runs']]
        current=rules.running_history(HistoryC(),1,'UTC',BASE)
        self.assertEqual(current['week_totals_m'],[30000,0,0,0])
        self.assertEqual(current['run_days_per_week'],.75)
        self.assertEqual(current['observed_break_days'],25)

    def test_frozen_schedule_and_legacy_unchanged(self):
        p=setting();before=G['_build_legacy'](p,G['paces'](45));self.assertEqual(G['build'](p,G['paces'](45)),before)
        saved=make(p);a=G['build']({**p,'prescription':saved},G['paces'](25));b=G['build']({**p,'prescription':saved},G['paces'](85))
        self.assertEqual(a,b);a[0]['workouts'][0]['title']='changed';self.assertNotEqual(a,G['build']({**p,'prescription':saved},{}))
        with self.assertRaises(ValueError):G['build']({**p,'prescription':{'version':99}}, {})
        # Exact legacy output stays pinned across future changes to the new generator.
        import hashlib
        fixture=json.dumps(before,default=str,sort_keys=True).encode()
        self.assertEqual(hashlib.sha256(fixture).hexdigest(),'2efef2ed9953d1e095f94cd66ac345704e2a851f50416a0dc62cbb548a4c2687')

    def test_stale_paces_and_unrealistic_goal(self):
        # The real helper imports only analysis; supply its unchanged pure math functions.
        from unittest.mock import patch
        module=types.ModuleType('app.analysis');module.__dict__.update(analysis)
        class C:
            def execute(self,sql,args): self.args=args;return self
            def fetchall(self):return [{'distance_m':5000,'elapsed_s':1200}]
        p=setting();h=history(p)
        with patch.dict(sys.modules,{'app.analysis':module}):
            self.assertEqual(rules.fresh_paces(C(),1,'UTC',BASE,{**h,'days_since_run':35},G['paces'],42195,601,0),{})
            self.assertNotIn('goal',rules.fresh_paces(C(),1,'UTC',BASE,h,G['paces'],42195,601,0))
            self.assertEqual(rules.fresh_paces(C(),1,'UTC',BASE,h,G['paces'],42195,None,14),{})

    def test_runwalk_exact_duration_and_endpoint(self):
        p=setting('5k','first',9,3);ws=rules.weeks(make(p));last=[w for wk in ws for w in wk['workouts'] if w['type']=='runwalk'][-1]
        self.assertEqual(last['duration_s'],2400);self.assertIn('30 min',last['title'])
        for wk in ws:
            for w in wk['workouts']:
                if w['type']=='runwalk':
                    seconds=sum(s.get('duration_s',s.get('repeat',0)*(s.get('run_s',0)+s.get('walk_s',0))) for s in w['segments'])
                    self.assertEqual(w['duration_s'],seconds)

if __name__=='__main__':unittest.main()
