"""lab_pages.py — the workshop: the door from Settings, the pulse lab's verdict, the copy of the data and putting it back.
    python3 lab_pages.py            all
    python3 lab_pages.py P D K      only those (P pulse lab · D data · K the door and the index)"""
import sys, json, time
from datetime import datetime, timedelta, timezone
from harness import phone, URL, T0
import flow_ui
from flow_ui import seed, history, profile

bad = []


def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ((' — ' + str(info)) if info != '' else ''))
    if not cond:
        bad.append(name)


def freeze(app):
    """stop the page's clock a moment from now (the clock has run on its own since the phone was made)"""
    now = app.page.evaluate('Date.now()')
    app.page.clock.pause_at(datetime.fromtimestamp((now + 300) / 1000.0, tz=timezone.utc))


def lab(app, path):
    """open a lab page (its own document: no app around it), the clock paused so nothing moves unless we say so"""
    app.page.goto(URL + path)
    freeze(app)


def put(app, sd):
    """put a phone's worth of data in this browser (a page of the same origin, so the storage is the app's)"""
    app.page.goto(URL + '/lab/index.html')
    app.page.evaluate("(s) => { localStorage.setItem('coh:v1:meta', JSON.stringify(s.meta)); Object.keys(s.profiles).forEach(k => localStorage.setItem('coh:v1:profile:' + k, JSON.stringify(s.profiles[k]))); }", sd)


def K():
    print('K · the door from Settings, and the index of the workshop')
    with phone(clock=True, seed=seed(sessions=history())) as app:
        flow_ui.home(app)
        app.tap('[data-id="accueil/tab-settings"]'); app.settle(); app.wait_screen('reglages')
        check('the version line is a link to the workshop', app.ev("document.querySelector('#s-reglages .verlink').getAttribute('href')") == '/lab/index.html')
        check('…and it reads like before', app.ev("document.querySelector('#s-reglages [data-id=\"reglages/version\"]').textContent").startswith('Cohérence · '))
        app.page.click('#s-reglages .verlink')
        app.page.wait_for_url('**/lab/index.html')
        check('it opens the index', app.page.inner_text('h1') == 'Atelier', app.page.url)
        hrefs = app.ev("Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href'))")
        check('the index leads to the two tools and back to the app', hrefs == ['/lab/pulse.html', '/lab/data.html', '/'], hrefs)
        check('it shows the version', app.ev("document.getElementById('v').textContent").strip() != '')
        check('no errors', not app.errors, app.errors)


