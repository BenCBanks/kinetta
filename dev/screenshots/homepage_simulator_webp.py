"""Publish fictional iOS Simulator homepage captures as the site's 2x/1x phone screens."""
import hashlib
import json
from pathlib import Path

CAPTURES = {
    ('activity', 'light'): 'light-activity-detail',
    ('activity', 'dark'): 'dark-activity-detail',
    ('header-me', 'light'): '1319-profile-light',
    ('header-me', 'dark'): '1319-profile-dark',
    ('achievements', 'light'): 'light-achievements',
    ('achievements', 'dark'): 'dark-achievements',
}
LEGACY = [f'1319-activity-detail-{theme}' for theme in ('light', 'dark')]


def validate_assets(output):
    """Check published files and provenance without image-library dependencies."""
    output = Path(output)
    manifest = json.loads((output / 'manifest.json').read_text())
    record = manifest.get('simulator_captures')
    assert isinstance(record, dict), 'Simulator capture manifest is missing'
    assert record.get('emoji_renderer') == 'Apple iOS Simulator'
    assert record.get('fixture') == 'dev/tests/native-ui/appstore.cjs'
    assert record.get('device') == 'iPhone 16'
    revision = record.get('source_revision', '')
    assert len(revision) == 40 and all(char in '0123456789abcdef' for char in revision), 'Invalid capture source revision'
    captures = record.get('captures', [])
    assert len(captures) == len(CAPTURES), 'Manifest must contain six unique homepage screens'
    assert {(item.get('stage'), item.get('theme')) for item in captures} == set(CAPTURES), 'Manifest must cover all six homepage screens'
    for item in captures:
        base = CAPTURES[(item['stage'], item['theme'])]
        assert item.get('fixture') == record['fixture'] and item.get('device') == record['device']
        assert item.get('two_x') == f'{base}.webp' and item.get('one_x') == f'{base}-1x.webp'
        for name in (item['two_x'], item['one_x']):
            path = output / name
            with path.open('rb') as image:
                header = image.read(12)
            assert len(header) == 12 and header[:4] == b'RIFF' and header[8:12] == b'WEBP', f'{name}: expected a WebP file'
    return record


def convert(source, output):
    from PIL import Image

    source, output = Path(source), Path(output)
    record = json.loads((source / 'homepage-captures.json').read_text())
    captures = record.get('captures', [])
    assert record.get('fixture') == 'dev/tests/native-ui/appstore.cjs', 'Only the fictional Store fixture may publish homepage captures'
    assert record.get('device') == 'iPhone 16' and record.get('runtime', '').startswith('iOS '), 'Captures must identify the iPhone Simulator'
    assert len(record.get('source_revision', '')) == 40, 'Capture source revision must be recorded'
    assert {(item.get('stage'), item.get('theme')) for item in captures} == set(CAPTURES), 'All three screens need both themes'
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    published = []
    for item in captures:
        key = (item['stage'], item['theme'])
        base, png = CAPTURES[key], source / item['png']
        assert item.get('fixture') == record['fixture'] and item.get('device') == record['device']
        assert item.get('runtime') == record['runtime'] and item.get('sdk') == record['sdk']
        assert item.get('viewport') == {'width': 393, 'height': 852, 'offset': 0} and item.get('safeTop', 0) >= 20
        raw = png.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item.get('sha256'), f'{png.name}: capture hash mismatch'
        with Image.open(png) as captured:
            assert captured.format == 'PNG' and captured.size == (1179, 2556), f'{png.name}: expected a full iPhone 16 screenshot'
            two_x = captured.convert('RGB').resize((786, 1704), Image.Resampling.LANCZOS)
        two_x.save(output / f'{base}.webp', 'WEBP', quality=82, method=6)
        two_x.resize((393, 852), Image.Resampling.LANCZOS).save(output / f'{base}-1x.webp', 'WEBP', quality=82, method=6)
        published.append({
            'stage': item['stage'], 'theme': item['theme'], 'device': item['device'],
            'runtime': item['runtime'], 'sdk': item['sdk'], 'safe_top_points': item['safeTop'],
            'fixture': item['fixture'], 'source_sha256': item['sha256'],
            'two_x': f'{base}.webp', 'one_x': f'{base}-1x.webp',
        })
    for base in LEGACY:
        for suffix in ('.webp', '-1x.webp'):
            (output / (base + suffix)).unlink(missing_ok=True)
    safe_area = output / 'safe-area-audit.json'
    if safe_area.is_file():
        audit = json.loads(safe_area.read_text())
        replaced = {'light-activity-detail', 'dark-activity-detail', 'light-achievements', 'dark-achievements'}
        audit['captures'] = [item for item in audit.get('captures', []) if item.get('scene') not in replaced]
        safe_area.write_text(json.dumps(audit, indent=2) + '\n')
    manifest['simulator_captures'] = {
        'source_revision': record['source_revision'], 'device': record['device'],
        'runtime': record['runtime'], 'sdk': record['sdk'],
        'fixture': record['fixture'], 'emoji_renderer': 'Apple iOS Simulator',
        'captures': sorted(published, key=lambda item: (item['stage'], item['theme'])),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    validate_assets(output)


if __name__ == '__main__':
    import sys
    convert(sys.argv[1], sys.argv[2])
