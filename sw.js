/* sw.js — the offline copy.
 *
 * The whole app is a few small files. They are all fetched together when a new version appears, kept together under
 * one name, and served from there: the page never mixes files of two versions. The two marked spots are written by
 * scripts/stamp.js at each publication; in development they stay empty and the worker lets everything through.
 *
 * A new version installs in the background and takes over at once; the page (boot.js) reloads itself at a calm moment.
 */
'use strict';
const VERSION = /*VERSION*/"2026-09-29-15026aea"/*END*/;
const PRECACHE = /*PRECACHE*/[
  "/assets/fonts/fraunces-500.woff2",
  "/assets/fonts/inter-400.woff2",
  "/assets/fonts/inter-500.woff2",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/favicon-32.png",
  "/assets/icons/favicon.svg",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-maskable-512.png",
  "/assets/rings/ring-equal.mp4",
  "/assets/rings/ring-sigh.mp4",
  "/css/app.css",
  "/css/extra.css",
  "/index.html",
  "/js/analysis.js",
  "/js/boot.js",
  "/js/flows.js",
  "/js/guide.js",
  "/js/model.js",
  "/js/nav.js",
  "/js/paint.js",
  "/js/pulse.js",
  "/js/store.js",
  "/js/version.js",
  "/manifest.webmanifest"
]/*END*/;
const CACHE = 'coh-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      await Promise.all(PRECACHE.map(async (url) => {
        const res = await fetch(new Request(url, { cache: 'reload' }));         // past the browser's own copy: this must be this version
        if (!res.ok) throw new Error(url + ' ' + res.status);                    // a version that cannot be kept whole is not installed at all
        await c.put(url, res);
      }));
    } catch (err) { await caches.delete(CACHE); throw err; }                     // …and leaves nothing half-kept behind
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('coh-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Safari asks for its films in pieces (Range); a kept copy has to answer in pieces too */
function piece(req, res) {
  const h = req.headers.get('range');
  if (!h || res.status !== 200) return res;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h);
  if (!m || (m[1] === '' && m[2] === '')) return res;
  return res.arrayBuffer().then((buf) => {
    const size = buf.byteLength;
    const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (!(start >= 0 && start <= end)) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    return new Response(buf.slice(start, end + 1), {
      status: 206, statusText: 'Partial Content',
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'video/mp4', 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' }
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !PRECACHE.length) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      if (url.pathname === '/' || url.pathname === '/index.html') {              // the app itself: from the kept copy (?source=pwa and the like do not matter)
        const home = await c.match('/index.html');
        if (home) return home;
      }
      try { return await fetch(req); }
      catch (_) { return (await c.match(url.pathname)) || (await c.match('/index.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    }
    const hit = await c.match(url.pathname);
    if (hit) return piece(req, hit);
    return fetch(req);
  })());
});
