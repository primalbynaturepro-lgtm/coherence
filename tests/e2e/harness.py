"""harness.py — a phone for the tests: Chromium at iPhone size, no service worker, errors collected, helpers to tap and wait.

    with phone() as app:
        app.open()                       # first screen
        app.tap('[data-do="key:2"]')     # tap what is on the current screen
        app.wait_screen('qui')

Nothing here knows the app's logic: it looks at which screen is shown (COH.nav.current) and taps what a person would tap.
"""
import os, json, time, contextlib
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.normpath(os.path.join(ROOT, '..', 'fixtures'))
URL = os.environ.get('COH_URL', 'http://localhost:8811')
SHOTS = os.environ.get('COH_SHOTS', '/tmp/coh-shots')
# the browser the tests drive: $CHROMIUM if set, else the one of this workspace, else the one Playwright brought itself
CHROMIUM = os.environ.get('CHROMIUM') or ('/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None)
T0 = datetime(2026, 9, 29, 5, 10, 0, tzinfo=timezone.utc)                                   # Tuesday 29 September 2026, 07:10 in Paris (clock mode)
T0_MS = int(T0.timestamp() * 1000)


class App:
    def __init__(self, page, ctx):
        self.page, self.ctx, self.errors, self.logs = page, ctx, [], []
        page.on('pageerror', lambda e: self.errors.append('pageerror: %s' % e))
        page.on('console', self._console)
        page.on('requestfailed', lambda r: self.errors.append('requestfailed: %s %s' % (r.url, r.failure)) if not r.url.endswith('.mp4') else None)

    def _console(self, m):
        if m.type in ('error',):
            self.errors.append('console.error: %s' % m.text)
        else:
            self.logs.append('%s: %s' % (m.type, m.text))

    # ---- looking
    def screen(self):
        return self.page.evaluate('window.COH && COH.nav && COH.nav.current')

    def wait_screen(self, sid, timeout=8000):
        try:
            self.page.wait_for_function('(id) => window.COH && COH.nav && COH.nav.current === id', arg=sid, timeout=timeout)
        except Exception:
            raise AssertionError('expected screen %r, still on %r (errors: %s)' % (sid, self.screen(), self.errors[-3:]))

    def text(self, sel, sid=None):
        return self.page.inner_text(('#s-%s ' % sid if sid else '') + sel)

    def bound(self, key, sid=None):
        """the text the app put in a bound spot (textContent: what is in the page, not how the stylesheet dresses it)"""
        sid = sid or self.screen()
        return (self.page.text_content('#s-%s [data-bind="%s"]' % (sid, key)) or '').strip()

    def history(self):
        """every screen shown since the page opened (or since clear_history), in order"""
        return self.page.evaluate('window.__screens || []')

    def clear_history(self):
        self.page.evaluate('window.__screens = []')

    def visible(self, sel, sid=None):
        sid = sid or self.screen()
        return self.page.is_visible('#s-%s %s' % (sid, sel))

    def count(self, sel, sid=None):
        sid = sid or self.screen()
        return self.page.locator('#s-%s %s' % (sid, sel)).count()

    # ---- acting
    def tap(self, sel, sid=None, timeout=4000):
        sid = sid or self.screen()
        self.page.locator('#s-%s %s' % (sid, sel)).first.click(timeout=timeout)

    def tap_text(self, text, sid=None):
        sid = sid or self.screen()
        self.page.locator('#s-%s' % sid).get_by_text(text, exact=True).first.click(timeout=4000)

    def keys(self, digits):
        for d in digits:
            self.tap('[data-do="key:%s"]' % d)

    def go(self, sid, how=None):
        self.page.evaluate('([id, how]) => COH.nav.go(id, how)', [sid, how])
        self.wait_screen(sid)

    def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        path = os.path.join(SHOTS, name + '.png')
        self.page.screenshot(path=path)
        return path

    def ev(self, js, arg=None):
        return self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)

    def open(self, wait=True, sw=False, url=None):
        self.page.goto((url or URL) + ('/index.html' if sw else '/index.html?nosw'))
        if wait:
            self.page.wait_for_selector('html[data-ready="1"]', timeout=8000)
        if self.clocked:
            self.page.clock.pause_at(self.t0 + timedelta(seconds=30))            # (the clock runs on its own until now: give a slow page load room)

    # ---- time (only in clock mode: nothing moves unless we say so)
    clocked = False
    t0 = 0

    def tick(self, ms):
        self.page.clock.run_for(int(ms))

    def run(self, seconds, step=1000):
        """let `seconds` of app time go by, in steps"""
        left = int(seconds * 1000)
        while left > 0:
            d = min(step, left); self.tick(d); left -= d

    def until(self, sid, max_s=30, step=250):
        """advance time until the app shows screen sid"""
        left = int(max_s * 1000)
        while left > 0:
            if self.screen() == sid:
                return True
            d = min(step, left); self.tick(d); left -= d
        if self.screen() == sid:
            return True
        raise AssertionError('expected screen %r after %ss, on %r (errors: %s)' % (sid, max_s, self.screen(), self.errors[-3:]))

    def settle(self):
        if self.clocked:
            self.tick(450)
        else:
            self.page.wait_for_timeout(450)

    def seed(self, who, fn_js):
        """change a profile in the store: fn_js is a JS function body (p) => {...}"""
        self.page.evaluate('async ([who, src]) => { await COH.store.load(who); await COH.store.update(who, new Function("p", src)); await COH.store.flush(); }', [who, fn_js])

    def store_dump(self, who):
        return self.page.evaluate('async (who) => { await COH.store.flush(); return JSON.parse(JSON.stringify(COH.store.profile(who))); }', who)


