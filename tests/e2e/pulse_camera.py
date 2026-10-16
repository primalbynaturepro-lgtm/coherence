"""Chromium with a fake camera plays a video of a fingertip; pulse.js must open it, find the pulse, read the rate,
and record. usage: python3 pulse_camera.py [finger|dark|nofinger] [url]"""
import sys, time, json, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
which = sys.argv[1] if len(sys.argv) > 1 else 'finger'
base = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8811'
files = {'finger': 'finger-64.mjpeg', 'dark': 'dark-64.mjpeg', 'nofinger': 'nofinger.mjpeg'}
vid = os.path.normpath(os.path.join(ROOT, '..', 'fixtures', files[which]))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or ('/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None), args=[
        '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        '--use-file-for-fake-video-capture=' + vid, '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 430, 'height': 932}, permissions=['camera'])
    # keep every stream the page is given, to check afterwards that close() really lets the camera go
    ctx.add_init_script("""(() => { window.__streams = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => g(c).then((s) => { window.__streams.push(s); return s; }); })()""")
    pg = ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append(m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(base + '/tests/e2e/pulse-harness.html')
    t0 = time.time()
    res = pg.evaluate("""async () => { try { const s = await COH.pulse.open(); return {ok:true, s}; } catch (e) { return {ok:false, e}; } }""")
    print('open ->', json.dumps(res)[:300])
    seen = None
    for i in range(45):
        time.sleep(1)
        sn = pg.evaluate("COH.pulse.snapshot()")
        if sn['steady'] and seen is None:
            seen = time.time() - t0
            print(f'steady after {seen:.1f} s: hr {sn["hr"]:.1f}')
        if i % 5 == 4:
            print(f'{i+1:2d}s frames {sn["frames"]:4d} fps {sn["fps"]:.1f} steady {sn["steady"]} hr {sn["hr"]} sqi {sn["sqi"]:.2f} torch {sn["torch"]} color {sn["color"]} covered {sn["covered"]} time {sn["timeSrc"]}')
        if seen is not None and i > 20: break
    # record 20 s and analyse in the page
    pg.evaluate("COH.pulse.startRecording('t')")
    time.sleep(22)
    rec = pg.evaluate("(() => { const r = COH.pulse.stopRecording(); const a = COH.analysis.analyzeWindow({t:r.t, r:r.r, g:r.g, segs:r.segs}, {spectral:false, curve:false}); return {secs:r.seconds, n:r.t.length, hr:a.hr, ok:a.ok, reason:a.reason, cov:a.coverage, sqi:a.sqi, chan:a.chan, pol:a.pol, rmssd:a.rmssd}; })()")
    print('recording ->', json.dumps(rec))
    print('failure() ->', pg.evaluate("COH.pulse.failure()"))
    rep = pg.evaluate("COH.pulse.report()")
    print('report:', json.dumps({k: rep[k] for k in ['state','torch','torchTries','errors','timeSrc','rvfc','fps','color','covered','steady','hr','sqi','chan','pol']}))
    print('capabilities:', json.dumps(rep['capabilities'])[:400])
    print('torchLog:', json.dumps(rep['torchLog'])[:500])
    pg.evaluate("COH.pulse.close()")
    time.sleep(1.5)                                                   # the flash is put out first, then the camera let go (at most 0.7 s)
    left = pg.evaluate("({ tracks: window.__streams.flatMap(s => s.getTracks().map(t => t.readyState)), videos: document.querySelectorAll('video.camvideo').length, state: COH.pulse.state })")
    ok_close = bool(left['tracks']) and all(t == 'ended' for t in left['tracks']) and left['videos'] == 0 and left['state'] == 'closed'
    print('after close():', json.dumps(left), '->', 'camera let go' if ok_close else 'FAIL: the camera is still held')
    # and a camera that was taken away is let go of before it is asked for again (no second set of timers, no stream left behind)
    pg.evaluate("COH.pulse.open()"); time.sleep(3)
    pg.evaluate("window.__streams[window.__streams.length - 1].getVideoTracks()[0].stop(); window.__streams[window.__streams.length - 1].getVideoTracks()[0].dispatchEvent(new Event('ended'))")
    time.sleep(0.5)
    lost = pg.evaluate("COH.pulse.state")
    pg.evaluate("COH.pulse.open()"); time.sleep(3)
    again = pg.evaluate("({ state: COH.pulse.state, frames: COH.pulse.frames, videos: document.querySelectorAll('video.camvideo').length, live: window.__streams.map(s => s.getTracks().map(t => t.readyState)) })")
    ok_reopen = lost == 'lost' and again['state'] == 'live' and again['videos'] == 1 and sum(1 for st in again['live'] for t in st if t == 'live') == 1
    print('lost ->', lost, '· reopened ->', json.dumps(again), '->', 'one camera, one picture' if ok_reopen else 'FAIL: something was left behind')
    pg.evaluate("COH.pulse.close()")
    print('logs:', [l for l in logs if 'favicon' not in l][:8])
    b.close()
    if not (ok_close and ok_reopen):
        sys.exit(1)
