import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).parents[1] / 'screenshots/homepage_simulator_webp.py'
spec = importlib.util.spec_from_file_location('homepage_simulator_webp', MODULE)
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class HomepageSimulatorWebpManifestTests(unittest.TestCase):
    def make_assets(self, output):
        captures = []
        for (stage, theme), base in converter.CAPTURES.items():
            captures.append({'stage': stage, 'theme': theme, 'fixture': 'dev/tests/native-ui/appstore.cjs',
                'device': 'iPhone 16', 'two_x': f'{base}.webp', 'one_x': f'{base}-1x.webp'})
            for density in ('', '-1x'):
                (output / f'{base}{density}.webp').write_bytes(b'RIFF\x08\x00\x00\x00WEBPVP8 ')
        (output / 'manifest.json').write_text(json.dumps({'simulator_captures': {
            'source_revision': 'a' * 40, 'device': 'iPhone 16', 'runtime': 'iOS 26.1', 'sdk': '26.1',
            'fixture': 'dev/tests/native-ui/appstore.cjs', 'emoji_renderer': 'Apple iOS Simulator', 'captures': captures,
        }}))

    def test_manifest_and_webp_headers_are_valid_using_stdlib(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.make_assets(output)
            record = converter.validate_assets(output)
            self.assertEqual(len(record['captures']), 6)

    def test_rejects_missing_image_and_non_webp_header(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.make_assets(output)
            record = json.loads((output / 'manifest.json').read_text())
            target = output / record['simulator_captures']['captures'][0]['two_x']
            target.write_bytes(b'not a webp file')
            with self.assertRaisesRegex(AssertionError, 'expected a WebP file'):
                converter.validate_assets(output)
            target.unlink()
            with self.assertRaises(FileNotFoundError):
                converter.validate_assets(output)


if __name__ == '__main__': unittest.main()
