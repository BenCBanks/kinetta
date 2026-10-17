"""Read untrusted schema.org Recipe JSON-LD without executing page content."""
import json
import math
import re
from html.parser import HTMLParser

MAX_JSON=256*1024
MAX_NODES=5000
MAX_DEPTH=24
MAX_RECIPES=5
NUTRIENTS={'calories':('calories','kcal'),'proteinContent':('protein','g'),'carbohydrateContent':('carbs','g'),'fatContent':('fat','g'),'fiberContent':('fiber','g'),'sodiumContent':('sodium','mg'),'sugarContent':('sugar','g'),'saturatedFatContent':('saturated_fat','g')}


class RecipeSchemaError(ValueError):pass


class _Text(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.parts=[]
    def handle_data(self,data):self.parts.append(data)


def text(value,limit=500):
    if not isinstance(value,str):return ''
    p=_Text();p.feed(value[:limit*4]);p.close()
    return ' '.join(''.join(p.parts).split())[:limit]


class _Scripts(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=False);self.active=False;self.parts=[];self.size=0;self.scripts=[];self.total=0
    def handle_starttag(self,tag,attrs):
        if tag.lower()=='script':
            self.active=(dict(attrs).get('type') or '').split(';')[0].strip().lower()=='application/ld+json'
            self.parts=[];self.size=0
    def handle_data(self,data):
        if self.active:
            self.size+=len(data);self.total+=len(data)
            if self.size<=MAX_JSON and self.total<=MAX_JSON*2:self.parts.append(data)
    def handle_endtag(self,tag):
        if tag.lower()=='script':
            if self.active and self.size<=MAX_JSON and self.total<=MAX_JSON*2 and len(self.scripts)<32:self.scripts.append(''.join(self.parts))
            self.active=False;self.parts=[]


def _servings(raw):
    """Prefer an explicit serving count/bare count over yield units such as cookies."""
    values=raw if isinstance(raw,list) else [raw]
    explicit=[];bare=[]
    for value in values[:20]:
        s=str(value) if isinstance(value,(str,int,float)) and not isinstance(value,bool) else ''
        match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(?:servings?|people|portions?)?\s*',s,re.I)
        if match:
            n=float(match[1])
            if 0<n<=1000:(bare if re.fullmatch(r'\s*[\d.]+\s*',s) else explicit).append(n)
    selected=explicit or bare
    return selected[0] if selected and len(set(selected))==1 else None


def _quantity(value,unit):
    # schema.org calories use kcal; other bare nutrients have no defensible unit.
    if unit=='kcal' and isinstance(value,(int,float)) and not isinstance(value,bool):
        return round(float(value),6) if math.isfinite(value) and 0<=value<=1000000 else None
    if not isinstance(value,str):return None
    value=re.sub(r'(?<![\d,])\d{1,3}(?:,\d{3})+(?:\.\d+)?',lambda m:m[0].replace(',',''),value)
    if unit=='kcal' and re.fullmatch(r'\s*\d+(?:\.\d+)?\s*',value):value=value.strip()+' kcal' 
    m=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(kcal|calories?|kilocalories?|kj|g|grams?|mg|milligrams?|µg|μg|mcg)\s*',value,re.I)
    if not m:return None
    n=float(m[1]);u=m[2].lower()
    if unit=='kcal':
        if u=='kj':n/=4.184
        elif u not in ('kcal','calorie','calories','kilocalorie','kilocalories'):return None
    else:
        if u in ('g','gram','grams'):grams=n
        elif u in ('mg','milligram','milligrams'):grams=n/1000
        elif u in ('µg','μg','mcg'):grams=n/1000000
        else:return None
        n=grams*(1000 if unit=='mg' else 1)
    return round(n,6) if math.isfinite(n) and 0<=n<=1000000 else None


def _recipe(node,url):
    name=text(node.get('name'),200)
    raw=node.get('recipeIngredient')
    if isinstance(raw,str):raw=[raw]
    if not name or not isinstance(raw,list) or not 1<=len(raw)<=60:return None
    ingredients=[text(item) for item in raw]
    if not all(ingredients):return None
    raw_yield=node.get('recipeYield')
    yield_text=[text(str(v),100) for v in (raw_yield if isinstance(raw_yield,list) else [raw_yield])[:20] if isinstance(v,(str,int,float)) and not isinstance(v,bool)]
    nutrition=node.get('nutrition');nutrition=nutrition if isinstance(nutrition,dict) else {}
    published={key:_quantity(nutrition.get(field),unit) for field,(key,unit) in NUTRIENTS.items()}
    raw_nutrition={key:text(nutrition.get(field),100) for field,(key,_) in NUTRIENTS.items() if isinstance(nutrition.get(field),str)}
    return {'name':name,'servings':_servings(raw_yield),'yield_text':yield_text,'ingredients':ingredients,
            'source_url':url,'nutrition':published,'nutrition_text':raw_nutrition,
            'nutrition_basis':'site_per_serving' if any(v is not None for v in published.values()) else None,
            'serving_size':text(nutrition.get('servingSize'),100),'needs_servings_review':_servings(raw_yield) is None}


def parse(html,url):
    """Return up to five candidates; caller must ask which recipe and review before save.

    URL must be the fetcher's validated final URL. Never follow JSON-LD @id,
    ingredient links, images or scripts. Recipe instructions are not retained.
    """
    if not isinstance(html,str) or len(html)>1024*1024:raise RecipeSchemaError('That page is too large to read.')
    p=_Scripts();p.feed(html);p.close();recipes=[];seen=set();visited=0
    for script in p.scripts:
        try:root=json.loads(script,parse_constant=lambda _:None)
        except (ValueError,RecursionError):continue
        stack=[(root,0)]
        while stack:
            node,depth=stack.pop();visited+=1
            if visited>MAX_NODES:raise RecipeSchemaError('That recipe data is too complex. Try a screenshot or paste ingredients.')
            if depth>MAX_DEPTH:continue
            if isinstance(node,dict):
                types=node.get('@type',[]);types=types if isinstance(types,list) else [types]
                if any(isinstance(t,str) and t.rstrip('/').rsplit('/',1)[-1].rsplit(':',1)[-1]=='Recipe' for t in types):
                    recipe=_recipe(node,url)
                    if recipe:
                        identity=(recipe['name'],tuple(recipe['ingredients']),tuple(recipe['yield_text']))
                        if identity not in seen:
                            seen.add(identity);recipes.append(recipe)
                            if len(recipes)>=MAX_RECIPES:return recipes
                stack.extend((v,depth+1) for v in reversed(list(node.values())) if isinstance(v,(dict,list)))
            elif isinstance(node,list):stack.extend((v,depth+1) for v in reversed(node) if isinstance(v,(dict,list)))
    return recipes
