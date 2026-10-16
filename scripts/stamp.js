#!/usr/bin/env node
/* stamp.js — before a publication: give this build its version and tell the service worker which files to keep.
 *
 *   node scripts/stamp.js           writes js/version.js and the two marked spots in sw.js
 *   node scripts/stamp.js --check   changes nothing; says whether the stamp is current (exit 1 if not)
 *
 * The version is the date of the newest shipped file and a short fingerprint of everything shipped: the same files
 * always give the same version, so publishing twice without a change never makes the phones download anything.
 * Needs only Node (which the Vercel command line has anyway).
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');

function walk(dir, out) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out); else if (!e.name.startsWith('.')) out.push('/' + rel);
  });
  return out;
}

/* what the phone keeps for offline use: the page, its styles and scripts, the fonts, the icons, the two ring films, the manifest.
   (Not the launch screens — the phone reads those itself when the icon is added — and not the lab pages.) */
const files = ['/index.html', '/manifest.webmanifest'].concat(walk('css', []), walk('js', []), walk('assets/fonts', []), walk('assets/icons', []), walk('assets/rings', [])).sort();
files.forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) { console.error('missing: ' + f); process.exit(2); } });

/* the fingerprint leaves out the two files this script writes */
const h = crypto.createHash('sha1');
let newest = 0;
files.forEach((f) => {
  const p = path.join(ROOT, f);
  newest = Math.max(newest, fs.statSync(p).mtimeMs);
  if (f === '/js/version.js') return;
  h.update(f); h.update(fs.readFileSync(p));
});
const stamp = new Date(newest).toISOString().slice(0, 10) + ' · ' + h.digest('hex').slice(0, 8);
const cacheName = stamp.replace(/[^0-9a-z]+/gi, '-');

const versionJs = "/* version.js — stamped by scripts/stamp.js at each publication (together with sw.js). Shown at the bottom of Settings. */\n" +
  "(function (root) {\n  root.COH = root.COH || {};\n  root.COH.VERSION = " + JSON.stringify(stamp) + ";\n})(typeof self !== 'undefined' ? self : this);\n";

const swPath = path.join(ROOT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const list = files.map((f) => '  ' + JSON.stringify(f)).join(',\n');
const next = sw
  .replace(/\/\*VERSION\*\/[\s\S]*?\/\*END\*\//, '/*VERSION*/' + JSON.stringify(cacheName) + '/*END*/')
  .replace(/\/\*PRECACHE\*\/[\s\S]*?\/\*END\*\//, '/*PRECACHE*/[\n' + list + '\n]/*END*/');
if (next === sw && !/\/\*VERSION\*\//.test(sw)) { console.error('sw.js has no /*VERSION*/ … /*END*/ marks'); process.exit(2); }

const cur = fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8');
const same = cur === versionJs && next === sw;
if (check) { console.log(same ? 'stamp current: ' + stamp : 'stamp OUT OF DATE (would be ' + stamp + ')'); process.exit(same ? 0 : 1); }
if (!same) { fs.writeFileSync(path.join(ROOT, 'js/version.js'), versionJs); fs.writeFileSync(swPath, next); }
console.log('version ' + stamp + ' · ' + files.length + ' files kept for offline' + (same ? ' (unchanged)' : ''));
