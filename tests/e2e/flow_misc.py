"""flow_misc.py — the sessions without a reading (midday, late afternoon), pause / resume / stop, a phone that locks, the sighs, cyclic sighing.
Fake clock, no camera needed (only the test of five rhythms and the morning session read a pulse).
    python3 flow_misc.py           all
    python3 flow_misc.py B D       only those   (R: ring A, the Blender film · S: the screen stays lit)"""
import sys, json, time
from harness import phone, T0_MS

RHYTHM = {'value': 5.5, 'scores': [38, 51, 63, 55, 40], 'at': 1786000000000, 'date': '2026-08-11'}
META = {'v': 1, 'unlocked': True, 'sound': 'bowl', 'vol': 0.7, 'mute': False, 'ring': 'b', 'blink': True}
TODAY = '2026-09-29'
bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


def morning_today():
    return {'id': 'm1', 'ts': T0_MS - 60000, 'day': TODAY, 'kind': 'morning', 'secs': 300, 'rhythm': 5.5, 'rest': 63.0, 'hrv': 40.0, 'coh': 8.0,
            'curve': [66, 65, 64, 63, 62, 61, 62, 63, 62, 61, 60], 'curveAt': 4, 'q': None}


def seed(sessions=None, sos=None, cyc=None):
    return {'meta': META, 'profiles': {'mehdi': {'v': 1, 'who': 'mehdi', 'rhythm': RHYTHM, 'history': [], 'partial': None, 'sessions': sessions or [], 'sos': sos or [], 'cyc': cyc or []}}}


def home(app):
    app.open(); app.wait_screen('qui')
    app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('accueil'); app.settle()


def start_session(app, kind):
    app.tap('[data-id="accueil/ring-%s"]' % kind); app.settle(); app.wait_screen('seance-prete')
    app.tap('[data-id="seance-prete/begin"]'); app.settle(); app.wait_screen('seance')


def hidden(app, on):
    app.ev("""(on) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => on });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (on ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
    }""", on)


def A():
    print('A · a midday session: no camera, five minutes, counts as one of three')
    with phone(clock=True, seed=seed([morning_today()])) as app:
        home(app)
        check('home tiles: morning done, midday and late not yet', [app.bound('srt-morning'), app.bound('srt-midday'), app.bound('srt-late')] == ['Done', 'Not yet', 'Not yet'], [app.bound('srt-morning'), app.bound('srt-midday'), app.bound('srt-late')])
        app.tap('[data-id="accueil/ring-midday"]'); app.settle(); app.wait_screen('seance-prete')
        check('ready screen: kind and rhythm', app.bound('kindName') == 'Midday' and app.bound('spRhythm') == '5.5', (app.bound('kindName'), app.bound('spRhythm')))
        app.shot('a1-prete')
        app.tap('[data-id="seance-prete/begin"]'); app.settle(); app.wait_screen('seance')
        check('no camera for a midday session', app.ev('COH.pulse.state') == 'closed')
        check('the session screen knows its kind and rhythm', app.bound('kindName') == 'Midday' and app.bound('pbpm') == '5.5', (app.bound('kindName'), app.bound('pbpm')))
        st = app.ev('COH.guide.state()')
        check('guide: equal breathing at 5.5, 300 s', st['on'] and st['kind'] == 'equal' and abs(st['bpm'] - 5.5) < 1e-6 and st['remain'] > 298, st)
        app.run(30)
        app.shot('a2-seance')
        cues = set()
        for _ in range(12):
            app.run(1); cues.add(app.bound('cue'))
        check('the cue alternates In / Out', cues == {'In', 'Out'}, cues)
        app.until('fin-seance', 300, 1000); app.run(1); app.settle()
        check('done screen: kind and count', app.bound('fsKind') == 'Midday session' and app.bound('fsToday') == '2 of 3', (app.bound('fsKind'), app.bound('fsToday')))
        app.shot('a3-fin')
        p = app.store_dump('mehdi'); s = p['sessions'][-1]
        check('stored: midday, 300 s, rhythm 5.5, no numbers', s['kind'] == 'midday' and s['secs'] == 300 and s['rhythm'] == 5.5 and s['coh'] is None and s['rest'] is None, {k: s[k] for k in ('kind', 'day', 'secs', 'rhythm', 'coh')})
        check('stored on today', s['day'] == TODAY, s['day'])
        app.tap('[data-id="fin-seance/done"]'); app.settle(); app.wait_screen('accueil')
        check('home: midday now done', app.bound('srt-midday') == 'Done', app.bound('srt-midday'))
        check('home: week count', app.bound('wkN') == '2', app.bound('wkN'))
        check('camera never opened', app.ev('COH.pulse.state') == 'closed')
        check('no errors', not app.errors, app.errors)


