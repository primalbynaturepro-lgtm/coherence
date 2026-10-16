"""flow_ui.py — settings, progress (weeks, calendar, one day), empty and locked states, reduced motion, storage refused.
    python3 flow_ui.py             all
    python3 flow_ui.py F G         only those"""
import sys, json, time
from datetime import date, timedelta, datetime, timezone
from harness import phone, T0_MS

RHYTHM = {'value': 5.5, 'scores': [38, 51, 63, 55, 40], 'at': 1786000000000, 'date': '2026-08-11'}
META = {'v': 1, 'unlocked': True, 'sound': 'bowl', 'vol': 0.7, 'mute': False, 'ring': 'b', 'blink': True}
TODAY = date(2026, 9, 29)
bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


def profile(rhythm=True, sessions=None, sos=None, cyc=None, who='mehdi'):
    return {'v': 1, 'who': who, 'rhythm': RHYTHM if rhythm else None, 'history': [], 'partial': None, 'sessions': sessions or [], 'sos': sos or [], 'cyc': cyc or []}


def seed(**kw):
    return {'meta': META, 'profiles': {'mehdi': profile(**kw)}}


def ts_of(d, hh=7, mm=30):
    """a local (Paris) time on day d, in ms — Paris is UTC+2 on these dates (summer time until 25 October)"""
    return int(datetime(d.year, d.month, d.day, hh - 2, mm, tzinfo=timezone.utc).timestamp() * 1000)


def history():
    """eight weeks of mornings (week 3 has none), a few middays and lates, a sigh visit and a cyclic sitting"""
    mondays = [date(2026, 8, 10) + timedelta(days=7 * i) for i in range(8)]
    rest = [70.0, 68.8, 67.6, None, 65.2, 64.0, 62.8, 61.6]
    hrv = [30.0, 32.0, 34.0, None, 38.0, 40.0, 42.0, 44.0]
    coh = [5.0, 5.4, 5.8, None, 6.6, 7.0, 7.4, 7.8]
    out, n = [], 0
    for w, mon in enumerate(mondays):
        if rest[w] is None:
            continue
        for k in range(7):
            d = mon + timedelta(days=k)
            if d > TODAY:
                break
            n += 1
            out.append({'id': 'm%d' % n, 'ts': ts_of(d), 'day': d.isoformat(), 'kind': 'morning', 'secs': 300, 'rhythm': 5.5, 'rest': rest[w], 'hrv': hrv[w], 'coh': coh[w],
                        'curve': [70 - i * 0.5 for i in range(30)] + [60 + (i % 5) for i in range(150)], 'curveAt': 30, 'q': None})
            if k % 2 == 0:
                n += 1; out.append({'id': 'd%d' % n, 'ts': ts_of(d, 13, 0), 'day': d.isoformat(), 'kind': 'midday', 'secs': 300, 'rhythm': 5.5, 'rest': None, 'hrv': None, 'coh': None, 'curve': None, 'curveAt': 0, 'q': None})
            if k % 3 == 0:
                n += 1; out.append({'id': 'l%d' % n, 'ts': ts_of(d, 17, 30), 'day': d.isoformat(), 'kind': 'late', 'secs': 300, 'rhythm': 5.5, 'rest': None, 'hrv': None, 'coh': None, 'curve': None, 'curveAt': 0, 'q': None})
    return out


def home(app, who='mehdi', dest='accueil'):
    app.open(); app.wait_screen('qui')
    app.tap('[data-do="who:%s"]' % who); app.tick(100); app.wait_screen(dest); app.settle()


