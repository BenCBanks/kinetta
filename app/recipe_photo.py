"""Existing photo estimator → held recipe draft; never writes a food entry."""
import hashlib,json
from uuid import UUID
from pydantic import Field
from . import db,recipe_estimate as E,food_photo,food_thread_sources as S,ai_budget,ai_access,coach
from fastapi import HTTPException

class PhotoDraftIn(food_photo.PhotoIn):
    model_config={'extra':'forbid'}
    client_id:UUID


def read(body,user):
    from . import recipe_import as R
    uid=user['id'];ai_access.require(uid,'food')
    if not coach.allowed(uid,'food'):raise HTTPException(403,coach.off())
    digest=hashlib.sha256(json.dumps(body.model_dump(mode='json',exclude={'client_id'}),sort_keys=True).encode()).hexdigest()
    row,fresh=R._claim(uid,body,photo=True,digest=digest)
    if not fresh:return R._out(row)
    error=None;data={}
    try:
        with ai_budget.scope(uid,body.client_id,feature='recipe screenshot'):
            result=food_photo.estimate(food_photo.PhotoIn(image=body.image,images=body.images,note=body.note),user=user,strict=True)
        entries=S.draft_entries(S.model_drafts(result))
        lines=[f"{entry['amount']:g} {entry['unit']} {entry['name']}"[:500] for entry in entries]
        candidate={'name':'Recipe from screenshot','servings':None,'yield_text':[],'ingredients':lines,'source_url':None,
                   'nutrition':{field:None for field in ('calories','protein','carbs','fat','fiber','sodium','sugar','saturated_fat')},
                   'nutrition_text':{},'nutrition_basis':None,'serving_size':'','needs_servings_review':True}
        data={'input_hash':digest,'candidates':[candidate],'estimates':{E.key(0,line):{'text':line,'status':'ready','source':'ai','entries':[entry]} for line,entry in zip(lines,entries)}}
        with db.connect() as c:data['candidates']=R._match(c,uid,data['candidates'])
    except HTTPException as e:error=('estimate',str(e.detail))
    except Exception:error=('unavailable','The screenshot could not be read. Choose it again, or enter the recipe yourself.')
    with db.connect() as c:
        row=R._expire(c,R._owned(c,uid,body.client_id,True))
        if row['state']=='pending':
            if not coach.allowed(uid,'food'):error=('consent','AI access or consent changed. Enter the recipe instead.')
            c.execute('UPDATE recipe_link_drafts SET state=%s,data=%s,error_code=%s,error_message=%s WHERE user_id=%s AND id=%s',
                      ('failed' if error else 'ready',json.dumps(data) if not error else '{}',error[0] if error else None,error[1] if error else None,uid,body.client_id))
        return R._out(R._owned(c,uid,body.client_id))
