"""Prepare diagnostics only in a disposable bundle; leave the original app/assets intact."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
PREPARE=ROOT/'dev/tests/native-ui/prepare.py'


class DisplayCopyTests(unittest.TestCase):
    def test_original_and_update_keep_fixture_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'Original.app';public=source/'public';static=public/'static';static.mkdir(parents=True)
            (public/'index.html').write_text('<body><script src="/static/keyboard.js?v=1"></script></body>')
            (static/'native.js').write_text("const get = async (key) => (await prefs.get({key})).value;")
            (static/'appearance.js').write_bytes((ROOT/'app/static/appearance.js').read_bytes())
            before={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
            destination=Path(temp)/'Fixture.app'
            for update,token in [(False,'a'*32),(True,'b'*32)]:
                args=['python3',str(PREPARE),str(source),str(destination),'--stage','review','--root','16','--run',token]
                if update:args.append('--update')
                subprocess.run(args,check=True,cwd=ROOT)
                early=(destination/'public/static/native-ui-early.js').read_text()
                self.assertIn('function install(cfg, env = globalThis)',early)
                self.assertEqual(early.count('function install(cfg, env = globalThis)'),1)
                self.assertLess(early.index('function install'),early.index('const cfg=globalThis.KinettaUIFixture,errors='))
                self.assertIn('"run": "'+token+'"',early)
                self.assertEqual((destination/'public/static/appearance.js').read_bytes(),(static/'appearance.js').read_bytes(),'Production appearance bytes stay exact even in the instrumented copy')
                late=(destination/'public/static/native-ui-late.js').read_text()
                self.assertIn('display:cfg.displayDiagnostics(),navigation',late)
                self.assertIn('errors:cfg.errors,display:cfg.displayDiagnostics()',late)
                self.assertEqual((destination/'public/index.html').read_text().count('native-ui-late.js'),1)
                after={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
                self.assertEqual(before,after)


if __name__=='__main__':unittest.main()
