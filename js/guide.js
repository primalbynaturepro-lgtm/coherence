/* guide.js — the breath, the ring, the sound, the screen that stays awake.
 *
 * One clock drives everything a person sees or hears while breathing: a phase p (0 = lungs empty, 1 = full).
 * The ring is drawn from p (ring B, live) or plays a Blender loop kept in step with it (ring A); the sound rises and
 * falls with p; the words "In" / "Out" and the clock follow. Nothing here knows about the pulse — the camera is another
 * module, and it never slows this one down.
 *
 *   COH.guide.start({ screen, kind, bpm, seconds, resume, done, prog, silent })
 *        kind: 'equal' (in as long as out, at bpm breaths a minute) · 'sigh' (the physiological sigh, a 10 s cycle) ·
 *              'rest' (no ring, no sound: just the clock)
 *   COH.guide.stop(save)   stops; with save, the place is kept so the same screen can resume it
 *   COH.guide.audio        unlock · preview · volume · begin · set · end
 *   COH.guide.awake        on · off  (the screen stays lit: Wake Lock, and a tiny looping video where Wake Lock lies)
 */
(function (root) {
  'use strict';
  var COH = root.COH = root.COH || {};
  var doc = root.document;

  function $(sel, r) { return (r || doc).querySelector(sel); }
  function $$(sel, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(sel)); }
  function sec(id) { return doc.getElementById('s-' + id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + pad2(s % 60); }
  function ease(u) { u = Math.max(0, Math.min(1, u)); return (1 - Math.cos(Math.PI * u)) / 2; }

  var cfg = { sound: 'bowl', vol: 0.7, mute: false, ring: 'b' };

  /* ───────────── the two curves ───────────── */
  function pEqual(t, T) { return (1 - Math.cos(2 * Math.PI * t / T)) / 2; }
  function pSigh(t) {                                        // 10 s: a big breath in, a short one on top, a long breath out
    t = t % 10;
    if (t < 2.0) return 0.70 * ease(t / 2.0);
    if (t < 2.3) return 0.70;
    if (t < 3.3) return 0.70 + 0.30 * ease((t - 2.3) / 1.0);
    if (t < 3.6) return 1.0;
    return 1.0 - ease((t - 3.6) / 6.4);
  }

  /* ───────────── ring A: the Blender loops ───────────── */
  function videoSrc(loop) { return '/assets/rings/ring-' + loop + '.mp4'; }
  function wantsA(r) { var s = r.getAttribute('data-show'); return s ? s === 'a' : cfg.ring === 'a'; }
  function ensureVideo(r) {
    var loop = r.getAttribute('data-loop'), slot = $('.rA', r);
    if (!slot) return null;
    var v = r._v;
    if (!v || v._loop !== loop) {
      slot.innerHTML = '';
      v = doc.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.setAttribute('aria-hidden', 'true');
      v.src = videoSrc(loop); v._loop = loop; slot.appendChild(v); r._v = v;
    }
    return v;
  }

  /* ───────────── the engine ───────────── */
  var BR = { on: false }, SAVED = {}, raf = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : function (f) { return setTimeout(function () { f(perf()); }, 16); };
  function perf() { return (root.performance && performance.now()) || Date.now(); }

  function start(o) {
    stop(false);
    var s = sec(o.screen), resumed = !!(o.resume && SAVED[o.screen]);
    BR = { on: true, screen: o.screen, kind: o.kind, bpm: o.bpm || 6, t: 0, remain: o.seconds == null ? Infinity : o.seconds, total: o.seconds == null ? Infinity : o.seconds,
           rings: s ? $$('.ring', s) : [], cue: s ? $$('[data-bind="cue"]', s) : [], cap: s ? $$('[data-bind="cap"]', s) : [], clock: s ? $$('[data-bind="clock"]', s) : [],
           done: o.done || null, prog: o.prog || null, ph: '', sec: -1, sync: 0, last: perf(), raf: 0, p: 0, frame: o.frame || null };
    if (resumed) { BR.t = SAVED[o.screen].t; BR.remain = SAVED[o.screen].remain; } else delete SAVED[o.screen];
    var T = 60 / BR.bpm;
    BR.rings.forEach(function (r) {
      var v = wantsA(r) ? ensureVideo(r) : null;
      r.classList.toggle('fb', wantsA(r) && !v);
      if (v && !v._fbwired) { v._fbwired = true; v.addEventListener('error', function () { r.classList.add('fb'); }); }
      if (v) {
        var rate = BR.kind === 'equal' ? 10 / T : 1;
        var go = function () { try { v.playbackRate = rate; } catch (e) { /* fine */ } try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* fine */ } };
        go(); v.addEventListener('loadedmetadata', go, { once: true });
      }
    });
    AU.begin(BR.kind === 'rest' || o.silent ? null : BR.kind);
    paintClock(true);
    BR.raf = raf(frame);
    return BR;
  }

  function paintClock(force) {
    if (!isFinite(BR.remain)) return;
    var sc = Math.ceil(Math.max(0, BR.remain));
    if (force || sc !== BR.sec) { BR.sec = sc; BR.clock.forEach(function (e) { e.textContent = mmss(sc); }); }
  }

  function frame(now) {
    if (!BR.on) return;
    var dt = Math.max(0, Math.min(1, (now - BR.last) / 1000)); BR.last = now;
    BR.t += dt; BR.remain -= dt;
    var T = 60 / BR.bpm, p = 0;
    if (BR.kind === 'equal') p = pEqual(BR.t, T); else if (BR.kind === 'sigh') p = pSigh(BR.t);
    BR.p = p;
    var cyc = BR.kind === 'equal' ? BR.t % T : BR.t % 10;
    BR.rings.forEach(function (r) {
      r.style.setProperty('--p', p.toFixed(4));
      var v = r._v;
      if (v && wantsA(r) && now - BR.sync > 400 && v.readyState > 1) {                     // keep the loop in step with the breath
        var want = BR.kind === 'equal' ? (BR.t / T % 1) * 10 : (BR.t % 10), diff = Math.abs(v.currentTime - want);
        if (diff > 0.25 && diff < 9.75) { try { v.currentTime = want; } catch (e) { /* fine */ } }
      }
    });
    if (now - BR.sync > 400) BR.sync = now;
    var ph = '', capTxt = '';
    if (BR.kind === 'equal') ph = cyc < T / 2 ? 'In' : 'Out';
    else if (BR.kind === 'sigh') { ph = cyc < 2.15 ? 'In' : (cyc < 3.45 ? 'In again' : 'Out'); capTxt = cyc < 2.15 ? 'Breathe in through your nose' : (cyc < 3.45 ? 'A second short breath in' : 'Long breath out through your mouth'); }
    if (ph !== BR.ph) { BR.ph = ph; BR.cue.forEach(function (e) { e.textContent = ph; }); BR.cap.forEach(function (e) { e.textContent = capTxt; }); }
    paintClock(false);
    if (BR.prog && isFinite(BR.total)) BR.prog(1 - Math.max(0, BR.remain) / BR.total);
    if (BR.frame) BR.frame(p, BR);
    AU.set(p);
    if (BR.remain <= 0) {
      var cb = BR.done, sc2 = BR.screen; stop(false); delete SAVED[sc2];
      if (cb) cb();
      return;
    }
    BR.raf = raf(frame);
  }

  function stop(save) {
    if (!BR.on) return;
    if (root.cancelAnimationFrame) cancelAnimationFrame(BR.raf);
    if (save && isFinite(BR.remain)) SAVED[BR.screen] = { t: BR.t, remain: BR.remain };
    BR.rings.forEach(function (r) { if (r._v) { try { r._v.pause(); } catch (e) { /* fine */ } } });
    BR.on = false; AU.end();
  }
  function forget(screen) { if (screen) delete SAVED[screen]; else SAVED = {}; }
  function saved(screen) { return SAVED[screen] || null; }

  /* ───────────── the sound: a note, a bowl or a breath — rising on the in-breath, falling on the out-breath ───────────── */
  var AU = { ctx: null, master: null, n: null, keep: null };
  AU.unlock = function () {
    try {
      if (!AU.ctx) {
        var C = root.AudioContext || root.webkitAudioContext; if (!C) return;
        AU.ctx = new C(); AU.master = AU.ctx.createGain(); AU.master.gain.value = cfg.mute ? 0 : cfg.vol; AU.master.connect(AU.ctx.destination);
      }
      AU.session();
      if (AU.ctx.state !== 'running') { var pr = AU.ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); }
    } catch (e) { AU.ctx = null; }
  };
  /* iOS: the side switch silences a web page unless the page says it is "playback" (a guide, like music) */
  AU.session = function () {
    try { if (root.navigator && navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS */ }
  };
  AU.hold = function (on) {                                         // older iOS: a silent loop keeps the "playback" category while we breathe
    if (root.navigator && navigator.audioSession) return;
    try {
      if (on) {
        if (!AU.keep) {
          var bytes = new Uint8Array(44 + 1600), dv = new DataView(bytes.buffer), w = function (o, s) { for (var i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
          w(0, 'RIFF'); dv.setUint32(4, 36 + 1600, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
          dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, 1600, true);
          for (var i = 0; i < 1600; i++) bytes[44 + i] = 128;
          AU.keep = new root.Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))); AU.keep.loop = true; AU.keep.setAttribute('playsinline', '');
        }
        var p = AU.keep.play(); if (p && p.catch) p.catch(function () {});
      } else if (AU.keep) AU.keep.pause();
    } catch (e) { /* no audio element: fine */ }
  };
  AU.volume = function () { if (AU.ctx && AU.master) AU.master.gain.setTargetAtTime(cfg.mute ? 0 : cfg.vol, AU.ctx.currentTime, 0.03); };
  AU.begin = function (kind, snd) {
    AU.end();
    if (!kind || !AU.ctx) return;
    try {
      AU.session(); AU.hold(true);
      var c = AU.ctx, g = c.createGain(); g.gain.value = 0; g.connect(AU.master);
      var n = { type: snd || cfg.sound, g: g, osc: [], nodes: [g] };
      if (n.type === 'note') {
        var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 196; o.connect(g); o.start(); n.osc.push([o, 1]);
      } else if (n.type === 'bowl') {
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(g); n.nodes.push(lp);
        [[1, 1], [2.756, 0.35], [5.404, 0.12], [1.004, 0.8]].forEach(function (pr) {
          var o2 = c.createOscillator(), pg = c.createGain(); o2.type = 'sine'; o2.frequency.value = 220 * pr[0]; pg.gain.value = pr[1] * 0.5;
          o2.connect(pg); pg.connect(lp); o2.start(); n.osc.push([o2, pr[0]]); n.nodes.push(pg);
        });
      } else {
        var len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
        var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.value = 500;
        src.connect(bp); bp.connect(g); src.start(); n.src = src; n.bp = bp; n.nodes.push(bp);
      }
      AU.n = n;
    } catch (e) { AU.n = null; }
  };
  AU.set = function (p) {
    var n = AU.n; if (!n || !AU.ctx) return;
    var t = AU.ctx.currentTime;
    try {
      if (n.type === 'note') { n.osc[0][0].frequency.setTargetAtTime(196 * Math.pow(2, p * 7 / 12), t, 0.05); n.g.gain.setTargetAtTime(0.2, t, 0.15); }
      else if (n.type === 'bowl') { var base = 220 * Math.pow(2, p * 5 / 12); n.osc.forEach(function (o) { o[0].frequency.setTargetAtTime(base * o[1], t, 0.05); }); n.g.gain.setTargetAtTime(0.10 + 0.14 * p, t, 0.12); }
      else { n.bp.frequency.setTargetAtTime(500 * Math.pow(2, p * 1.8), t, 0.05); n.g.gain.setTargetAtTime(0.05 + 0.30 * p, t, 0.08); }
    } catch (e) { /* the sound is a guest: it never stops the breath */ }
  };
  AU.end = function () {
    var n = AU.n; AU.n = null;
    if (!n || !AU.ctx) { if (!BR.on || BR.kind === 'rest') AU.hold(false); return; }
    try {
      var t = AU.ctx.currentTime; n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0, t, 0.06);
      setTimeout(function () {
        n.osc.forEach(function (o) { try { o[0].stop(); } catch (e) { /* fine */ } });
        if (n.src) { try { n.src.stop(); } catch (e) { /* fine */ } }
        n.nodes.forEach(function (x) { try { x.disconnect(); } catch (e) { /* fine */ } });
        if (!AU.n) AU.hold(false);
      }, 350);
    } catch (e) { /* fine */ }
  };
  var prevRun = 0;
  AU.preview = function (name) {                                    // four seconds of one breath, to choose by ear
    AU.unlock();
    if (BR.on) return;
    AU.begin('equal', name);
    var t0 = perf(); prevRun++; var mine = prevRun;
    (function tick(now) {
      if (mine !== prevRun) return;
      var t = (now - t0) / 1000; AU.set(pEqual(t, 4));
      if (t < 4.2) raf(tick); else AU.end();
    })(t0);
  };

  /* ───────────── the screen stays lit ───────────── */
  var NOSLEEP = 'data:video/mp4;base64,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';
  /* The lock: the Wake Lock API where the phone has one, and, as well, a two-second silent film played the way NoSleep.js plays it — the one way
     iOS is known to keep a screen lit when the lock is missing or ignored. What matters, and cost a review to learn: the film must not carry the
     `muted` or `loop` attribute (iOS lets the screen sleep under such a film); it is kept going by jumping back whenever it passes half a second;
     and the phone only lets it start from a touch, so the first touch of the page "primes" it (starts it, and stops it again unless a lock is wanted). */
  var AW = { want: false, lock: null, video: null, primed: false, priming: false, err: null };
  function awVideo() {
    if (AW.video) return AW.video;
    var v = doc.createElement('video');
    v.className = 'camvideo'; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('title', 'No Sleep'); v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
    v.addEventListener('timeupdate', function () { if (v.currentTime > 0.5) { try { v.currentTime = Math.random(); } catch (e) { /* fine */ } } });
    v.addEventListener('ended', function () { if (AW.want) { try { v.currentTime = 0; var q = v.play(); if (q && q.catch) q.catch(function () {}); } catch (e) { /* fine */ } } });
    v.src = NOSLEEP; doc.body.appendChild(v); AW.video = v;
    return v;
  }
  AW.prime = function () {
    if (AW.primed || AW.priming) return;
    AW.priming = true;
    try {
      var v = awVideo(), p = v.play();
      var done = function (ok) { AW.priming = false; if (ok) AW.primed = true; if (!AW.want) { try { v.pause(); } catch (e) { /* fine */ } } };
      if (p && p.then) p.then(function () { done(true); }, function (e) { AW.priming = false; if (!e || e.name !== 'AbortError') AW.err = 'prime:' + (e && e.name); });     // (not primed: the next touch tries again)
      else done(true);
    } catch (e) { AW.priming = false; }
  };
  AW.on = function () {
    AW.want = true;
    try {
      var wl = root.navigator && navigator.wakeLock;
      if (wl && wl.request && !AW.lock) wl.request('screen').then(function (l) { AW.lock = l; AW.err = null; l.addEventListener('release', function () { if (AW.lock === l) AW.lock = null; }); }, function (e) { AW.err = 'lock:' + (e && e.name); /* the film below covers it */ });
    } catch (e) { /* fine */ }
    try {                                                            // belt and braces: on some iPhones the lock is granted and ignored
      var p = awVideo().play(); if (p && p.catch) p.catch(function (e) { if (!e || e.name !== 'AbortError') AW.err = 'film:' + (e && e.name); });
    } catch (e) { /* fine */ }
  };
  AW.off = function () {
    AW.want = false;
    try { if (AW.lock) { var l = AW.lock; AW.lock = null; l.release(); } } catch (e) { /* fine */ }
    try { if (AW.video && !AW.priming) AW.video.pause(); } catch (e) { /* fine */ }          // (a film that is being primed stops itself when it has started)
  };
  AW.info = function () { return { api: !!(root.navigator && navigator.wakeLock), lock: !!AW.lock, err: AW.err, film: !!AW.video, filmPlaying: !!(AW.video && !AW.video.paused), primed: AW.primed, want: AW.want }; };
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden && AW.want) AW.on(); });     // a lock is let go when the page is hidden: take it again

  /* the first touch of the page unlocks sound and primes the film that keeps the screen lit (iOS only counts a finished tap, not the start of one) */
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(function (ev) { doc.addEventListener(ev, function () { AU.unlock(); AW.prime(); }, { capture: true, passive: true }); });

  COH.guide = {
    config: function (o) {
      Object.keys(o || {}).forEach(function (k) { if (k in cfg) cfg[k] = o[k]; });
      var app = $('.app'); if (app) app.setAttribute('data-ring', cfg.ring);
      AU.volume();
    },
    get cfg() { return cfg; },
    start: start, stop: stop, forget: forget, saved: saved,
    state: function () { return { on: BR.on, screen: BR.screen, kind: BR.kind, bpm: BR.bpm, t: BR.t, remain: BR.remain, p: BR.p }; },
    curves: { pEqual: pEqual, pSigh: pSigh },
    audio: AU, awake: AW
  };
})(typeof self !== 'undefined' ? self : this);
