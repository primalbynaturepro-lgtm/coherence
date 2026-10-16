/* flows.js — what happens: the code, the test of five rhythms, the three sessions, the sighs, the settings.
 *
 * The screens are drawn (index.html) and painted (paint.js); this file is the story between them: which screen leads to
 * which, what starts when one arrives, what is kept when one ends. Timings, in seconds: rhythm 120 · pause 60 · morning
 * reading at rest 60 · session 300 · one sigh 10 · cyclic sighing 300.
 *
 * The pulse is read only where the drawing asks for it (the finger screens, the five rhythms, the morning session). It is
 * never allowed to stop the guide: if the finger slips in the middle, the breath goes on and the reading is judged at the end.
 */
(function (root) {
  'use strict';
  var COH = root.COH = root.COH || {};
  var doc = root.document, nav = COH.nav, ST = COH.ST, M = COH.model, A = COH.analysis, G = COH.guide, PU = COH.pulse, paint = COH.paint, P = paint.P, store = COH.store;
  var DO = nav.DO, DEST = nav.DEST, COND = nav.COND;

  var GATE = '24bc9b61f8ec0b982d1a363f559332b1a56f5bf7be48a373e33014247b5c6067';     // sha256('coh-gate:' + the code)
  var WAIT_MS = 12000;                                                                // Begin waits this long, once the camera is live, for a steady pulse
  var REST_S = 60, COH_S = 300, PALIER_S = 120, PAUSE_S = 60, CYC_S = 300;
  var FINGER = ['test-doigt', 'seance-doigt'];
  var KEEP_CAM = ['test-doigt', 'test-palier', 'test-pause', 'test-arreter', 'seance-doigt', 'seance-repos', 'seance', 'seance-pause', 'seance-arreter'];
  var KEEP_AWAKE = KEEP_CAM.concat(['cyclique', 'cyclique-arreter']);

  function $(sel, r) { return (r || doc).querySelector(sel); }
  function sec(id) { return doc.getElementById('s-' + id); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function profile() { return store.profile(ST.who); }
  function rhythm() { var p = profile(); return p ? M.rhythmValue(p) : null; }
  function meta() { return store.meta; }
  function partial() { return M.partialInfo(profile() || store.emptyProfile('mehdi'), Date.now()); }
  function doneFlags() { return partial().scores.map(function (x) { return x !== null; }); }
  function defer(fn) {                                          // let the screen change first, then do the arithmetic
    return new Promise(function (res) { setTimeout(function () { var out; try { out = fn(); } catch (e) { out = { error: String(e && e.stack || e) }; } res(out); }, 30); });
  }

  /* ───────────── the code (asked once on a phone, and never in the clear) ───────────── */
  function sha256(s) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], b = [], i, j;
    for (i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 255);
    var bits = b.length * 8; b.push(0x80); while (b.length % 64 !== 56) b.push(0);
    for (i = 7; i >= 0; i--) b.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var o = 0; o < b.length; o += 64) {
      var w = [];
      for (i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      for (i = 16; i < 64; i++) { var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  function shake(id) { var d = $('.dots', sec(id)); if (!d) return; d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); }

  DO.key = function (k) {
    var id = nav.current;
    if (id !== 'code' && id !== 'code-faux') return;
    if (k === 'del') ST.buf = ST.buf.slice(0, -1); else if (ST.buf.length < 4) ST.buf += k;
    paint.paintDots(id);
    if (ST.buf.length === 4) {
      var ok = sha256('coh-gate:' + ST.buf) === GATE;
      nav.later(function () {
        if (ok) { store.setMeta({ unlocked: true }); ST.buf = ''; nav.go('qui', 'push'); }
        else { ST.buf = ''; if (id === 'code') nav.go('code-faux', 'swap'); else { shake(id); paint.paintDots(id); } }
      }, 180);
    }
  };

  /* ───────────── who is opening ───────────── */
  function resetVisit() {
    ST.kind = 'morning'; ST.palier = 1; ST.sighs = 1; ST.noRead = false; ST.redoing = false; ST.redoFrom = 'progres'; ST.pending = null;
    ST.day = null; ST.month = null; ST.session = null; ST.sosRec = null; ST.lastSession = null; ST.pauseWhy = 'user'; ST.failFrom = 'test-doigt'; ST.resumeTo = 'seance';
    G.forget();
  }
  function loadDest() {
    var p = profile(), pi = M.partialInfo(p, Date.now()), has = M.rhythmValue(p) != null;
    if (pi.complete) { ST.redoing = has; return 'test-calcul'; }                    // a finished test nobody confirmed: show its result
    return has ? 'accueil' : 'test-intro';
  }
  DO.who = function (who) {
    if (ST.loading) return false;
    resetVisit(); ST.who = who;
    var shown = false, slow = setTimeout(function () { if (nav.current === 'qui') { shown = true; nav.go('chargement', 'swap'); } }, 400);
    ST.loading = store.load(who).then(function () {
      clearTimeout(slow); ST.loading = null;
      if (nav.current === 'qui' || nav.current === 'chargement') nav.go(loadDest(), shown ? 'swap' : 'push');
    }, function () { clearTimeout(slow); ST.loading = null; });
    return false;
  };

  /* ───────────── conditions and doors ───────────── */
  function showingPending() { return nav.current === 'rythme' && nav.from.rythme === 'test-resultat' && !!ST.pending; }
  COND.locked = function () { return rhythm() == null; };
  COND.norhythm = function () { return rhythm() == null && !showingPending(); };
  COND.redo = function () { return rhythm() != null; };
  COND.resume = function () { return partial().stopAt > 0; };
  COND.morning = function () { return ST.kind === 'morning'; };
  COND.sessionfail = function () { return /^seance/.test(ST.failFrom); };
  COND.sighmore = function () { return ST.sighs < 3; };
  COND.reading = function () { var p = profile(); return !!p && !!M.dayInfo(p, ST.day || M.today()).reading; };
  COND.noreadings = function () { var p = profile(); return !p || !M.hasReadings(p); };
  COND.nosessions = function () { var p = profile(); return !p || !M.hasSessions(p); };

  DEST.redoFrom = function () { return ['progres', 'reglages', 'rythme'].indexOf(ST.redoFrom) >= 0 ? ST.redoFrom : 'progres'; };
  DEST.redoDest = DEST.redoFrom;
  DEST.rythmeBack = function () { return nav.from.rythme || 'progres'; };
  DEST.jourBack = function () { return nav.from.jour || 'progres'; };
  DEST.sheetBack = function () { return nav.sheetBack; };
  DEST.resumeTo = function () { return ST.resumeTo; };
  DEST.useDest = function () { return ST.redoing && rhythm() != null && ST.pending && ST.pending.rhythm !== rhythm() ? 'test-remplacer' : (ST.redoing ? DEST.redoDest() : 'accueil'); };
  DEST.ringDest = function () { return rhythm() == null ? 'test-intro' : 'seance-prete'; };
  DEST.beginDest = function () { return ST.kind === 'morning' ? 'seance-doigt' : 'seance'; };
  DEST.failBack = function () { return ST.failFrom; };

  /* ───────────── the camera: only where a pulse is wanted ───────────── */
  var wave = { id: null, raf: 0, last: 0 };
  function ensureCamera(id) {
    if (PU.state === 'live' || PU.state === 'opening') return;
    PU.open().then(null, function (e) { if (nav.current === id && e && (e.kind === 'denied' || e.kind === 'unavailable')) failTo('camera'); });
  }
  function endReading() { if (PU.state !== 'closed') PU.close(); G.awake.off(); }
  function failTo(kind) { nav.go(kind === 'camera' ? 'camera-refusee' : (kind === 'flash' ? 'flash-indispo' : 'signal-faible'), 'push'); }

  function stopWave() { if (wave.raf) cancelAnimationFrame(wave.raf); wave.raf = 0; wave.id = null; }
  function startWave(id) {
    stopWave();
    var s = sec(id), path = $('.wave path', s), txt = $('[data-bind="sigtxt"]', s) || $('[data-bind="restBpm"]', s), rest = id === 'seance-repos';
    if (!path) return;
    wave.id = id;
    (function frame(now) {
      if (wave.id !== id) return;
      if (!wave.last || now - wave.last > 45) {                                     // twenty pictures a second are plenty for a pulse
        wave.last = now;
        var pts = PU.wave(6), d = 'M0 32 L320 32';
        if (pts.length > 4) d = pts.map(function (q, i) { return (i ? 'L' : 'M') + (320 * (1 - q.t / 6)).toFixed(1) + ' ' + (32 - q.y * 26).toFixed(1); }).join(' ');
        path.setAttribute('d', d);
        if (txt) {
          var st = PU.steady;
          txt.textContent = rest ? (st && PU.hr ? Math.round(PU.hr) + ' beats a minute' : 'Reading…') : (st ? 'Signal steady' : 'Looking for your pulse…');
        }
      }
      wave.raf = requestAnimationFrame(frame);
    })(0);
  }

  FINGER.forEach(function (id) {
    nav.onEnter(id, function () {
      ST.failFrom = id;
      var b = $('[data-do="fingerBegin"]', sec(id)); if (b) { b.classList.remove('busy'); b.removeAttribute('aria-busy'); }
      ST.waiting = false;
      G.awake.on(); ensureCamera(id); startWave(id);
    });
  });

  /* Begin: wait (a little) for the pulse to be steady, then go; if it never is, say why */
  DO.fingerBegin = function (arg, el) {
    var id = nav.current;
    if (ST.waiting || FINGER.indexOf(id) < 0) return false;
    ST.waiting = true; el.classList.add('busy'); el.setAttribute('aria-busy', 'true');
    PU.kick();                                                                        // this touch may be the only one that lets the picture start (Low Power Mode) and the flash try again
    var deadline = 0;
    function release() { ST.waiting = false; el.classList.remove('busy'); el.removeAttribute('aria-busy'); }
    (function poll() {
      if (nav.current !== id) { release(); return; }
      var st = PU.state;
      if (st === 'denied' || st === 'unavailable') { release(); failTo('camera'); return; }
      if (PU.steady) { release(); proceed(id); return; }
      if (st === 'live' || st === 'opening') {                                        // 'opening' too: a camera that was allowed but never shows a picture must not keep the button busy for ever
        if (!deadline) deadline = Date.now() + WAIT_MS;
        if (Date.now() > deadline) { var why = PU.failure(); release(); failTo(why); return; }
      } else if (st === 'lost' || st === 'closed') { ensureCamera(id); }
      nav.later(poll, 200);
    })();
    return false;
  };
  function proceed(id) {
    if (id === 'test-doigt') { var i = partial().scores.indexOf(null); ST.palier = i < 0 ? 1 : i + 1; nav.go('test-palier', 'push'); }
    else nav.go('seance-repos', 'push');
  }

  /* ───────────── the test: five rhythms, two minutes each ───────────── */
  var jobs = [];
  DO.testStart = function () { ST.redoing = rhythm() != null; ST.pending = null; ST.palier = 1; };
  DO.testResume = function () { ST.redoing = rhythm() != null; ST.pending = null; var i = partial().scores.indexOf(null); ST.palier = i < 0 ? 1 : i + 1; };
  DO.testGo = function () { ST.redoFrom = nav.current; };
  DO.redoStart = function () { ST.redoFrom = nav.current; };
  DO.testStop = function () { ST.pending = null; abortTestWindow(); };
  DO.paceNext = function () { ST.palier = ST.nextPalier || Math.min(5, ST.palier + 1); };

  function abortTestWindow() { if (PU.state !== 'closed' || PU.recordingSeconds() > 0) { PU.stopRecording(); endReading(); } G.awake.off(); G.forget('test-palier'); G.forget('test-pause'); }

  /* how much of a recording had a finger on the lens (red well above green); a window mostly without one is not read */
  var FINGER_RATIO = 1.25, FINGER_MIN = 0.6;
  function fingerFrac(rec) {
    if (!rec || !rec.r || !rec.r.length) return 0;
    var k = 0, i;
    for (i = 0; i < rec.r.length; i++) if (rec.r[i] >= 20 && rec.r[i] >= FINGER_RATIO * Math.max(rec.g[i], 1)) k++;
    return k / rec.r.length;
  }
  function analyze(rec, opts) {
    var a = A.analyzeWindow({ t: rec.t, r: rec.r, g: rec.g, segs: rec.segs }, opts), ff = fingerFrac(rec);
    a.finger = ff;
    if (ff < FINGER_MIN && !(a.coverage >= 0.8 && a.sqi >= 0.85)) { a.ok = false; a.reason = 'no-finger'; }      // (a window that clean is a pulse whatever the colours say)
    return a;
  }

  function scoreWindow(rec, bpm) {
    if (!rec || !rec.t || rec.t.length < 60) return { ok: false, s: null, amp: 0, R: 0, hr: 0, n: 0, cov: 0, sqi: 0, reason: 'short', secs: rec ? rec.seconds : 0, at: Date.now() };
    var a = analyze(rec, { pace: bpm, spectral: true, curve: false });
    var ok = !!a.ok && a.testScore !== null && a.testScore !== undefined;
    return { ok: ok, s: ok ? a.testScore : null, amp: a.ampMs || 0, R: a.R || 0, hr: a.hr || 0, n: a.nValid, cov: a.coverage, sqi: a.sqi, fin: a.finger, reason: a.reason || 'error', secs: rec.seconds, at: Date.now() };
  }
  function savePalier(n, res) {
    store.update(ST.who, function (p) {
      var now = Date.now();
      if (!M.partialInfo(p, now).valid) p.partial = { scores: [null, null, null, null, null], savedAt: now, log: [] };
      p.partial.scores[n - 1] = res.ok ? { s: res.s, amp: r1(res.amp), R: r2(res.R), hr: r1(res.hr), n: res.n, at: res.at } : null;
      p.partial.savedAt = now;
      p.partial.log = (p.partial.log || []).concat([{ n: n, ok: res.ok, reason: res.reason, cov: r2(res.cov || 0), sqi: r2(res.sqi || 0), fin: r2(res.fin || 0), secs: Math.round(res.secs || 0), at: res.at }]).slice(-20);
    });
  }
  function finishPalier() {
    var n = ST.palier, bpm = A.RHYTHMS[n - 1], rec = PU.stopRecording();
    jobs.push(defer(function () { return scoreWindow(rec, bpm); }).then(function (res) { savePalier(n, res); return res; }));
    var sc = partial().scores, nx = 0, i;
    for (i = n; i < 5; i++) if (sc[i] === null) { nx = i + 1; break; }              // the next rhythm still to do (a rhythm already scored is not run again)
    if (nx) { ST.nextPalier = nx; nav.go('test-pause', 'swap'); }
    else nav.go('test-calcul', 'swap');
  }

  nav.onEnter('test-intro', function () { P.testIntro(); });
  nav.onEnter('test-palier', function (prev) {
    var resume = prev === 'test-arreter', n = ST.palier, flags = doneFlags(), lastFlags = Date.now();
    P.testPalier(0);
    if (resume) PU.resumeRecording(); else PU.startRecording('p' + n);
    G.awake.on(); if (PU.state !== 'live' && PU.state !== 'opening') ensureCamera('test-palier');
    G.start({ screen: 'test-palier', kind: 'equal', bpm: A.RHYTHMS[n - 1], seconds: PALIER_S, resume: resume, done: finishPalier,
      prog: function (f) { if (Date.now() - lastFlags > 1000) { flags = doneFlags(); lastFlags = Date.now(); } paint.paintSegs('test-palier', flags, n - 1, f); } });
  });
  nav.onLeave('test-palier', function (next) { if (next === 'test-arreter') PU.pauseRecording(); });
  nav.onEnter('test-pause', function (prev) {
    P.testPause();
    G.start({ screen: 'test-pause', kind: 'rest', seconds: PAUSE_S, resume: prev === 'test-arreter', done: function () { DO.paceNext(); nav.go('test-palier', 'swap'); } });
  });
  nav.onEnter('test-arreter', function () { P.testArreter(); });
  nav.onEnter('test-calcul', function () {
    endReading();
    var t0 = Date.now();
    Promise.all(jobs.splice(0)).then(function () {
      nav.later(function () {
        var pi = partial();
        if (!pi.complete) { ST.failFrom = 'test-doigt'; nav.go('signal-faible', 'swap'); return; }          // some rhythm could not be read: go back for it
        var w = A.winnerOf(pi.scores);
        ST.pending = { rhythm: A.RHYTHMS[w], scores: pi.scores.slice(), detail: pi.raw.slice(), at: Date.now() };
        nav.go('test-resultat', 'swap');
      }, Math.max(0, 2400 - (Date.now() - t0)));
    });
  });
  nav.onEnter('test-resultat', function () { P.testResultat(); });
  nav.onEnter('test-remplacer', function () { P.testRemplacer(); });
  nav.onEnter('rythme', function (prev) {
    var pd = prev === 'test-resultat' && ST.pending ? ST.pending : null;
    P.rythme(pd ? { value: pd.rhythm, scores: pd.scores, date: M.dayKey(pd.at) } : null);
  });

  function commitTest() {
    var pd = ST.pending; if (!pd) return;
    store.update(ST.who, function (p) {
      if (p.rhythm) p.history.push(Object.assign({}, p.rhythm, { replacedAt: Date.now() }));
      p.rhythm = { value: pd.rhythm, scores: pd.scores.slice(), at: pd.at, date: M.dayKey(pd.at), detail: pd.detail };
      p.partial = null;
    });
    ST.pending = null; ST.redoing = false;
  }
  DO.useRhythm = function () {
    if (!ST.pending) return;
    if (ST.redoing && rhythm() != null && ST.pending.rhythm !== rhythm()) return;         // a different rhythm from the one in use: ask first (test-remplacer)
    commitTest();
  };
  DO.replaceUse = function () { commitTest(); };
  DO.replaceKeep = function () { store.update(ST.who, function (p) { p.partial = null; }); ST.pending = null; ST.redoing = false; };

  /* ───────────── the three sessions ───────────── */
  DO.kind = function (k) { ST.kind = k; ST.noRead = false; };
  DO.noread = function () { ST.noRead = true; };
  DO.sessionStop = function () { abortSession(); };

  function newSession(reading) { return { kind: ST.kind, startedAt: Date.now(), reading: reading, restRec: null }; }
  function abortSession() {
    if (PU.state !== 'closed' || PU.recordingSeconds() > 0) { PU.stopRecording(); endReading(); }
    G.awake.off(); G.forget('seance'); G.forget('seance-repos'); ST.session = null; ST.noRead = false;
  }

  nav.onEnter('seance-prete', function () { P.seancePrete(); });
  nav.onEnter('seance-repos', function (prev) {
    var resume = (prev === 'seance-pause' || prev === 'seance-arreter') && !!ST.session;
    if (!resume) { ST.session = newSession(true); PU.startRecording('rest'); } else PU.resumeRecording();
    G.awake.on(); if (PU.state !== 'live' && PU.state !== 'opening') ensureCamera('seance-repos');
    startWave('seance-repos');
    G.start({ screen: 'seance-repos', kind: 'rest', seconds: REST_S, resume: resume, done: function () { ST.session.restRec = PU.stopRecording(); nav.go('seance', 'swap'); } });
  });
  nav.onLeave('seance-repos', function (next) { if (next === 'seance-pause' || next === 'seance-arreter') PU.pauseRecording(); });
  nav.onEnter('seance', function (prev) {
    var resume = (prev === 'seance-pause' || prev === 'seance-arreter') && !!ST.session;
    if (!resume && prev !== 'seance-repos') ST.session = newSession(false);
    P.seance();
    if (ST.session.reading) { if (resume) PU.resumeRecording(); else PU.startRecording('coh'); if (PU.state !== 'live' && PU.state !== 'opening') ensureCamera('seance'); }
    G.awake.on();
    G.start({ screen: 'seance', kind: 'equal', bpm: rhythm() || 6, seconds: COH_S, resume: resume, done: finishSession });
  });
  nav.onLeave('seance', function (next) { if (next === 'seance-pause' || next === 'seance-arreter') PU.pauseRecording(); });
  nav.onEnter('seance-pause', function (prev) {
    if (prev === 'seance' || prev === 'seance-repos') ST.resumeTo = prev;
    paint.bind('seance-pause', 'pauseWhy', ST.pauseWhy === 'phone' ? 'The phone paused this session.' : 'You paused.');
    ST.pauseWhy = 'user';
    nav.later(function () { if (nav.current === 'seance-pause' && PU.state !== 'closed') PU.close(); }, 180000);          // a long pause lets the camera go
  });
  nav.onEnter('seance-arreter', function (prev) { if (prev === 'seance' || prev === 'seance-repos') ST.resumeTo = prev; });      // "Keep going" returns to where the sheet was opened (from the pause screen: to where the pause began)

  /* the curve of the heart across a reading, without the time the reading was paused */
  function squeeze(curve, rec) {
    if (!curve) return [];
    var segs = rec.segs && rec.segs.length ? rec.segs : null, t0 = segs ? segs[0][0] : rec.t[0], out = [];
    for (var i = 0; i < curve.length; i++) {
      var t = t0 + 1 + i * 2;                                                                   // hrCurve puts its first point one second in
      if (!segs || segs.some(function (s) { return t >= s[0] - 1 && t <= s[1] + 1; })) out.push(curve[i]);
    }
    return out;
  }
  function quality(a) { return a ? { ok: !!a.ok, reason: a.reason, cov: r2(a.coverage || 0), sqi: r2(a.sqi || 0), fin: r2(a.finger != null ? a.finger : 0), n: a.nValid || 0, R: a.R != null ? r2(a.R) : null, amp: a.ampMs != null ? r1(a.ampMs) : null, hr: a.hr ? r1(a.hr) : null } : null; }
  function buildSession(S, cohRec) {
    var bpm = rhythm() || 6;
    var out = { id: store.newId(), ts: S.startedAt, day: M.dayKey(S.startedAt), kind: S.kind, secs: COH_S, rhythm: bpm, rest: null, hrv: null, coh: null, curve: null, curveAt: 0, q: null };
    if (!S.reading) return out;
    var rr = S.restRec, restA = rr && rr.t.length > 60 ? analyze(rr, { curve: true }) : null;
    var cohA = cohRec && cohRec.t.length > 60 ? analyze(cohRec, { pace: bpm, spectral: true, curve: true }) : null;
    if (restA && restA.ok) { out.rest = r1(restA.hr); out.hrv = restA.rmssd != null ? r1(restA.rmssd) : null; }
    if (cohA && cohA.ok && cohA.cohNote != null) out.coh = cohA.cohNote;
    var c1 = restA && restA.ok ? squeeze(restA.curve, rr) : [], c2 = cohA && cohA.ok ? squeeze(cohA.curve, cohRec) : [];
    if (c1.length + c2.length > 3) { out.curve = c1.concat(c2); out.curveAt = c1.length; }
    out.q = { rest: quality(restA), coh: quality(cohA) };
    return out;
  }
  function finishSession() {
    var S = ST.session; if (!S) return;
    var rec = S.reading ? PU.stopRecording() : null;
    endReading();
    defer(function () { return buildSession(S, rec); }).then(function (record) {
      if (record.error) record = { id: store.newId(), ts: S.startedAt, day: M.dayKey(S.startedAt), kind: S.kind, secs: COH_S, rhythm: rhythm() || 6, rest: null, hrv: null, coh: null, curve: null, curveAt: 0, q: { error: record.error } };
      store.update(ST.who, function (p) { p.sessions.push(record); });
      ST.lastSession = record; ST.session = null; ST.noRead = false;
      nav.go(record.kind === 'morning' ? (record.coh != null ? 'fin-matin' : 'fin-sans-note') : 'fin-seance', 'swap');
    });
  }
  nav.onEnter('fin-matin', function () { P.finMatin(); });
  nav.onEnter('fin-sans-note', function () { P.finSansNote(); });
  nav.onEnter('fin-seance', function () {
    P.finSeance();
    var fr = $('.fillring', sec('fin-seance')); if (!fr) return;
    fr.style.setProperty('--f', '0');
    var t0 = Date.now();
    (function step() { var u = Math.min(1, (Date.now() - t0) / 900); fr.style.setProperty('--f', String((1 - Math.cos(Math.PI * u)) / 2)); if (u < 1 && nav.current === 'fin-seance') requestAnimationFrame(step); })();
  });
  ['camera-refusee', 'signal-faible', 'flash-indispo'].forEach(function (id) {
    nav.onEnter(id, function () { paint.bind(id, 'leaveLbl', /^seance/.test(ST.failFrom) ? 'Back to Home' : 'Leave the test'); });
  });

  /* ───────────── the sighs ───────────── */
  DO.sosStart = function () { ST.sighs = 1; ST.sosRec = null; };
  DO.sosMore = function () { ST.sighs = Math.min(3, ST.sighs + 1); };
  nav.onEnter('sos', function () {
    P.sos();
    G.start({ screen: 'sos', kind: 'sigh', seconds: 10, done: function () { nav.go('sos-encore', 'swap'); } });
  });
  nav.onEnter('sos-encore', function (prev) {
    if (prev === 'sos') {                                                                        // a sigh finished: it counts, however few there are
      if (!ST.sosRec) { ST.sosRec = { id: store.newId(), ts: Date.now(), day: M.dayKey(Date.now()), n: ST.sighs }; var rec = ST.sosRec; store.update(ST.who, function (p) { p.sos.push(rec); }); }
      else store.update(ST.who, function () { ST.sosRec.n = ST.sighs; });
    }
    P.sosEncore();
  });
  nav.onEnter('sos-fin', function () { P.sosFin(); });

  DO.cycStart = function () { G.forget('cyclique'); };
  DO.cycStop = function () { G.forget('cyclique'); };
  nav.onEnter('cyclique', function (prev) {
    G.awake.on();
    G.start({ screen: 'cyclique', kind: 'sigh', seconds: CYC_S, resume: prev === 'cyclique-arreter', done: function () {
      var at = Date.now(); store.update(ST.who, function (p) { p.cyc.push({ id: store.newId(), ts: at, day: M.dayKey(at), secs: CYC_S }); });
      nav.go('cyclique-fin', 'swap');
    } });
  });

  /* ───────────── progress, one day ───────────── */
  DO.day = function (a) { ST.day = a === 'today' ? M.today() : a; };
  DO.calStep = function (a) { ST.month = M.monthStep(ST.month || M.monthOf(M.today()), +a); P.calendar(); return false; };
  nav.onEnter('accueil', function () { P.accueil(); });
  nav.onEnter('progres', function () { ST.month = M.monthOf(M.today()); P.progres(); });
  nav.onEnter('jour', function () { P.jour(); });

  /* ───────────── settings ───────────── */
  DO.mute = function () { var m = !meta().mute; store.setMeta({ mute: m }); G.config({ mute: m }); paint.paintSound(); };
  DO.sound = function (a) { store.setMeta({ sound: a }); G.config({ sound: a }); P.reglagesSon(); };
  DO.listen = function (a) { G.audio.preview(a || meta().sound); };
  DO.blink = function () { store.setMeta({ blink: !meta().blink }); paint.paintBlink(); };
  DO.ringToggle = function () { var r = meta().ring === 'a' ? 'b' : 'a'; store.setMeta({ ring: r }); G.config({ ring: r }); P.reglages(); return false; };
  doc.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-vol')) G.config({ vol: (+t.value) / 100 });
  }, true);
  doc.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-vol')) store.setMeta({ vol: (+t.value) / 100 });
  }, true);
  nav.onEnter('reglages', function () { P.reglages(); });
  nav.onEnter('reglages-son', function () { P.reglagesSon(); });

  /* ───────────── the code screens ───────────── */
  ['code', 'code-faux'].forEach(function (id) {
    nav.onEnter(id, function () { ST.buf = ''; paint.paintDots(id); paint.paintBlink(); if (id === 'code-faux') shake(id); });
  });

  /* ───────────── every screen ───────────── */
  nav.onEnter('*', function () { paint.paintSound(); });
  nav.onLeave('*', function (next) {
    G.stop(true); stopWave();
    if (KEEP_AWAKE.indexOf(next) < 0) G.awake.off();
    if (KEEP_CAM.indexOf(next) < 0 && PU.state !== 'closed') PU.close();
  });

  /* a phone that locks, a call that comes: the session pauses; the test remembers what it has scored and starts the rhythm again */
  var hiddenAt = null;
  doc.addEventListener('visibilitychange', function () {
    var id = nav.current;
    if (doc.hidden) {
      if (G.state().on && ['seance', 'seance-repos', 'test-palier', 'test-pause'].indexOf(id) >= 0) { hiddenAt = id; G.stop(true); PU.pauseRecording(); stopWave(); }
    } else if (hiddenAt) {
      var h = hiddenAt; hiddenAt = null;
      if (h === 'seance' || h === 'seance-repos') { ST.pauseWhy = 'phone'; nav.go('seance-pause', 'swap'); }
      else { abortTestWindow(); nav.go('test-intro', 'swap'); }
    } else if (nav.current === 'accueil') P.accueil();
  });

  function safeToReload() { return ['code', 'qui', 'accueil', 'progres', 'jour', 'rythme', 'reglages', 'reglages-son', 'chargement'].indexOf(nav.current) >= 0; }

  COH.flows = { resetVisit: resetVisit, loadDest: loadDest, scoreWindow: scoreWindow, buildSession: buildSession, squeeze: squeeze, safeToReload: safeToReload, sha256: sha256, GATE: GATE, WAIT_MS: WAIT_MS };
})(typeof self !== 'undefined' ? self : this);
