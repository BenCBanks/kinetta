"""Deterministic recipe draft review. All arithmetic and source labels are server-owned."""
import hashlib,json,math,secrets
from typing import Annotated,Literal
from pydantic import BaseModel,Field,StrictBool
from fastapi import HTTPException
from . import api_dishes as D,recipe_schema,nutrients as N
FIELDS={'kcal':'calories','protein_g':'protein','carbs_g':'carbs','fat_g':'fat','fiber_g':'fiber','sodium_mg':'sodium','sugar_g':'sugar','saturated_fat_g':'saturated_fat'}

class Values(N.ExtraValues):
    model_config={'extra':'forbid','allow_inf_nan':False}
    kcal:float|None=Field(None,ge=0,le=20000)
    protein_g:float|None=Field(None,ge=0,le=2000)
    carbs_g:float|None=Field(None,ge=0,le=2000)
    fat_g:float|None=Field(None,ge=0,le=2000)
    fiber_g:float|None=Field(None,ge=0,le=1000)

class ReviewIn(BaseModel):
    model_config={'extra':'forbid','allow_inf_nan':False}
    candidate:int=Field(ge=0,le=4)
    name:str=Field(min_length=1,max_length=80)
    servings:float=Field(ge=.5,le=50)
    lines:list[Annotated[str,Field(min_length=1,max_length=500)]]=Field(min_length=1,max_length=60)
    basis:Literal['published','ingredients','entered']='published'
    values:Values|None=None

class SaveIn(BaseModel):
    model_config={'extra':'forbid'}
    baseline:str=Field(pattern='^[0-9a-f]{64}$')
    confirmed:StrictBool


def _values(entry):
    unknown=(entry.get('ref') or {}).get('unknown_nutrients') or []
    return {k:entry.get(k) if k not in unknown else None for k in D.NUM}


def _items(matches):
    out=[];pending=[]
    for match in matches:
        if match.get('status')!='ready':pending.append(match['text']);continue
        parts=match.get('ingredients') or match.get('entries') or []
        if not parts or len(out)+len(parts)>D.MAX_ITEMS:pending.append(match['text']);continue
        for entry in parts:
            grams=entry.get('grams') or (entry.get('amount') if entry.get('unit')=='g' else None)
            values=_values(entry)
            if entry.get('per100') and grams:values={k:(entry['per100'].get(k)*grams/100 if entry['per100'].get(k) is not None else None) for k in D.NUM}
            per100={k:v*100/grams if v is not None else None for k,v in values.items()} if grams else None
            out.append({'name':entry['name'][:200],'grams':grams,'per100':per100,**values,'amount':f'{grams:g} g' if grams else (str(entry.get('amount') or 1)+' '+str(entry.get('unit') or 'portion'))[:100],
                        'source':'ai' if entry.get('source')=='ai' or (entry.get('ref') or {}).get('origin')=='ai' else (entry.get('source') or 'saved'),'ref':{**{k:(entry.get('ref') or {}).get(k) for k in ('origin','origin_notes','origin_model')},'unknown_nutrients':[k for k,v in values.items() if v is None]},'key':'','units':{}})
    return out,pending


def build(c,uid,row,body):
    from . import recipe_import as R
    candidates=row['data'].get('candidates') or []
    if body.candidate>=len(candidates):raise HTTPException(422,'Choose one of the recipes in this draft')
    original=candidates[body.candidate]
    name=body.name.strip();lines=[recipe_schema.text(line) for line in body.lines]
    if not name or not all(lines):raise HTTPException(422,'Check the recipe name and ingredient lines')
    matching=R._match(c,uid,[{**original,'ingredients':lines}])[0]['matches']
    from .recipe_estimate import key
    for index,match in enumerate(matching):
        estimated=row['data'].get('estimates',{}).get(key(body.candidate,lines[index]))
        if match.get('status')!='ready' and estimated:matching[index]=estimated
    items,pending=_items(matching)
    summed={k:round(sum(i[k] for i in items),4) if items and not pending and all(i.get(k) is not None for i in items) else None for k in D.NUM}
    site={k:original['nutrition'].get(field) for k,field in FIELDS.items()}
    proposed=dict(site) if body.basis=='published' else dict.fromkeys(D.NUM)
    if body.values:proposed.update(body.values.model_dump(exclude_unset=True))
    totals={};sources={}
    for k in D.NUM:
        if body.basis=='ingredients':v=summed[k];source=D.source_label(items) if v is not None else 'unknown'
        else:
            per=proposed[k];v=per*body.servings if per is not None else (summed[k] if body.basis=='published' else None)
            source=('site' if per==site[k] and body.basis=='published' else 'entered') if per is not None else (D.source_label(items) if v is not None else 'unknown')
        if v is not None and (not math.isfinite(v) or v>N.BATCH_MAX[k]):raise HTTPException(422,'The whole recipe is too large. Check servings and nutrition.')
        totals[k]=round(v,4) if v is not None else None;sources[k]=source
    review={'input':body.model_dump(mode='json',exclude_unset=True),'name':name,'servings':body.servings,'items':items,'pending':pending,
            'totals':totals,'per_serving':{k:round(v/body.servings,4) if v is not None else None for k,v in totals.items()},
            'sources':sources,'basis':body.basis,'source_url':original['source_url'],'yield_text':original['yield_text'],
            'ingredient_lines':lines,'site_nutrition':site,'matching':matching,
            'site_recipe_changed':bool(original['source_url']) and lines!=original['ingredients'] and body.basis=='published'}
    review['baseline']=hashlib.sha256(json.dumps(review,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return review


def with_ids(items):return [{**item,'id':secrets.token_hex(4)} for item in items]
