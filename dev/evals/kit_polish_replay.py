"""Compare saved fictional answers across render-only branches. No providers or release approval.

Both app versions run in network-disabled containers without credentials. Inputs and
private results stay outside the repository; identical historical outputs are deduplicated.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def identity(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=str).encode()).hexdigest()


def collect(paths):
    cases={};sources=[]
    def add(row,source):
        evidence=row.get('answer_evidence') or row.get('evidence')
        if not isinstance(evidence,list) or not evidence:return
        name=row.get('case','archived-answer')
        context=(row.get('observed_context') or [{}])[0]
        common=dict(evidence=evidence,question=context.get('question') or row.get('question') or ('Review my week' if str(name).startswith('weekly-') else ''),
                    history=context.get('history',row.get('history',[])),
                    weekly=bool(row.get('weekly_review') or str(name).startswith('weekly-')))
        raws=[]
        for turn in row.get('provider_turns') or []:
            if turn.get('raw_model_json'):raws.append(turn['raw_model_json'])
        for key in ('raws','answers'):
            if isinstance(row.get(key),list):raws.extend(row[key])
        direct=row.get('raw_model_json')
        if isinstance(direct,list):raws.extend(direct)
        elif direct:raws.append(direct)
        for raw in raws:
            item=dict(common,mode='answer',raw=raw)
            key=identity(item)
            if key not in cases:cases[key]=dict(item,id=key,cases=[],sources=[])
            cases[key]['cases']=sorted(set(cases[key]['cases']+[str(name)]))
            cases[key]['sources']=sorted(set(cases[key]['sources']+[source]))
        # Exercise the app-owned fallback for each distinct evidence/context pair,
        # even when the model's captured reply happened to verify.
        if raws:
            item=dict(common,mode='fallback');key=identity(item)
            if key not in cases:cases[key]=dict(item,id=key,cases=[],sources=[])
            cases[key]['cases']=sorted(set(cases[key]['cases']+[str(name)]))
            cases[key]['sources']=sorted(set(cases[key]['sources']+[source]))
    for path in paths:
        data=json.loads(path.read_text());sources.append(dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        if isinstance(data,list):rows=data
        elif isinstance(data,dict):rows=data.get('results',data.get('cases',[data]))
        else:continue
        for row in rows:
            if isinstance(row,dict):add(row,path.name)
    return dict(cases=list(cases.values()),source_files=sources)


def worker(payload):
    from app import coach_chat,kit_weekly,kit_recovery
    from unittest.mock import patch
    import time
    rows=[]
    with patch('urllib.request.urlopen',side_effect=AssertionError('Provider network forbidden')), \
         patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True), \
         patch('app.db.coach_connect'):
        for item in payload['cases']:
            row=dict(id=item['id'],cases=item['cases'],mode=item['mode'],weekly=item['weekly'])
            try:
                if item['mode']=='answer':
                    raw=coach_chat._json(item['raw']) if isinstance(item['raw'],str) else item['raw']
                    answer=coach_chat.checked_answer(raw,item['evidence'],kit=True,weekly_review=item['weekly'],conversation_question=item['question'])
                else:
                    state=dict(uid=987,evidence=item['evidence'],history=item['history'],usage={},began=time.monotonic())
                    answer=(kit_weekly.fallback(987,item['question'],state,None) if item['weekly'] else
                            kit_recovery.fallback(987,item['question'],state,None,'answer_verification'))
                row.update(status='pass',text=answer.get('interpretation'),blocks=answer.get('answer_blocks'),facts=answer.get('facts'))
            except Exception as error:
                row.update(status='reject',error_type=type(error).__name__,code=getattr(error,'reason_code',None) or str(error).split('\n')[0][:160])
            rows.append(row)
    return rows


def private_write(path,data):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as out:json.dump(data,out,indent=2)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--captures',type=Path);p.add_argument('--baseline-commit');p.add_argument('--output',type=Path)
    p.add_argument('--worker',type=Path);args=p.parse_args()
    if args.worker:
        print(json.dumps(worker(json.loads(args.worker.read_text()))));return
    if not (args.captures and args.baseline_commit and args.output):p.error('Supply --captures, --baseline-commit and private --output')
    root=Path(__file__).resolve().parents[2]
    revision=subprocess.check_output(['git','-C',str(root),'rev-parse',args.baseline_commit],text=True).strip()
    paths=([args.captures] if args.captures.is_file() else sorted(args.captures.glob('kit-gate-*.json')))
    paths+=sorted((root/'dev/evals/fixtures').glob('kit-*.json'))
    payload=collect(paths)
    if not payload['cases']:raise ValueError('No saved fictional answers found')
    with tempfile.TemporaryDirectory() as temp:
        temp=Path(temp);old=temp/'before';old.mkdir();inputs=temp/'inputs.json'
        inputs.write_text(json.dumps(payload));inputs.chmod(0o644)
        archive=subprocess.check_output(['git','-C',str(root),'archive',revision,'app'])
        subprocess.run(['tar','-xf','-','-C',str(old)],input=archive,check=True)
        def run(source):
            result=subprocess.check_output(['docker','run','--rm','--network','none','-e','PYTHONPATH=/srv',
                '-v',str(source)+':/srv:ro','-v',str(Path(__file__).resolve())+':/tmp/replay.py:ro',
                '-v',str(inputs)+':/tmp/inputs.json:ro','ghcr.io/bencbanks/kinetta:latest',
                'python','/tmp/replay.py','--worker','/tmp/inputs.json'])
            return json.loads(result)
        before,after=run(old),run(root)
    regressions=[];changed=[];rejected=0
    for a,b in zip(before,after,strict=True):
        assert a['id']==b['id']
        if (a['status'],a.get('error_type'),a.get('code'))!=(b['status'],b.get('error_type'),b.get('code')):
            regressions.append(dict(before=a,after=b))
        elif a['status']=='pass':
            if a['facts']!=b['facts']:regressions.append(dict(before=a,after=b,reason='Checked facts changed'))
            if a['text']!=b['text']:changed.append(dict(cases=a['cases'],mode=a['mode'],before=a['text'],after=b['text']))
        else:rejected+=1
    report=dict(baseline_commit=revision,candidate_commit=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip(),
                source_files=payload['source_files'],unique_cases=len(before),provider_calls=0,reviewed=False,release_report=False,
                changed=changed,regressions=regressions,unchanged_rejections=rejected,
                summary={mode:dict(cases=sum(r['mode']==mode for r in before),
                    passed=sum(r['mode']==mode and r['status']=='pass' for r in after)) for mode in ('answer','fallback')})
    private_write(args.output,report)
    print(json.dumps({k:v for k,v in report.items() if k in {'unique_cases','provider_calls','unchanged_rejections','summary'}}|
                     dict(changed=len(changed),regressions=len(regressions),output=str(args.output))))
    if regressions:raise SystemExit('Offline safety/fact outcome changed; inspect private report before proceeding')


if __name__=='__main__':main()
