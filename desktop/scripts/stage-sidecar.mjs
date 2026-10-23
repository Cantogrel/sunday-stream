// Prépare desktop/sidecar/ : le service Node regroupé en UN fichier (esbuild),
// les pages du service, l'UI du téléphone, l'APK, et node.exe en externalBin de
// Tauri. Même arborescence relative que le dépôt (sidecar/pc-service/src/index.js,
// sidecar/mobile-app/www, sidecar/app.apk) pour que staticServer.js résolve ses
// dossiers sans changement.
//
// Allègement de l'installeur :
//  - le service et ses ~90 paquets JS tiennent dans src/index.js ;
//  - seul node-web-audio-api reste externe (binaire natif) et n'embarque QUE le
//    binaire win32-x64 (les 6 autres plateformes pèsent ≈ 33 Mo) ;
//  - node-fetch (tiré par node-web-audio-api pour des AudioWorklet distants, non
//    utilisés ici) est remplacé par un module vide : il entraînait ≈ 20 Mo.
import { existsSync, cpSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'desktop', 'sidecar');
const svcSrc = join(root, 'pc-service');
const svc = join(out, 'pc-service');
const pkg = JSON.parse(readFileSync(join(svcSrc, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(svc, 'src'), { recursive: true });

// Dépendances de production du service (nécessaires au bundle).
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: svcSrc, stdio: 'inherit' });

await build({
  entryPoints: [join(svcSrc, 'src', 'index.js')],
  outfile: join(svc, 'src', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node-web-audio-api', 'bufferutil', 'utf-8-validate', 'zlib-sync', 'erlpack', '@discordjs/opus', 'sodium-native', 'libsodium-wrappers'],
  banner: { js: "import { createRequire as __sundayCreateRequire } from 'node:module'; const require = __sundayCreateRequire(import.meta.url);" },
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none',
  logLevel: 'warning',
});
// version.js lit ../package.json (version du service) ; "type" : module pour le bundle ESM.
writeFileSync(join(svc, 'package.json'), JSON.stringify({ name: 'sunday-stream-service', version: pkg.version, type: 'module' }, null, 2));

cpSync(join(svcSrc, 'public'), join(svc, 'public'), { recursive: true });
cpSync(join(root, 'mobile-app', 'www'), join(out, 'mobile-app', 'www'), { recursive: true });

// node-web-audio-api : uniquement le binaire win32-x64.
const nwaSrc = join(svcSrc, 'node_modules', 'node-web-audio-api');
const nwaDst = join(svc, 'node_modules', 'node-web-audio-api');
const keepNative = 'node-web-audio-api.win32-x64-msvc.node';
cpSync(nwaSrc, nwaDst, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(nwaSrc.length + 1);
    if (rel.endsWith('.node')) return rel === keepNative;
    if (rel === `node_modules${sep}node-fetch` || rel.startsWith(`node_modules${sep}node-fetch${sep}`)) return false;
    return !/\.(md|d\.ts)$/i.test(rel);
  },
});
if (!existsSync(join(nwaDst, keepNative))) throw new Error(`${keepNative} introuvable dans node-web-audio-api`);
cpSync(join(svcSrc, 'node_modules', 'caller'), join(svc, 'node_modules', 'caller'), { recursive: true });
const stub = join(nwaDst, 'node_modules', 'node-fetch');
mkdirSync(stub, { recursive: true });
writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: 'node-fetch', version: '0.0.0-stub', type: 'module', main: 'index.js' }));
writeFileSync(join(stub, 'index.js'), "export default function fetch() { throw new Error('node-fetch non embarqué : AudioWorklet distant non utilisé'); }\n");

// APK signé (release) de préférence : la clé de signature reste la même d'une
// version à l'autre, ce qui permet à Android de le mettre à jour sur place.
const apkDir = join(root, 'mobile-app', 'android', 'app', 'build', 'outputs', 'apk');
const apk = [join(apkDir, 'release', 'app-release.apk'), join(apkDir, 'debug', 'app-debug.apk')].find(existsSync) ?? '';
if (existsSync(apk)) copyFileSync(apk, join(out, 'app.apk'));
else console.warn("APK introuvable : l'installeur n'embarquera pas l'app téléphone (voir mobile-app/README.md pour la construire)");

const bins = join(root, 'desktop', 'src-tauri', 'binaries');
mkdirSync(bins, { recursive: true });
copyFileSync(process.execPath, join(bins, 'node-x86_64-pc-windows-msvc.exe'));
console.log('sidecar prêt');
