"""Race predictions use how much this runner actually slows over distance (2026-10-26). Fictional efforts only."""
from app import analysis as A

def eff(label, m, s, run_m=None): return {'label': label, 'distance_m': m, 'elapsed_s': s, 'activity_m': run_m or m}
T = ((5000, '5K'), (10000, '10K'), (21097.5, 'Half'), (42195, 'Marathon'))
def secs(effs, km=75): return {p['label']: p['seconds'] for p in A.predictions(effs, km, T)}

# A 40:20 10K race alone, 75 km a week: the mileage exponent (1.06) projects about 3:06.
only10 = secs([eff('10K', 10000, 2420, 10100)])
assert 3 * 3600 < only10['Marathon'] < 3 * 3600 + 600, only10
# The same runner also ran a full 30K long run in 2:26: they slow more than 1.06 says, so the marathon is slower.
k, pair = A.personal_k([eff('10K', 10000, 2420, 10100), eff('30K', 30000, 8760, 30500)], A.endurance_k(75))
assert 1.15 < k < 1.20 and pair, k
both = secs([eff('10K', 10000, 2420, 10100), eff('30K', 30000, 8760, 30500)])
assert both['Marathon'] > only10['Marathon'] + 15 * 60, (only10, both)
assert both['10K'] == only10['10K'] and both['5K'] == only10['5K'], 'shorter races still come from the 10K'
# One very bad long day is capped at 1.20, not taken at face value.
k, _ = A.personal_k([eff('10K', 10000, 2420, 10100), eff('Marathon', 42195, 6 * 3600, 42500)], 1.06)
assert k == A.PERSONAL_K_MAX, k
# A runner who holds pace well keeps at least the mileage-based exponent.
k, _ = A.personal_k([eff('10K', 10000, 2420, 10100), eff('30K', 30000, 7500, 30200)], 1.08)
assert k == 1.08, k
# A fast 10K inside a 30 km easy run is not a full effort, so it doesn't set the exponent.
k, pair = A.personal_k([eff('10K', 10000, 2700, 30000), eff('30K', 30000, 9500, 30000)], 1.06)
assert pair is None and k == 1.06, (k, pair)
print('race predictions: personal endurance OK')