def F():
    print('F · settings: profile, sound, volume, mute, breathing ring, rhythm, redo, what is remembered')
    with phone(clock=True, seed=seed()) as app:
        home(app)
        app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        got = {k: app.bound(k) for k in ('rgInitial', 'rgWho', 'rgSound', 'rgRing', 'rgRhythm', 'rgData', 'version')}
        print('   ', got)
        check('who / initial', got['rgWho'] == 'Mehdi' and got['rgInitial'] == 'M')
        check('sound line', got['rgSound'] == 'A bowl · volume 70', got['rgSound'])
        check('ring line: B by default', got['rgRing'] == 'Version B · drawn live' and app.ev("document.querySelector('.app').dataset.ring") == 'b', got['rgRing'])
        check('rhythm line', got['rgRhythm'] == '5.5 a minute · tested Tue 11 Aug', got['rgRhythm'])
        check('data line', got['rgData'] == 'Saved on this phone', got['rgData'])
        check('version shown', got['version'] != '', got['version'])
        app.shot('u1-reglages')
        # the ring
        app.tap('[data-id="reglages/ring"]'); app.settle()
        check('ring → A, remembered', app.bound('rgRing') == 'Version A · a film' and app.ev("document.querySelector('.app').dataset.ring") == 'a' and app.ev('COH.store.meta.ring') == 'a', app.bound('rgRing'))
        app.tap('[data-id="reglages/ring"]'); app.settle()
        check('ring → B again', app.bound('rgRing') == 'Version B · drawn live' and app.ev('COH.store.meta.ring') == 'b')
        # the sound
        app.tap('[data-id="reglages/sound"]'); app.settle(); app.wait_screen('reglages-son')
        on = app.ev("Array.from(document.querySelectorAll('#s-reglages-son .snd.on')).map(e => e.dataset.sound)")
        check('sound screen: the bowl is chosen', on == ['bowl'], on)
        app.shot('u2-son')
        app.tap('[data-id="reglages-son/note"]'); app.settle()
        on = app.ev("Array.from(document.querySelectorAll('#s-reglages-son .snd.on')).map(e => e.dataset.sound)")
        check('choose a note', on == ['note'] and app.ev('COH.store.meta.sound') == 'note' and app.ev('COH.guide.cfg.sound') == 'note', on)
        app.tap('[data-id="reglages-son/listen-breath"]'); app.tick(500)
        check('listen: does not change the choice, does not fail', app.ev('COH.store.meta.sound') == 'note' and not app.errors, app.errors)
        app.ev("(() => { const v = document.querySelector('#s-reglages-son input[data-vol]'); v.value = 30; v.dispatchEvent(new Event('input', { bubbles: true })); })()")
        check('volume: heard at once', abs(app.ev('COH.guide.cfg.vol') - 0.3) < 1e-9, app.ev('COH.guide.cfg.vol'))
        check('volume: not stored until the slider is let go', abs(app.ev('COH.store.meta.vol') - 0.7) < 1e-9, app.ev('COH.store.meta.vol'))
        app.ev("document.querySelector('#s-reglages-son input[data-vol]').dispatchEvent(new Event('change', { bubbles: true }))")
        check('volume: stored on release', abs(app.ev('COH.store.meta.vol') - 0.3) < 1e-9, app.ev('COH.store.meta.vol'))
        app.tap('[data-id="reglages-son/mute"]'); app.settle()
        check('mute', app.ev('COH.store.meta.mute') is True and app.ev('COH.guide.cfg.mute') is True)
        check('mute icon painted on the sound buttons', app.ev("document.querySelectorAll('.sndbtn.off').length") > 0)
        app.tap('[data-id="reglages-son/back"]'); app.settle(); app.wait_screen('reglages')
        check('settings line follows', app.bound('rgSound') == 'A note · volume 30', app.bound('rgSound'))
        # what is remembered when the app is closed and opened again
        app.ev('COH.store.flush()')
        check('no errors', not app.errors, app.errors)


