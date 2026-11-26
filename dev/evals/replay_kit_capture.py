"""Offline replay of exact private fictional eval captures; never calls a provider."""
import argparse
import json
from app import coach_chat

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--input',required=True)
args=p.parse_args()
report=json.load(open(args.input))
counts={'accepted':0,'rejected':0,'truncated':0,'no_raw_capture':0,'previously_passed_no_raw':0}
for row in report['results']:
    capture=row.get('rejection') or {}
    text=capture.get('raw_model_json')
    if not text:
        counts['previously_passed_no_raw' if row.get('passed') else 'no_raw_capture']+=1
        continue
    evidence=capture.get('evidence')
    try:
        raw=coach_chat._json(text)
        if evidence is None:raise ValueError('Evidence not captured')
        coach_chat.checked_answer(raw,evidence,kit=True,weekly_review=row.get('weekly_review',False))
    except json.JSONDecodeError:
        state='truncated';reason='Incomplete JSON; never repaired'
    except ValueError as error:
        state='rejected';reason=str(error)
    else:state='accepted';reason=None
    counts[state]+=1
    print(json.dumps({'case':row['case'],'variant':row['variant'],'state':state,'reason':reason}))
print(json.dumps({'summary':counts}))
