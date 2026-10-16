'use strict';
/* node --test tests/unit/
   The analysis meets fake fingers whose heart is known: what it reads must match what was put in. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const A = require(path.join(__dirname, '../../js/analysis.js'));
const S = require('./synth.js');

const TYPICAL = { noise: 0.25, driftAmp: 3 };
const HARSH = { noise: 0.35, driftAmp: 4 };

/* what the analysis should say, computed from the true beats with the very same lock-in */
function truth(f, dur, f0) {
  const nn = [], nt = [], valid = [];
  for (let k = 0; k + 1 < f.beats.length; k++) {
    const t = f.beats[k + 1].t; if (t > f.t0 + dur) break;
    nn.push((f.beats[k + 1].t - f.beats[k].t) * 1000); nt.push(t); valid.push(true);
  }
  const ls = A.lockIn(A.tachStretches(nn, nt, valid, 20), f0);
  const m = nn.reduce((a, b) => a + b, 0) / nn.length; let d2 = 0;
  for (let i = 1; i < nn.length; i++) d2 += (nn[i] - nn[i - 1]) ** 2;
  return { hr: 60000 / m, rmssd: Math.sqrt(d2 / (nn.length - 1)), R: ls.R, amp: ls.ampMs };
}
const win = (f, segs) => ({ t: f.t, r: f.r, g: f.g, segs });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, wanted ${b} ± ${tol}`);

test('a clean finger: heart rate, wave height and share are read back', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const f = S.finger({ dur: 120, hr: 55 + seed * 4, rsaMs: 40, fBreath: 0.1, seed, noise: 0.1, driftAmp: 1.5 });
    const r = A.analyzeWindow(win(f), { pace: 6, spectral: true, curve: true }), t = truth(f, 120, 0.1);
    assert.equal(r.ok, true, 'ok: ' + r.reason);
    near(r.hr, t.hr, 0.5, 'hr');
    near(r.ampMs, t.amp, 0.12 * t.amp, 'amp');
    near(r.R, t.R, 0.08, 'R');
    near(r.rmssd, t.rmssd, 0.25 * t.rmssd, 'rmssd');
    assert.ok(r.coverage > 0.9 && r.sqi > 0.9, `coverage ${r.coverage} sqi ${r.sqi}`);
  }
});

test('heart rates from 42 to 120 beats a minute', () => {
  [42, 48, 55, 65, 80, 95, 110, 120].forEach((hr, i) => {
    const f = S.finger({ dur: 90, hr, rsaMs: hr < 60 ? 55 : 30, fBreath: 0.0917, seed: 20 + i, ...TYPICAL });
    const r = A.analyzeWindow(win(f), { pace: 5.5, spectral: true });
    assert.equal(r.ok, true, `hr ${hr}: ${r.reason}`);
    near(r.hr, truth(f, 90, 0.0917).hr, 1.2, `hr ${hr}`);
  });
});

test('a typical and a harsh finger still give the right pulse and wave', () => {
  [TYPICAL, HARSH].forEach((c, ci) => {
    for (let seed = 1; seed <= 6; seed++) {
      const f = S.finger({ dur: 120, hr: 58 + seed * 3, rsaMs: 40, fBreath: 0.1, seed: seed + 30 * ci, ...c });
      const r = A.analyzeWindow(win(f), { pace: 6, spectral: true }), t = truth(f, 120, 0.1);
      assert.equal(r.ok, true, r.reason);
      near(r.hr, t.hr, 0.7, 'hr');
      near(r.ampMs, t.amp, 0.2 * t.amp, 'amp');
      near(r.R, t.R, 0.22, 'R');
    }
  });
});

test('breathing at 6.5 · 6 · 5.5 · 5 · 4.5 with the heart resonating at 5.5: the test picks 5.5', () => {
  let right = 0, N = 10;
  for (let seed = 1; seed <= N; seed++) {
    const scores = A.RHYTHMS.map((pace, i) => {
      const f = S.finger({ dur: 120, hr: 62, rsaMs: S.rsaResponse(pace / 60, 60, 5.5 / 60, 3.5), fBreath: pace / 60, seed: seed * 11 + i, ...TYPICAL });
      const r = A.analyzeWindow(win(f), { pace, spectral: true });
      assert.equal(r.ok, true, `${pace}: ${r.reason}`);
      return r.testScore;
    });
    if (A.winnerOf(scores) === 2) right++;
    assert.ok(Math.abs(A.winnerOf(scores) - 2) <= 1, 'never far off: ' + scores.join(','));
  }
  assert.ok(right >= 8, `5.5 won ${right}/${N}`);
});

test('a resonance at 6.5 is found at 6.5, one at 4.5 at 4.5', () => {
  [[6.5, 0], [4.5, 4]].forEach(([res, idx]) => {
    let right = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const scores = A.RHYTHMS.map((pace, i) => {
        const f = S.finger({ dur: 120, hr: 64, rsaMs: S.rsaResponse(pace / 60, 60, res / 60, 3.5), fBreath: pace / 60, seed: seed * 17 + i + 3, ...TYPICAL });
        return A.analyzeWindow(win(f), { pace, spectral: true }).testScore;
      });
      if (Math.abs(A.winnerOf(scores) - idx) <= 0) right++;
    }
    assert.ok(right >= 5, `resonance ${res}: ${right}/6`);
  });
});

test('winnerOf: highest score, a tie goes to the rhythm closest to 6', () => {
  assert.equal(A.winnerOf([50, 60, 70, 65, 40]), 2);
  assert.equal(A.winnerOf([70, 60, 70, 65, 40]), 2);             // 6.5 and 5.5 tie, 5.5 and 6.5 both 0.5 from 6 → the first one met keeps it
  assert.equal(A.winnerOf([50, 70, 70, 65, 40]), 1);             // 6.0 beats 5.5 on a tie
  assert.equal(A.winnerOf([null, null, 10, null, 5]), 2);
  assert.equal(A.winnerOf([null, null, null, null, null]), -1);
});

test('the scores: what the drawing says they are', () => {
  assert.equal(A.cohNote({ R: 1, ampMs: 30 }), 10);
  assert.equal(A.cohNote({ R: 0.5, ampMs: 30 }), 5);
  assert.equal(A.cohNote({ R: 0.5, ampMs: 7.5 }), 2.5);           // half the gate: half the note
  assert.equal(A.cohNote({ R: 0.62, ampMs: 100 }), 6.2);
  assert.equal(A.testScore({ R: 1, ampMs: 1e6 }), 100);
  assert.equal(A.testScore({ R: 0, ampMs: 80 }), 0);
  const a = A.testScore({ R: 0.7, ampMs: 40 }), b = A.testScore({ R: 0.7, ampMs: 80 }), c = A.testScore({ R: 0.7, ampMs: 160 });
  assert.ok(a < b && b < c, 'a bigger wave never scores less, even when it is already big');
  assert.ok(A.testScore({ R: 0.9, ampMs: 60 }) > A.testScore({ R: 0.5, ampMs: 60 }), 'a steadier wave scores more');
});

test('the finger is off the camera for 40 s: the missing time is counted, the rest is read', () => {
  const f = S.finger({ dur: 120, hr: 66, rsaMs: 40, fBreath: 0.1, seed: 5, lost: [[40, 80]], ...TYPICAL });
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
  assert.ok(r.coverage < 0.75, 'coverage ' + r.coverage);
  assert.equal(r.ok, false);
  near(r.hr, truth(f, 120, 0.1).hr, 1.5, 'hr of what was read');
});

test('a short slip: 6 s off, the window is still good', () => {
  const f = S.finger({ dur: 120, hr: 66, rsaMs: 40, fBreath: 0.1, seed: 6, lost: [[50, 56]], ...TYPICAL });
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
  assert.ok(r.coverage > 0.78, 'coverage ' + r.coverage);
  assert.equal(r.ok, true, r.reason);
});

test('no finger at all: nothing is read', () => {
  const f = S.finger({ dur: 60, hr: 66, rsaMs: 40, seed: 7, lost: [[0, 61]], ...TYPICAL });
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
  assert.equal(r.ok, false);
  assert.ok(r.coverage < 0.3, 'coverage ' + r.coverage);
});

test('the red is saturated (no pulse in it): the green is used', () => {
  const f = S.finger({ dur: 90, hr: 63, rsaMs: 40, fBreath: 0.1, seed: 8, dcR: 254, acR: 3, acG: 1.6, ...TYPICAL });
  assert.ok(Math.max(...f.r) <= 255);
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.chan, 'g');
  near(r.hr, truth(f, 90, 0.1).hr, 1);
});

test('the signal may rise or fall with the beat', () => {
  [1, -1].forEach(pol => {
    const f = S.finger({ dur: 90, hr: 70, rsaMs: 40, fBreath: 0.1, seed: 9, pol, ...TYPICAL });
    const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
    assert.equal(r.ok, true, r.reason);
    near(r.hr, truth(f, 90, 0.1).hr, 0.7);
  });
});

test('lost frames: 8 % at random and bursts of a quarter second', () => {
  const f = S.finger({ dur: 120, hr: 64, rsaMs: 40, fBreath: 0.1, seed: 10, drop: 0.08, burst: 0.004, ...TYPICAL });
  assert.ok(f.t.length < 3400);
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true }), t = truth(f, 120, 0.1);
  assert.equal(r.ok, true, r.reason);
  near(r.hr, t.hr, 1);
  near(r.ampMs, t.amp, 0.25 * t.amp);
});

test('frame times that are a few ms off do not matter much', () => {
  const f = S.finger({ dur: 120, hr: 64, rsaMs: 40, fBreath: 0.1, seed: 11, tsJitter: 0.006, jitter: 0.0005, ...TYPICAL });
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true }), t = truth(f, 120, 0.1);
  assert.equal(r.ok, true, r.reason);
  near(r.hr, t.hr, 1);
  near(r.ampMs, t.amp, 0.2 * t.amp);
});

test('a movement of the whole hand: it is flagged, not believed', () => {
  const f = S.finger({ dur: 120, hr: 64, rsaMs: 40, fBreath: 0.1, seed: 12, motion: [[30, 60, 30]], ...TYPICAL });
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
  assert.ok(r.coverage < 0.85 || r.sqi < 0.9, `coverage ${r.coverage} sqi ${r.sqi}`);
  if (r.ok) near(r.hr, truth(f, 120, 0.1).hr, 3, 'if it says ok the heart rate must be right');
});

test('two stretches with a pause between (the person paused the session): read as one', () => {
  const a = S.finger({ dur: 60, t0: 0, hr: 62, rsaMs: 40, fBreath: 0.0917, seed: 13, ...TYPICAL });
  const b = S.finger({ dur: 60, t0: 80, hr: 62, rsaMs: 40, fBreath: 0.0917, seed: 14, ...TYPICAL });
  const w = S.concat([a, b]);
  const r = A.analyzeWindow({ t: w.t, r: w.r, g: w.g, segs: [[0, 60], [80, 140]] }, { pace: 5.5, spectral: true });
  assert.equal(r.ok, true, r.reason);
  near(r.durationS, 120, 0.5);
  near(r.hr, 62, 2);
  assert.ok(r.ampMs > 20, 'amp ' + r.ampMs);
});

test('breathing off the guide by a little still counts, breathing far off does not', () => {
  const near1 = S.finger({ dur: 120, hr: 62, rsaMs: 40, fBreath: 0.1 + 0.010, seed: 15, ...TYPICAL });    // 0.6 breaths a minute faster
  const far = S.finger({ dur: 120, hr: 62, rsaMs: 40, fBreath: 0.1 + 0.05, seed: 15, ...TYPICAL });        // 3 a minute faster
  const a = A.analyzeWindow(win(near1), { pace: 6, spectral: true }), b = A.analyzeWindow(win(far), { pace: 6, spectral: true });
  assert.ok(a.R > 0.6, 'near: ' + a.R);
  assert.ok(b.R < 0.3, 'far: ' + b.R);
  assert.ok(a.testScore > b.testScore + 15);
});

test('a heart with no breathing wave scores low whatever it does', () => {
  const f = S.finger({ dur: 120, hr: 66, rsaMs: 0, lfMs: 0, scatterMs: 25, fBreath: 0.1, seed: 16, ...TYPICAL });
  const r = A.analyzeWindow(win(f), { pace: 6, spectral: true });
  assert.ok(r.R < 0.3, 'R ' + r.R);
  assert.ok(r.cohNote < 3, 'note ' + r.cohNote);
});

test('the heart rate curve follows the heart', () => {
  const a = S.finger({ dur: 60, hr: 75, rsaMs: 30, fBreath: 0.25, seed: 17, ...TYPICAL });
  const b = S.finger({ dur: 60, t0: 60, hr: 60, rsaMs: 40, fBreath: 0.0917, seed: 18, ...TYPICAL });
  const w = S.concat([a, b]);
  const r = A.analyzeWindow({ t: w.t, r: w.r, g: w.g }, { pace: 5.5, spectral: false, curve: true });
  assert.ok(r.curve.length >= 55);
  const first = r.curve.slice(3, 25).filter(x => x !== null), last = r.curve.slice(35, 58).filter(x => x !== null);
  assert.ok(first.length > 15 && last.length > 15, 'the curve has holes');
  const m = x => x.reduce((p, q) => p + q, 0) / x.length;
  near(m(first), 75, 4); near(m(last), 60, 4);
});

test('liveScan: steady on a good finger, not steady on noise or on a lost finger', () => {
  const f = S.finger({ dur: 20, hr: 68, rsaMs: 30, fBreath: 0.1, seed: 19, ...TYPICAL });
  const cut = (x, a, b) => ({ t: f.t.filter((t, i) => t >= a && t < b), r: f.r.filter((v, i) => f.t[i] >= a && f.t[i] < b), g: f.g.filter((v, i) => f.t[i] >= a && f.t[i] < b) });
  const good = A.liveScan(cut(f, 8, 18));
  assert.equal(good.steady, true);
  near(good.hr, truth(f, 20, 0.1).hr, 4);
  const lost = S.finger({ dur: 20, hr: 68, rsaMs: 30, seed: 20, lost: [[0, 21]], ...TYPICAL });
  assert.equal(A.liveScan({ t: lost.t, r: lost.r, g: lost.g }).steady, false);
  const flat = S.finger({ dur: 20, hr: 68, rsaMs: 30, seed: 21, acR: 0, acG: 0, driftAmp: 3, noise: 0.3 });
  assert.equal(A.liveScan({ t: flat.t, r: flat.r, g: flat.g }).steady, false);
  const short = A.liveScan(cut(f, 8, 10));
  assert.equal(short.steady, false);
});

test('a six-minute session is analysed in well under a second', () => {
  const f = S.finger({ dur: 360, hr: 62, rsaMs: 45, fBreath: 0.0917, seed: 22, ...TYPICAL });
  const t0 = Date.now();
  const rest = A.analyzeWindow({ t: f.t, r: f.r, g: f.g, segs: [[0, 60]] }, { spectral: false });
  const coh = A.analyzeWindow({ t: f.t, r: f.r, g: f.g, segs: [[60, 360]] }, { pace: 5.5, spectral: true, curve: true });
  const ms = Date.now() - t0;
  assert.equal(rest.ok, true, rest.reason); assert.equal(coh.ok, true, coh.reason);
  assert.ok(ms < 1500, ms + ' ms');
  assert.ok(coh.cohNote > 6, 'note ' + coh.cohNote);
  assert.ok(coh.curve.length >= 149);
  near(rest.hr, 62, 1.5);
});
