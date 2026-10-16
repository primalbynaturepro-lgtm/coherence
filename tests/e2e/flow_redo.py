"""flow_redo.py — the test again: a new rhythm that differs from the one in use (keep or use), a test finished but never confirmed,
a half-finished test that has gone stale (more than 24 hours).
Fake clock, fake finger (its heart resonates at 5.5 a minute). The four rhythms already scored are seeded, so only the last one is run (2 minutes).
    python3 flow_redo.py            all
    python3 flow_redo.py X Y        only those
    X  redo → the new rhythm differs → « Keep the old one »
    Y  redo → the new rhythm differs → « Use the new one » (the old one goes to the history)
    W  a finished test nobody confirmed: the result comes back at the next opening, and « Use » puts it in place
    Z  a half-finished test older than a day is not offered again; a fresh start is"""
import sys, json, time
from harness import phone, T0_MS

META = {'v': 1, 'unlocked': True, 'sound': 'bowl', 'vol': 0.7, 'mute': False, 'ring': 'b', 'blink': True}
OLD = {'value': 5.0, 'scores': [38, 51, 40, 63, 30], 'at': 1786000000000, 'date': '2026-08-11'}
bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


def sc(s, ago_h=1):
    return {'s': s, 'amp': 30.0, 'R': 0.5, 'hr': 64.0, 'n': 100, 'at': T0_MS - int(ago_h * 3600 * 1000)}


def seed(rhythm=OLD, scores=(20, 25, 30, 22, None), ago_h=1):
    partial = {'scores': [sc(s, ago_h) if s is not None else None for s in scores], 'savedAt': T0_MS - int(ago_h * 3600 * 1000), 'log': []}
    return {'meta': META, 'profiles': {'mehdi': {'v': 1, 'who': 'mehdi', 'rhythm': rhythm, 'history': [], 'partial': partial, 'sessions': [], 'sos': [], 'cyc': []}}}


def redo_to_result(app):
    """home → Settings → redo → resume at the missing rhythm → its two minutes → the result"""
    app.open(); app.wait_screen('qui')
    app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('accueil'); app.settle()
    app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
    app.tap('[data-id="reglages/redo"]'); app.settle(); app.wait_screen('test-intro')
    check('redo: a valid half-finished test is offered', app.visible('[data-id="test-intro/resume"]') and app.bound('tiResume') == 'Resume at rhythm 5', app.bound('tiResume'))
    app.tap('[data-id="test-intro/resume"]'); app.settle(); app.wait_screen('test-doigt')
    app.run(8)
    app.tap('[data-do="fingerBegin"]'); app.until('test-palier', 15, 250); app.settle()
    check('it runs the missing rhythm (5 of 5, 4.5 a minute)', app.bound('pn') == 'Rhythm 5 of 5' and app.bound('pbpm') == '4.5', (app.bound('pn'), app.bound('pbpm')))
    app.until('test-calcul', 130, 1000)
    app.until('test-resultat', 20, 250); app.settle()
    return float(app.bound('rNum'))


def X():
    print('X · redo, the new rhythm differs: « Keep the old one »')
    with phone(clock=True, finger=True, seed=seed()) as app:
        new = redo_to_result(app)
        check('the new rhythm is not the one in use', new in (4.5, 5.5) and new != 5.0, new)
        check('the result screen offers to use it', app.bound('rUse') == 'Use %.1f a minute' % new, app.bound('rUse'))
        app.tap('[data-id="test-resultat/use"]'); app.settle(); app.wait_screen('test-remplacer')
        check('it asks first: old and new side by side', app.bound('oldNum') == '5.0' and app.bound('newNum') == '%.1f' % new and app.bound('oldDate') != '', (app.bound('oldNum'), app.bound('newNum'), app.bound('oldDate')))
        p = app.store_dump('mehdi')
        check('nothing is changed yet', p['rhythm']['value'] == 5.0 and p['history'] == [], (p['rhythm']['value'], p['history']))
        app.shot('x1-remplacer')
        app.tap('[data-id="test-remplacer/keep-old"]'); app.settle(); app.wait_screen('reglages')
        p = app.store_dump('mehdi')
        check('back in Settings, the old rhythm stands', p['rhythm']['value'] == 5.0 and p['rhythm']['scores'] == OLD['scores'], p['rhythm'] and p['rhythm']['value'])
        check('the history is untouched, the half-finished test is cleared', p['history'] == [] and p['partial'] is None, (p['history'], p['partial']))
        check('Settings still says 5.0', app.bound('rgRhythm').startswith('5.0 a minute'), app.bound('rgRhythm'))
        check('no errors', not app.errors, app.errors)


