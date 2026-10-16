/* synth.js — a fake fingertip, for the tests.
 *
 * Builds what the camera would have seen: the mean red and green of each frame, with the time of the frame.
 * The heart is a real (if simple) model: beats come one after the other, each interval is
 *     mean interval  +  a wave at the breathing frequency (the sinus arrhythmia)  +  a little random scatter,
 * and every beat draws a pulse (a fast systolic wave and a small dicrotic bump). On top of that the finger
 * moves slowly (baseline drift), the sensor is noisy, the frames come with jitter, some are dropped.
 *
 * Everything is seeded: the same seed gives the same finger.
 */
'use strict';

function rng(seed) {                                   // mulberry32
  var a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gauss(r) { var u = 0; while (u === 0) u = r(); var v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* the beats of a stretch of time: returns [{t, nn}] where t is the onset of the beat (s) */
function makeBeats(o) {
  var r = rng(o.seed || 1), t = o.t0 !== undefined ? o.t0 : 0, out = [], phi = o.phase !== undefined ? o.phase : r() * 2 * Math.PI;
  var lfPhi = r() * 2 * Math.PI, drift = 0;
  var dur = o.dur, nn0 = 60000 / o.hr;
  while (t < (o.t0 || 0) + dur + 2) {
    drift = 0.98 * drift + 0.02 * (o.driftMs || 0) * gauss(r) * 4;            // slow wander of the mean heart rate
    var rsa = (o.rsaMs || 0) * Math.sin(2 * Math.PI * o.fBreath * t + phi);
    var lf = (o.lfMs || 0) * Math.sin(2 * Math.PI * 0.05 * t + lfPhi);
    var nn = nn0 + rsa + lf + drift + (o.scatterMs || 0) * gauss(r);
    out.push({ t: t, nn: nn });
    t += nn / 1000;
  }
  return out;
}

/* one pulse, as a function of the time since the onset of the beat (s) */
function pulse(tau, w) {
  w = w || PULSE_W;                                    // 1 = sharp fingertip upstroke; larger = smoother (the camera blurs)
  if (tau < 0 || tau > 1.0) return 0;
  var sys = Math.exp(-Math.pow((tau - 0.10 - 0.03 * w) / (0.055 * w), 2));
  var dic = 0.38 * Math.exp(-Math.pow((tau - 0.30 - 0.08 * w) / (0.09 * w), 2));
  return sys + dic;
}
var PULSE_W = 1.5;

/* frames: { t: [...s], r: [...], g: [...] }
   o: beats (from makeBeats) — or a function t -> pulse value —, t0, dur, fps, seed
      acR, acG      the pulse height, in 8-bit units (peak of the pulse)
      dcR, dcG      the mean level
      pol           +1 the signal rises with the beat, -1 it falls
      driftAmp      slow drift of the level (8-bit units)
      noise         sensor noise (8-bit units, per frame)
      jitter        frame time jitter (s, sigma) — the frame really was taken at that time
      tsJitter      error on the reported time (s, sigma) — the frame was taken on the beat, we were told a slightly different time
      drop          probability that a frame is lost
      burst         probability (per frame) that a burst of lost frames starts (0.1–0.25 s)
      lost          [[t0, t1], ...] finger off the camera: no pulse, a different colour, a lot of noise
      motion        [[t0, t1, amp], ...] movement: a big slow slosh
      clip          clip to 0..255 (default true)
*/
function makeFrames(o) {
  var r = rng((o.seed || 1) * 7919 + 13), fps = o.fps || 30, t0 = o.t0 || 0, t = t0, ts = [], R = [], G = [];
  var beats = o.beats || [], bi = 0;
  var pol = o.pol === undefined ? -1 : o.pol;
  var dcR = o.dcR === undefined ? 190 : o.dcR, dcG = o.dcG === undefined ? 45 : o.dcG;
  var acR = o.acR === undefined ? 2.4 : o.acR, acG = o.acG === undefined ? 0.9 : o.acG;
  var driftAmp = o.driftAmp === undefined ? 4 : o.driftAmp, noise = o.noise === undefined ? 0.35 : o.noise;
  var jitter = o.jitter === undefined ? 0.002 : o.jitter, drop = o.drop || 0, burst = o.burst || 0;
  var lost = o.lost || [], motion = o.motion || [], clip = o.clip !== false;
  var ph1 = r() * 6.28, ph2 = r() * 6.28, ph3 = r() * 6.28, dr = 0, dr2 = 0, skipUntil = -1;
  var end = t0 + o.dur;
  while (t < end) {
    var tt = t + (jitter ? jitter * gauss(r) : 0);
    t += 1 / fps;
    if (tt < skipUntil) continue;
    if (drop && r() < drop) continue;
    if (burst && r() < burst) { skipUntil = tt + 0.10 + 0.15 * r(); continue; }
    while (bi < beats.length - 1 && beats[bi + 1].t <= tt) bi++;
    var p = beats.length ? pulse(tt - beats[bi].t, o.pulseW) : 0;
    if (typeof o.wave === 'function') p = o.wave(tt);
    // slow finger movements: an Ornstein-Uhlenbeck drift plus a little "breathing" of the baseline
    dr = 0.995 * dr + 0.09 * gauss(r); dr2 = 0.9995 * dr2 + 0.02 * gauss(r);
    var base = driftAmp * (0.6 * dr + 0.8 * dr2 + 0.4 * Math.sin(2 * Math.PI * 0.23 * tt + ph1) + 0.3 * Math.sin(2 * Math.PI * 0.07 * tt + ph2));
    var lostNow = false, i;
    for (i = 0; i < lost.length; i++) if (tt >= lost[i][0] && tt <= lost[i][1]) lostNow = true;
    var mo = 0;
    for (i = 0; i < motion.length; i++) if (tt >= motion[i][0] && tt <= motion[i][1]) mo += motion[i][2] * Math.sin(2 * Math.PI * 1.3 * tt + ph3) + motion[i][2] * 0.5 * gauss(r);
    var rv, gv;
    if (lostNow) {
      rv = 90 + 10 * gauss(r); gv = 110 + 10 * gauss(r);
    } else {
      rv = dcR + base + mo + pol * acR * p + noise * gauss(r);
      gv = dcG + 0.35 * base + 0.3 * mo + pol * acG * p + noise * 0.6 * gauss(r);
    }
    if (clip) { rv = Math.max(0, Math.min(255, rv)); gv = Math.max(0, Math.min(255, gv)); }
    ts.push(o.tsJitter ? tt + o.tsJitter * gauss(r) : tt); R.push(rv); G.push(gv);   // tsJitter: the frame is right, the time we were told is not
  }
  return { t: ts, r: R, g: G };
}

/* convenience: a stretch of finger with a given heart */
function finger(o) {
  var beats = makeBeats({ dur: o.dur, t0: o.t0 || 0, hr: o.hr || 62, rsaMs: o.rsaMs === undefined ? 40 : o.rsaMs, fBreath: o.fBreath || 0.1,
    scatterMs: o.scatterMs === undefined ? 12 : o.scatterMs, lfMs: o.lfMs === undefined ? 8 : o.lfMs, driftMs: o.driftMs === undefined ? 1.5 : o.driftMs, seed: o.seed || 1 });
  var f = makeFrames(Object.assign({}, o, { beats: beats }));
  f.beats = beats;
  return f;
}

/* the response of the heart to breathing at frequency f: the sinus arrhythmia peaks near a resonance (about 5.5 breaths a minute) */
function rsaResponse(f, peakMs, f0, Q) {
  f0 = f0 || 5.5 / 60; Q = Q || 3;
  return peakMs / Math.sqrt(1 + Q * Q * Math.pow(f / f0 - f0 / f, 2));
}

/* glue several stretches (each with its own start time) into one recording */
function concat(parts) {
  var t = [], r = [], g = [];
  parts.forEach(function (p) { for (var i = 0; i < p.t.length; i++) { t.push(p.t[i]); r.push(p.r[i]); g.push(p.g[i]); } });
  return { t: t, r: r, g: g };
}

module.exports = { rng: rng, gauss: gauss, makeBeats: makeBeats, makeFrames: makeFrames, finger: finger, pulse: pulse, rsaResponse: rsaResponse, concat: concat };
