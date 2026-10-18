"""Screenshots only (2026-10-18): run the throwaway app with made-up food estimates, so the website's food story
(dev/screenshots/take.js) is repeatable and no AI provider or public food database is ever called.
Started by dev/screenshots/compose.standin.yml inside the screenshot workflow's own container; never used by an install.
The numbers are the same made-up ones the screenshots have always used."""
import sys
sys.path.insert(0, '/srv')
from app import food_photo, meal_chat

NOTE = ''   # the real estimator's short note; left empty so the website shows no stand-in wording


def sample(note):
    """Typed meal: a Costco hot dog and a Diet Coke; "two" doubles the hot dogs, like the real thing when told."""
    n = 2 if 'two' in note else 1
    items = []
    if 'hot dog' in note:
        items.append({'name': 'Hot dog', 'amount': str(n), 'grams': 140 * n, 'kcal': 550 * n, 'protein_g': 20 * n, 'carbs_g': 45 * n, 'fat_g': 32 * n, 'fiber_g': 2 * n})
    if 'diet coke' in note:
        items.append({'name': 'Diet Coke', 'amount': '1 bottle', 'grams': 590, 'kcal': 0, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 0, 'fiber_g': 0})
    return items


def bowl(note):
    """The snapped curry rice bowl (dev/demo/photos/curry-rice-bowl.jpg); "half" or "small" shrinks the rice."""
    small = 'half' in note or 'small' in note
    return [
        {'name': 'Spiced rice', 'amount': '¾ cup' if small else '1½ cups', 'grams': 120 if small else 240, 'kcal': 160 if small else 320,
         'protein_g': 3 if small else 6, 'carbs_g': 35 if small else 70, 'fat_g': 1 if small else 2, 'fiber_g': 1},
        {'name': 'Butter chicken', 'amount': '1 cup', 'grams': 240, 'kcal': 380, 'protein_g': 28, 'carbs_g': 12, 'fat_g': 24, 'fiber_g': 2},
        {'name': 'Chickpeas and potato', 'amount': '½ cup', 'grams': 120, 'kcal': 150, 'protein_g': 6, 'carbs_g': 24, 'fat_g': 3, 'fiber_g': 5},
        {'name': 'Slaw, tomato and crispy topping', 'amount': '½ cup', 'grams': 60, 'kcal': 70, 'protein_g': 1, 'carbs_g': 8, 'fat_g': 4, 'fiber_g': 2}]


def estimate(body, user, *, strict=False):
    note = (getattr(body, 'note', None) or '').lower()
    photo = bool(getattr(body, 'image', None) or getattr(body, 'images', None))
    items = bowl(note) if photo or 'curry' in note else sample(note)
    return {'items': items or [{'name': 'Food', 'amount': '1', 'grams': None, 'kcal': 200, 'protein_g': 5, 'carbs_g': 25, 'fat_g': 8, 'fiber_g': None}],
            'notes': NOTE, 'model': 'sample'}


food_photo.estimate = estimate
# nothing in the public food databases, so the stand-in estimates every new food (as the old browser stand-ins did)
meal_chat.lookup = lambda text, *a, **k: {'text': text, 'query': '', 'kind': 'none', 'foods': [], 'portion': None}

import uvicorn  # noqa: E402

uvicorn.run('app.main:app', host='0.0.0.0', port=8000, proxy_headers=True)
