'use strict';
/* report-fixture.js — a fake « Copier avec les mesures brutes », built from the fake fingers of synth.js.
   makeReport(opts) → the object the lab would copy (opts: what the finger does; ua; torch; timeSrc; quantise (ms, the reported time is rounded to that grid)). */
const S = require('./synth.js');

function makeReport(o) {
  o = o || {};
  const dur = o.dur || 40, f = S.finger(Object.assign({ dur: dur, hr: 64, rsaMs: 45, fBreath: 0.0917, seed: 5, noise: 0.25, driftAmp: 3, t0: 1000 }, o.finger || {}));
  let t = f.t.slice();
  if (o.quantise) t = t.map(v => Math.round(v * 1000 / o.quantise) * o.quantise / 1000);
  // frames closer than a millisecond after rounding cannot exist: drop the doubles
  const keep = []; for (let i = 0; i < t.length; i++) if (i === 0 || Math.round(t[i] * 1000) > Math.round(t[keep[keep.length - 1]] * 1000)) keep.push(i);
  const tt = keep.map(i => t[i]), r = keep.map(i => f.r[i]), g = keep.map(i => f.g[i]);
  const t0 = tt[0], rd = x => Math.round(x * 100) / 100;
  const dt = tt.map(v => Math.round((v - t0) * 1000));
  const rep = {
    at: '2026-09-29T21:10:00.000Z', ua: o.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    standalone: false, version: 'test', state: 'live', torch: o.torch || 'on', torchTries: 1, torchLog: [], errors: [], timeSrc: o.timeSrc || 'capture',
    track: { label: 'Back Camera', readyState: 'live', muted: false }, videoInputs: ['Back Camera'], capabilities: {}, settings: { frameRate: 30 },
    rvfc: true, imageCapture: false, frames: tt.length, fps: 30, ratio: 4, steady: false, hr: null, sqi: 0, chan: null, pol: 1, notes: [],
    recording: { seconds: dur, frames: tt.length },
    samples: { t0: +t0.toFixed(3), unit: 'dt in ms from t0; segs in seconds on the same clock as t0', dt: dt, r: r.map(rd), g: g.map(rd), segs: [[t0, tt[tt.length - 1]]] }
  };
  if (o.check) rep.samples.check = { n: dt.length, dt: dt.reduce((a, b) => a + b, 0), r: rep.samples.r.reduce((a, v) => a + Math.round(v * 100), 0), g: rep.samples.g.reduce((a, v) => a + Math.round(v * 100), 0) };
  rep.truth = { hr: 60000 / (f.beats.reduce((a, b, i, A) => i ? a + (b.t - A[i - 1].t) : 0, 0) / (f.beats.length - 1) * 1000) };
  return rep;
}
module.exports = { makeReport };
