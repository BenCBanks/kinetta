"""Fixed fictional workout facts, no database/model/provider/device calls."""
import copy
import math
from app import notification_words as words

ROW={'id':7,'user_id':1,'activity_id':2,'recipient_name':'Alex Example','sport':'run','activity':'Morning Run','distance_m':8062.81344,'moving_s':2460,'elapsed_s':2500,'units':'imperial'}

def facts(**extra):return {'user_id':1,'activity_id':2,**extra}


def run():
    original=copy.deepcopy(ROW)
    for sport,kind in [('run','run'),('ride','ride'),('walk','walk'),('swim','swim'),('hike','hike'),('row','row'),('ski','ski'),('workout','workout')]:
        titles={words.activity({**ROW,'sport':sport,'activity_id':i})[0] for i in range(1,4)}
        assert len(titles)==3 and all(kind in value.lower() and 'Alex' in value and len(value)<40 for value in titles)
    assert 'lift' in words.activity({**ROW,'sport':'workout','has_lifts':True})[0].lower()
    assert 'lift' not in words.activity({**ROW,'sport':'workout','sport_label':'Yoga'})[0].lower()
    assert words.activity(ROW)==words.activity(ROW)
    title,body=words.activity(ROW);assert 'Alex' in title and body=='Morning Run · 5.01 mi in 41 min' and '\n' not in body
    assert '8.06 km' in words.activity({**ROW,'units':'metric'})[1]
    best={'label':'5K','distance_m':5000,'seconds':1450,'previous':1500}
    assert words.highlight(ROW,facts(bests=[best]))=='New 5K best: 24:10'
    assert not words.highlight(ROW,facts(bests=[{**best,'previous':1450}]))
    assert not words.highlight(ROW,facts(bests=[{**best,'seconds':math.nan}]))
    ride={**ROW,'sport':'ride'}
    longest={'month':{'count':2,'previous_m':5000,'current':True},'year':{'count':10,'previous_m':20000,'current':True}}
    assert words.highlight(ride,facts(longest=longest))=='Longest ride this month'
    assert not words.highlight(ride,facts(longest={'month':{'count':1,'previous_m':ride['distance_m'],'current':True}}))
    assert words.highlight(ride,facts(longest={'year':{'count':1,'previous_m':5000,'current':False,'label':'2025'}}))=='Longest ride in 2025'
    milestone={'kind':'sport_count','amount':100}
    assert words.highlight(ROW,facts(milestones=[milestone]))=='100th run'
    assert words.highlight(ROW,facts(milestones=[{'kind':'year_distance','amount':1000,'unit':'mi','year':2026}]))=='1,000 mi in 2026'
    weekly={'count':3,'distance_m':22852.6848}
    assert words.highlight(ROW,facts(weekly=weekly))=='3rd run this week · 14.20 mi so far'
    assert not words.highlight(ROW,facts(weekly={'count':1,'distance_m':8062}))
    walk={**ROW,'sport':'walk'}
    assert words.highlight(walk,facts(break_days=14,first_today=True))=='First walk in 2 weeks. Welcome back'
    assert not words.highlight(walk,facts(break_days=14,first_today=False))
    all_facts=facts(bests=[best],longest=longest,milestones=[milestone],weekly=weekly,break_days=30,first_today=True)
    assert words.highlight(ROW,all_facts).startswith('New 5K best')
    all_facts['bests']=[];assert words.highlight(ROW,all_facts).startswith('Longest run')
    all_facts['longest']={};assert words.highlight(ROW,all_facts)=='100th run'
    all_facts['milestones']=[];assert words.highlight(ROW,all_facts).startswith('3rd run')
    assert not words.highlight(ROW,{**all_facts,'user_id':2}) and not words.highlight(ROW,{**all_facts,'activity_id':3})
    assert words.activity({**ROW,'distance_m':math.inf,'moving_s':math.nan,'elapsed_s':math.nan})[1]=='Morning Run'
    title,body=words.activity({**ROW,'activity':'A long fictional workout name '*100,'recipient_name':'Alex\nInjected title\u202e'})
    assert '\n' not in title and '\u202e' not in title and len(title)<40 and len(body)<160 and '…' in body
    assert not any(word in (title+body).lower()for word in ['calorie','streak','kit'])
    assert ROW==original
    print('Warm workout wording: sports/name/stable rotation, true highlight priority/ties, units, plain fallback, truncation and owner guards PASS')

if __name__=='__main__':run()
