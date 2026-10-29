"""Keep the every-screen acceptance inventory complete when client routes change."""
import json,re
from pathlib import Path

root=Path(__file__).resolve().parents[2]
inventory=json.loads((root/'dev/tests/ui_inventory.json').read_text())
actual={(str(p.relative_to(root)),m.group(1)) for p in (root/'app/static').glob('*.js') for m in re.finditer(r'^route\((/.*?/),',p.read_text(),re.M)}
listed={(row['source'],row['pattern']) for row in inventory['routes']}
assert actual==listed,{'unlisted':sorted(actual-listed),'obsolete':sorted(listed-actual)}
for row in inventory['routes']:
    pattern=re.compile(row['pattern'][1:-1])
    for path in row['paths']:
        concrete=re.sub(r'\{[^}]+\}','1',path).split('?')[0]
        assert pattern.fullmatch(concrete),(row['id'],path)
assert all('foodview=' in path for path in inventory['extra_views'] if path.startswith('/progress?section=food')), 'Food Progress views use their dedicated selector'
print(f"UI acceptance inventory: all {len(actual)} registered route definitions have explicit cases")
