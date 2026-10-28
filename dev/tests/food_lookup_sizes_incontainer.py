"""Size words describe the portion, not the food: '1 medium chicken breast' finds chicken breast (28 October 2026).
The USDA search is a fictional stand-in; nothing leaves the container."""
from unittest.mock import patch
from app import meal_chat

FOODS = [{'name': 'Chicken, breast, boneless, skinless, raw', 'generic': True, 'source': 'usda'},
         {'name': 'Chicken breast, roll, oven-roasted', 'generic': True, 'source': 'usda'},
         {'name': 'Egg, whole, raw', 'generic': True, 'source': 'usda'}]
seen = []
def search(q):
    seen.append(q); return FOODS
with patch.object(meal_chat, '_search_usda', search), patch.object(meal_chat, '_search_off', lambda q: []):
    for text in ('1 medium chicken breast', 'a large chicken breast', 'chicken breast', '2 small chicken breasts'):
        r = meal_chat.lookup(text)
        assert r['kind'] == 'plain' and r['foods'][0]['name'].startswith('Chicken, breast'), (text, r)
        assert 'medium' not in r['query'] and 'large' not in r['query'] and 'small' not in r['query'], r['query']
    assert meal_chat.lookup('2 large eggs')['foods'][0]['name'] == 'Egg, whole, raw'
    r = meal_chat.lookup('1 medium')            # a size alone is not a food: unchanged behaviour, no match
    assert r['kind'] == 'none', r
print('Food lookup: size words (small/medium/large) stay with the portion, not the search; chicken breast and eggs match PASS')
