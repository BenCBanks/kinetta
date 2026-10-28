"""Owner-confirmed edits to a displayed food, before the final logging review."""
import copy
from fastapi import HTTPException
from . import nutrients as N,food_thread_compose as C,food_thread_sources as S,food_thread_remove as R


def manual_part(part):
    # Explicit row corrections retain the other displayed foods and their sources.
    # They become a one-off reviewed snapshot, never corrections to a shared catalog.
    part=copy.deepcopy(part)
    for key in ('drafts','templates','item','recipe_pick','learn_phrase','entered_numbers','entry_drafts'):
        part.pop(key,None)
    part.update(manual=True,status='ready',looked_up=True)
    return part


def fresh_part(c,uid,part):
    """Revalidate every live source before turning a group into one-off foods."""
    if part.get('recipe_pick'):
        from .food_entry_review import dish_entry
        pick=part['recipe_pick'];part['entries']=[dish_entry(c,uid,pick['did'],pick['portion'])]
    elif part.get('drafts'):C.fresh_drafts(c,uid,part)
    elif part.get('templates'):C.fresh_templates(c,uid,part)
    elif not part.get('manual'):C.fresh_own(c,uid,part)


def edit(c,uid,message,body):
    result=C.card(c,uid,message)
    if not result or not (message.get('result') or {}).get('review_only'):
        raise HTTPException(409,'Only unlogged foods can be changed here')
    C.check_live(message,result)
    part=next((p for p in result['parts'] if p['index']==body.part),None)
    if not part or part.get('logged') or R.removal_token(part)!=body.expected:
        raise HTTPException(409,'This food card changed. Check it before changing a food.')
    if not 0<=body.entry<len(part.get('entries') or []):raise HTTPException(422,'Choose a food on this card')
    part=copy.deepcopy(part);before=copy.deepcopy(part['entries'])
    # Preserve source/ownership checks before taking an explicit one-off snapshot.
    fresh_part(c,uid,part)
    if before!=part['entries']:
        result['parts']=[part if p['index']==body.part else p for p in result['parts']]
        response=C.write(c,uid,message,result);response['changed']=True;return response
    old=part['entries'][body.entry]
    if body.amount is not None:
        factor=body.amount/old['amount'];mapping=part.get('entry_drafts') or []
        if part.get('drafts') and body.entry<len(mapping) and mapping.count(mapping[body.entry])==1:
            S.scale_drafts([part['drafts'][mapping[body.entry]]],factor)
        else:
            part=manual_part(part)
            part['entries'][body.entry]={**old,'amount':body.amount,**{k:N.rounded(k,old[k]*factor) if N.known(old,k) else None for k in N.ALL}}
    else:
        raw=body.item.model_dump();factor=old['amount']/body.basis_amount
        values={k:raw.get(k) for k in N.ALL}
        entry={**old,'name':raw['name'].strip(),'source':'quick',
               **{k:N.rounded(k,v*factor) if v is not None else None for k,v in values.items()},
               'ref':{'origin':'label','per_serving':values,'basis_amount':body.basis_amount,'basis_unit':old['unit'],
                      'serving':{'label':body.basis_label,'g':body.basis_g},'unknown_nutrients':[k for k,v in values.items() if v is None]}}
        if not entry['name']:raise HTTPException(422,'Give the food a name')
        mapping=part.get('entry_drafts') or []
        if part.get('drafts') and body.entry<len(mapping) and mapping.count(mapping[body.entry])==1 and old['unit'] in ('g','serving'):
            # Keep other estimates and saved-food matches live; only this food's
            # source becomes the label entered by its owner.
            part['drafts'][mapping[body.entry]]={'food':{'name':entry['name'],'brand':entry.get('brand'),
                'serving_label':body.basis_label,'serving_g':body.basis_g,**values},
                'portion':{'grams':old['amount']} if old['unit']=='g' and body.basis_g else {'count':factor},
                'origin':'label','origin_ref':{'source':'quick','per_serving':values,'serving':entry['ref']['serving']}}
            part.pop('learn_phrase',None)
            part['entries']=S.draft_entries(part['drafts'])
        else:
            part=manual_part(part);part['entries'][body.entry]=entry
    if any(e.get('amount',0)<=0 or any(N.known(e,k) and e[k]>N.ENTRY_MAX[k] for k in N.ALL) for e in part['entries']):
        raise HTTPException(422,'That portion is too large. Check the amount and nutrition.')
    result['parts']=[part if p['index']==body.part else p for p in result['parts']]
    result.pop('error',None)
    return C.write(c,uid,message,result)
