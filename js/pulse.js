/* pulse.js — the back camera, the flash, the frames.
 *
 * What it does
 *   open()              asks for the back camera, keeps the stream open, tries to light the flash (again and again,
 *                       in the background, for as long as the camera is open), and reads every frame: the mean red,
 *                       green and blue of the middle of the picture.
 *   live                every half second: is there a steady pulse right now, at what rate, how good is the signal.
 *   wave()              the last seconds of the pulse, filtered, ready to draw.
 *   startRecording()…   keeps the frames of a reading (with its pauses) for analysis.js.
 *   failure()           why there is no pulse: 'camera' · 'flash' · 'signal' (the three screens of the drawing).
 *   close()             lets go of the camera and puts the flash out.
 *
 * The flash: on iPhone the torch of a web page is capricious. So we never trust one call and never trust what the
 * browser says about itself: we ask, ask again, ask another way, keep the camera open, and let the pulse have the
 * last word — a pulse that reads well in ambient light is a pulse, whether or not the flash lit.
 *
 * Test hook: window.COH_TEST.source = { start(push), stop() } replaces the camera; push(tMs, r, g, b) is one frame.
 */
(function (root) {
  'use strict';
  var COH = root.COH = root.COH || {};
  var A = COH.analysis;

  var W = 64, H = 48;                       // the small picture we read
  var X0 = 12, X1 = 52, Y0 = 9, Y1 = 39;    // the middle of it (the edges of a fingertip picture are unreliable)
  var BUF_S = 16;                           // seconds of frames kept for the live reading
  var SCAN_S = 10;                          // seconds the live reading looks at
  var TORCH_AT = [0, 350, 900, 1800, 3200, 5200];   // ms after the stream is live
  var TORCH_EVERY = 3000;                   // then, while the flash is not lit
  var LIVE_EVERY = 500;

  var S = null;
  function fresh() {
    return {
      state: 'closed',       // closed · opening · live · denied · unavailable · lost
      torch: 'off',          // off · trying · on (the track says so) · assumed (applied without error, not checkable) · refused
      torchWanted: false, torchTries: 0, torchLog: [], torchTimers: [], torchBg: 0,
      stream: null, track: null, video: null, canvas: null, ctx: null, source: null,
      frames: 0, fps: 0, lastT: null, lastWall: 0, stallTimer: 0, liveTimer: 0, raf: 0,
      timeSrc: 'now', probe: [], mediaOffset: 0,
      buf: { t: [], r: [], g: [], b: [], fr: [], fg: [] }, fr: A.causalBandpass(30, 0.5, 4.0), fg: A.causalBandpass(30, 0.5, 4.0),
      color: { r: 0, g: 0, b: 0 },
      live: { steady: false, hr: null, sqi: 0, chan: null, pol: 1, beats: [], n: 0 },
      steadyRun: 0, notRun: 0, steady: false, lock: null, scans: 0, hrSmooth: null,
      rec: null, listeners: [], openPromise: null, caps: null, settings: null, errors: [], t0: 0
    };
  }
  S = fresh();

  function now() { return (root.performance && performance.now()) || Date.now(); }
  function emit(ev) { S.listeners.slice().forEach(function (fn) { try { fn(ev, snapshot()); } catch (e) { /* a listener must not stop the camera */ } }); }
  function note(what, result) { S.torchLog.push({ at: Math.round(now() - S.t0), what: what, result: String(result), r: Math.round(S.color.r), g: Math.round(S.color.g), reported: torchState() }); if (S.torchLog.length > 80) S.torchLog.shift(); }

  function snapshot() {
    return { state: S.state, torch: S.torch, steady: S.steady, hr: S.hrSmooth, sqi: S.live.sqi, fps: S.fps, frames: S.frames,
             color: { r: S.color.r, g: S.color.g, b: S.color.b }, covered: covered(), timeSrc: S.timeSrc, chan: S.live.chan, pol: S.live.pol };
  }

  /* ───────────── frames ───────────── */
  var FINGER_RATIO = 1.25;                   // "there is a finger": red at least this much above green (lenient on purpose — a wrong "no finger" would lock the app, a wrong "finger" only costs a bad reading)
  function covered(k) {                      // a fingertip over the lens looks red: much more red than green
    var c = S.color;
    return c.r >= 20 && c.r >= (k || 1.7) * Math.max(c.g, 1);
  }

  function onSample(tSec, r, g, b) {
    if (!isFinite(tSec)) return;                                 // a frame the clock could not date is not kept (one NaN would poison every later comparison)
    if (S.lastT !== null && tSec <= S.lastT) return;
    if (S.lastT !== null) { var dt = tSec - S.lastT; if (dt > 0.005 && dt < 0.5) S.fps = S.fps ? 0.95 * S.fps + 0.05 / dt : 1 / dt; }
    S.lastT = tSec; S.lastWall = now(); S.frames++;
    var k = S.frames < 8 ? 0.5 : 0.08;
    S.color.r += (r - S.color.r) * k; S.color.g += (g - S.color.g) * k; S.color.b += (b - S.color.b) * k;
    var B = S.buf;
    B.t.push(tSec); B.r.push(r); B.g.push(g); B.b.push(b); B.fr.push(S.fr(r)); B.fg.push(S.fg(g));
    if (B.t.length > BUF_S * 45 && B.t[B.t.length - 1] - B.t[0] > BUF_S * 1.25) {
      var cut = 0; while (B.t[B.t.length - 1] - B.t[cut] > BUF_S) cut++;
      for (var key in B) B[key].splice(0, cut);
    }
    if (S.rec && S.rec.open) { if (S.rec.segStart === null) S.rec.segStart = tSec; S.rec.t.push(tSec); S.rec.r.push(r); S.rec.g.push(g); }
    if (S.state === 'opening') { S.state = 'live'; emit('live'); }
  }

  /* which clock to believe. Chrome gives the true capture time of a frame; Safari may give the media time; when
     neither is steady we take the time the callback ran. Decided once, on the first 30 frames. */
  function decideTime() {
    var P = S.probe, cands = { capture: [], media: [], now: [] }, i;
    P.forEach(function (p) { if (typeof p.cap === 'number') cands.capture.push(p.cap); if (typeof p.med === 'number') cands.media.push(p.med * 1000); cands.now.push(p.now); });
    var best = 'now', bestMad = 1e9;
    ['capture', 'media', 'now'].forEach(function (name) {
      var a = cands[name]; if (a.length < P.length) return;
      var d = []; for (i = 1; i < a.length; i++) d.push(a[i] - a[i - 1]);
      if (d.some(function (x) { return x <= 0; })) return;
      var m = A.median(d); if (m < 12 || m > 80) return;
      var mad = A.median(d.map(function (x) { return Math.abs(x - m); }));
      var lim = name === 'now' ? 1e9 : 3.5;
      if (mad <= lim && mad < bestMad - (name === 'now' ? 0 : 0.0)) { best = name; bestMad = mad; }
      if (name === 'now' && best === 'now') bestMad = mad;
    });
    S.timeSrc = best;
    if (best === 'media') { var last = P[P.length - 1]; S.mediaOffset = last.now - last.med * 1000; }
    S.probe = null;
  }
  function frameMs(nowMs, meta) {
    if (S.probe) {
      S.probe.push({ now: nowMs, cap: meta && meta.captureTime, med: meta && meta.mediaTime });
      if (S.probe.length >= 30) decideTime();
      return nowMs;
    }
    if (S.timeSrc === 'capture') return meta && typeof meta.captureTime === 'number' ? meta.captureTime : NaN;      // (this frame carries no date: skip it, never mix two clocks)
    if (S.timeSrc === 'media') return meta && typeof meta.mediaTime === 'number' ? S.mediaOffset + meta.mediaTime * 1000 : NaN;
    return nowMs;
  }

  function readPicture(nowMs, meta) {
    var v = S.video; if (!v || v.readyState < 2) return;
    var ctx = S.ctx;
    try { ctx.drawImage(v, 0, 0, W, H); var d = ctx.getImageData(X0, Y0, X1 - X0, Y1 - Y0).data; } catch (e) { S.errors.push('draw:' + e.name); return; }
    var n = d.length / 4, r = 0, g = 0, b = 0;
    for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    onSample(frameMs(nowMs, meta) / 1000, r / n, g / n, b / n);
  }
  function loopFrames() {
    var v = S.video; if (!v) return;
    if (typeof v.requestVideoFrameCallback === 'function') {
      var cb = function (t, meta) { if (S.video !== v) return; readPicture(t, meta); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
    } else {
      var lastCt = -1, tick = function (t) {
        if (S.video !== v) return;
        if (v.currentTime !== lastCt) { lastCt = v.currentTime; readPicture(t, null); }
        S.raf = requestAnimationFrame(tick);
      };
      S.raf = requestAnimationFrame(tick);
    }
  }

  /* ───────────── the flash ───────────── */
  function torchState() {
    var t = S.track; if (!t) return null;
    try { var st = t.getSettings ? t.getSettings() : {}; return typeof st.torch === 'boolean' ? st.torch : null; } catch (e) { return null; }
  }
  function applyTorch(reason, on) {
    var t = S.track;
    if (S.source) { S.torch = on === false ? 'off' : 'assumed'; return Promise.resolve(); }
    if (!t || t.readyState !== 'live') return Promise.resolve();
    var want = on !== false, seq = Promise.resolve(), ok = false, why = [];
    S.torchTries++;
    if (S.torch !== 'on' && want) S.torch = 'trying';
    function attempt(name, fn) {
      seq = seq.then(function () {
        if (ok || !fn) return;
        return Promise.resolve().then(fn).then(function () { ok = true; note(reason + ' · ' + name, 'ok'); }, function (e) { why.push(name + ':' + (e && e.name || e)); note(reason + ' · ' + name, e && e.name || e); });
      });
    }
    attempt('advanced', function () { return t.applyConstraints({ advanced: [{ torch: want }] }); });
    attempt('plain', function () { return t.applyConstraints({ torch: want }); });
    attempt('withVideo', function () { return t.applyConstraints({ facingMode: 'environment', advanced: [{ torch: want }] }); });
    attempt('imageCapture', (typeof root.ImageCapture === 'function') ? function () {
      var ic = new root.ImageCapture(t);
      return ic.setOptions ? ic.setOptions({ torch: want, fillLightMode: want ? 'flash' : 'off' }) : Promise.reject(new Error('NoSetOptions'));
    } : null);
    return seq.then(function () {
      if (!want) { S.torch = 'off'; return; }
      var reported = torchState();
      if (reported === true) S.torch = 'on';
      else if (ok) S.torch = reported === false ? 'assumed' : 'assumed';
      else S.torch = S.torchTries >= 4 ? 'refused' : 'trying';
      emit('torch');
    });
  }
  function keepTryingTorch() {
    S.torchWanted = true;
    S.torchTimers.forEach(clearTimeout); S.torchTimers = [];
    TORCH_AT.forEach(function (ms, i) { S.torchTimers.push(setTimeout(function () { if (S.torchWanted && S.torch !== 'on') applyTorch('boot' + i); }, ms)); });
    clearInterval(S.torchBg);
    S.torchBg = setInterval(function () {
      if (!S.torchWanted || S.state !== 'live') return;
      var reported = torchState();
      if (reported === true) { S.torch = 'on'; return; }
      // the browser says it is off, or says nothing and the finger sits in the dark with no pulse: ask again
      var dark = covered() && S.color.r < 70 && !S.steady;
      if (S.torch === 'refused' || S.torch === 'trying' || reported === false || dark) applyTorch('bg');
    }, TORCH_EVERY);
  }

  /* ───────────── opening the camera ───────────── */
  function constraintsList() {
    var size = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } };
    return [
      { video: Object.assign({ facingMode: { exact: 'environment' }, advanced: [{ torch: true }] }, size), audio: false },
      { video: Object.assign({ facingMode: { ideal: 'environment' } }, size), audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false }
    ];
  }
  function getStream() {
    var list = constraintsList(), i = 0;
    function next(lastErr) {
      if (i >= list.length) return Promise.reject(lastErr);
      var c = list[i++];
      return navigator.mediaDevices.getUserMedia(c).catch(function (e) {
        S.errors.push('gum' + (i - 1) + ':' + (e && e.name));
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'PermissionDeniedError')) return Promise.reject(e);
        return next(e);
      });
    }
    return next(null);
  }
  function makeVideo() {
    var v = document.createElement('video');
    v.className = 'camvideo'; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', ''); v.setAttribute('autoplay', '');
    v.muted = true; v.playsInline = true; v.autoplay = true; v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
    document.body.appendChild(v);
    return v;
  }

  function open() {
    if (S.openPromise && (S.state === 'opening' || S.state === 'live')) return S.openPromise;
    if (S.state === 'lost') close();                             // what is left of the lost camera (timers, the hidden picture, the stream) goes first
    closeSeg();                                                  // a reading in progress survives a re-open (the camera was taken away and given back)
    var keep = { listeners: S.listeners, rec: S.rec };
    S = fresh(); S.listeners = keep.listeners; S.rec = keep.rec; S.t0 = now(); S.state = 'opening'; S.probe = [];
    S.canvas = document.createElement('canvas'); S.canvas.width = W; S.canvas.height = H;
    S.ctx = S.canvas.getContext('2d', { willReadFrequently: true });
    emit('opening');
    var me = S;
    var test = root.COH_TEST && root.COH_TEST.source;
    if (test) {                                                  // a fake camera, for the tests
      S.source = test; S.timeSrc = 'now'; S.probe = null; S.torch = 'assumed';
      S.openPromise = Promise.resolve().then(function () {
        test.start(function (tMs, r, g, b) { if (S === me) onSample(tMs / 1000, r, g, b); });
        startTimers(); return snapshot();
      });
      return S.openPromise;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      S.state = 'unavailable'; S.errors.push('no-getUserMedia'); emit('unavailable');
      return (S.openPromise = Promise.reject({ kind: 'unavailable', name: 'NoMediaDevices' }));
    }
    S.openPromise = getStream().then(function (stream) {
      if (S !== me) { stream.getTracks().forEach(function (t) { t.stop(); }); return snapshot(); }
      S.stream = stream; S.track = stream.getVideoTracks()[0]; S.openedAt = now();
      try { if (navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (l) { if (S === me) S.devices = l.filter(function (d) { return d.kind === 'videoinput'; }).map(function (d) { return d.label || '(no label)'; }); }, function () {}); } catch (e) { /* fine */ }
      try { S.caps = S.track.getCapabilities ? S.track.getCapabilities() : null; S.settings = S.track.getSettings ? S.track.getSettings() : null; } catch (e) { /* not everywhere */ }
      S.track.addEventListener('ended', function () { if (S === me && S.state !== 'closed') { S.state = 'lost'; emit('lost'); } });
      S.track.addEventListener('mute', function () { if (S === me) emit('mute'); });
      S.track.addEventListener('unmute', function () { if (S === me) { emit('unmute'); if (S.torchWanted) applyTorch('unmute'); } });
      S.video = makeVideo(); S.video.srcObject = stream;
      var ready = new Promise(function (res) {
        var done = function () { res(); };
        S.video.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(done, 2500);
      });
      var play = function () { var p = S.video && S.video.play(); if (p && p.catch) p.catch(function (e) { S.errors.push('play:' + (e && e.name)); }); };
      play();
      S.video.addEventListener('playing', function () { if (S === me && S.torchWanted && S.torch !== 'on') applyTorch('playing'); });
      return ready.then(function () {
        if (S !== me) return snapshot();
        play(); loopFrames(); startTimers(); keepTryingTorch();
        return snapshot();
      });
    }).catch(function (e) {
      var kind = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'PermissionDeniedError') ? 'denied' : 'unavailable';
      if (S === me) { S.state = kind; S.errors.push('open:' + (e && e.name)); emit(kind); }
      throw { kind: kind, name: e && e.name, message: e && e.message };
    });
    return S.openPromise;
  }

  function startTimers() {
    clearInterval(S.liveTimer); S.liveTimer = setInterval(scan, LIVE_EVERY);
    clearInterval(S.stallTimer);
    S.stallTimer = setInterval(function () {               // frames stopped (the page was hidden, the camera was interrupted) or never started (the phone would not autoplay)
      if ((S.state !== 'live' && S.state !== 'opening') || S.source || !S.video || !S.video.paused) return;
      if (S.state === 'opening' || now() - S.lastWall > 2500) { var p = S.video.play(); if (p && p.catch) p.catch(function (e) { S.errors.push('replay:' + (e && e.name)); }); }
    }, 1500);
  }

  /* ───────────── the live reading ───────────── */
  function scan() {
    if (S.state !== 'live' && S.state !== 'opening') return;
    var B = S.buf, n = B.t.length, tNow = n ? B.t[n - 1] : 0;
    if (n < 4 * 30 || (S.lastWall && now() - S.lastWall > 2000)) { setSteady(false, null); emit('update'); return; }
    var i0 = n - 1; while (i0 > 0 && tNow - B.t[i0 - 1] <= SCAN_S) i0--;
    var win = { t: B.t.slice(i0), r: B.r.slice(i0), g: B.g.slice(i0) };
    S.scans++;
    var pref = S.lock && (S.scans % 8) !== 0 ? S.lock : null;
    var res = A.liveScan(win, pref);
    S.live = res;
    if (res.steady) S.lock = { chan: res.chan, pol: res.pol };
    // a regular flicker of a room is not a pulse: the lens must look covered — unless the signal is so clean and regular that it can only be one
    setSteady(res.steady && (covered(FINGER_RATIO) || res.sqi >= 0.85), res.hr);
    emit('update');
  }
  function setSteady(v, hr) {
    if (v) { S.steadyRun++; S.notRun = 0; if (S.steadyRun >= 2 && !S.steady) { S.steady = true; emit('steady'); } }
    else { S.notRun++; S.steadyRun = 0; if (S.notRun >= 2 && S.steady) { S.steady = false; S.lock = null; emit('unsteady'); } }
    if (S.steady && hr) S.hrSmooth = S.hrSmooth ? S.hrSmooth + (hr - S.hrSmooth) * 0.35 : hr;
    if (!S.steady && S.notRun > 6) S.hrSmooth = null;
  }

  /* the last `seconds` of the pulse for drawing: points { t (s ago, 0 = now), y (−1..1, up is systole) } */
  function wave(seconds) {
    var B = S.buf, n = B.t.length, out = [];
    if (n < 10) return out;
    var chan = (S.live.chan || 'r') === 'g' ? B.fg : B.fr, sign = S.live.pol === 1 ? 1 : -1;
    var tNow = B.t[n - 1], i0 = n - 1; while (i0 > 0 && tNow - B.t[i0 - 1] <= seconds) i0--;
    var m = 1e-9, i;
    for (i = i0; i < n; i++) m = Math.max(m, Math.abs(chan[i]));
    // scale on a robust height so one big movement does not flatten the wave
    var abs = []; for (i = i0; i < n; i++) abs.push(Math.abs(chan[i]));
    abs.sort(function (a, b) { return a - b; });
    var ref = Math.max(abs[Math.floor(abs.length * 0.92)] || m, 1e-9);
    for (i = i0; i < n; i++) out.push({ t: tNow - B.t[i], y: Math.max(-1.4, Math.min(1.4, sign * chan[i] / ref)) });
    return out;
  }

  /* ───────────── recording ───────────── */
  function startRecording(label) {
    S.rec = { label: label || '', t: [], r: [], g: [], segs: [], segStart: S.lastT, open: true, startedAt: now() };
    return S.rec;
  }
  function closeSeg() {
    var R = S.rec; if (!R || !R.open) return;
    R.open = false;
    var t1 = R.t.length ? R.t[R.t.length - 1] : R.segStart;
    if (R.segStart !== null && t1 !== null && t1 > R.segStart) R.segs.push([R.segStart, t1]);
  }
  function pauseRecording() { closeSeg(); }
  function resumeRecording() {
    var R = S.rec; if (!R || R.open) return;
    R.open = true; R.segStart = S.lastT;                          // null until the first frame after the pause
  }
  function stopRecording() {
    var R = S.rec; if (!R) return null;
    closeSeg(); S.rec = null;
    return { label: R.label, t: R.t, r: R.r, g: R.g, segs: R.segs, seconds: R.segs.reduce(function (a, s) { return a + s[1] - s[0]; }, 0) };
  }
  function recordingSeconds() {
    var R = S.rec; if (!R) return 0;
    var s = R.segs.reduce(function (a, x) { return a + x[1] - x[0]; }, 0);
    if (R.open && R.t.length && R.segStart !== null) s += R.t[R.t.length - 1] - R.segStart;
    return s;
  }

  /* ───────────── what went wrong ───────────── */
  /* 'camera' — not allowed / not available;  'flash' — the finger is there, in the dark, the flash is not lighting;
     'signal' — anything else (the finger is not on the lens, too much pressure, moving) */
  function failure() {
    if (S.state === 'denied' || S.state === 'unavailable' || S.state === 'lost' || (S.state === 'opening' && !S.frames)) return 'camera';
    if (covered() && !S.steady && (S.torch === 'refused' || (S.torch !== 'on' && S.color.r < 60))) return 'flash';
    return 'signal';
  }

  function on(fn) { S.listeners.push(fn); return function () { var i = S.listeners.indexOf(fn); if (i >= 0) S.listeners.splice(i, 1); }; }

  function close() {
    var st = S, stream = st.stream, video = st.video, track = st.track;      // taken now: the state is replaced below, and the flash is put out before the camera is let go
    st.torchWanted = false; st.torchTimers.forEach(clearTimeout); clearInterval(st.torchBg); clearInterval(st.liveTimer); clearInterval(st.stallTimer);
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.source) { try { st.source.stop(); } catch (e) { /* fine */ } }
    var stopped = false, guard = 0;
    var stop = function () {
      if (stopped) return; stopped = true; clearTimeout(guard);
      if (stream) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* fine */ } });
      if (video) { try { video.pause(); } catch (e) { /* fine */ } video.srcObject = null; if (video.parentNode) video.parentNode.removeChild(video); }
    };
    if (track && track.readyState === 'live' && st.torch !== 'off') {
      guard = setTimeout(stop, 700);                                          // a phone that never answers must not keep the camera (and the flash) on
      try { track.applyConstraints({ advanced: [{ torch: false }] }).then(stop, stop); } catch (e) { stop(); }
    } else stop();
    var keep = st.listeners, rec = st.rec;
    if (rec && rec.open) { S = st; closeSeg(); }
    st.state = 'closed'; st.video = null; st.stream = null; st.track = null; st.openPromise = null;
    var fresh1 = fresh(); fresh1.listeners = keep; fresh1.rec = rec; S = fresh1;
  }

  /* a touch is the one moment a phone always lets a picture start (and, for the flash, a good moment to ask again) */
  function kick() {
    var v = S.video; if (!v || S.source || (S.state !== 'opening' && S.state !== 'live')) return;
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function (e) { S.errors.push('kick:' + (e && e.name)); }); }
    if (S.torchWanted && S.torch !== 'on' && S.torch !== 'assumed') applyTorch('tap');
  }
  ['touchend', 'pointerup', 'click'].forEach(function (ev) { document.addEventListener(ev, kick, { capture: true, passive: true }); });

  /* visible again: the camera may have been taken away while we were hidden */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (S.rec && S.rec.open) { closeSeg(); S.rec.hidden = true; } return; }
    if (S.state === 'lost' || (S.track && S.track.readyState === 'ended')) { emit('lost'); return; }
    if (S.video && S.video.paused) { var p = S.video.play(); if (p && p.catch) p.catch(function () {}); }
    if (S.torchWanted) applyTorch('visible');
    emit('visible');
  });

  function report() {
    var s = S, B = s.buf;
    return {
      at: new Date().toISOString(), ua: navigator.userAgent, standalone: !!(navigator.standalone || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches)),
      version: COH.VERSION || null, state: s.state, torch: s.torch, torchTries: s.torchTries, torchLog: s.torchLog, errors: s.errors, timeSrc: s.timeSrc,
      track: s.track ? { label: s.track.label, readyState: s.track.readyState, muted: s.track.muted } : null, videoInputs: s.devices || null,
      audioSession: !!(navigator.audioSession), wakeLockApi: !!(navigator.wakeLock),
      awake: (COH.guide && COH.guide.awake && COH.guide.awake.info) ? COH.guide.awake.info() : null,
      capabilities: s.caps ? JSON.parse(JSON.stringify(s.caps)) : null, settings: s.track && s.track.getSettings ? s.track.getSettings() : s.settings,
      rvfc: typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function',
      imageCapture: typeof root.ImageCapture === 'function', frames: s.frames, fps: +s.fps.toFixed(2),
      color: { r: +s.color.r.toFixed(1), g: +s.color.g.toFixed(1), b: +s.color.b.toFixed(1) }, covered: covered(), coveredLenient: covered(FINGER_RATIO), ratio: +(s.color.r / Math.max(s.color.g, 1)).toFixed(2),
      steady: s.steady, hr: s.hrSmooth && +s.hrSmooth.toFixed(1), sqi: +(s.live.sqi || 0).toFixed(2), chan: s.live.chan, pol: s.live.pol,
      bufferSeconds: B.t.length ? +(B.t[B.t.length - 1] - B.t[0]).toFixed(1) : 0
    };
  }

  COH.pulse = {
    open: open, close: close, kick: kick, on: on, wave: wave, failure: failure, report: report, snapshot: snapshot,
    startRecording: startRecording, pauseRecording: pauseRecording, resumeRecording: resumeRecording, stopRecording: stopRecording, recordingSeconds: recordingSeconds,
    retryTorch: function () { S.torchWanted = true; S.torchTries = 0; return applyTorch('manual'); },
    get state() { return S.state; }, get torch() { return S.torch; }, get steady() { return S.steady; }, get hr() { return S.hrSmooth; },
    get live() { return S.live; }, get covered() { return covered(); }, get frames() { return S.frames; }, get lastT() { return S.lastT; }
  };
})(typeof self !== 'undefined' ? self : this);
