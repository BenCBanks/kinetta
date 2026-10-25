"""Text food estimates for named brands and restaurant items, plus everyday controls (25 October 2026).

kcal is the product's published label/menu value for the amount said (US, checked against retailer or brand
listings where noted; menus change, so treat each as approximate). Branded cases score within 15%; informal
amounts (handfuls) and controls use the wider `range`. Controls check that brand awareness didn't change ordinary
estimates. Used by brand_eval.py; no personal data."""

BRANDED = [
    ('a garage beer', 95), ('a bud light', 110), ('a coors light', 102), ('a miller lite', 96),
    ('a corona extra', 148), ('a guinness draught can', 125), ('a white claw', 100), ('a coke', 140),
    ('a diet coke', 0), ('a red bull', 110), ('a big mac', 590), ('an egg mcmuffin', 310),
    ('a medium mcdonalds fries', 320), ('a chick fil a chicken sandwich', 420), ('a taco bell crunchy taco', 170),
    ('a krispy kreme original glazed donut', 190), ('3 oreos', 160), ('a snickers bar', 250),
    ('a pack of reeses cups', 210), ('a clif bar', 250), ('a premier protein shake', 160),
    ('a fairlife core power 26g', 170), ('a gatorade 20 oz', 140), ('a la croix', 0),
    ('a starbucks grande latte', 190), ('a 1 oz bag of lays classic', 160), ('a nature valley crunchy granola bar pack', 190),
]
# Informal amounts of a named product: a range, since a handful varies.
INFORMAL = [
    ('3 handfuls of popcorners kettle corn', (150, 260)),   # label 130 kcal per 28 g; a handful ~12-20 g
    ('a handful of goldfish crackers', (60, 150)),          # label 140 kcal per 55 pieces / 30 g
]
CONTROLS = [
    ('2 scrambled eggs', (140, 240)), ('a banana', (90, 125)), ('a cup of white rice', (180, 250)),
    ('an apple', (75, 120)), ('a glass of 2% milk', (110, 140)), ('a handful of almonds', (120, 210)),
    ('a slice of pepperoni pizza', (250, 400)), ('a bowl of oatmeal', (130, 320)), ('a glass of red wine', (110, 160)),
    ('a beer', (140, 200)), ('a turkey sandwich', (280, 520)), ('grilled chicken breast', (180, 330)),
]


def cases():
    return ([{'text': t, 'kcal': k, 'range': (round(k * .85), round(k * 1.15)) if k else (0, 10), 'group': 'branded'} for t, k in BRANDED]
            + [{'text': t, 'range': r, 'group': 'informal'} for t, r in INFORMAL]
            + [{'text': t, 'range': r, 'group': 'control'} for t, r in CONTROLS])
