"""Explicit units and nullable source values; no intake recommendations or AI inference."""
import math
from pydantic import BaseModel,Field,field_validator

CORE=('kcal','protein_g','carbs_g','fat_g','fiber_g')
EXTRA=('sodium_mg','sugar_g','saturated_fat_g')
ALL=CORE+EXTRA
TARGETS={'sodium_mg':'sodium_target_mg','sugar_g':'sugar_target_g','saturated_fat_g':'saturated_fat_target_g'}
UNITS={'sodium_mg':'mg','sugar_g':'g','saturated_fat_g':'g'}
PER100_MAX={'sodium_mg':100000,'sugar_g':100,'saturated_fat_g':100}

ENTRY_MAX={'kcal':20000,'protein_g':2000,'carbs_g':2000,'fat_g':2000,'fiber_g':1000,'sodium_mg':1000000,'sugar_g':2000,'saturated_fat_g':2000}

def rounded(key,value):
    return round(value,4 if key in EXTRA else 1) if value is not None else None

class ExtraValues(BaseModel):
    model_config={'allow_inf_nan':False}
    sodium_mg:float|None=Field(None,ge=0,le=ENTRY_MAX['sodium_mg'])
    sugar_g:float|None=Field(None,ge=0,le=ENTRY_MAX['sugar_g'])
    saturated_fat_g:float|None=Field(None,ge=0,le=ENTRY_MAX['saturated_fat_g'])

    @field_validator(*EXTRA,mode='before')
    @classmethod
    def numeric_or_unknown(cls,value):
        if isinstance(value,bool):raise ValueError('Enter a number, or leave it blank for unknown')
        return value

class ExtraTargets(BaseModel):
    model_config={'allow_inf_nan':False}
    sodium_target_mg:float|None=Field(None,ge=0,le=100000)
    sugar_target_g:float|None=Field(None,ge=0,le=2000)
    saturated_fat_target_g:float|None=Field(None,ge=0,le=1000)

    @field_validator(*TARGETS.values(),mode='before')
    @classmethod
    def numeric_or_unset(cls,value):
        if isinstance(value,bool):raise ValueError('Enter a number, or leave this limit unset')
        return value


def number(value,maximum):
    if value is None or isinstance(value,bool):return None
    try:n=float(value)
    except (TypeError,ValueError,OverflowError):return None
    return n if math.isfinite(n) and 0<=n<=maximum else None


def off_values(nutriments):
    # OFF normalized *_100g fields use grams, including sodium; *_unit is
    # the contributor's input unit and must not be applied a second time.
    result={}
    for key,source in [('sodium_mg','sodium_100g'),('sugar_g','sugars_100g'),('saturated_fat_g','saturated-fat_100g')]:
        n=number(nutriments.get(source),PER100_MAX[key]/(1000 if key=='sodium_mg' else 1))
        result[key]=round(n*(1000 if key=='sodium_mg' else 1),4) if n is not None else None
    return result


def fdc_values(rows):
    result=dict.fromkeys(EXTRA);ranks={}
    codes={'sodium_mg':((1093,), '307'),'sugar_g':((2000,1063),'269'),'saturated_fat_g':((1258,),'606')}
    for row in rows:
        if not isinstance(row,dict):continue
        identity=row.get('nutrientId');code=str(row.get('nutrientNumber') or '')
        for key,(ids,legacy) in codes.items():
            if identity not in ids and code!=legacy:continue
            rank=ids.index(identity) if identity in ids else len(ids)
            raw_unit=row.get('unitName');unit=(raw_unit if isinstance(raw_unit,str) and raw_unit else UNITS[key] if raw_unit in (None,'') else '').strip().lower().replace('μ','µ')
            if unit not in ('g','mg','µg','mcg','ug'):continue
            value=number(row.get('value'),100000000)
            if value is None:continue
            grams=value*({'g':1,'mg':.001,'µg':.000001,'mcg':.000001,'ug':.000001}[unit])
            converted=grams*(1000 if key=='sodium_mg' else 1)
            if converted>PER100_MAX[key] or (key in ranks and rank>=ranks[key]):continue
            result[key]=round(converted,4);ranks[key]=rank
    return result


def day_values(entries,targets):
    """Known subtotal plus coverage. Partial observations are never a complete intake."""
    out={}
    for key in EXTRA:
        known=[float(e[key]) for e in entries if e.get(key) is not None and not (isinstance((e.get('ref') or {}).get('unknown_nutrients'),list) and key in e['ref']['unknown_nutrients'])]
        out[key]={'recorded':round(sum(known),3) if known else None,'known_count':len(known),
                  'unknown_count':len(entries)-len(known),'complete':bool(entries) and len(known)==len(entries),
                  'unit':UNITS[key],'target':targets.get(TARGETS[key])}
    return out

# Shared arithmetic/storage rules; source numbers remain nullable until the legacy
# non-null calorie/macro columns need their explicit missing-value marker.

PER100_LIMITS={**dict.fromkeys(CORE,100),'kcal':1000,**PER100_MAX}
BATCH_MAX={**dict.fromkeys(ALL,5000),'kcal':50000,'sodium_mg':10000000}

class ExtraPer100(ExtraValues):
    sodium_mg:float|None=Field(None,ge=0,le=100000)
    sugar_g:float|None=Field(None,ge=0,le=100)
    saturated_fat_g:float|None=Field(None,ge=0,le=100)

class KnownExtras(BaseModel):
    model_config={'allow_inf_nan':False}
    known_sodium_mg:float|None=Field(None,ge=0,le=10000000)
    known_sugar_g:float|None=Field(None,ge=0,le=5000)
    known_saturated_fat_g:float|None=Field(None,ge=0,le=5000)

    @field_validator('known_sodium_mg','known_sugar_g','known_saturated_fat_g',mode='before')
    @classmethod
    def numeric_or_unknown(cls,value):
        if isinstance(value,bool):raise ValueError('Enter a number, or leave it blank for unknown')
        return value


def known(entry,key):
    missing=(entry.get('ref') or {}).get('unknown_nutrients')
    return entry.get(key) is not None and not (isinstance(missing,list) and key in missing)





def storage(entry):
    result=dict(entry)
    original=(entry.get('ref') or {}).get('unknown_nutrients')
    future={k for k in original if isinstance(k,str) and k not in ALL} if isinstance(original,list) else set()
    missing=sorted(future|{k for k in ALL if not known(entry,k)})
    result.update({k:(0 if k in CORE[:4] else None) if k in missing else entry[k] for k in ALL})
    ref=entry.get('ref')
    if missing or (ref and 'unknown_nutrients' in ref):ref={**(ref or {}),'unknown_nutrients':missing}
    result['ref']=ref
    return result
