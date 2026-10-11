// Copies the phone app (app/static) into www/, the folder Capacitor builds into the iPhone app. The pages ask for their
// files at /static/..., so they keep that place; index.html goes to the top. No build step, same files as the server.
import {cpSync, mkdirSync, rmSync, copyFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'app', 'static');
const www = join(here, '..', 'www');
rmSync(www, {recursive: true, force: true});
mkdirSync(www, {recursive: true});
cpSync(src, join(www, 'static'), {recursive: true, filter: (p) => !p.endsWith('sw.js')});   // no service worker in the app
copyFileSync(join(src, 'index.html'), join(www, 'index.html'));
copyFileSync(join(src, 'manifest.webmanifest'), join(www, 'manifest.webmanifest'));
console.log('copied app/static into mobile/www');
