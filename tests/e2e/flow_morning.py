"""flow_morning.py — a whole morning session, with a fake finger and a fake clock:
Home → Morning → Ready → Place your finger → one minute at rest → five minutes → the note.  (about 6 minutes of app time)"""
import sys, json, time
from harness import phone

SEED = {
    'meta': {'v': 1, 'unlocked': True, 'sound': 'bowl', 'vol': 0.7, 'mute': False, 'ring': 'b', 'blink': True},
    'profiles': {'mehdi': {'v': 1, 'who': 'mehdi', 'rhythm': {'value': 5.5, 'scores': [38, 51, 63, 55, 40], 'at': 1786000000000, 'date': '2026-08-11'},
                           'history': [], 'partial': None, 'sessions': [], 'sos': [], 'cyc': []}}
}

t0 = time.time()
with phone(clock=True, finger=True, seed=SEED) as app:
    app.open()
    app.wait_screen('qui')
    app.tap('[data-do="who:mehdi"]')
    app.tick(100); app.wait_screen('accueil'); app.settle()
    print('home:', app.bound('acDate'), '·', app.bound('acWho'), '· rhythm', app.bound('acRhythm'), '· morning tile:', app.bound('srt-morning'))
    app.shot('m1-accueil')
    app.tap('[data-id="accueil/ring-morning"]'); app.settle(); app.wait_screen('seance-prete')
    app.shot('m2-prete')
    app.tap('[data-id="seance-prete/begin"]'); app.settle(); app.wait_screen('seance-doigt')
    app.run(8)
    print('finger screen, after 8 s:', app.bound('sigtxt'), '· steady:', app.ev('COH.pulse.steady'), '· hr:', app.ev('COH.pulse.hr'))
    app.shot('m3-doigt')
    app.tap('[data-do="fingerBegin"]')
    app.until('seance-repos', 15)
    app.settle()
    print('rest minute started at', app.ev('COH.guide.state().remain'))
    app.run(20)
    print('after 20 s at rest:', app.bound('restBpm'), '·', app.bound('clock'))
    app.shot('m4-repos')
    app.until('seance', 60, 500)
    app.settle()
    print('coherence phase:', app.bound('clock'), '· cue', app.bound('cue'), '· guide', json.dumps({k: round(v, 2) if isinstance(v, float) else v for k, v in app.ev('COH.guide.state()').items()}))
    app.run(30)
    app.shot('m5-seance')
    app.until('fin-matin', 320, 1000)
    app.run(1)
    app.settle()
    print('done screen:', app.bound('fmCoh'), '/10 ·', app.bound('fmRest'), 'bpm ·', app.bound('fmVar'), 'ms ·', app.bound('fmToday'))
    app.shot('m6-fin')
    p = app.store_dump('mehdi')
    s = p['sessions'][-1]
    print('stored session:', json.dumps({k: s[k] for k in ('kind', 'day', 'secs', 'rhythm', 'rest', 'hrv', 'coh', 'curveAt')}), '· curve points:', len(s['curve'] or []))
    print('quality:', json.dumps(s['q']))
    app.tap('[data-id="fin-matin/day"]'); app.settle(); app.wait_screen('jour')
    print('day:', app.bound('jTitle'), '·', app.bound('j-morning-t'), '·', app.bound('j-morning-s'), '· reading card:', app.visible('[data-id="jour/heart"]'))
    app.shot('m7-jour')
    print('errors:', app.errors)
    print('elapsed %.1f s' % (time.time() - t0))
    sys.exit(1 if app.errors else 0)