def B():
    print('B · pause, resume, stop — in a late-afternoon session')
    with phone(clock=True, seed=seed()) as app:
        home(app)
        start_session(app, 'late')
        app.run(30)
        r0 = app.ev('COH.guide.state().remain')
        app.tap('[data-id="seance/pause"]'); app.settle(); app.wait_screen('seance-pause')
        check('pause: the screen says "You paused."', app.bound('pauseWhy') == 'You paused.', app.bound('pauseWhy'))
        check('pause: the breath has stopped', app.ev('COH.guide.state().on') is False)
        app.shot('b1-pause')
        app.run(20)
        sv = app.ev('COH.guide.saved("seance")')
        check('pause: the time left is kept, and does not run down', sv and abs(sv['remain'] - r0) < 1.0, (r0, sv))
        app.tap('[data-id="seance-pause/resume"]'); app.settle(); app.wait_screen('seance')
        r1 = app.ev('COH.guide.state().remain')
        check('resume: picks up from where it stopped (not from 5:00)', app.ev('COH.guide.state().on') and abs(r1 - (r0 - 0.5)) < 2.0, (r0, r1))
        app.run(10)
        r2 = app.ev('COH.guide.state().remain')
        app.tap('[data-id="seance/stop"]'); app.settle(); app.wait_screen('seance-arreter')
        check('stop sheet: the breath is held', app.ev('COH.guide.state().on') is False)
        app.shot('b2-stop-sheet')
        app.tap('[data-id="seance-arreter/keep-going"]'); app.settle(); app.wait_screen('seance')
        r3 = app.ev('COH.guide.state().remain')
        check('"Keep going" returns to the session, still on time', app.ev('COH.guide.state().on') and abs(r3 - (r2 - 0.5)) < 2.0, (r2, r3))
        app.run(5)
        app.tap('[data-id="seance/stop"]'); app.settle(); app.wait_screen('seance-arreter')
        app.tap('[data-id="seance-arreter/stop"]'); app.settle(); app.wait_screen('accueil')
        p = app.store_dump('mehdi')
        check('stopped: nothing is saved', len(p['sessions']) == 0, len(p['sessions']))
        check('home: late still "Not yet"', app.bound('srt-late') == 'Not yet', app.bound('srt-late'))
        check('the breath is off and forgotten', app.ev('COH.guide.state().on') is False and app.ev('COH.guide.saved("seance")') is None)
        # the pause screen's own Stop, and "Keep going" from there
        start_session(app, 'late')
        app.run(12)
        app.tap('[data-id="seance/pause"]'); app.settle(); app.wait_screen('seance-pause')
        app.tap('[data-id="seance-pause/stop"]'); app.settle(); app.wait_screen('seance-arreter')
        app.tap('[data-id="seance-arreter/keep-going"]'); app.settle(); app.wait_screen('seance')
        check('pause → Stop → Keep going: back in the session', app.ev('COH.guide.state().on') is True)
        check('a fresh session after a stop starts at 5:00 again', app.ev('COH.guide.state().remain') > 250, app.ev('COH.guide.state().remain'))
        check('no errors', not app.errors, app.errors)


def C():
    print('C · the phone locks in the middle of a session (and of a rhythm of the test)')
    with phone(clock=True, seed=seed()) as app:
        home(app)
        start_session(app, 'midday')
        app.run(40)
        r0 = app.ev('COH.guide.state().remain')
        hidden(app, True); app.tick(300)
        check('locked: the breath stops', app.ev('COH.guide.state().on') is False)
        app.run(30)                                                           # locked for 30 s
        hidden(app, False); app.tick(600); app.settle(); app.wait_screen('seance-pause')
        check('unlocked: the pause screen says the phone paused it', app.bound('pauseWhy') == 'The phone paused this session.', app.bound('pauseWhy'))
        sv = app.ev('COH.guide.saved("seance")')
        check('the time left did not run down while locked', sv and abs(sv['remain'] - r0) < 1.5, (r0, sv))
        app.shot('c1-phone-pause')
        app.tap('[data-id="seance-pause/resume"]'); app.settle(); app.wait_screen('seance')
        check('resumes', app.ev('COH.guide.state().on') is True and abs(app.ev('COH.guide.state().remain') - r0) < 2.5)
        check('no errors', not app.errors, app.errors)
    with phone(clock=True, finger=True, seed={'meta': META, 'profiles': {'mehdi': {'v': 1, 'who': 'mehdi', 'rhythm': None, 'history': [], 'partial': None, 'sessions': [], 'sos': [], 'cyc': []}}}) as app:
        app.open(); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('test-intro'); app.settle()
        app.tap('[data-id="test-intro/start"]'); app.settle(); app.wait_screen('test-doigt')
        app.run(8)
        app.tap('[data-do="fingerBegin"]'); app.until('test-palier', 15, 250); app.settle()
        app.run(30)
        hidden(app, True); app.tick(300); hidden(app, False); app.tick(600); app.settle()
        app.wait_screen('test-intro')
        check('a rhythm interrupted: back to the start of the test (nothing kept, nothing scored)', app.bound('tiTitle') == 'Let’s find your rhythm.' and app.visible('[data-id="test-intro/start"]'), app.bound('tiTitle'))
        check('camera let go', app.ev('COH.pulse.state') == 'closed', app.ev('COH.pulse.state'))
        check('breath off', app.ev('COH.guide.state().on') is False)
        check('no errors', not app.errors, app.errors)


