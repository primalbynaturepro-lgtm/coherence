"""sw_offline.py — the offline copy and the update, on a throw-away copy of the app served on its own port.
    1. first visit: the worker installs and keeps every file; 2. offline: the app opens, the ring film answers in pieces (Range);
    3. a new version: the worker fetches it in the background and the page reloads itself at a calm moment (never mid-session);
    4. a version that cannot be fetched whole is not installed (the old one stays)."""
import os, sys, shutil, subprocess, time, json, socket, tempfile, http.server, threading, functools
from harness import phone

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, '..', '..'))
bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


def reloaded_since(app, token, wait_s=10):
    """did the page reload by itself (a new document, another token) within wait_s seconds?"""
    t0 = time.time()
    while time.time() - t0 < wait_s:
        try:
            if app.ev('window.__load') != token:
                return True
        except Exception:                                    # the document was replaced under us: that is the reload
            app.page.wait_for_selector('html[data-ready="1"]', timeout=8000)
            return True
        app.page.wait_for_timeout(200)
    return False


tmp = tempfile.mkdtemp(prefix='coh-sw-')
site = os.path.join(tmp, 'site')
shutil.copytree(APP, site, ignore=shutil.ignore_patterns('tests', '.vercel', '__pycache__', 'node_modules'))
subprocess.check_call(['node', 'scripts/stamp.js'], cwd=site, stdout=subprocess.DEVNULL)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):                                    # like Vercel: the worker and the page are never cached
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Quiet, directory=site))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:%d' % port
print('serving a copy at', URL)

with phone(sw=True) as app:
    ctx, page = app.ctx, app.page
    page.add_init_script("window.__load = Math.random().toString(36).slice(2);")
    app.open(sw=True, url=URL)
    v1 = app.ev('COH.VERSION')
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=8000)
    keys = app.ev("caches.keys()")
    n = app.ev("caches.open(%s).then(c => c.keys()).then(k => k.length)" % json.dumps(keys[0]))
    check('first visit: the worker controls the page', True)
    check('one cache, named after the version', len(keys) == 1 and keys[0].startswith('coh-'), keys)
    check('every file of the list is kept (25)', n == 25, n)
    load1 = app.ev('window.__load')

    # ---- offline
    ctx.set_offline(True)
    page.reload()
    page.wait_for_selector('html[data-ready="1"]', timeout=8000)
    check('offline: the app opens', app.screen() in ('code', 'qui'), app.screen())
    check('offline: same version', app.ev('COH.VERSION') == v1, app.ev('COH.VERSION'))
    check('offline: the fonts are there', app.ev("document.fonts.check('500 20px Fraunces')") is True)
    r = app.ev("fetch('/assets/rings/ring-equal.mp4', { headers: { Range: 'bytes=0-99' } }).then(async r => [r.status, r.headers.get('content-range'), (await r.arrayBuffer()).byteLength])")
    size = os.path.getsize(os.path.join(site, 'assets/rings/ring-equal.mp4'))
    check('offline: the ring film answers a Range request in pieces', r == [206, 'bytes 0-99/%d' % size, 100], r)
    r = app.ev("fetch('/assets/rings/ring-equal.mp4', { headers: { Range: 'bytes=-50' } }).then(async r => [r.status, r.headers.get('content-range')])")
    check('offline: a suffix Range too', r == [206, 'bytes %d-%d/%d' % (size - 50, size - 1, size)], r)
    r = app.ev("fetch('/?source=pwa').then(r => r.status)")
    check('offline: the home-screen address works', r == 200, r)
    check('no errors (offline)', not app.errors, app.errors)
    ctx.set_offline(False)

    # ---- a new version: the worker fetches it, the page reloads at a calm moment
    load1 = app.ev('window.__load')                          # (this document, after the offline reload)
    with open(os.path.join(site, 'css', 'extra.css'), 'a') as f:
        f.write('\n/* second version */\n')
    subprocess.check_call(['node', 'scripts/stamp.js'], cwd=site, stdout=subprocess.DEVNULL)
    page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
    reloaded = reloaded_since(app, load1)
    page.wait_for_selector('html[data-ready="1"]', timeout=8000)
    v2 = app.ev('COH.VERSION')
    check('update: the page reloaded by itself on a calm screen', reloaded and app.screen() in ('code', 'qui'), (reloaded, app.screen()))
    check('update: new version', v2 != v1, (v1, v2))
    keys2 = app.ev("caches.keys()")
    check('update: the old copy is gone, only the new one kept', len(keys2) == 1 and keys2[0] != keys[0], keys2)
    css = app.ev("fetch('/css/extra.css').then(r => r.text())")
    check('update: the new file is what is served', 'second version' in css)

    # ---- not in the middle of something
    app.ev("localStorage.setItem('coh:v1:meta', JSON.stringify({v: 1, unlocked: true, sound: 'bowl', vol: 0.7, mute: false, ring: 'b', blink: true}))")
    app.ev("localStorage.setItem('coh:v1:profile:mehdi', JSON.stringify({v: 1, who: 'mehdi', rhythm: {value: 5.5, scores: [38, 51, 63, 55, 40], at: 1786000000000, date: '2026-08-11'}, history: [], partial: null, sessions: [], sos: [], cyc: []}))")
    page.reload(); page.wait_for_selector('html[data-ready="1"]', timeout=8000)
    load2 = app.ev('window.__load')
    app.wait_screen('qui')
    app.tap('[data-do="who:mehdi"]'); page.wait_for_timeout(1200)
    app.wait_screen('accueil')
    check('reload is calm on home', app.ev('COH.flows.safeToReload()') is True)
    app.ev("COH.nav.go('test-doigt', 'push')"); page.wait_for_timeout(700)
    check('reload is not calm on a finger screen (or the screen that follows it)', app.ev('COH.flows.safeToReload()') is False, app.screen())
    with open(os.path.join(site, 'css', 'extra.css'), 'a') as f:
        f.write('\n/* third version */\n')
    subprocess.check_call(['node', 'scripts/stamp.js'], cwd=site, stdout=subprocess.DEVNULL)
    page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
    page.wait_for_timeout(2500)
    check('a new version does NOT reload the page while a reading is being set up', app.ev('window.__load') == load2, app.screen())
    app.ev("COH.nav.go('accueil', 'swap')")
    check('…and reloads when the person is back on a calm screen', reloaded_since(app, load2, 8))

    # ---- a version that cannot be fetched whole is not installed
    v3 = None
    page.wait_for_selector('html[data-ready="1"]', timeout=8000)
    v3 = app.ev('COH.VERSION')
    with open(os.path.join(site, 'css', 'extra.css'), 'a') as f:
        f.write('\n/* fourth version */\n')
    subprocess.check_call(['node', 'scripts/stamp.js'], cwd=site, stdout=subprocess.DEVNULL)
    os.rename(os.path.join(site, 'js', 'guide.js'), os.path.join(site, 'js', 'guide.js.off'))       # the list names a file the server no longer has
    load3 = app.ev('window.__load')
    page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update().catch(() => 0))")
    page.wait_for_timeout(3000)
    check('a broken publication is not installed: the page stays as it was', app.ev('window.__load') == load3 and app.ev('COH.VERSION') == v3, (app.ev('COH.VERSION'), v3))
    check('the working copy is still kept', len(app.ev("caches.keys()")) == 1)
    os.rename(os.path.join(site, 'js', 'guide.js.off'), os.path.join(site, 'js', 'guide.js'))

srv.shutdown()
shutil.rmtree(tmp, ignore_errors=True)
print('FAILED: %s' % bad if bad else 'ALL OK')
sys.exit(1 if bad else 0)
