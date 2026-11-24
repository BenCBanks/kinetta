import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

MODULE = Path(__file__).parents[1] / 'screenshots/homepage_simulator_webp.py'
spec = importlib.util.spec_from_file_location('homepage_simulator_webp', MODULE)
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class HomepageSimulatorWebpTests(unittest.TestCase):
    def test_fictional_simulator_screens_make_two_densities_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source'; output = root / 'shots'
            source.mkdir(); output.mkdir()
            revision = 'a' * 40
            captures = []
            for index, ((stage, theme), _) in enumerate(converter.CAPTURES.items()):
                name = f'homepage-{theme}-{stage}.png'; png = source / name
                Image.new('RGB', (1179, 2556), (20 + index, 40, 60)).save(png)
                captures.append({'stage': stage, 'theme': theme, 'png': name, 'device': 'iPhone 16',
                    'runtime': 'iOS 26.1', 'sdk': '26.1', 'viewport': {'width': 393, 'height': 852, 'offset': 0},
                    'safeTop': 59, 'fixture': 'dev/tests/native-ui/appstore.cjs', 'sha256': hashlib.sha256(png.read_bytes()).hexdigest()})
            (source / 'homepage-captures.json').write_text(json.dumps({'source_revision': revision,
                'device': 'iPhone 16', 'runtime': 'iOS 26.1', 'sdk': '26.1',
                'fixture': 'dev/tests/native-ui/appstore.cjs', 'captures': captures}))
            (output / 'manifest.json').write_text(json.dumps({'generated_at': 'fixture', 'revision': revision}))
            (output / 'safe-area-audit.json').write_text(json.dumps({'topInsetPx': 59, 'captures': [
                {'scene': name} for name in ('light-activity-detail', 'dark-activity-detail', 'light-achievements', 'dark-achievements', 'light-profile', 'dark-profile', 'light-feed')]}))
            for name in converter.LEGACY:
                for suffix in ('.webp', '-1x.webp'):
                    (output / (name + suffix)).write_bytes(b'obsolete alias')

            converter.convert(source, output)

            for base in converter.CAPTURES.values():
                with Image.open(output / f'{base}.webp') as image: self.assertEqual(image.size, (786, 1704))
                with Image.open(output / f'{base}-1x.webp') as image: self.assertEqual(image.size, (393, 852))
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(manifest['simulator_captures']['emoji_renderer'], 'Apple iOS Simulator')
            self.assertEqual(manifest['simulator_captures']['source_revision'], revision)
            self.assertEqual(len(manifest['simulator_captures']['captures']), 6)
            self.assertEqual([item['scene'] for item in json.loads((output / 'safe-area-audit.json').read_text())['captures']], ['light-profile', 'dark-profile', 'light-feed'])
            self.assertTrue(all(not (output / (name + suffix)).exists() for name in converter.LEGACY for suffix in ('.webp', '-1x.webp')))

    def test_rejects_unverified_capture_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source'; output = root / 'shots'
            source.mkdir(); output.mkdir(); (output / 'manifest.json').write_text('{}')
            item = {'stage': 'activity', 'theme': 'light', 'png': 'capture.png', 'device': 'iPhone 16',
                'runtime': 'iOS 26.1', 'sdk': '26.1', 'viewport': {'width': 393, 'height': 852, 'offset': 0},
                'safeTop': 59, 'fixture': 'dev/tests/native-ui/appstore.cjs', 'sha256': '0' * 64}
            Image.new('RGB', (1179, 2556)).save(source / item['png'])
            items = [dict(item, stage=stage, theme=theme) for stage, theme in converter.CAPTURES]
            (source / 'homepage-captures.json').write_text(json.dumps({'source_revision': 'a' * 40,
                'device': 'iPhone 16', 'runtime': 'iOS 26.1', 'sdk': '26.1',
                'fixture': 'dev/tests/native-ui/appstore.cjs', 'captures': items}))
            with self.assertRaisesRegex(AssertionError, 'capture hash mismatch'):
                converter.convert(source, output)


if __name__ == '__main__': unittest.main()
