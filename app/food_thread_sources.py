"""Food-source arithmetic for the thread. Model text is never a nutrition tool.

Estimates keep their origin/assumptions. Catalog portions use published values;
missing weights remain a portion question rather than an invented zero or weight.
"""
import math
import re
from fastapi import HTTPException
from . import api_food,meal_chat


def positive(value,maximum=20000):
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<=maximum:return None
    return float(value)


def numbers(item):
    result={}
    for key,maximum in (('kcal',20000),('protein_g',2000),('carbs_g',2000),('fat_g',2000),('fiber_g',1000)):
        value=item.get(key)
        if value is None and key=='fiber_g':result[key]=None;continue
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=maximum:
            raise HTTPException(422,'Check the nutrition numbers; missing values cannot be logged as zero')
        result[key]=round(value,3)
    return result


def model_drafts(estimate):
    items=estimate.get('items')
    if not isinstance(items,list) or not 1<=len(items)<=30:raise HTTPException(422,'No usable food estimate came back')
    result=[]
    for item in items:
        name=' '.join(str(item.get('name') or '').split())[:200]
        if not name:raise HTTPException(422,'That estimate needs a food name')
        amount=' '.join(str(item.get('amount') or '1 estimated portion').split())[:60]
        read,_=meal_chat.amount(meal_chat.raw(amount))
        count=positive((read or {}).get('count'),100000) or 1
        grams=positive(item.get('grams'),5000) or positive((read or {}).get('grams'),5000)
        values=numbers(item)
        # Model numbers describe the complete stated portion. Turn "2 bowls"
        # into a reusable *one*-bowl food before multiplying by two on this log.
        label=amount
        if count!=1:
            unit=(read or {}).get('unit')
            suffix=re.sub(r'^(?:\d+(?:\.\d+)?(?:/\d+)?|half|one|two|three|four|five|six|seven|eight|nine|ten|½|¼|¾)\s*(?:(?:a|an|of)\s+)*','',amount,flags=re.I).strip()
            label='1 '+(str(unit) if unit else suffix or 'estimated portion')
        food={'name':name,'brand':None,'serving_label':label,'serving_g':grams/count if grams else None,
              **{k:(v/count if v is not None else None) for k,v in values.items()}}
        portion={'count':count}
        if read and read.get('grams') and grams:
            # Nutrition still comes from the estimated portion weight, not from
            # independently trusting two different weights in model output.
            portion={'grams':grams}
        result.append({'food':food,'portion':portion,'learn_portion':dict(portion),'origin':'ai','notes':str(estimate.get('notes') or '')[:300],
                       'model':str(estimate.get('model') or '')[:100],'origin_ref':None})
    return result


def draft_entries(drafts):
    """Preview only. Logging recomputes from the saved private food in its transaction."""
    entries=[]
    for draft in drafts:
        if draft.get('own_entries'):
            entries+=draft['own_entries'];continue
        f=draft['food'];p=draft['portion']
        scale=p['grams']/f['serving_g'] if p.get('grams') and f.get('serving_g') else p.get('count',1)
        entries.append({'name':f['name'],'brand':f.get('brand'),'amount':p.get('grams') or p.get('count',1),
                        'unit':'g' if p.get('grams') else 'serving',**meal_chat.scaled(f,scale),
                        'source':'ai' if draft['origin']=='ai' else (draft.get('origin_ref') or {}).get('source','quick'),
                        'ref':{'origin':draft['origin'],'origin_notes':draft.get('notes'),'origin_model':draft.get('model'),
                               'serving':{'label':f['serving_label'],'g':f.get('serving_g')},'origin_ref':draft.get('origin_ref')}})
    return entries


def catalog_draft(food,portion=None):
    per=api_food._sane(food.get('per100') or {})
    if not per:return None
    serving=food.get('serving') or {};grams=positive(serving.get('g'),10000)
    label=str(serving.get('label') or '')[:60]
    if portion and portion.get('grams'):
        amount=positive(portion['grams']);base=100
        if not amount:return None
        return {'food':{'name':str(food['name'])[:200],'brand':food.get('brand'),'serving_label':'100 g','serving_g':100,**numbers(per)},
                'portion':{'grams':amount},'origin':'catalog','notes':None,'model':None,'origin_ref':food}
    if not grams:return None
    if portion and portion.get('unit')=='serving' and portion.get('count'):
        return catalog_draft(food,{'grams':grams*portion['count']})
    label_portion,_=meal_chat.amount(meal_chat.raw(label))
    # "100 g" is not an apple, slice or bowl. Do not silently call a mass-only
    # catalog reference the household serving the person described.
    if label_portion and label_portion.get('grams'):return None
    n=positive((portion or {}).get('count'),100000) or 1
    unit=(portion or {}).get('unit')
    if unit and meal_chat.stem(unit) not in set(meal_chat.product_words(label)):return None
    count=positive((label_portion or {}).get('count'),100000) or 1
    return {'food':{'name':str(food['name'])[:200],'brand':food.get('brand'),'serving_label':label or '1 serving',
                    'serving_g':grams,**meal_chat.scaled(per,grams/100)},
            'portion':{'count':n/count},'origin':'catalog','notes':None,'model':None,'origin_ref':food}


def scale_drafts(drafts,factor):
    if not positive(factor,100000):raise HTTPException(422,'Choose a positive portion')
    for draft in drafts:
        key='grams' if 'grams' in draft['portion'] else 'count'
        draft['portion'][key]*=factor
        if draft.get('own'):
            own_key='grams' if 'grams' in draft['own']['portion'] else 'count'
            draft['own']['portion'][own_key]*=factor
            draft.pop('own_entries',None)
        if not positive(draft['portion'][key],20000 if key=='grams' else 100000):
            raise HTTPException(422,'Check the portion amount')
    if meal_chat.too_big(draft_entries(drafts)):raise HTTPException(422,'That portion is too large')
    return drafts


def apply_portion(drafts,portion,text=''):
    if 'share' in portion:return scale_drafts(drafts,portion['share'])
    if 'grams' in portion:
        weights=[d['food'].get('serving_g') for d in drafts]
        if not all(positive(g,10000) for g in weights):raise HTTPException(422,'Choose a relative portion when an item has no known weight')
        total=sum(d['portion'].get('grams',g*d['portion'].get('count',1)) for d,g in zip(drafts,weights))
        return scale_drafts(drafts,portion['grams']/total)
    read=meal_chat.read_part(text,[]).get('portion') or {}
    original=positive(read.get('count'),100000) or 1
    return scale_drafts(drafts,portion['count']/original)
