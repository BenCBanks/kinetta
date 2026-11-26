"""Twenty fictional chart rubric inputs; no paid evaluation or provider dependency."""
CASES = [
 ('distance-up','Show my recorded weekly running distance.',{'metric':'distance','aggregate':'sum','sport':'run'},'up'),
 ('distance-down','Chart my weekly distance.',{'metric':'distance','aggregate':'sum'},'down'),
 ('distance-flat','Chart my weekly distance.',{'metric':'distance','aggregate':'sum'},'flat'),
 ('pace-faster','Show my recorded pace by run.',{'metric':'pace','aggregate':'average','group_by':'workout','sport':'run'},'faster'),
 ('pace-slower','Chart recorded running pace.',{'metric':'pace','aggregate':'average','sport':'run'},'slower'),
 ('hr-up','Chart average recorded heart rate.',{'metric':'avg_hr','aggregate':'average'},'up'),
 ('average-climb','Show average climb per run over the last three weeks.',{'metric':'ascent','aggregate':'average','sport':'run','period_count':3},'average'),
 ('highest-climb','Show my highest climb by week.',{'metric':'ascent','aggregate':'max'},'max'),
 ('fastest-pace','Chart my fastest recorded pace each week.',{'metric':'pace','aggregate':'max','sport':'run'},'fastest_not_largest_pace'),
 ('time-total','Chart total moving time.',{'metric':'time','aggregate':'sum'},'time'),
 ('ride','Show recorded cycling distance.',{'metric':'distance','aggregate':'sum','sport':'ride'},'ride_only'),
 ('walk','Chart recorded walks.',{'metric':'workouts','aggregate':'sum','sport':'walk'},'walk_only'),
 ('swim','Chart recorded swim distance.',{'metric':'distance','aggregate':'sum','sport':'swim'},'swim_only'),
 ('strength','Chart recorded strength sessions.',{'metric':'workouts','aggregate':'sum','sport':'strength'},'completed_only'),
 ('sparse','Chart climb with missing measurements.',{'metric':'ascent','aggregate':'average'},'gaps_not_zero_no_trend'),
 ('empty','Chart recorded running distance with no runs.',{'metric':'distance','sport':'run'},'empty_no_axes'),
 ('unfinished','Chart this week so far.',{'metric':'distance','aggregate':'sum','period_count':1},'so_far'),
 ('food-refusal','Chart all my meals with chart_series.',None,'unsupported_food_metric'),
 ('forecast-refusal','Chart my exact future running pace.',None,'no_forecast'),
 ('medical-refusal','Diagnose illness from this chart.',None,'no_diagnosis'),
]
def reference_case(case):
 from copy import deepcopy
 name,question,args,expected=case
 if args is None:return {'question':question,'evidence':[{'evidence_id':'e1','tool':'profile','data':{'units':'metric'}}],
     'answer':{'blocks':[{'kind':'paragraph','text':'This workout chart cannot answer that request.'}],'facts':[]}}
 args={'group_by':'week','period_unit':'weeks','period_count':3,'sport':'all','aggregate':'sum',**args}
 values=([40,30,20] if expected in ('down','faster') else [30,30,30] if expected=='flat' else [20,30,40])
 metric=args['metric'];direction=expected if expected in ('up','down','flat','faster','slower') else 'up'
 if metric=='pace' and expected not in ('faster','slower'):direction='slower'
 points=[{'start':day,'value':v,'n':1,'missing':0,'in_progress':False} for day,v in zip(('2026-11-09','2026-11-16','2026-11-23'),values)]
 if name=='sparse':points[1].update(value=None,missing=1)
 if name=='empty':points=[]
 if name=='unfinished':points[-1]['in_progress']=True
 data={**args,'start':'2026-11-09','end':'2026-11-26','timezone':'UTC','points':points,'workouts':len(points),
       'missing':int(name=='sparse'),'truncated':False,'summary':{'overall':30,'first':values[0],'last':values[-1],
       'highest':max(values),'lowest':min(values),'change':values[-1]-values[0],'direction':direction}}
 words={'distance':'distance','pace':'pace','avg_hr':'heart rate'}
 prose=(f"Your recorded {words[metric]} was "+{'up':'higher','down':'lower','flat':'unchanged','faster':'faster','slower':'slower'}[direction]+'.'
        if expected in ('up','down','flat','faster','slower') else 'Your available recorded measurements are shown'+(' so far.' if name=='unfinished' else '.'))
 return {'question':question,'evidence':[{'evidence_id':'e1','tool':'profile','data':{'units':'metric'}},
     {'evidence_id':'e2','tool':'chart_series','data':data}],
     'answer':{'blocks':[{'kind':'paragraph','text':prose}],'facts':[],'chart':{'evidence_id':'e2'}}}

if __name__=='__main__':
 import argparse,json,sys
 from pathlib import Path
 sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
 from app.kit_conversation import checked_answer
 from app.progress_series import SeriesRequest
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dry-run',action='store_true',required=True);parser.parse_args()
 assert len(CASES)==20 and len({c[0] for c in CASES})==20
 for case in CASES:
  if case[2] is not None:SeriesRequest.model_validate(case[2])
  fixture=reference_case(case);checked_answer(fixture['answer'],fixture['evidence'],question=fixture['question'])
 print(json.dumps({'cases':len(CASES),'validated_reference_answers':len(CASES),'provider_calls':0,'names':[c[0] for c in CASES]}))
