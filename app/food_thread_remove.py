"""Explicit removal of an unlogged review ingredient; no model or source resolution."""
import copy
import hashlib
import json
from fastapi import HTTPException
from . import food_thread,food_thread_compose as C,food_thread_sources as S


def removal_token(part):
    # Bind removal to the displayed card: a retry must never remove a shifted row.
    return hashlib.sha256(json.dumps({k:v for k,v in part.items() if k not in ('remove_token','remove_entries')},
                                    sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()


def removable_entries(part):
    if part.get('logged'):return []
    entries=part.get('entries') or []
    if part.get('drafts'):
        mapping=part.get('entry_drafts') or []
        return [i for i,d in enumerate(mapping) if mapping.count(d)==1]
    if part.get('manual') or len(entries)==1:return list(range(len(entries)))
    return []


def annotate(messages):
    # Presentation metadata is computed on reads too, so existing drafts need no migration.
    output=[]
    for m in messages:
        result=m.get('result') or {}
        if result.get('composed') and result.get('parts'):
            result=copy.deepcopy(result)
            for part in result['parts']:
                part['remove_entries']=removable_entries(part)
                part['remove_token']=removal_token(part)
            m={**m,'result':result}
        output.append(m)
    return output


def remove_food(c,uid,message,body):
    result=C.card(c,uid,message)
    if not result or not (message.get('result') or {}).get('review_only'):
        raise HTTPException(409,'Only unlogged foods can be removed here')
    C.check_live(message,result)
    part=next((p for p in result['parts'] if p['index']==body.part),None)
    if not part or part.get('logged') or removal_token(part)!=body.expected:
        raise HTTPException(409,'This food card changed. Check it before removing a food.')
    if body.entry not in removable_entries(part):raise HTTPException(422,'Choose a removable food on this card')
    part=copy.deepcopy(part)
    if part.get('drafts'):
        part['drafts'].pop(part['entry_drafts'][body.entry])
        part['entries']=S.draft_entries(part['drafts'])
        # Do not teach an alias for a meal whose ingredients were removed.
        part.pop('learn_phrase',None)
    else:part['entries'].pop(body.entry)
    result['parts']=[part if p['index']==body.part else p for p in result['parts'] if p['index']!=body.part or part['entries']]
    result.pop('error',None)
    if not result['parts']:
        result.update(kind='preview',pending_count=0,can_resolve=False,text='All foods removed. Nothing was logged.')
        return food_thread.finish_reply(c,uid,message,result)
    return C.write(c,uid,message,result)