def F2():
    print('F2 · …and remembered after closing the app; rhythm from settings; redo; switching profile')
    with phone(clock=True, seed=seed()) as app:
        home(app)
        app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        app.tap('[data-id="reglages/sound"]'); app.settle(); app.wait_screen('reglages-son')
        app.tap('[data-id="reglages-son/breath"]'); app.settle()
        app.ev("(() => { const v = document.querySelector('#s-reglages-son input[data-vol]'); v.value = 45; v.dispatchEvent(new Event('input', { bubbles: true })); v.dispatchEvent(new Event('change', { bubbles: true })); })()")
        app.tap('[data-id="reglages-son/mute"]'); app.settle()
        app.ev('COH.store.flush()')
        state = app.ctx.storage_state()
    with phone(clock=True, storage=state) as app:                       # the app is closed, then opened again on the same phone
        app.open(); app.wait_screen('qui')
        check('reopening: the code is not asked again', app.screen() == 'qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('accueil'); app.settle()
        app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        check('after reopening: the sound line is the same', app.bound('rgSound') == 'A breath · volume 45', app.bound('rgSound'))
        check('after reopening: still muted', app.ev('COH.guide.cfg.mute') is True)
        # rhythm from settings, and back
        app.tap('[data-id="reglages/rhythm"]'); app.settle(); app.wait_screen('rythme')
        check('rhythm screen: 5.5', app.bound('ryNum') == '5.5', app.bound('ryNum'))
        check('rhythm screen: redo offered, "no rhythm" note hidden', app.visible('[data-id="rythme/redo"]') and not app.visible('[data-id="rythme/none"]'))
        app.tap('[data-id="rythme/back"]'); app.settle(); app.wait_screen('reglages')
        # redo from settings: the current rhythm is shown, "Keep my rhythm" goes back to settings
        app.tap('[data-id="reglages/redo"]'); app.settle(); app.wait_screen('test-intro')
        check('redo: current rhythm card shown, "Keep" offered, "Later" not', app.visible('[data-id="test-intro/current"]') and app.visible('[data-id="test-intro/keep"]') and not app.visible('[data-id="test-intro/later"]'))
        check('redo: title', app.bound('tiTitle') == 'Find your rhythm again.', app.bound('tiTitle'))
        check('redo: shows the current rhythm and date', app.bound('tiNow') == '5.5' and app.bound('tiNowDate') == 'Tested Tue 11 Aug', (app.bound('tiNow'), app.bound('tiNowDate')))
        app.shot('u3-redo')
        app.tap('[data-id="test-intro/keep"]'); app.settle(); app.wait_screen('reglages')
        # switch profile
        app.tap('[data-id="reglages/profile"]'); app.settle(); app.wait_screen('qui')
        app.tap('[data-do="who:adri"]'); app.tick(100); app.wait_screen('test-intro'); app.settle()
        check('Adri has her own profile: no rhythm yet, so the test comes first', app.bound('tiTitle') == 'Let’s find your rhythm.' and not app.visible('[data-id="test-intro/current"]'), app.bound('tiTitle'))
        check('her profile is empty, his untouched', app.ev("JSON.stringify(COH.store.profile('adri').rhythm)") == 'null' and app.ev("COH.store.profile('mehdi').rhythm.value") == 5.5)
        app.tap('[data-id="test-intro/later"]'); app.settle(); app.wait_screen('accueil')
        check('home for Adri: her name, locked', app.bound('acWho') == 'Adri' and app.visible('[data-id="accueil/locked"]'), app.bound('acWho'))
        app.shot('u4-adri-locked')
        tile = app.ev("document.querySelector('#s-accueil [data-do=\"kind:morning\"]').className")
        check('locked tiles', 'locked' in tile, tile)
        app.tap('[data-id="accueil/ring-morning"]'); app.settle(); app.wait_screen('test-intro')
        check('a locked session tile leads to the test', True)
        check('no errors', not app.errors, app.errors)


def G():
    print('G · progress: weekly curves, deltas, calendar, one day')
    with phone(clock=True, seed=seed(sessions=history(), sos=[{'id': 's1', 'ts': ts_of(TODAY, 9, 5), 'day': TODAY.isoformat(), 'n': 2}], cyc=[{'id': 'c1', 'ts': ts_of(date(2026, 9, 15), 20, 0), 'day': '2026-09-15', 'secs': 300}])) as app:
        home(app)
        check('home: today has a morning (weekday tiles)', app.bound('srt-morning') == 'Done', app.bound('srt-morning'))
        check('home: heart card of this morning', app.bound('hLbl') == 'Your heart · this morning' and app.bound('hRest') == '62' and app.bound('hCoh') == '7.8' and app.bound('hVar') == '44 ms', (app.bound('hLbl'), app.bound('hRest'), app.bound('hCoh'), app.bound('hVar')))
        check('home: the sparkline is drawn', app.ev("document.querySelectorAll('#s-accueil [data-bind=hSpark] circle').length") >= 5)
        app.shot('g1-accueil')
        app.tap('[data-id="accueil/tab-progress"]'); app.settle(); app.wait_screen('progres')
        got = {k: app.bound(k) for k in ('pg-rest', 'pg-var', 'pg-coh', 'pgd-rest', 'pgd-var', 'pgd-coh', 'wkFrom', 'wkTo', 'calTitle', 'pgRhythm', 'pgTested')}
        print('   ', got)
        check('latest values', (got['pg-rest'], got['pg-var'], got['pg-coh']) == ('62', '44', '7.8'), got)
        check('deltas over eight weeks of measuring (a gap week is bridged, not invented)', (got['pgd-rest'], got['pgd-var'], got['pgd-coh']) == ('−8 in 8 weeks', '+14 ms in 8 weeks', '+2.8 in 8 weeks'), got)
        check('weeks axis', (got['wkFrom'], got['wkTo']) == ('10 Aug', '28 Sep'), got)
        check('rhythm line', got['pgRhythm'] == '5.5' and got['pgTested'] == 'tested Tue 11 Aug', got)
        check('the "no readings" note is hidden', not app.visible('[data-id="progres/empty"]'))
        pts = app.ev("document.querySelectorAll('#s-progres [data-bind=pgs-rest] circle').length")
        check('sparkline: seven points (one week has no reading)', pts == 7, pts)
        app.shot('g2-progres')
        # calendar
        check('calendar: September 2026', got['calTitle'] == 'September 2026', got['calTitle'])
        days = app.ev("Array.from(document.querySelectorAll('#s-progres .cal .cal-c')).map(e => e.tagName + (e.classList.contains('off') ? ':off' : '') + (e.classList.contains('today') ? ':today' : ''))")
        check('calendar: 29 days you can open (the 29th is today), the 30th is greyed', len(days) == 30 and days[28] == 'BUTTON:today' and days[29] == 'SPAN:off', (len(days), days[27:]))
        blanks = app.ev("document.querySelectorAll('#s-progres .cal .calb').length")
        check('calendar: the 1st is a Tuesday (one blank before it)', blanks == 1, blanks)
        prev_dis = app.ev("document.querySelector('#s-progres [data-do=\"calStep:-1\"]').disabled")
        next_dis = app.ev("document.querySelector('#s-progres [data-do=\"calStep:1\"]').disabled")
        check('calendar: can go back, cannot go past this month', prev_dis is False and next_dis is True, (prev_dis, next_dis))
        # rings inside the cells: the 28th has morning + midday (k=... check 22nd and 24th)
        cnt = app.ev("(d) => document.querySelector('#s-progres .cal [data-id=\"progres/day-' + d + '\"]').getAttribute('aria-label')", '28')
        print('    28th:', cnt)
        app.tap('[data-do="calStep:-1"]'); app.settle()
        check('previous month: August 2026', app.bound('calTitle') == 'August 2026', app.bound('calTitle'))
        prev_dis = app.ev("document.querySelector('#s-progres [data-do=\"calStep:-1\"]').disabled")
        check('…and no further back than the first day of data', prev_dis is True)
        app.shot('g3-aout')
        app.tap('[data-do="calStep:1"]'); app.settle()
        check('next month: back to September', app.bound('calTitle') == 'September 2026')
        # a day with a reading
        app.tap('[data-id="progres/day-15"]'); app.settle(); app.wait_screen('jour')
        got = {k: app.bound(k) for k in ('jTitle', 'jShort', 'j-morning-s', 'jRest', 'jVar', 'jCoh', 'j-sos-t', 'j-cyc-t', 'j-cyc-s')}
        print('   ', got)
        check('day 15 Sep: title, morning note, heart numbers', got['jTitle'] == 'Tuesday 15 September' and got['j-morning-s'] == '7.0 / 10' and (got['jRest'], got['jVar'], got['jCoh']) == ('64', '40', '7.0'), got)
        check('day 15 Sep: the cyclic sitting is listed, sighs are not', got['j-cyc-t'].startswith('5 minutes · 20:00') and got['j-sos-t'] == 'None', got)
        check('day: the heart card and its curve are shown', app.visible('[data-id="jour/heart"]') and app.ev("document.querySelectorAll('#s-jour [data-bind=jCurve] path.cv').length") == 1 and app.ev("document.querySelectorAll('#s-jour [data-bind=jCurve] path.cv-s').length") == 1)
        app.shot('g4-jour')
        app.tap('[data-id="jour/back"]'); app.settle(); app.wait_screen('progres')
        check('back to progress on the same month', app.bound('calTitle') == 'September 2026')
        # a day in the gap week: nothing done, no heart card
        app.tap('[data-id="progres/day-02"]'); app.settle(); app.wait_screen('jour')
        got = {k: app.bound(k) for k in ('jTitle', 'j-morning-t', 'j-morning-s', 'j-midday-t')}
        check('gap day: nothing shown as done, no heart card', got['j-morning-t'] == 'Not done' and got['j-morning-s'] == '—' and not app.visible('[data-id="jour/heart"]'), got)
        app.tap('[data-id="jour/back"]'); app.settle(); app.wait_screen('progres')
        # today, from a card
        app.tap('[data-id="progres/card-rest"]'); app.settle(); app.wait_screen('jour')
        check('cards open today', app.bound('jTitle') == 'Tuesday 29 September' and app.bound('j-sos-t').endswith('2 sighs'), (app.bound('jTitle'), app.bound('j-sos-t')))
        check('no errors', not app.errors, app.errors)


def H():
    print('H · empty and locked states')
    with phone(clock=True, seed=seed()) as app:
        home(app)
        check('home: a rhythm but no sessions yet: no week card, no heart card', not app.visible('[data-id="accueil/week"]') and not app.visible('[data-id="accueil/heart"]'))
        check('home: tiles say "Not yet"', [app.bound('srt-morning'), app.bound('srt-midday'), app.bound('srt-late')] == ['Not yet'] * 3)
        app.shot('h1-accueil-vide')
        app.tap('[data-id="accueil/tab-progress"]'); app.settle(); app.wait_screen('progres')
        check('progress: the "no readings yet" note, no cards', app.visible('[data-id="progres/empty"]') and not app.visible('[data-id="progres/card-rest"]'))
        app.shot('h2-progres-vide')
        app.tap('[data-id="progres/tab-home"]'); app.settle(); app.wait_screen('accueil')
        app.tap('[data-id="accueil/rhythm"]'); app.settle(); app.wait_screen('rythme')
        app.tap('[data-id="rythme/back"]'); app.settle(); app.wait_screen('accueil')
    with phone(clock=True, seed=seed(rhythm=False)) as app:
        home(app, dest='test-intro')
        app.tap('[data-id="test-intro/later"]'); app.settle(); app.wait_screen('accueil')
        check('locked home: the card that leads to the test', app.visible('[data-id="accueil/locked"]') and app.bound('lockBtn') == 'Take the test' and app.bound('acRhythm') == '—', (app.bound('lockBtn'), app.bound('acRhythm')))
        check('locked home: the rhythm tile is not a link', not app.visible('[data-id="accueil/rhythm"]'))
        app.shot('h3-accueil-locked')
        app.tap('[data-id="accueil/tab-progress"]'); app.settle(); app.wait_screen('progres')
        check('progress without a rhythm: "Take the test" instead of "Redo"', app.visible('[data-id="progres/take"]') and not app.visible('[data-id="progres/redo"]'))
        app.tap('[data-id="progres/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        check('settings without a rhythm', app.bound('rgRhythm') == 'Not found yet', app.bound('rgRhythm'))
        check('no errors', not app.errors, app.errors)


def I():
    print('I · the browser refuses storage: the app still works, and says so')
    deny = "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });"
    with phone(clock=True, extra_init=[deny]) as app:
        app.open()
        app.wait_screen('code')
        app.keys('2580'); app.tick(400); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('test-intro'); app.settle()
        check('works in memory: the code was accepted, the test is offered', app.visible('[data-id="test-intro/start"]'))
        check('the store knows it is not keeping anything', app.ev('COH.store.volatile') is True)
        app.tap('[data-id="test-intro/later"]'); app.settle(); app.wait_screen('accueil')
        app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        check('settings say so', app.bound('rgData') == 'Not kept — this browser blocks storage', app.bound('rgData'))
        app.shot('i1-reglages-volatile')
        check('no errors', not app.errors, app.errors)


def J():
    print('J · reduced motion: screens change without travelling, the breath still runs')
    with phone(clock=True, seed=seed(), reduced_motion='reduce') as app:
        home(app)
        app.tap('[data-id="accueil/ring-midday"]'); app.tick(50)
        check('reduced motion: the next screen is there almost at once', app.screen() == 'seance-prete', app.screen())
        app.tap('[data-id="seance-prete/begin"]'); app.tick(50); app.wait_screen('seance')
        app.run(10)
        st = app.ev('COH.guide.state()')
        check('the guide runs', st['on'] and st['t'] > 9, st)
        check('no errors', not app.errors, app.errors)


if __name__ == '__main__':
    t_all = time.time()
    want = set(a.upper() for a in sys.argv[1:]) or {'F', 'F2', 'G', 'H', 'I', 'J'}
    for n, fn in (('F', F), ('F2', F2), ('G', G), ('H', H), ('I', I), ('J', J)):
        if n in want:
            fn()
    print('elapsed %.1f s' % (time.time() - t_all))
    print('FAILED: %s' % bad if bad else 'ALL OK')
    sys.exit(1 if bad else 0)
