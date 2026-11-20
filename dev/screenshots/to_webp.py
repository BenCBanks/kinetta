# Whole screenshots at1x and2x; never crop UI or upscale browser captures for the store.
# Usage: to_webp.py <png dir> <site/assets/shots>
from pathlib import Path
import sys
from PIL import Image
from manifest import write_manifest

CROP_HEIGHTS = {
    'light-activity-detail': 1440,
    'dark-activity-detail': 1440,
    'light-kit-food-chat-confirmed': 1080,
    'dark-kit-food-chat-confirmed': 1080,
}

def convert(source, output):
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    files = sorted(Path(source).glob('*.png'))
    if not files: raise ValueError('No captured PNG screenshots')
    for path in files:
        with Image.open(path) as captured:
            image = captured.convert('RGB')
        if image.size != (786, 1704):
            raise ValueError(f'{path.name}: expected a whole786×1704 website capture')
        # Keep source PNGs whole for pipeline validation. These website assets use a
        # published crop so the relevant content sits together above fixed app controls.
        if path.stem in CROP_HEIGHTS:
            image = image.crop((0, 0, 786, CROP_HEIGHTS[path.stem]))
        image.save(output / (path.stem + '.webp'), 'WEBP', quality=82, method=6)
        image.resize((image.width // 2, image.height // 2), Image.Resampling.LANCZOS).save(output / (path.stem + '-1x.webp'), 'WEBP', quality=82, method=6)
        print(path.name)
    write_manifest(output)

if __name__ == '__main__': convert(*sys.argv[1:])
