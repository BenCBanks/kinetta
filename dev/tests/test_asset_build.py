"""Disposable builds and real mobile-copy parity; no server, credentials or devices."""
import hashlib
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('asset_build',ROOT/'app/asset_build.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


class AssetBuildTests(unittest.TestCase):
    def tree(self,parent):
        source=parent/'source';source.mkdir()
        (source/'index.html').write_text('<link href="/static/style.css?v=__ASSET_HASH__"><script src="/static/app.js?v=__ASSET_HASH__"></script><link href="/manifest.webmanifest">')
        (source/'sw.js').write_text("const SHELL = 'fit-shell-__SHELL_HASH__';\n")
        (source/'style.css').write_text('body {color:blue}\n')
        (source/'app.js').write_text('console.log("fictional");\n')
        (source/'manifest.webmanifest').write_text('{}')
        return source

    def files(self,root):return {p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def test_change_determinism_and_in_place_rebuild(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=self.tree(parent);original=self.files(source)
            first=builder.build(source,parent/'one');second=builder.build(source,parent/'two')
            self.assertEqual(first,second);self.assertEqual(self.files(parent/'one'),self.files(parent/'two'))
            self.assertEqual(original,self.files(source))
            builder.build(parent/'one',parent/'one');self.assertEqual(self.files(parent/'one'),self.files(parent/'two'))
            (source/'style.css').write_text('body {color:green}\n');changed=builder.build(source,parent/'three')
            self.assertNotEqual(first['shell'],changed['shell']);self.assertNotEqual(first['assets']['style.css'],changed['assets']['style.css'])
            self.assertEqual(first['assets']['app.js'],changed['assets']['app.js'])
            html=(parent/'three/index.html').read_text();self.assertNotIn('__ASSET_HASH__',html)
            self.assertIn('app.js?v='+first['assets']['app.js'],html)
            self.assertIn('style.css?v='+changed['assets']['style.css'],html)
            (source/'unreferenced.svg').write_text('<svg/>');added=builder.build(source,parent/'four');self.assertNotEqual(changed['shell'],added['shell'])
            (source/'unreferenced.svg').unlink();builder.build(source,parent/'five');self.assertEqual(self.files(parent/'three'),self.files(parent/'five'))
            (source/'sw.js').write_text((source/'sw.js').read_text()+'// worker logic changed\n')
            self.assertNotEqual(changed['shell'],builder.build(source,parent/'six')['shell'])

    def test_real_tree_and_mobile_bundle_match(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=parent/'app/static';shutil.copytree(ROOT/'app/static',source)
            before=self.files(source);result=builder.build(source,parent/'docker')
            script=parent/'mobile/scripts/copy-web.mjs';script.parent.mkdir(parents=True);shutil.copy2(ROOT/'mobile/scripts/copy-web.mjs',script)
            shutil.copy2(ROOT/'app/asset_build.py',parent/'app/asset_build.py')
            subprocess.run(['node',str(script)],check=True,capture_output=True)
            expected=self.files(parent/'docker');expected.pop('sw.js')
            self.assertEqual(expected,self.files(parent/'mobile/www/static'))
            self.assertEqual((parent/'docker/index.html').read_bytes(),(parent/'mobile/www/index.html').read_bytes())
            self.assertEqual(before,self.files(source));self.assertFalse((parent/'mobile/www/static/sw.js').exists())
            html=(parent/'docker/index.html').read_text()
            for match in builder.REFERENCE.finditer(html):
                url=urlsplit(match['url'])
                if not url.path.startswith('/static/') and url.path!='/manifest.webmanifest':continue
                name=url.path.removeprefix('/static/').removeprefix('/')
                value=parse_qs(url.query).get('v',[''])[0]
                self.assertRegex(value,r'^[0-9a-f]{32}$')
                self.assertEqual(value,hashlib.sha256((parent/'docker'/name).read_bytes()).hexdigest()[:32])
            self.assertNotIn('__ASSET_HASH__',html);self.assertNotIn('__SHELL_HASH__',(parent/'docker/sw.js').read_text())
            self.assertIn(result['shell'],(parent/'docker/sw.js').read_text())

    def test_two_branches_merge_without_version_edits(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=self.tree(parent)
            (source/'style.css').write_text(''.join(f'.demo-{n} {{ margin:{n}px; }}\n' for n in range(100)))
            def git(*args):return subprocess.run(['git','-C',str(source),*args],check=True,capture_output=True)
            git('init','-b','main');git('config','user.name','Demo');git('config','user.email','demo@example.invalid');git('add','.');git('commit','-m','Base')
            git('checkout','-b','first');p=source/'style.css';p.write_text(p.read_text().replace('margin:1px','margin:2px'));git('commit','-am','First style change')
            git('checkout','main');git('checkout','-b','second');p.write_text(p.read_text().replace('margin:98px','margin:99px'));git('commit','-am','Second style change')
            git('checkout','main');git('merge','--no-edit','first');git('merge','--no-edit','second')
            self.assertEqual(git('diff','HEAD~2','--name-only').stdout.strip(),b'style.css')
            # Build source outside .git: both source entry points remain untouched.
            git('show','HEAD:index.html');self.assertIn('__ASSET_HASH__',(source/'index.html').read_text())
            self.assertIn('__SHELL_HASH__',(source/'sw.js').read_text())

    def test_missing_reference_fails_build(self):
        with tempfile.TemporaryDirectory() as temp:
            source=self.tree(Path(temp));(source/'app.js').unlink()
            with self.assertRaisesRegex(ValueError,'Missing referenced'):builder.build(source,Path(temp)/'output')

    def test_direct_server_uses_disposable_stamped_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            source=self.tree(Path(temp));before=self.files(source)
            output=builder.runtime_copy(source)
            try:
                self.assertIsNotNone(output);self.assertNotIn('__ASSET_HASH__',(Path(output.name)/'index.html').read_text())
                self.assertIsNone(builder.runtime_copy(output.name));self.assertEqual(before,self.files(source))
            finally:output.cleanup()

    def test_embedded_logo_and_manifest_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=self.tree(parent)
            (source/'logo.svg').write_text('<svg>one</svg>')
            (source/'app.js').write_text('const picture=`<source srcset="/static/logo.svg?v=__ASSET_HASH__"><img src="/static/logo.svg?v=__ASSET_HASH__">`;')
            (source/'manifest.webmanifest').write_text('{"icons":[{"src":"/static/logo.svg?v=__ASSET_HASH__"}]}')
            first=builder.build(source,parent/'one');(source/'logo.svg').write_text('<svg>two</svg>')
            second=builder.build(source,parent/'two')
            for name in ('logo.svg','app.js','manifest.webmanifest'):
                self.assertNotEqual(first['assets'][name],second['assets'][name])
                self.assertEqual(second['assets'][name],hashlib.sha256((parent/'two'/name).read_bytes()).hexdigest()[:32])
            self.assertEqual(first['assets']['style.css'],second['assets']['style.css'])
            self.assertIn('app.js?v='+second['assets']['app.js'],(parent/'two/index.html').read_text())
            before=self.files(parent/'two');builder.build(parent/'two',parent/'two');self.assertEqual(before,self.files(parent/'two'))


if __name__=='__main__':unittest.main()
