"""Formatting helpers for already-validated Kit facts; this module contains no model prompt."""

AMBIGUOUS_MASS_FIELDS = frozenset({
    'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g',
    'saturated_fat_g', 'protein_target', 'carbs_target', 'fat_target',
    'fiber_target', 'sodium_target_mg', 'sugar_target_g', 'saturated_fat_target_g',
})


def has_ambiguous_mass_unit(fact):
    path = fact.get('path')
    return bool(path and path[-1] in AMBIGUOUS_MASS_FIELDS)