def P():
    print('P · the pulse lab: three lines and a sentence')
    for mode, want in (('finger', 'ok'), ('none', 'nofinger'), ('dark', 'dark')):
        with phone(clock=True, finger=True) as app:
            lab(app, '/lab/pulse.html')
            app.ev("COH_TEST.finger.cfg.mode = %s" % json.dumps(mode))
            app.page.click('#go')
            app.run(24)
            say, tor, cov, pul = (app.page.inner_text(i) for i in ('#say', '#t-torch', '#t-cov', '#t-pulse'))
            dots = {i: app.ev("document.getElementById('%s').className" % i) for i in ('d-torch', 'd-cov', 'd-pulse')}
            print('   %-6s' % mode, '|', say, '|', tor, '|', cov, '|', pul, '|', dots)
            if want == 'ok':
                check('finger: "it works" and a rate', say.startswith('✓') and 'battements par minute' in pul and dots['d-pulse'] == 'dot ok', (say, pul))
                check('finger: the flash line is not red, the finger line is green', dots['d-torch'] != 'dot bad' and dots['d-cov'] == 'dot ok', dots)
                hr = int(pul.split('·')[1].split()[0])
                check('finger: the rate is the heart of the model (64)', 60 <= hr <= 68, hr)
                # a recording, analysed, and the raw samples in the report
                app.page.click('#rec'); app.run(52)
                res = app.page.inner_text('#recres')
                check('recording: a rate and the variability are shown', 'Pouls' in res and 'Variabilité' in res and 'Battements lus' in res, res.replace('\n', ' | '))
                check('recording: it says how much of the time the finger was seen (not a mislabelled share of beats)', 'Doigt vu' in res and 'doigt sur' not in res, res.replace('\n', ' | '))
                check('the raw-samples button is now on', app.ev("!document.getElementById('copyraw').disabled") is True)
                app.ev("navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }")
                app.page.click('#copyraw'); app.tick(50)
                clip = json.loads(app.ev('window.__clip'))
                sm = clip.get('samples') or {}
                check('the copied report holds the samples (time, red, green) of equal length', len(sm.get('dt', [])) > 900 and len(sm['dt']) == len(sm['r']) == len(sm['g']), {k: len(v) for k, v in sm.items() if isinstance(v, list)})
                check('…and what the phone says of itself', 'ua' in clip and 'torchLog' in clip and 'standalone' in clip and clip.get('recording', {}).get('ok') is True, list(clip)[:12])
                check('…times start at 0 and grow', sm['dt'][0] == 0 and sm['dt'][-1] > 35000 and sm['dt'][1] - sm['dt'][0] < 100, (sm['dt'][0], sm['dt'][-1]))
                import os; os.makedirs('/tmp/coh-shots', exist_ok=True); open('/tmp/coh-shots/lab-report-finger.json', 'w').write(app.ev('window.__clip'))
                ck = sm.get('check') or {}
                mine = {'n': len(sm['dt']), 'dt': sum(sm['dt']), 'r': sum(round(v * 100) for v in sm['r']), 'g': sum(round(v * 100) for v in sm['g'])}
                check('…with sums that catch a damaged paste (and they add up)', ck == mine, (ck, mine))
                rc = clip.get('recording', {})
                check('…the finger was seen all along, no pause', rc.get('fingerFrames', 0) >= 0.95 and rc.get('pauses') == 0 and rc.get('waitedS', 99) < 10, rc)
                app.page.screenshot(path='/tmp/coh-shots/lab-pulse-finger.png')
                # the likely case on a real iPhone: the phone refuses the flash, yet the pulse is read in ambient light
                app.ev("(() => { const o = COH.pulse.snapshot; COH.pulse.snapshot = () => Object.assign(o.call(COH.pulse), { torch: 'refused' }); })()")
                app.run(1)
                say2, tor2 = app.page.inner_text('#say'), app.page.inner_text('#t-torch')
                check('flash refused but pulse read: it says so plainly (ambient light)', say2.startswith('✓') and 'sans le flash' in say2 and 'refusé' in tor2, (say2, tor2))
            elif want == 'nofinger':
                check('no finger: it says where the finger goes', 'objectif' in say and dots['d-cov'] == 'dot bad', (say, dots))
            else:
                check('dark: it says the flash does not light', say.startswith('✗') and 'flash' in say and dots['d-torch'] == 'dot bad', (say, dots))
            check('no errors (%s)' % mode, not app.errors, app.errors)

    print('   the button first and the finger later · a finger lifted in the middle · no finger at all')
    with phone(clock=True, finger=True) as app:
        lab(app, '/lab/pulse.html')
        app.ev("COH_TEST.finger.cfg.mode = 'none'")
        app.page.click('#go'); app.run(6)
        app.page.click('#rec'); app.run(10)
        btn, txt = app.page.inner_text('#rec'), app.page.inner_text('#recstat')
        check('recording, no finger yet: it waits and says where the finger goes', 'attends' in btn and 'objectif' in txt, (btn, txt))
        app.ev("COH_TEST.finger.cfg.mode = 'finger'"); app.run(8)
        btn = app.page.inner_text('#rec')
        check('…and starts by itself once the finger is seen and the picture has settled', 'enregistre' in btn, btn)
        app.run(14)
        app.ev("COH_TEST.finger.cfg.mode = 'none'"); app.run(4)
        txt = app.page.inner_text('#recstat')
        check('a finger lifted in the middle pauses the count and says so', 'perdu' in txt, txt)
        app.ev("COH_TEST.finger.cfg.mode = 'finger'"); app.run(48)
        res = app.page.inner_text('#recres')
        check('…the count resumes and the recording ends with a result', 'Doigt vu' in res and 'pause' in res, res.replace('\n', ' | '))
        app.ev("navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve(); }")
        app.page.click('#copyraw'); app.tick(50)
        clip = json.loads(app.ev('window.__clip')); rc = clip.get('recording', {}); sm = clip.get('samples') or {}
        open('/tmp/coh-shots/lab-report-paused.json', 'w').write(app.ev('window.__clip'))
        check('the pause is in the report (once, lost then back) and the samples come in two stretches', rc.get('pauses') == 1 and [e['what'] for e in rc.get('events', [])] == ['lost', 'back'] and len(sm.get('segs') or []) == 2, (rc.get('pauses'), rc.get('events'), sm.get('segs')))
        check('…and about 40 s of finger were kept, not 40 s of clock', 38 <= rc.get('seconds', 0) <= 46, rc.get('seconds'))
        check('no errors (late finger)', not app.errors, app.errors)
    with phone(clock=True, finger=True) as app:
        lab(app, '/lab/pulse.html')
        app.ev("COH_TEST.finger.cfg.mode = 'none'")
        app.page.click('#go'); app.run(6)
        app.page.click('#rec'); app.run(66)
        txt, btn = app.page.inner_text('#recstat'), app.page.inner_text('#rec')
        check('no finger for a minute: it gives up plainly and the button is back', 'pas vu de doigt' in txt and 'Enregistrer' in btn and app.ev("!document.getElementById('rec').disabled") is True, (txt, btn))
        check('no errors (no finger)', not app.errors, app.errors)