def D():
    print('D · the sighs: one to three, one record per visit, closing early saves nothing')
    with phone(clock=True, seed=seed([morning_today()])) as app:
        home(app)
        app.tap('[data-id="accueil/sos"]'); app.settle(); app.wait_screen('sos')
        check('sigh 1 of 3', app.bound('sosN') == 'Sigh 1 of 3', app.bound('sosN'))
        st = app.ev('COH.guide.state()')
        check('guide: sigh pattern, 10 s', st['on'] and st['kind'] == 'sigh' and st['remain'] > 9, st)
        app.shot('d1-sos')
        cues = []
        for _ in range(9):
            app.run(1); cues.append(app.bound('cue'))
        check('phases: In, In again, Out', ['In', 'In again', 'Out'] == [c for i, c in enumerate(cues) if i == 0 or c != cues[i - 1]], cues)
        app.until('sos-encore', 12, 250); app.settle()
        check('"Sigh 1 done"', app.bound('sosDone') == 'Sigh 1 done', app.bound('sosDone'))
        p = app.store_dump('mehdi')
        check('recorded at the first completed sigh', len(p['sos']) == 1 and p['sos'][0]['n'] == 1, p['sos'])
        app.shot('d2-encore')
        app.tap('[data-id="sos-encore/more"]'); app.settle(); app.wait_screen('sos')
        check('sigh 2 of 3', app.bound('sosN') == 'Sigh 2 of 3', app.bound('sosN'))
        app.until('sos-encore', 12, 250); app.settle()
        p = app.store_dump('mehdi')
        check('still one record, now 2 sighs', len(p['sos']) == 1 and p['sos'][0]['n'] == 2, p['sos'])
        app.tap('[data-id="sos-encore/more"]'); app.settle(); app.wait_screen('sos')
        app.until('sos-encore', 12, 250); app.settle()
        check('after the third: "one more" is gone', not app.visible('[data-id="sos-encore/more"]') and app.visible('[data-id="sos-encore/enough"]'))
        app.shot('d3-encore3')
        app.tap('[data-id="sos-encore/enough"]'); app.settle(); app.wait_screen('sos-fin')
        check('end: "3 sighs"', app.bound('sosLog') == '3 sighs', app.bound('sosLog'))
        app.tap('[data-id="sos-fin/day"]'); app.settle(); app.wait_screen('jour')
        t = app.bound('j-sos-t')
        check('day view: the sighs of today', t.endswith('3 sighs'), t)
        app.tap('[data-id="jour/back"]'); app.settle()
        # closing during the first sigh of a new visit saves nothing
        app.go('accueil', 'swap'); app.settle()
        app.tap('[data-id="accueil/sos"]'); app.settle(); app.wait_screen('sos')
        app.run(4)
        app.tap('[data-id="sos/close"]'); app.settle(); app.wait_screen('accueil')
        p = app.store_dump('mehdi')
        check('closed before the first sigh ended: no new record', len(p['sos']) == 1, len(p['sos']))
        # a second visit that goes through: a second record, and the day says "2 times"
        app.tap('[data-id="accueil/sos"]'); app.settle(); app.wait_screen('sos')
        app.until('sos-encore', 12, 250); app.settle()
        app.tap('[data-id="sos-encore/enough"]'); app.settle(); app.wait_screen('sos-fin')
        check('one sigh: "One sigh"', app.bound('sosLog') == 'One sigh', app.bound('sosLog'))
        app.tap('[data-id="sos-fin/day"]'); app.settle(); app.wait_screen('jour')
        t = app.bound('j-sos-t')
        check('day view: two visits, four sighs', t == '2 times · 4 sighs', t)
        check('no errors', not app.errors, app.errors)


