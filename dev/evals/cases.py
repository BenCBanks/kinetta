"""300 synthetic, reference-grounded food cases. No real-user records and no claimed photo accuracy.

Fixtures describe fictional foods with explicit reference nutrition; this exercises quantities, normalization,
product identity and follow-up behavior. Real weighed-meal photos require human-reviewed external fixtures.
"""

def cases():
    result = []
    quantities = [('25 g', 25), ('100 g', 100), ('150 g', 150), ('250 g', 250), ('0.5 kg', 500), ('1/2 kg', 500)]
    for kind in ('text', 'label', 'barcode', 'restaurant', 'correction'):
        for food in range(10):
            name = f'Reference food {food + 1}'
            per100 = {'kcal': 80 + 25 * food, 'protein_g': 2 + food, 'carbs_g': 10 + food, 'fat_g': 3 + food / 2}
            for ix, (quantity, grams) in enumerate(quantities):
                truth = {k: round(v * grams / 100, 1) for k, v in per100.items()}
                reference = {'name': name, 'per100': per100, 'barcode': f'99900000{food:04d}', 'serving_g': 100}
                prompt = f'{quantity} {name}. Reference nutrition per 100 g: {per100}.'
                if kind == 'correction': prompt = f'First I said 100 g {name}. Correction: make that {quantity}. Reference per 100 g: {per100}.'
                if kind == 'label': prompt = f'Label says {per100} per 100 g for {name}. I ate {quantity}.'
                if kind == 'barcode': prompt = f'Barcode {reference["barcode"]} identifies {name}, with {per100} per 100 g. Amount: {quantity}.'
                if kind == 'restaurant': prompt = f'The fictional cafe menu gives {per100} per 100 g for {name}. My portion weighed {quantity}.'
                result.append({'id': f'{kind}-{food:02d}-{ix}', 'kind': kind, 'input': prompt, 'reference': reference,
                               'expected': {**truth, 'grams': grams, 'names': [name]}, 'synthetic': True})
    return result