def D():
    print('D · the data: what is kept, a copy, putting it back')
    sess = history()
    with phone(clock=True, permissions=['clipboard-read', 'clipboard-write']) as app:
        put(app, seed(sessions=sess, sos=[{'id': 'x1', 'ts': 1786000000000, 'day': '2026-08-06', 'n': 2}]))
        lab(app, '/lab/data.html')
        app.page.wait_for_function("document.querySelectorAll('#status .who').length === 2", timeout=6000)
        st = app.page.inner_text('#status').replace('\n', ' | ')
        print('   ', st)
        check('status: both people, with what each has', 'Mehdi' in st and 'Adri' in st and ('%d séances' % len(sess)) in st and 'rythme 5.5' in st and '1 SOS' in st, st)
        check('status: Adri has nothing yet', 'Adri | 0 séance' in st.replace(' séances', ' séance'), st)
        check('in a browser tab it warns that the app keeps its own data', 'Attention' in app.page.inner_text('#where'))
        # the copy (text)
        app.page.click('#copy'); app.tick(100)
        text = app.page.evaluate('navigator.clipboard.readText()')
        d = json.loads(text)
        check('the copy is a whole export: app, version, both profiles, the phone settings', d['app'] == 'coherence' and d['v'] == 1 and set(d['profiles']) == {'adri', 'mehdi'} and 'meta' in d, list(d))
        check('…with every session', len(d['profiles']['mehdi']['sessions']) == len(sess))
        # the copy (file): a download when there is no share sheet
        with app.page.expect_download() as dl:
            app.page.click('#save')
        name = dl.value.suggested_filename
        check('the file is named after the day', name == 'coherence-2026-09-29.json', name)
        # wipe the phone, then put the copy back
        app.ev("localStorage.clear()")
        app.page.reload(); freeze(app)
        app.page.wait_for_function("document.querySelectorAll('#status .who').length === 2", timeout=6000)
        check('after the wipe: nothing left', '0 séance' in app.page.inner_text('#status'), app.page.inner_text('#status').replace('\n', ' | '))
        app.page.fill('#paste', 'pas du json')
        check('not a copy: says so, nothing to restore', 'Ce n’est pas une copie' in app.page.inner_text('#preview') and app.ev("document.getElementById('restore').disabled") is True)
        app.page.fill('#paste', text)
        pv = app.page.inner_text('#preview').replace('\n', ' | ')
        check('the preview shows the copy next to the phone', 'dans la copie' in pv and 'sur ce téléphone' in pv and ('%d séances' % len(sess)) in pv, pv)
        app.page.click('#restore')
        check('first touch only asks again', app.page.inner_text('#restore') == 'Toucher encore pour remplacer' and app.ev("document.getElementById('done').hidden") is True)
        app.page.click('#restore'); app.tick(200)
        app.page.wait_for_function("!document.getElementById('done').hidden", timeout=4000)
        check('second touch puts it back', '✓' in app.page.inner_text('#done') and ('%d séances' % len(sess)) in app.page.inner_text('#status'), (app.page.inner_text('#done'), app.page.inner_text('#status').replace('\n', ' | ')))
        stored = json.loads(app.ev("localStorage.getItem('coh:v1:profile:mehdi')"))
        check('what is stored is what was copied', len(stored['sessions']) == len(sess) and stored['rhythm']['value'] == 5.5 and len(stored['sos']) == 1)
        # a copy older than the phone: the loss is named
        older = json.loads(text); older['profiles']['mehdi']['sessions'] = older['profiles']['mehdi']['sessions'][:10]
        app.page.fill('#paste', json.dumps(older))
        pv = app.page.inner_text('#preview')
        check('an older copy says how many sessions would be lost', 'seraient perdues' in pv and ('%d' % (len(sess) - 10)) in pv, pv.replace('\n', ' | '))
        # the file path
        app.page.set_input_files('#file', files=[{'name': 'coherence.json', 'mimeType': 'application/json', 'buffer': text.encode('utf-8')}])
        app.page.wait_for_function("document.getElementById('paste').value.length > 100", timeout=4000)
        check('a chosen file fills the box and the preview', ('%d séances' % len(sess)) in app.page.inner_text('#preview'))
        check('no errors', not app.errors, app.errors)
    # back in the app: the numbers are there
    with phone(clock=True) as app:
        put(app, seed(sessions=sess))
        app.ev("localStorage.clear()")
        app.page.goto(URL + '/lab/data.html')
        app.page.wait_for_function("document.querySelectorAll('#status .who').length === 2", timeout=6000)
        app.page.fill('#paste', text); app.page.click('#restore'); app.page.click('#restore')
        app.page.wait_for_function("!document.getElementById('done').hidden", timeout=4000)
        app.page.goto(URL + '/index.html?nosw'); app.page.wait_for_selector('html[data-ready="1"]', timeout=8000)
        n = app.ev("COH.store.load('mehdi').then(p => p.sessions.length)")
        check('reopening the app: the sessions are back', n == len(sess), n)


if __name__ == '__main__':
    t_all = time.time()
    want = set(a.upper() for a in sys.argv[1:]) or {'K', 'P', 'D'}
    import os
    os.makedirs('/tmp/coh-shots', exist_ok=True)
    for n, fn in (('K', K), ('P', P), ('D', D)):
        if n in want:
            fn()
    print('elapsed %.1f s' % (time.time() - t_all))
    print('FAILED: %s' % bad if bad else 'ALL OK')
    sys.exit(1 if bad else 0)