@contextlib.contextmanager
def phone(camera=None, clock=False, finger=False, seed=None, storage=None, permissions=None, viewport=(430, 932), scale=2, reduced_motion=None, fake_device=False, sw=False, extra_init=None):
    """camera: None (no camera flags) or a fixture name like 'finger-64.mjpeg'.
    finger: replace the camera by the in-page fake finger (tests/e2e/fake-finger.js).
    fake_device: a camera exists but the person has not allowed it (the permission is refused).
    extra_init: scripts to run in the page before the app (a list of JS strings).
    sw: let the service worker run (the app then also has to be opened without ?nosw — see App.open(sw=True)).
    clock: fake timers — nothing moves unless the test calls app.tick()/app.run().
    seed: {'meta': {...}, 'profiles': {'mehdi': {...}}} written to localStorage before the app starts (only if the phone is empty)."""
    args = ['--no-sandbox']
    perms = list(permissions or [])
    if fake_device:
        args += ['--use-fake-device-for-media-stream']
    if camera:
        args += ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                 '--use-file-for-fake-video-capture=' + os.path.normpath(os.path.join(FIX, camera))]
        if 'camera' not in perms:
            perms.append('camera')
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM, args=args)
        kw = dict(viewport={'width': viewport[0], 'height': viewport[1]}, device_scale_factor=scale, is_mobile=True, has_touch=True,
                  service_workers='allow' if sw else 'block', permissions=perms)
        if reduced_motion:
            kw['reduced_motion'] = reduced_motion
        if storage:
            kw['storage_state'] = storage
        kw['timezone_id'] = 'Europe/Paris'
        ctx = b.new_context(**kw)
        ctx.add_init_script(script="document.addEventListener('coh:screen', function () { (window.__screens = window.__screens || []).push(COH.nav.current); });")
        for js in (extra_init or []):
            ctx.add_init_script(script=js)
        if finger:
            ctx.add_init_script(path=os.path.join(ROOT, 'fake-finger.js'))
        if seed:
            ctx.add_init_script(script="(function(){try{var s=%s;if(localStorage.getItem('coh:v1:meta')!==null)return;"
                                "localStorage.setItem('coh:v1:meta',JSON.stringify(s.meta||{}));"
                                "Object.keys(s.profiles||{}).forEach(function(k){localStorage.setItem('coh:v1:profile:'+k,JSON.stringify(s.profiles[k]));});}catch(e){}})();" % json.dumps(seed))
        page = ctx.new_page()
        app = App(page, ctx)
        if clock:
            app.clocked = True
            app.t0 = T0
            page.clock.install(time=app.t0)
        try:
            yield app
        finally:
            b.close()
