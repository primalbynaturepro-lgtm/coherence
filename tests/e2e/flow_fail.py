"""flow_fail.py — when the pulse cannot be read: no camera, camera refused, no finger, flash not lighting, finger slipping in the middle.
Each case in its own phone. What the person is told, what they can do next, what is kept.
    python3 flow_fail.py            all five
    python3 flow_fail.py 2 4        only those"""
import sys, json, time
from harness import phone, T0_MS

RHYTHM = {'value': 5.5, 'scores': [38, 51, 63, 55, 40], 'at': 1786000000000, 'date': '2026-08-11'}
META = {'v': 1, 'unlocked': True, 'sound': 'bowl', 'vol': 0.7, 'mute': False, 'ring': 'b', 'blink': True}
NO404 = lambda errs, *more: [e for e in errs if '404' not in e and not any(m in e for m in more)]


def profile(rhythm=True, partial=None):
    return {'v': 1, 'who': 'mehdi', 'rhythm': RHYTHM if rhythm else None, 'history': [], 'partial': partial, 'sessions': [], 'sos': [], 'cyc': []}


def seed(**kw):
    return {'meta': META, 'profiles': {'mehdi': profile(**kw)}}


bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


def enter_morning(app, wait=True, mode=None):
    app.open()
    if mode:
        app.ev("COH_TEST.finger.cfg.mode = '%s'" % mode)      # the fake finger starts afresh with each opening: say what it does after it
    app.wait_screen('qui')
    app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('accueil'); app.settle()
    app.tap('[data-id="accueil/ring-morning"]'); app.settle(); app.wait_screen('seance-prete')
    app.tap('[data-id="seance-prete/begin"]'); app.settle()
    if wait:
        app.wait_screen('seance-doigt')                       # (with no camera at all the app is already on its way to the next screen)


def busy_state(app, sid):
    return app.ev("(() => { const b = document.querySelector('#s-%s [data-do=fingerBegin]'); return [b.classList.contains('busy'), b.getAttribute('aria-busy')]; })()" % sid)


def s1():
    print('1 · no camera at all (a session)')
    with phone(clock=True, seed=seed()) as app:
        enter_morning(app, wait=False)
        app.until('camera-refusee', 10, 250); app.settle()
        check('camera-refusee shown', app.screen() == 'camera-refusee')
        check('"Back to Home" wording', app.bound('leaveLbl') == 'Back to Home', app.bound('leaveLbl'))
        check('"without the reading" offered', app.visible('[data-id="camera-refusee/without"]'))
        app.shot('f1-camera-refusee')
        app.tap('[data-id="camera-refusee/without"]'); app.settle(); app.wait_screen('seance')
        check('session without reading: no camera opened', app.ev('COH.pulse.state') == 'closed', app.ev('COH.pulse.state'))
        app.run(20)
        app.shot('f1-seance-sans')
        app.until('fin-sans-note', 300, 1000); app.run(1); app.settle()
        app.shot('f1-fin-sans-note')
        p = app.store_dump('mehdi'); s = p['sessions'][-1]
        check('stored: morning, no numbers', s['kind'] == 'morning' and s['coh'] is None and s['rest'] is None and s['hrv'] is None and s['curve'] is None, {k: s[k] for k in ('kind', 'coh', 'rest', 'hrv')})
        check('counts as one of three', app.bound('fsnToday') == '1 of 3', app.bound('fsnToday'))
        app.tap('[data-id="fin-sans-note/day"]'); app.settle(); app.wait_screen('jour')
        check('day says "no reading"', 'no reading' in app.bound('j-morning-t'), app.bound('j-morning-t'))
        check('no heart card on that day', not app.visible('[data-id="jour/heart"]'))
        app.shot('f1-jour')
        check('no errors', not NO404(app.errors), app.errors)


def s2():
    print('2 · camera refused (the test)')
    with phone(clock=True, fake_device=True, seed=seed(rhythm=False)) as app:
        app.open(); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('test-intro'); app.settle()
        app.tap('[data-id="test-intro/start"]'); app.settle()
        app.until('camera-refusee', 10, 250); app.settle()
        check('camera-refusee shown', app.screen() == 'camera-refusee')
        check('"Leave the test" wording', app.bound('leaveLbl') == 'Leave the test', app.bound('leaveLbl'))
        check('"without the reading" NOT offered in the test', not app.visible('[data-id="camera-refusee/without"]'))
        app.clear_history()
        app.tap('[data-id="camera-refusee/retry"]'); app.tick(600)
        app.until('camera-refusee', 6, 250); app.settle()
        h = app.history()
        check('retry goes back to the finger screen, fails again, and says so again', h[:1] == ['test-doigt'] and h[-1] == 'camera-refusee', h)
        app.tap('[data-id="camera-refusee/leave"]'); app.settle(); app.wait_screen('accueil')
        check('leave → home, locked', app.visible('[data-id="accueil/locked"]'))
        check('camera let go', app.ev('COH.pulse.state') == 'closed', app.ev('COH.pulse.state'))
        check('no errors', not NO404(app.errors, 'getUserMedia'), app.errors)


