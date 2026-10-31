// Copies the phone app (app/static) into www/, the folder Capacitor builds into the iPhone app. The pages ask for their
// files at /static/..., so they keep that place; index.html goes to the top. The shared Python builder stamps exactly
// the same content hashes as Docker, without editing app/static or relying on hand-maintained version numbers.
import {mkdirSync, rmSync, copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'app', 'static');
const www = join(here, '..', 'www');
rmSync(www, {recursive: true, force: true});
mkdirSync(www, {recursive: true});
execFileSync('python3', [join(here, '..', '..', 'app', 'asset_build.py'), src, join(www, 'static')], {stdio: 'inherit'});
rmSync(join(www, 'static', 'sw.js')); // no service worker in the native app
copyFileSync(join(www, 'static', 'index.html'), join(www, 'index.html'));
copyFileSync(join(www, 'static', 'manifest.webmanifest'), join(www, 'manifest.webmanifest'));
console.log('stamped app/static into mobile/www');
