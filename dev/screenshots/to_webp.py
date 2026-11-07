# Whole screenshots at1x and2x; the Home Food chat is the one intentionally compact marketing capture.
# Usage: to_webp.py <png dir> <site/assets/shots>
from pathlib import Path
import sys
from PIL import Image
from manifest import write_manifest

def convert(source, output):
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    files = sorted(Path(source).glob('*.png'))
    if not files: raise ValueError('No captured PNG screenshots')
    for path in files:
        with Image.open(path) as captured:
            image = captured.convert('RGB')
        compact_food_chat = path.stem in {'light-home-food-chat', 'dark-home-food-chat'}
        if image.width != 786 or (compact_food_chat and (image.height < 1080 or image.height >= 1704 or image.height % 2)):
            raise ValueError(f'{path.name}: compact Home Food chat must be 786px wide with an even height from1080px to1702px')
        if not compact_food_chat and image.size != (786, 1704):
            raise ValueError(f'{path.name}: expected a whole786×1704 website capture')
        image.save(output / (path.stem + '.webp'), 'WEBP', quality=82, method=6)
        size = (393, image.height // 2) if compact_food_chat else (393, 852)
        image.resize(size, Image.Resampling.LANCZOS).save(output / (path.stem + '-1x.webp'), 'WEBP', quality=82, method=6)
        print(path.name)
    write_manifest(output)

if __name__ == '__main__': convert(*sys.argv[1:])