def s3():
    print('3 · no finger on the lens (a session): Begin waits, then says so; retry works once the finger is there')
    with phone(clock=True, finger=True, seed=seed()) as app:
        enter_morning(app, mode='none')
        app.run(6)
        check('finger screen: still looking', app.bound('sigtxt') == 'Looking for your pulse…', app.bound('sigtxt'))
        app.tap('[data-do="fingerBegin"]'); app.tick(300)
        check('Begin shows it is waiting', busy_state(app, 'seance-doigt') == [True, 'true'], busy_state(app, 'seance-doigt'))
        app.shot('f3-busy')
        app.until('signal-faible', 16, 250); app.settle()
        check('signal-faible shown', app.screen() == 'signal-faible')
        check('"without the reading" offered in a session', app.visible('[data-id="signal-faible/without"]'))
        app.shot('f3-signal-faible')
        app.ev("COH_TEST.finger.cfg.mode = 'finger'")
        app.tap('[data-id="signal-faible/retry"]'); app.settle(); app.wait_screen('seance-doigt')
        check('Begin is ready again', busy_state(app, 'seance-doigt') == [False, None], busy_state(app, 'seance-doigt'))
        app.run(9)
        check('steady again', app.ev('COH.pulse.steady') is True and app.bound('sigtxt') == 'Signal steady', app.bound('sigtxt'))
        app.tap('[data-do="fingerBegin"]'); app.until('seance-repos', 15, 250)
        check('reading starts', app.screen() == 'seance-repos')
        check('no errors', not NO404(app.errors), app.errors)


def s4():
    print('4 · the flash does not light (a finger in the dark)')
    with phone(clock=True, finger=True, seed=seed()) as app:
        enter_morning(app, mode='dark')
        app.run(3)
        app.tap('[data-do="fingerBegin"]')
        app.until('flash-indispo', 18, 250); app.settle()
        check('flash-indispo shown', app.screen() == 'flash-indispo')
        check('"without the reading" offered', app.visible('[data-id="flash-indispo/without"]'))
        app.shot('f4-flash-indispo')
        app.tap('[data-id="flash-indispo/without"]'); app.settle(); app.wait_screen('seance')
        check('session goes on without the reading (no camera)', app.ev('COH.pulse.state') == 'closed', app.ev('COH.pulse.state'))
        app.run(5); app.tap('[data-id="seance/pause"]'); app.settle(); app.wait_screen('seance-pause')
        check('no errors', not NO404(app.errors), app.errors)


def s5():
    print('5 · the finger slips in the middle of the last rhythm: it is asked again, alone, and the rest is kept')
    sc = lambda s: {'s': s, 'amp': 30.0, 'R': 0.5, 'hr': 64.0, 'n': 100, 'at': T0_MS - 3600 * 1000}
    partial = {'scores': [sc(38), sc(51), sc(63), sc(55), None], 'savedAt': T0_MS - 3600 * 1000, 'log': []}
    with phone(clock=True, finger=True, seed=seed(rhythm=False, partial=partial)) as app:
        app.open(); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('test-intro'); app.settle()
        check('resume is offered at rhythm 5', app.visible('[data-id="test-intro/resume"]') and app.bound('tiResume') == 'Resume at rhythm 5', app.bound('tiResume'))
        check('title says where we stopped', app.bound('tiTitle') == 'Pick up where you stopped.', app.bound('tiTitle'))
        app.shot('f5-intro-resume')
        app.tap('[data-id="test-intro/resume"]'); app.settle(); app.wait_screen('test-doigt')
        app.run(8)
        app.tap('[data-do="fingerBegin"]'); app.until('test-palier', 15, 250); app.settle()
        check('starts at rhythm 5', app.bound('pn') == 'Rhythm 5 of 5' and app.bound('pbpm') == '4.5', (app.bound('pn'), app.bound('pbpm')))
        app.run(20)
        app.ev("COH_TEST.finger.cfg.mode = 'none'")                     # the finger comes off the lens
        app.until('test-calcul', 130, 1000)
        app.until('signal-faible', 20, 250); app.settle()
        p = app.store_dump('mehdi')
        got = [x and x['s'] for x in p['partial']['scores']]
        check('the four good rhythms are kept', got == [38, 51, 63, 55, None], got)
        print('   log:', json.dumps(p['partial']['log'][-1]))
        check('the failed rhythm is logged with a reason', p['partial']['log'] and p['partial']['log'][-1]['ok'] is False, p['partial']['log'][-1:])
        check('signal-faible: leave label for the test', app.bound('leaveLbl') == 'Leave the test' and not app.visible('[data-id="signal-faible/without"]'))
        app.shot('f5-signal-faible')
        app.ev("COH_TEST.finger.cfg.mode = 'finger'")
        app.tap('[data-id="signal-faible/retry"]'); app.settle(); app.wait_screen('test-doigt')
        app.run(9)
        app.tap('[data-do="fingerBegin"]'); app.until('test-palier', 15, 250); app.settle()
        check('retry resumes at the missing rhythm (5), not at 1', app.bound('pn') == 'Rhythm 5 of 5', app.bound('pn'))
        segs = app.ev('Array.from(document.querySelectorAll("#s-test-palier .segs i")).map(e => e.className)')
        check('four segments already filled', segs == ['on', 'on', 'on', 'on', ''], segs)
        app.until('test-calcul', 130, 1000)
        app.until('test-resultat', 20, 250); app.settle()
        p = app.store_dump('mehdi')
        print('   scores:', [x and x['s'] for x in p['partial']['scores']], '· result', app.bound('rNum'))
        check('a result is reached', app.screen() == 'test-resultat' and app.bound('rNum') in ('6.5', '6.0', '5.5', '5.0', '4.5'), app.bound('rNum'))
        app.shot('f5-resultat')
        check('no errors', not NO404(app.errors), app.errors)


if __name__ == '__main__':
    t_all = time.time()
    want = set(sys.argv[1:]) or {'1', '2', '3', '4', '5'}
    for n, fn in (('1', s1), ('2', s2), ('3', s3), ('4', s4), ('5', s5)):
        if n in want:
            fn()
    print('elapsed %.1f s' % (time.time() - t_all))
    print('FAILED: %s' % bad if bad else 'ALL OK')
    sys.exit(1 if bad else 0)
