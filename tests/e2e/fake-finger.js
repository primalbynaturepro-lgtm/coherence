/* fake-finger.js — a fingertip on a camera, for the browser tests. Injected before the app: window.COH_TEST.source is what
 * pulse.js reads instead of the camera. The heart is a small model: beats one after the other, each interval =
 * mean + a wave at the breathing frequency (sinus arrhythmia, biggest near a resonance) + scatter; every beat draws a pulse.
 * The person breathes with the guide (COH.guide.state()), so the test of five rhythms has something to find.
 *
 *   COH_TEST.finger.cfg     hr, peakMs (arrhythmia at resonance), f0, Q, scatter, noise, mode
 *   COH_TEST.finger.cfg.mode   'finger' · 'none' (no finger on the lens) · 'dark' (a finger in the dark: the flash is not lighting)
 */
(function () {
  function rng(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { var u = 0; while (u === 0) u = r(); var v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  var PULSE_W = 1.5;
  function pulse(tau) {
    if (tau < 0 || tau > 1.0) return 0;
    var w = PULSE_W, sys = Math.exp(-Math.pow((tau - 0.10 - 0.03 * w) / (0.055 * w), 2)), dic = 0.38 * Math.exp(-Math.pow((tau - 0.30 - 0.08 * w) / (0.09 * w), 2));
    return sys + dic;
  }
  function rsaResponse(f, peak, f0, Q) { return peak / Math.sqrt(1 + Q * Q * Math.pow(f / f0 - f0 / f, 2)); }

  var cfg = { hr: 64, peakMs: 45, f0: 5.5 / 60, Q: 3, scatter: 12, noise: 0.35, mode: 'finger', seed: 11, restPeakMs: 14, fps: 30, dcR: 190, dcG: 45, acR: 2.4, acG: 0.9, pol: -1, driftAmp: 4 };
  var st = { timer: 0, push: null, rnd: null, last: 0, theta: 0, beatT: -1, nextT: 0, ou: 0, ou2: 0, frames: 0 };

  function breath() {                                        // what the person is doing with their breath right now: [frequency Hz, arrhythmia ms]
    var g = window.COH && COH.guide && COH.guide.state && COH.guide.state();
    if (g && g.on && g.kind === 'equal') { var f = g.bpm / 60; return [f, rsaResponse(f, cfg.peakMs, cfg.f0, cfg.Q)]; }
    if (g && g.on && g.kind === 'sigh') return [0.1, 8];
    return [0.25, cfg.restPeakMs];                            // breathing normally
  }
  function tick() {
    var t = performance.now() / 1000, dt = st.last ? t - st.last : 1 / cfg.fps; st.last = t;
    var b = breath(), r = st.rnd;
    st.theta += 2 * Math.PI * b[0] * dt;
    if (st.beatT < 0) { st.beatT = t; st.nextT = t + 0.8; }
    while (t >= st.nextT) { st.beatT = st.nextT; var nn = 60000 / cfg.hr + b[1] * Math.sin(st.theta) + cfg.scatter * gauss(r); st.nextT = st.beatT + Math.max(0.4, nn) / 1000; }
    st.ou = 0.995 * st.ou + 0.09 * gauss(r); st.ou2 = 0.9995 * st.ou2 + 0.02 * gauss(r);
    var base = cfg.driftAmp * (0.6 * st.ou + 0.8 * st.ou2 + 0.4 * Math.sin(2 * Math.PI * 0.23 * t)), rv, gv, bv;
    if (cfg.mode === 'none') { rv = 120 + 2 * gauss(r); gv = 118 + 2 * gauss(r); bv = 110 + 2 * gauss(r); }
    else if (cfg.mode === 'dark') { rv = 40 + 0.4 * gauss(r); gv = 8 + 0.3 * gauss(r); bv = 6; }
    else { var p = pulse(t - st.beatT); rv = cfg.dcR + base + cfg.pol * cfg.acR * p + cfg.noise * gauss(r); gv = cfg.dcG + 0.35 * base + cfg.pol * cfg.acG * p + cfg.noise * 0.6 * gauss(r); bv = 20; }
    st.frames++;
    st.push(t * 1000, Math.max(0, Math.min(255, rv)), Math.max(0, Math.min(255, gv)), Math.max(0, Math.min(255, bv)));
  }
  var source = {
    start: function (push) { st.push = push; st.rnd = rng(cfg.seed); st.last = 0; st.beatT = -1; st.theta = 0; st.timer = setInterval(tick, 1000 / cfg.fps); },
    stop: function () { clearInterval(st.timer); st.timer = 0; }
  };
  window.COH_TEST = window.COH_TEST || {};
  window.COH_TEST.source = source;
  window.COH_TEST.finger = { cfg: cfg, st: st, running: function () { return !!st.timer; } };
})();
