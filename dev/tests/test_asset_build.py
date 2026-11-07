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
            built_app=(parent/'docker/app.js').read_text()
            self.assertIn('/static/explore.js?v='+result['assets']['explore.js'],built_app,'the real deferred route points at Explore’s own content hash')
            self.assertIn('/static/social-notifications.js?v='+result['assets']['social-notifications.js'],built_app,'the notification routes point at their own content hash')
            self.assertIn('/static/food-import.js?v='+result['assets']['food-import.js'],built_app,'the real deferred route points at Food import’s own content hash')
            self.assertIn('/static/lift-routes.js?v='+result['assets']['lift-routes.js'],built_app,'the deferred lifting routes point at their own content hash')

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

    def test_lazy_bundle_version_tracks_its_own_content(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=self.tree(parent)
            (source/'explore.js').write_text('window.Explore="first";\n')
            (source/'social-notifications.js').write_text('window.Notifications="first";\n')
            (source/'food-import.js').write_text('window.FoodImport="first";\n')
            (source/'lift-routes.js').write_text('window.Lift="first";\n')
            (source/'other.js').write_text('window.Other="unchanged";\n')
            (source/'app.js').write_text("const bundles=['/static/explore.js?v=__ASSET_HASH__','/static/social-notifications.js?v=__ASSET_HASH__','/static/food-import.js?v=__ASSET_HASH__','/static/lift-routes.js?v=__ASSET_HASH__'];\n")
            first=builder.build(source,parent/'first')
            first_app=(parent/'first/app.js').read_text()
            first_url=re.search(r'/static/explore\.js\?v=([0-9a-f]{32})',first_app).group(0)
            first_notifications_url=re.search(r'/static/social-notifications\.js\?v=([0-9a-f]{32})',first_app).group(0)
            first_food_url=re.search(r'/static/food-import\.js\?v=([0-9a-f]{32})',first_app).group(0)
            first_lift_url=re.search(r'/static/lift-routes\.js\?v=([0-9a-f]{32})',first_app).group(0)

            (source/'explore.js').write_text('window.Explore="edited";\n')
            second=builder.build(source,parent/'second')
            second_app=(parent/'second/app.js').read_text()
            second_url=re.search(r'/static/explore\.js\?v=([0-9a-f]{32})',second_app).group(0)
            second_notifications_url=re.search(r'/static/social-notifications\.js\?v=([0-9a-f]{32})',second_app).group(0)
            second_food_url=re.search(r'/static/food-import\.js\?v=([0-9a-f]{32})',second_app).group(0)
            second_lift_url=re.search(r'/static/lift-routes\.js\?v=([0-9a-f]{32})',second_app).group(0)

            self.assertNotEqual(first_url,second_url,'an Explore-only edit gets a fresh deferred URL')
            self.assertIn(first['assets']['explore.js'],first_url)
            self.assertIn(second['assets']['explore.js'],second_url)
            self.assertEqual(first_notifications_url,second_notifications_url,'an Explore-only edit keeps the notification URL')
            self.assertIn(first['assets']['social-notifications.js'],first_notifications_url)
            self.assertEqual(first['assets']['social-notifications.js'],second['assets']['social-notifications.js'])
            self.assertEqual(first_food_url,second_food_url,'an Explore-only edit keeps the Food import URL')
            self.assertEqual(first['assets']['food-import.js'],second['assets']['food-import.js'])
            self.assertEqual(first_lift_url,second_lift_url,'an Explore-only edit keeps the lift URL')
            self.assertEqual(first['assets']['other.js'],second['assets']['other.js'])
            self.assertEqual(first['assets']['style.css'],second['assets']['style.css'])
            self.assertNotEqual(first['assets']['app.js'],second['assets']['app.js'],'the bundle map follows Explore’s new hash')

            (source/'social-notifications.js').write_text('window.Notifications="edited";\n')
            third=builder.build(source,parent/'third')
            third_app=(parent/'third/app.js').read_text()
            third_url=re.search(r'/static/explore\.js\?v=([0-9a-f]{32})',third_app).group(0)
            third_notifications_url=re.search(r'/static/social-notifications\.js\?v=([0-9a-f]{32})',third_app).group(0)
            third_food_url=re.search(r'/static/food-import\.js\?v=([0-9a-f]{32})',third_app).group(0)
            third_lift_url=re.search(r'/static/lift-routes\.js\?v=([0-9a-f]{32})',third_app).group(0)
            self.assertEqual(second_url,third_url,'a notification-only edit keeps Explore’s URL')
            self.assertEqual(second['assets']['explore.js'],third['assets']['explore.js'])
            self.assertNotEqual(second_notifications_url,third_notifications_url,'a notification-only edit gets a fresh deferred URL')
            self.assertIn(first['assets']['social-notifications.js'],first_notifications_url)
            self.assertIn(second['assets']['social-notifications.js'],second_notifications_url)
            self.assertIn(third['assets']['social-notifications.js'],third_notifications_url)
            self.assertEqual(second_food_url,third_food_url,'a notification-only edit keeps the Food import URL')
            self.assertEqual(second_lift_url,third_lift_url,'a notification-only edit keeps the lift URL')
            self.assertEqual(second['assets']['style.css'],third['assets']['style.css'])
            self.assertEqual(second['assets']['other.js'],third['assets']['other.js'])
            self.assertNotEqual(second['assets']['app.js'],third['assets']['app.js'],'the bundle map follows the notification hash')

            (source/'food-import.js').write_text('window.FoodImport="edited";\n')
            fourth=builder.build(source,parent/'fourth')
            fourth_app=(parent/'fourth/app.js').read_text()
            fourth_url=re.search(r'/static/explore\.js\?v=([0-9a-f]{32})',fourth_app).group(0)
            fourth_notifications_url=re.search(r'/static/social-notifications\.js\?v=([0-9a-f]{32})',fourth_app).group(0)
            fourth_food_url=re.search(r'/static/food-import\.js\?v=([0-9a-f]{32})',fourth_app).group(0)
            fourth_lift_url=re.search(r'/static/lift-routes\.js\?v=([0-9a-f]{32})',fourth_app).group(0)
            self.assertNotEqual(third_food_url,fourth_food_url,'a Food-import-only edit gets a fresh deferred URL')
            self.assertIn(third['assets']['food-import.js'],third_food_url)
            self.assertIn(fourth['assets']['food-import.js'],fourth_food_url)
            self.assertEqual(third_url,fourth_url,'a Food-import-only edit keeps Explore’s URL')
            self.assertEqual(third_notifications_url,fourth_notifications_url,'a Food-import-only edit keeps the notification URL')
            self.assertEqual(third_lift_url,fourth_lift_url,'a Food-import-only edit keeps the lift URL')
            self.assertEqual(third['assets']['style.css'],fourth['assets']['style.css'])
            self.assertEqual(third['assets']['other.js'],fourth['assets']['other.js'])
            self.assertNotEqual(third['assets']['app.js'],fourth['assets']['app.js'],'the bundle map follows the Food import hash')

            (source/'lift-routes.js').write_text('window.Lift="edited";\n')
            fifth=builder.build(source,parent/'fifth')
            fifth_app=(parent/'fifth/app.js').read_text()
            fifth_url=re.search(r'/static/explore\.js\?v=([0-9a-f]{32})',fifth_app).group(0)
            fifth_notifications_url=re.search(r'/static/social-notifications\.js\?v=([0-9a-f]{32})',fifth_app).group(0)
            fifth_food_url=re.search(r'/static/food-import\.js\?v=([0-9a-f]{32})',fifth_app).group(0)
            fifth_lift_url=re.search(r'/static/lift-routes\.js\?v=([0-9a-f]{32})',fifth_app).group(0)
            self.assertNotEqual(fourth_lift_url,fifth_lift_url,'a lift-only edit gets a fresh deferred URL')
            self.assertIn(fourth['assets']['lift-routes.js'],fourth_lift_url)
            self.assertIn(fifth['assets']['lift-routes.js'],fifth_lift_url)
            self.assertEqual(fourth_url,fifth_url,'a lift-only edit keeps Explore’s URL')
            self.assertEqual(fourth_notifications_url,fifth_notifications_url,'a lift-only edit keeps the notification URL')
            self.assertEqual(fourth_food_url,fifth_food_url,'a lift-only edit keeps the Food import URL')
            self.assertEqual(fourth['assets']['explore.js'],fifth['assets']['explore.js'])
            self.assertEqual(fourth['assets']['social-notifications.js'],fifth['assets']['social-notifications.js'])
            self.assertEqual(fourth['assets']['food-import.js'],fifth['assets']['food-import.js'])
            self.assertNotEqual(fourth['assets']['app.js'],fifth['assets']['app.js'],'the bundle map follows the lift hash')

    def test_food_and_kit_lazy_urls_track_their_own_content(self):
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);source=self.tree(parent)
            (source/'food.js').write_text('window.Food="first";\n')
            (source/'kit.js').write_text('window.Kit="first";\n')
            (source/'app.js').write_text("const bundles=['/static/food.js?v=__ASSET_HASH__','/static/kit.js?v=__ASSET_HASH__'];\n")
            first=builder.build(source,parent/'first');first_app=(parent/'first/app.js').read_text()
            first_food=re.search(r'/static/food\.js\?v=([0-9a-f]{32})',first_app).group(0)
            first_kit=re.search(r'/static/kit\.js\?v=([0-9a-f]{32})',first_app).group(0)
            self.assertIn(first['assets']['food.js'],first_food)
            self.assertIn(first['assets']['kit.js'],first_kit)

            (source/'food.js').write_text('window.Food="edited";\n')
            second=builder.build(source,parent/'second');second_app=(parent/'second/app.js').read_text()
            second_food=re.search(r'/static/food\.js\?v=([0-9a-f]{32})',second_app).group(0)
            second_kit=re.search(r'/static/kit\.js\?v=([0-9a-f]{32})',second_app).group(0)
            self.assertNotEqual(first_food,second_food,'a Food-only edit gets a fresh deferred URL')
            self.assertIn(second['assets']['food.js'],second_food)
            self.assertEqual(first_kit,second_kit,'a Food-only edit keeps Kit’s URL')

            (source/'kit.js').write_text('window.Kit="edited";\n')
            third=builder.build(source,parent/'third');third_app=(parent/'third/app.js').read_text()
            third_food=re.search(r'/static/food\.js\?v=([0-9a-f]{32})',third_app).group(0)
            third_kit=re.search(r'/static/kit\.js\?v=([0-9a-f]{32})',third_app).group(0)
            self.assertEqual(second_food,third_food,'a Kit-only edit keeps Food’s URL')
            self.assertNotEqual(second_kit,third_kit,'a Kit-only edit gets a fresh deferred URL')
            self.assertIn(third['assets']['kit.js'],third_kit)


if __name__=='__main__':unittest.main()
