"""Load archived case declarations only; never import archived app/provider code."""
import ast
from kit_cases import CASES
from kit_gate_cases import GATE_CASE_IDS


def historical_cases(read):
    tree=ast.parse(read('dev/evals/kit_batch2_cases.py'))
    values={}
    for node in tree.body:
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in {'REPLACED','EXTRA'}:
            values[node.targets[0].id]=ast.literal_eval(node.value)
    return [c for c in CASES if c[0] in GATE_CASE_IDS and c[0] not in values['REPLACED']]+values['EXTRA']
