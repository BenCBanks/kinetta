# PNG screenshots -> the site's .webp files. Usage: to_webp.py <png dir> <site/assets/shots>
import glob, os, sys
from PIL import Image
for p in sorted(glob.glob(os.path.join(sys.argv[1], '*.png'))):
    Image.open(p).convert('RGB').save(os.path.join(sys.argv[2], os.path.basename(p)[:-4] + '.webp'), 'WEBP', quality=82, method=6)
    print(os.path.basename(p))

# A manifest lets an already-open homepage discover a genuinely refreshed screenshot set.
import datetime, json, subprocess
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
with open(os.path.join(sys.argv[2], 'manifest.json'), 'w') as f:
    json.dump({'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'revision': revision}, f)