def Y():
    print('Y · redo, the new rhythm differs: « Use the new one »')
    with phone(clock=True, finger=True, seed=seed()) as app:
        new = redo_to_result(app)
        app.tap('[data-id="test-resultat/use"]'); app.settle(); app.wait_screen('test-remplacer')
        app.tap('[data-id="test-remplacer/use-new"]'); app.settle(); app.wait_screen('reglages')
        p = app.store_dump('mehdi')
        check('the new rhythm is in use', p['rhythm']['value'] == new and len(p['rhythm']['scores']) == 5, (p['rhythm']['value'], new))
        check('the old one went to the history, with when it was replaced', len(p['history']) == 1 and p['history'][0]['value'] == 5.0 and p['history'][0].get('replacedAt'), p['history'])
        check('the half-finished test is cleared', p['partial'] is None)
        check('Settings says the new rhythm, tested today', app.bound('rgRhythm').startswith('%.1f a minute' % new) and 'Tue 29 Sep' in app.bound('rgRhythm'), app.bound('rgRhythm'))
        app.tap('[data-id="reglages/rhythm"]'); app.settle(); app.wait_screen('rythme')
        check('the rhythm screen shows the new one', app.bound('ryNum') == '%.1f' % new, app.bound('ryNum'))
        check('no errors', not app.errors, app.errors)


def W():
    print('W · a finished test nobody confirmed comes back at the next opening')
    full = seed(rhythm=None, scores=(38, 51, 63, 55, 40))
    with phone(clock=True, seed=full) as app:
        app.open(); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100)
        app.until('test-resultat', 10, 250); app.settle()
        check('straight to the result of the finished test', app.bound('rNum') == '5.5' and app.bound('rUse') == 'Use 5.5 a minute', (app.bound('rNum'), app.bound('rUse')))
        p = app.store_dump('mehdi')
        check('and no rhythm is chosen until the person says so', p['rhythm'] is None)
        app.tap('[data-id="test-resultat/use"]'); app.settle(); app.wait_screen('accueil')
        p = app.store_dump('mehdi')
        check('« Use » puts it in place and clears the test', p['rhythm'] and p['rhythm']['value'] == 5.5 and p['partial'] is None, p['rhythm'] and p['rhythm']['value'])
        check('home shows 5.5', app.bound('acRhythm') == '5.5', app.bound('acRhythm'))
        check('no errors', not app.errors, app.errors)


def Z():
    print('Z · a half-finished test older than a day is not offered again')
    with phone(clock=True, seed=seed(rhythm=None, ago_h=25)) as app:
        app.open(); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('test-intro'); app.settle()
        check('first opening, stale test: a fresh start, no "resume"', app.visible('[data-id="test-intro/start"]') and not app.visible('[data-id="test-intro/resume"]'), app.bound('tiTitle'))
        check('the title is the fresh one', app.bound('tiTitle') == 'Let’s find your rhythm.', app.bound('tiTitle'))
    with phone(clock=True, seed=seed(scores=(38, 51, 63, 55, 40), ago_h=25)) as app:
        app.open(); app.wait_screen('qui')
        app.tap('[data-do="who:mehdi"]'); app.tick(100); app.wait_screen('accueil'); app.settle()
        check('a stale finished test is not shown as a result: home, old rhythm stands', app.bound('acRhythm') == '5.0', app.bound('acRhythm'))
        app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        app.tap('[data-id="reglages/redo"]'); app.settle(); app.wait_screen('test-intro')
        check('redo with a stale test: fresh start, the current rhythm shown', app.visible('[data-id="test-intro/start"]') and not app.visible('[data-id="test-intro/resume"]') and app.bound('tiNow') == '5.0', (app.bound('tiNow'),))
        check('no errors', not app.errors, app.errors)


if __name__ == '__main__':
    t_all = time.time()
    want = set(a.upper() for a in sys.argv[1:]) or set('XYWZ')
    for n, fn in (('X', X), ('Y', Y), ('W', W), ('Z', Z)):
        if n in want:
            fn()
    print('elapsed %.1f s' % (time.time() - t_all))
    print('FAILED: %s' % bad if bad else 'ALL OK')
    sys.exit(1 if bad else 0)
