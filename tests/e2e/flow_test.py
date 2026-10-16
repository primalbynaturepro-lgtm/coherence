"""flow_test.py — the test of five rhythms, whole, with a fake finger whose heart resonates at 5.5 a minute:
first opening → intro → finger → five rhythms of two minutes with a minute between → result → "Use" → home.
(about 14 minutes of app time)"""
import sys, json, time
from harness import phone

SEED = {
    'meta': {'v': 1, 'unlocked': True, 'sound': 'bowl', 'vol': 0.7, 'mute': False, 'ring': 'b', 'blink': True},
    'profiles': {'mehdi': {'v': 1, 'who': 'mehdi', 'rhythm': None, 'history': [], 'partial': None, 'sessions': [], 'sos': [], 'cyc': []}}
}
bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


t0 = time.time()
with phone(clock=True, finger=True, seed=SEED) as app:
    app.open()
    app.wait_screen('qui')
    app.tap('[data-do="who:mehdi"]')
    app.tick(100); app.wait_screen('test-intro'); app.settle()
    check('first opening with no rhythm goes to the test', True)
    check('the "current rhythm" card is hidden', not app.visible('[data-id="test-intro/current"]'))
    check('Start is offered, Resume is not', app.visible('[data-id="test-intro/start"]') and not app.visible('[data-id="test-intro/resume"]'))
    check('title', app.bound('tiTitle') == 'Let’s find your rhythm.', app.bound('tiTitle'))
    app.shot('t1-intro')
    app.tap('[data-id="test-intro/start"]'); app.settle(); app.wait_screen('test-doigt')
    app.run(8)
    check('finger: signal steady after 8 s', app.bound('sigtxt') == 'Signal steady' and app.ev('COH.pulse.steady'), app.bound('sigtxt'))
    app.shot('t2-doigt')
    app.tap('[data-do="fingerBegin"]')
    seen = []
    for n in range(1, 6):
        app.until('test-palier', 20 if n == 1 else 75, 500); app.settle()
        pn, pb = app.bound('pn'), app.bound('pbpm')
        seen.append((pn, pb))
        check('rhythm %d screen says so' % n, pn == 'Rhythm %d of 5' % n, (pn, pb))
        st = app.ev('COH.guide.state()')
        check('guide runs at %s a minute' % pb, abs(st['bpm'] - float(pb)) < 0.01 and st['on'], (round(st['bpm'], 2), st['on']))
        if n in (1, 3):
            app.run(40); app.shot('t3-palier%d' % n)
        if n < 5:
            app.until('test-pause', 130, 1000); app.settle()
            check('pause %d: "Rhythm %d done"' % (n, n), app.bound('pdone') == 'Rhythm %d done' % n, app.bound('pdone'))
            if n == 2:
                app.shot('t4-pause')
            segs = app.ev('Array.from(document.querySelectorAll("#s-test-pause .segs i")).map(e => e.className)')
            check('pause %d: %d segments filled' % (n, n), segs.count('on') == n, segs)
    app.until('test-calcul', 130, 1000)
    app.settle()
    app.shot('t5-calcul')
    app.until('test-resultat', 30, 250); app.settle()
    r = app.bound('rNum')
    p = app.store_dump('mehdi')
    part = p['partial']
    print('scores:', [x['s'] if x else None for x in part['scores']] if part else None, '· result screen:', r, '· best', app.bound('rBest'), '·', app.bound('rUse'))
    if part:
        print('detail:', json.dumps(part['scores']))
        print('log:', json.dumps(part['log']))
    check('the result is 5.5 a minute', r == '5.5', r)
    check('all five rhythms scored', part is not None and all(x for x in part['scores']))
    check('a rhythm is not chosen until the person says so', p['rhythm'] is None)
    app.shot('t6-resultat')
    # the detail screen from the result, and back
    app.tap('[data-id="test-resultat/card"]'); app.settle(); app.wait_screen('rythme')
    check('rhythm screen shows the pending result', app.bound('ryNum') == '5.5', app.bound('ryNum'))
    check('"no rhythm" note hidden, "Take the test" hidden', not app.visible('[data-id="rythme/none"]') and not app.visible('[data-id="rythme/take"]'))
    best_rows = app.ev('Array.from(document.querySelectorAll("#s-rythme .prow.best")).map(e => e.getAttribute("data-i"))')
    check('best row is the third', best_rows == ['2'], best_rows)
    app.shot('t7-rythme')
    app.tap('[data-id="rythme/back"]'); app.settle(); app.wait_screen('test-resultat')
    app.tap('[data-id="test-resultat/use"]'); app.settle(); app.wait_screen('accueil')
    p = app.store_dump('mehdi')
    check('rhythm stored', p['rhythm'] and p['rhythm']['value'] == 5.5 and len(p['rhythm']['scores']) == 5, p['rhythm'] and {k: p['rhythm'][k] for k in ('value', 'scores', 'date')})
    check('partial cleared', p['partial'] is None)
    check('home shows 5.5', app.bound('acRhythm') == '5.5', app.bound('acRhythm'))
    check('lock card gone', not app.visible('[data-id="accueil/locked"]'))
    app.shot('t8-accueil')
    print('errors:', app.errors)
    print('elapsed %.1f s' % (time.time() - t0))
    print('FAILED: %s' % bad if bad else 'ALL OK')
    sys.exit(1 if (bad or app.errors) else 0)