def E():
    print('E · cyclic sighing, five minutes: stop sheet, keep going, saved on completion only')
    with phone(clock=True, seed=seed()) as app:
        home(app)
        app.tap('[data-id="accueil/cyclic"]'); app.settle(); app.wait_screen('cyclique-pret')
        app.tap('[data-id="cyclique-pret/begin"]'); app.settle(); app.wait_screen('cyclique')
        st = app.ev('COH.guide.state()')
        check('guide: sigh pattern, 300 s', st['on'] and st['kind'] == 'sigh' and 298 < st['remain'] <= 300, st)
        app.run(60)
        r0 = app.ev('COH.guide.state().remain')
        app.tap('[data-id="cyclique/stop"]'); app.settle(); app.wait_screen('cyclique-arreter')
        check('sheet: breath held', app.ev('COH.guide.state().on') is False)
        app.tap('[data-id="cyclique-arreter/keep-going"]'); app.settle(); app.wait_screen('cyclique')
        r1 = app.ev('COH.guide.state().remain')
        check('keep going: on time (not restarted)', abs(r1 - (r0 - 0.5)) < 2.0, (r0, r1))
        app.shot('e1-cyclique')
        app.until('cyclique-fin', 300, 1000); app.run(1); app.settle()
        p = app.store_dump('mehdi')
        check('saved on completion: one record, 300 s', len(p['cyc']) == 1 and p['cyc'][0]['secs'] == 300, p['cyc'])
        app.shot('e2-fin')
        app.tap('[data-id="cyclique-fin/day"]'); app.settle(); app.wait_screen('jour')
        t = app.bound('j-cyc-t')
        check('day view: "5 minutes · HH:MM"', t.startswith('5 minutes · '), t)
        app.go('accueil', 'swap'); app.settle()
        app.tap('[data-id="accueil/cyclic"]'); app.settle(); app.wait_screen('cyclique-pret')
        app.tap('[data-id="cyclique-pret/begin"]'); app.settle(); app.wait_screen('cyclique')
        app.run(30)
        app.tap('[data-id="cyclique/stop"]'); app.settle(); app.wait_screen('cyclique-arreter')
        app.tap('[data-id="cyclique-arreter/stop"]'); app.settle(); app.wait_screen('accueil')
        p = app.store_dump('mehdi')
        check('stopped: no second record', len(p['cyc']) == 1, len(p['cyc']))
        check('breath off, forgotten', app.ev('COH.guide.state().on') is False and app.ev('COH.guide.saved("cyclique")') is None)
        check('no errors', not app.errors, app.errors)


def R():
    print('R · ring A (the Blender film): the right film per screen, kept in step, and a ring that still breathes when the film cannot play')
    meta_a = dict(META, ring='a')
    sd = {'meta': meta_a, 'profiles': {'mehdi': {'v': 1, 'who': 'mehdi', 'rhythm': RHYTHM, 'history': [], 'partial': None, 'sessions': [], 'sos': [], 'cyc': []}}}
    with phone(clock=True, seed=sd) as app:
        home(app)
        start_session(app, 'midday')
        ring = "document.querySelector('#s-seance .ring')"
        src = app.ev("(() => { const v = %s._v; return v ? new URL(v.src).pathname : null })()" % ring)
        check('a session shows the "equal" film', src == '/assets/rings/ring-equal.mp4', src)
        rate = app.ev("%s._v.playbackRate" % ring)
        check('the film is played at the breath\'s pace (10 s loop, 5.5 a minute)', abs(rate - 10 / (60 / 5.5)) < 0.01, rate)
        app.run(12)
        p1 = app.ev("parseFloat(%s.style.getPropertyValue('--p'))" % ring)
        app.run(2)
        p2 = app.ev("parseFloat(%s.style.getPropertyValue('--p'))" % ring)
        check('the breath phase still moves (drives the sound, the words, the fallback ring)', p1 != p2 and 0 <= p1 <= 1 and 0 <= p2 <= 1, (p1, p2))
        state = app.ev("(() => { const v = %s._v; return { err: !!v.error, ready: v.readyState, fb: %s.classList.contains('fb') } })()" % (ring, ring))
        print('    film state in this browser:', state)
        # this Chromium may not read H.264: then the ring must fall back to the live one, never a blank ring
        check('either the film plays or the ring fell back to the live one', (not state['err']) or state['fb'], state)
        app.shot('r1-seance-ring-a')
        app.tap('[data-id="seance/stop"]') if app.visible('[data-id="seance/stop"]') else None
    with phone(clock=True, seed=sd) as app:
        home(app)
        app.tap('[data-id="accueil/sos"]'); app.settle(); app.wait_screen('sos')
        src = app.ev("(() => { const v = document.querySelector('#s-sos .ring')._v; return v ? new URL(v.src).pathname : null })()")
        check('a sigh shows the "sigh" film', src == '/assets/rings/ring-sigh.mp4', src)
        rate = app.ev("document.querySelector('#s-sos .ring')._v.playbackRate")
        check('…at its own speed (1)', rate == 1, rate)
        check('no errors', not app.errors, app.errors)


WEBM_FILM = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAM9EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggMn7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECfQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYjjG+6YUarAEZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAdzWUDgibCBILqBIJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYjjG+6YUarAEWfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB9DtnVBgueBAKOkgQAAgDACAJ0BKiAAIAAARwiFhYiFhIgCAgAHkPPJwP7/q1CAo5WBAH0AsQEAARAQABgAGFgv9AAIcACjlYEA+gCxAQABEBAAGAAYWC/0AAhwAKOVgQF3ALEBAAEQEAAYABhYL/QACHAAo5WBAfQAsQEAARAQABgAGFgv9AAIcACjlYECcQCxAQABEBAAGAAYWC/0AAhwAKOVgQLuALEBAAEQEAAYABhYL/QACHAAo5WBA2sAsQEAARAQFGAAYWC/0AAhwACjlYED6ACxAQABEBAAGAAYWC/0AAhwAKOVgQRlALEBAAEQEAAYABhYL/QACHAAo5WBBOIAsQEAARAQABgAGFgv9AAIcACjlYEFXwCxAQABEBAAGAAYWC/0AAhwAKOVgQXcALEBAAEQEAAYABhYL/QACHAAo5WBBlkAsQEAARAQABgAGFgv9AAIcACjlYEG1gCxAQABEBAAGAAYWC/0AAhwAKOVgQdTALEBAAEQEAAYABhYL/QACHAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw=="        # 2 s, 32 x 32, silent: what the H.264 film is, in a format this Chromium can play


def S():
    print('S · the screen stays lit: the film is made the way iOS respects, primed by the first touch, asked for by a session, let go after it')
    swap = """(() => { const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); },
            set(v) { if (typeof v === 'string' && v.indexOf('data:video/mp4') === 0) v = 'data:video/webm;base64,' + %s; d.set.call(this, v); } }); })()""" % json.dumps(WEBM_FILM)
    with phone(clock=True, seed=seed(), extra_init=[swap]) as app:
        home(app)
        film = "(() => { const v = document.querySelector('video[title]'); return v ? { muted: v.muted, loop: v.loop, mutedAttr: v.hasAttribute('muted'), loopAttr: v.hasAttribute('loop'), inline: v.hasAttribute('playsinline') } : null })()"
        v = app.ev(film)
        check('the first touches of the app have made the film', v is not None)
        check('…with neither `muted` nor `loop` (iOS lets the screen sleep under such a film), and inline', v and not v['muted'] and not v['loop'] and not v['mutedAttr'] and not v['loopAttr'] and v['inline'], v)
        info = app.ev('COH.guide.awake.info()')
        check('primed by a touch (played, then stopped again), no lock wanted yet', info['primed'] is True and info['want'] is False and info['filmPlaying'] is False, info)
        start_session(app, 'midday')
        info = app.ev('COH.guide.awake.info()')
        check('a session wants the screen lit, and the film plays', info['want'] is True and info['filmPlaying'] is True, info)
        app.run(6)
        check('the film keeps going (it jumps back before its end)', app.ev("(() => { const v = document.querySelector('video[title]'); return !v.paused && !v.ended && v.currentTime < 1.6 })()") is True)
        app.until('fin-seance', 300, 1000); app.settle()
        info = app.ev('COH.guide.awake.info()')
        check('after the session the lock is let go', info['want'] is False and info['lock'] is False and info['filmPlaying'] is False, info)
        check('no errors', not app.errors, app.errors)


if __name__ == '__main__':
    t_all = time.time()
    want = set(a.upper() for a in sys.argv[1:]) or set('ABCDERS')
    for n, fn in (('A', A), ('B', B), ('C', C), ('D', D), ('E', E), ('R', R), ('S', S)):
        if n in want:
            fn()
    print('elapsed %.1f s' % (time.time() - t_all))
    print('FAILED: %s' % bad if bad else 'ALL OK')
    sys.exit(1 if bad else 0)
