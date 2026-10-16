#!/usr/bin/env node
'use strict';
/* analyze-report.js — reads what the lab copies with « Copier avec les mesures brutes » and says what the phone saw.
 *
 *   node scripts/analyze-report.js report.txt            the text form
 *   node scripts/analyze-report.js report.txt --json     the same, machine-readable
 *   node scripts/analyze-report.js < report.txt          from the standard input
 *
 * It answers, in this order:
 *   1. what the phone is (browser, camera, torch, clock) and what it said about itself;
 *   2. whether the frames are regular (rate, holes, how the clock ticks);
 *   3. whether the picture is usable (level, saturation, finger over the lens, slow drift);
 *   4. whether a pulse exists in the signal AT ALL, by a way that does not use the app's beat detector
 *      (the spectrum of ten-second windows: a steady pulse is a narrow peak between 0.7 and 3 Hz that stays put);
 *   5. what the app's own chain (js/analysis.js) makes of it — every channel and polarity, and why beats are thrown out;
 *   6. which relaxed rule would have read it (so a threshold that is too strict shows up as such);
 *   7. a verdict.
 *
 * The app's chain is run from js/analysis.js itself, read as text and patched IN MEMORY for the experiments:
 * nothing shipped is changed. A patch that no longer matches stops the run loudly.
 */
const fs = require('fs');
const path = require('path');

const ANALYSIS_PATH = path.join(__dirname, '../js/analysis.js');

/* ───────────── the app's chain, with a way in ───────────── */
function loadAnalysis(patches) {
  let src = fs.readFileSync(ANALYSIS_PATH, 'utf8');
  const all = (patches || []).concat([
    // hooks: the constants and inner functions, and the reasons a beat is thrown out
    ['return {\n    FS: FS,', 'return {\n    __x: { BEAT: BEAT, QUALITY: QUALITY, runs: runs, scan: scanChannel },\n    FS: FS,'],
    ['      res.bad[i] = levelBad ||', '      (res.why = res.why || []).push({ level: levelBad, weak: tb.strength < BEAT.minStrength, amp: amp, periodic: per < BEAT.minPeriodic, corr: (segs[i] ? res.q[i] < BEAT.minCorr : false) });\n      res.bad[i] = levelBad ||'],
    ['beatsBySeg.push({ t: ts, idx: idx, bad: bq.bad, q: bq.q, bp: bp, a: a, b: b });', 'beatsBySeg.push({ t: ts, idx: idx, bad: bq.bad, q: bq.q, bp: bp, a: a, b: b, why: bq.why, strength: bq.strength, periodic: bq.periodic, pulsatility: bq.pulsatility, sqi: bq.sqi, dc: dc });'],
    ['goodTime: goodTime, sign: sign };', 'goodTime: goodTime, sign: sign, __segs: beatsBySeg };']
  ]);
  all.forEach(function (p) {
    const from = p[0], to = p[1], parts = src.split(from);
    if (parts.length !== 2) throw new Error('analysis.js changed: the patch "' + from.slice(0, 60).replace(/\n/g, ' ') + '…" matches ' + (parts.length - 1) + ' times (wanted once). Update scripts/analyze-report.js.');
    src = parts.join(to);
  });
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports;
}
const A0 = loadAnalysis();

const VARIANTS = [
  { name: 'as shipped', patches: [], opts: {} },
  { name: 'pass band 0.7–3.5 Hz', patches: [], opts: { hp: 0.7, lp: 3.5 } },
  { name: 'beat gates relaxed', patches: [['minCorr: 0.6', 'minCorr: 0.4'], ['minStrength: 0.5', 'minStrength: 0.3'], ['minPeriodic: 0.30', 'minPeriodic: 0.15'], ['maxPulsatility: 0.12', 'maxPulsatility: 0.5'], ['ampHigh: 3.0', 'ampHigh: 5.0'], ['ampLow: 0.25', 'ampLow: 0.1']], opts: {} },
  { name: 'interval rule 40 % (not 24 %)', patches: [['Math.abs(nn[i] - m) <= 0.24 * m', 'Math.abs(nn[i] - m) <= 0.40 * m']], opts: {} },
  { name: 'stretches of 2 s (not 4 s)', patches: [['runs(rs.ok, Math.round(4 * fs))', 'runs(rs.ok, Math.round(2 * fs))']], opts: {} },
  { name: 'everything relaxed + band 0.7–3.5', patches: [['minCorr: 0.6', 'minCorr: 0.4'], ['minStrength: 0.5', 'minStrength: 0.3'], ['minPeriodic: 0.30', 'minPeriodic: 0.15'], ['maxPulsatility: 0.12', 'maxPulsatility: 0.5'], ['ampHigh: 3.0', 'ampHigh: 5.0'], ['ampLow: 0.25', 'ampLow: 0.1'], ['Math.abs(nn[i] - m) <= 0.24 * m', 'Math.abs(nn[i] - m) <= 0.40 * m']], opts: { hp: 0.7, lp: 3.5 } }
];

/* ───────────── small tools ───────────── */
function pct(x) { return Math.round(100 * x) + ' %'; }
function f1(x) { return isFinite(x) ? (Math.round(x * 10) / 10).toString() : '–'; }
function f2(x) { return isFinite(x) ? (Math.round(x * 100) / 100).toString() : '–'; }
function stats(a) {
  a = Array.prototype.slice.call(a).filter(isFinite);
  if (!a.length) return null;
  const q = (p) => A0.quantile(a, p), m = A0.mean(a);
  let v = 0; a.forEach(x => { v += (x - m) * (x - m); });
  return { n: a.length, min: Math.min.apply(null, a), p5: q(0.05), p50: q(0.5), p95: q(0.95), max: Math.max.apply(null, a), mean: m, sd: Math.sqrt(v / Math.max(1, a.length - 1)) };
}
function spark(a, lo, hi) {
  const blocks = '▁▂▃▄▅▆▇█';
  if (lo === undefined) lo = Math.min.apply(null, a.filter(isFinite));
  if (hi === undefined) hi = Math.max.apply(null, a.filter(isFinite));
  return a.map(v => !isFinite(v) ? '·' : blocks[Math.max(0, Math.min(7, Math.floor(7.999 * (v - lo) / Math.max(1e-9, hi - lo))))]).join('');
}
function median(a) { return A0.median(a); }

function extractJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object found in the text');
  try { return JSON.parse(text.slice(a, b + 1)); }
  catch (e) {
    const m = /position (\d+)/.exec(String(e.message)), at = m ? +m[1] : -1;
    throw new Error('the text is not valid JSON (' + e.message + ')' + (at >= 0 ? ' near: …' + text.slice(a + Math.max(0, at - 40), a + at + 40).replace(/\s+/g, ' ') + '…' : '') + ' — the paste may have been cut or altered.');
  }
}

/* ───────────── the samples ───────────── */
function samplesOf(rep) {
  const S = rep && rep.samples;
  if (!S) return null;
  let dt = S.dt, r = S.r, g = S.g;
  if (typeof dt === 'string' || typeof r === 'string') throw new Error('this report uses an encoded form this version of the analyzer does not know');
  if (!Array.isArray(dt) || !Array.isArray(r) || !Array.isArray(g)) return null;
  const n = dt.length, problems = [];
  if (r.some(v => typeof v !== 'number' || !isFinite(v)) || g.some(v => typeof v !== 'number' || !isFinite(v)) || dt.some(v => typeof v !== 'number' || !isFinite(v))) problems.push('some values are not numbers (null or text): the phone may have produced an invalid frame, or the paste was altered');
  if (r.length !== n || g.length !== n) problems.push('lengths differ: dt ' + n + ', r ' + r.length + ', g ' + g.length);
  const m = Math.min(n, r.length, g.length);
  dt = dt.slice(0, m); r = r.slice(0, m); g = g.slice(0, m);
  if (S.check) {                                                        // the lab adds sums so a damaged paste is caught
    const sum = (a, k) => a.reduce((s, v) => s + Math.round(v * k), 0);
    const got = { dt: sum(dt, 1), r: sum(r, 100), g: sum(g, 100), n: m };
    ['dt', 'r', 'g', 'n'].forEach(k => { if (S.check[k] !== undefined && S.check[k] !== got[k]) problems.push('check sum of ' + k + ' differs (' + got[k] + ' vs ' + S.check[k] + ') — a digit was changed in the paste'); });
  }
  const t = dt.map(d => S.t0 + d / 1000);
  for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) problems.push('time does not increase at frame ' + i);
  const segs = S.segs && S.segs.length ? S.segs : null, seg = new Array(t.length).fill(0);
  if (segs) for (let i = 0; i < t.length; i++) { let k = segs.findIndex(x => t[i] >= x[0] - 1e-6 && t[i] <= x[1] + 1e-6); seg[i] = k < 0 ? -1 : k; }
  return { t: t, r: r.map(Number), g: g.map(Number), segs: segs, seg: seg, t0: S.t0, problems: problems.slice(0, 6) };
}

/* ───────────── 2. timing ───────────── */
function timingOf(s) {
  const t = s.t, n = t.length, d = [], res = [], nSeg = s.segs ? s.segs.length : 1;
  const id = new Array(n).fill(0);                                       // a stretch ends where the finger left (segments) or where the frames stopped for a quarter of a second
  for (let i = 1; i < n; i++) id[i] = id[i - 1] + ((s.seg[i] !== s.seg[i - 1] || t[i] - t[i - 1] > 0.25) ? 1 : 0);
  for (let i = 1; i < n; i++) if (id[i] === id[i - 1] && s.seg[i] >= 0) d.push((t[i] - t[i - 1]) * 1000);
  const st = stats(d), out = { frames: n, stretches: nSeg, seconds: 0, dt: st };
  const last = id[n - 1];
  for (let k = 0; k <= last; k++) {
    const idx = []; for (let i = 0; i < n; i++) if (id[i] === k) idx.push(i);
    if (idx.length < 3) continue;
    out.seconds += t[idx[idx.length - 1]] - t[idx[0]];
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = idx.length;
    idx.forEach((i, q) => { sx += q; sy += t[i]; sxx += q * q; sxy += q * t[i]; });
    const b = (m * sxy - sx * sy) / (m * sxx - sx * sx || 1), a = (sy - b * sx) / m;
    idx.forEach((i, q) => res.push((t[i] - (a + b * q)) * 1000));
  }
  out.fps = st ? 1000 / st.p50 : null;
  out.fpsMean = out.seconds > 0 ? (n - 1 - last) / out.seconds : null;
  // holes inside a stretch of the recording (the finger leaving is not one: it is a new segment)
  let g60 = 0, g100 = 0, g250 = 0;
  for (let i = 1; i < n; i++) if (s.seg[i] === s.seg[i - 1] && s.seg[i] >= 0) { const x = (t[i] - t[i - 1]) * 1000; if (x > 60) g60++; if (x > 100) g100++; if (x > 250) g250++; }
  out.gaps60 = g60; out.gaps100 = g100; out.gaps250 = g250;
  const hist = {}; d.forEach(x => { const k = Math.round(x); hist[k] = (hist[k] || 0) + 1; });
  out.common = Object.keys(hist).map(k => [+k, hist[k] / Math.max(1, d.length)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  out.clockJitterMs = res.length ? median(res.map(x => Math.abs(x))) : null;
  out.clockJitterMax = res.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  return out;
}

/* ───────────── 3. the picture ───────────── */
function levelsOf(s) {
  const n = s.t.length, out = { r: stats(s.r), g: stats(s.g) };
  out.satR = s.r.filter(v => v >= 250).length / n; out.satG = s.g.filter(v => v >= 250).length / n;
  out.blackR = s.r.filter(v => v <= 5).length / n;
  const ratio = s.r.map((v, i) => v / Math.max(1, s.g[i]));
  out.ratio = stats(ratio);
  // finger, the way the app defines it (strict: covered(); lenient: the ratio used for the pulse check)
  let strict = 0, lenient = 0;
  for (let i = 0; i < n; i++) { if (s.r[i] >= 20 && s.r[i] >= 1.7 * Math.max(s.g[i], 1)) strict++; if (s.r[i] >= 20 && s.r[i] >= 1.25 * Math.max(s.g[i], 1)) lenient++; }
  out.fingerStrict = strict / n; out.fingerLenient = lenient / n;
  // one number a second, stretch by stretch (a gap between two stretches shows as a dot and never counts as a step)
  const perR = [], perG = [], perFinger = [], nSeg = s.segs ? s.segs.length : 1;
  let step = 0;
  for (let k = 0; k < nSeg; k++) {
    const t0 = s.segs ? s.segs[k][0] : s.t[0], t1 = s.segs ? s.segs[k][1] : s.t[n - 1], secs = Math.floor(t1 - t0);
    if (k > 0) { perR.push(NaN); perG.push(NaN); perFinger.push(NaN); }
    let prev = NaN;
    for (let q = 0; q < secs; q++) {
      const idx = []; for (let i = 0; i < n; i++) if (s.seg[i] === k && s.t[i] >= t0 + q && s.t[i] < t0 + q + 1) idx.push(i);
      if (!idx.length) { perR.push(NaN); perG.push(NaN); perFinger.push(NaN); prev = NaN; continue; }
      const mr = median(idx.map(i => s.r[i]));
      perR.push(mr); perG.push(median(idx.map(i => s.g[i])));
      perFinger.push(idx.filter(i => s.r[i] >= 20 && s.r[i] >= 1.7 * Math.max(s.g[i], 1)).length / idx.length);
      if (isFinite(prev)) step = Math.max(step, Math.abs(mr - prev));
      prev = mr;
    }
  }
  out.perSecond = { r: perR, g: perG, finger: perFinger };
  out.maxStepR = step;
  return out;
}

/* ───────────── 4. is there a pulse in the signal, without the beat detector? ───────────── */
function uniform(s, ch) {
  const t0 = s.segs ? s.segs[0][0] : s.t[0], t1 = s.segs ? s.segs[s.segs.length - 1][1] : s.t[s.t.length - 1];
  return A0.resample(s.t, s[ch], t0, t1, A0.FS, 0.25, s.segs);
}
function hann(n) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; }
/* power spectrum (units²/Hz) of one stretch, detrended, Hann, zero-padded */
function spectrum(x, fs) {
  const N = 4096, n = x.length, re = new Float64Array(N), im = new Float64Array(N), w = hann(n);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n;
  let sw2 = 0; for (let i = 0; i < n; i++) { re[i] = (x[i] - (a + b * i)) * w[i]; sw2 += w[i] * w[i]; }
  A0.fft(re, im);
  const P = new Float64Array(N / 2), df = fs / N;
  for (let k = 1; k < N / 2; k++) P[k] = 2 * (re[k] * re[k] + im[k] * im[k]) / (fs * sw2);
  return { P: P, df: df };
}
function bandRms(sp, lo, hi) { let v = 0; for (let k = Math.ceil(lo / sp.df); k <= Math.floor(hi / sp.df) && k < sp.P.length; k++) v += sp.P[k] * sp.df; return Math.sqrt(v); }
function pulseSearch(s) {
  const out = {};
  ['r', 'g'].forEach(ch => {
    const rs = uniform(s, ch), fs = rs.fs, W = Math.round(10 * fs), hop = Math.round(2 * fs), rows = [];
    let slow = 0, pulse = 0, noise = 0, cnt = 0;
    for (let a = 0; a + W <= rs.x.length; a += hop) {
      let ok = 0; for (let i = a; i < a + W; i++) ok += rs.ok[i] && isFinite(rs.x[i]) ? 1 : 0;
      if (ok < 0.9 * W) continue;
      const x = new Float64Array(W); for (let i = 0; i < W; i++) x[i] = isFinite(rs.x[a + i]) ? rs.x[a + i] : 0;
      const sp = spectrum(x, fs);
      const lo = Math.ceil(0.7 / sp.df), hi = Math.floor(3.0 / sp.df);
      let pk = lo; for (let k = lo; k <= hi; k++) if (sp.P[k] > sp.P[pk]) pk = k;
      const band = []; for (let k = Math.ceil(0.5 / sp.df); k <= Math.floor(4.0 / sp.df); k++) band.push(sp.P[k]);
      const med = A0.median(band), snr = 10 * Math.log10(sp.P[pk] / Math.max(1e-12, med));
      // the same peak, counting its neighbours (the peak of a real pulse is a few bins wide)
      const rows1 = { t: rs.t0 + a / fs, hz: pk * sp.df, bpm: 60 * pk * sp.df, snr: snr, slow: bandRms(sp, 0.05, 0.5), pulse: bandRms(sp, 0.7, 3.5), noise: bandRms(sp, 6, 13.5) };
      rows.push(rows1); slow += rows1.slow; pulse += rows1.pulse; noise += rows1.noise; cnt++;
    }
    const good = rows.filter(r => r.snr >= 12), med = good.length ? A0.median(good.map(r => r.bpm)) : null;
    out[ch] = { windows: rows, n: rows.length, strong: good.length, medianBpm: med,
                spreadBpm: good.length > 2 ? A0.quantile(good.map(r => r.bpm), 0.75) - A0.quantile(good.map(r => r.bpm), 0.25) : null,
                steady: med === null ? 0 : good.filter(r => Math.abs(r.bpm - med) <= 6).length / Math.max(1, rows.length),
                rmsSlow: cnt ? slow / cnt : NaN, rmsPulse: cnt ? pulse / cnt : NaN, rmsNoise: cnt ? noise / cnt : NaN,
                medianSnr: rows.length ? A0.median(rows.map(r => r.snr)) : NaN };
  });
  return out;
}

/* ───────────── 5. the app's chain ───────────── */
/* the scan of every channel and polarity of the recording — analyzeWindow keeps only the best, we keep them all */
function explainBest(A, s, opts) {
  // rebuild the scan of every channel/polarity the way analyzeWindow does, but keep each one
  const segs = s.segs || [[s.t[0], s.t[s.t.length - 1]]], t0 = segs[0][0], t1 = segs[segs.length - 1][1], rows = [];
  ['r', 'g'].forEach(ch => {
    const rs = A.resample(s.t, s[ch], t0, t1, A.FS, 0.25, segs);
    [1, -1].forEach(sign => {
      const one = A.__scan(rs, sign, opts || {});
      rows.push(Object.assign({ ch: ch, sign: sign }, summarise(one)));
    });
  });
  return rows;
}
function summarise(sc) {
  const valid = []; for (let i = 0; i < sc.nn.length; i++) if (sc.valid[i]) valid.push(sc.nn[i]);
  const bad = { level: 0, weak: 0, amp: 0, periodic: 0, corr: 0, any: 0, total: 0 };
  let strength = [], periodic = [], puls = [], nInterval = { range: 0, neighbour: 0, badBeat: 0 };
  (sc.__segs || []).forEach(bs => {
    if (bs.why) bs.why.forEach((w, i) => { bad.total++; ['level', 'weak', 'amp', 'periodic', 'corr'].forEach(k => { if (w[k]) bad[k]++; }); if (bs.bad[i]) bad.any++; });
    if (isFinite(bs.strength) && bs.strength) strength.push(bs.strength);
    if (isFinite(bs.periodic)) periodic.push(bs.periodic);
    if (isFinite(bs.pulsatility)) puls.push(bs.pulsatility);
    // why intervals fell
    if (bs.t.length > 1) {
      const nn = [], K = 4; for (let i = 1; i < bs.t.length; i++) nn.push((bs.t[i] - bs.t[i - 1]) * 1000);
      for (let i = 0; i < nn.length; i++) {
        const nb = []; for (let j = Math.max(0, i - K); j <= Math.min(nn.length - 1, i + K); j++) if (j !== i) nb.push(nn[j]);
        const m = nb.length ? median(nb) : nn[i];
        if (nn[i] < 350 || nn[i] > 1600) nInterval.range++;
        else if (bs.bad[i] || bs.bad[i + 1]) nInterval.badBeat++;
        else if (Math.abs(nn[i] - m) > 0.24 * m) nInterval.neighbour++;
      }
    }
  });
  return { nBeats: sc.peaksT.length, nIntervals: sc.nn.length, nValid: valid.length, coverage: sc.coverage, sqi: sc.sqi, goodTime: sc.goodTime,
           hr: valid.length ? 60000 / A0.mean(valid) : null, medianNn: valid.length ? median(valid) : (sc.nn.length ? median(sc.nn) : null),
           bad: bad, intervalDrops: nInterval, strength: strength.length ? A0.mean(strength) : null, periodic: periodic.length ? A0.mean(periodic) : null, pulsatility: puls.length ? A0.median(puls) : null };
}

/* ───────────── 6. the app's decision, as written ───────────── */
function decide(A, s, opts) {
  const win = { t: s.t, r: s.r, g: s.g, segs: s.segs };
  const r = A.analyzeWindow(win, Object.assign({ spectral: false, curve: false }, opts || {}));
  return { ok: r.ok, reason: r.reason, hr: r.hr || null, rmssd: r.rmssd || null, coverage: r.coverage, sqi: r.sqi, nBeats: r.nBeats, nValid: r.nValid, chan: r.chan, pol: r.pol, durationS: r.durationS };
}
function slidingWindows(A, s, len, hop) {
  const out = [], t0 = s.t[0], t1 = s.t[s.t.length - 1];
  for (let a = t0; a + len <= t1 + 1e-6; a += hop) {
    const idx = []; for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] <= a + len) idx.push(i);
    const win = { t: idx.map(i => s.t[i]), r: idx.map(i => s.r[i]), g: idx.map(i => s.g[i]), segs: [[a, a + len]] };
    const d = A.analyzeWindow(win, { spectral: false, curve: false });
    out.push({ from: a - t0, to: a - t0 + len, coverage: d.coverage, sqi: d.sqi, nBeats: d.nBeats, nValid: d.nValid, hr: d.hr || null, chan: d.chan, pol: d.pol, ok: d.ok, reason: d.reason });
  }
  return out;
}

/* ───────────── the whole ───────────── */
function analyze(rep) {
  const out = { device: deviceOf(rep), recording: rep.recording || null, notes: rep.notes || [] };
  const s = samplesOf(rep);
  if (!s) { out.error = 'no raw samples in this report (paste the text of « Copier avec les mesures brutes », after a recording)'; out.verdict = [{ level: 'stop', text: out.error }]; return out; }
  out.problems = s.problems;
  if (s.t.length < 60) { out.error = 'only ' + s.t.length + ' frames in the report: too few to analyse (a recording gives about 1200)'; out.verdict = [{ level: 'stop', text: out.error }]; return out; }
  out.timing = timingOf(s); out.levels = levelsOf(s); out.pulseSearch = pulseSearch(s);

  const scanByVariant = VARIANTS.map(v => {
    const A = v.patches.length ? loadAnalysis(v.patches) : A0;
    A.__scan = makeScan(A);
    const rows = explainBest(A, s, v.opts), dec = decide(A, s, v.opts);
    return { name: v.name, rows: rows, decision: dec };
  });
  out.variants = scanByVariant;
  out.windows = slidingWindows(A0, s, 20, 4);
  out.verdict = verdictOf(out, s);
  return out;
}

function makeScan(A) { return A.__x.scan; }               // scanChannel of analysis.js, reached through the hook of loadAnalysis

function deviceOf(rep) {
  const ua = rep.ua || '';
  let browser = 'unknown';
  if (/GSA\//.test(ua)) browser = 'Google app (in-app browser)';
  else if (/CriOS/.test(ua)) browser = 'Chrome (iOS)';
  else if (/FxiOS/.test(ua)) browser = 'Firefox (iOS)';
  else if (/EdgiOS/.test(ua)) browser = 'Edge (iOS)';
  else if (/Safari/.test(ua) && /Version\//.test(ua)) browser = 'Safari';
  const cap = rep.capabilities || {}, capKeys = Object.keys(cap);
  return { at: rep.at, version: rep.version, browser: browser, ua: ua, standalone: rep.standalone, state: rep.state, torch: rep.torch, torchTries: rep.torchTries,
           torchLog: (rep.torchLog || []).slice(-8), errors: rep.errors || [], timeSrc: rep.timeSrc, rvfc: rep.rvfc, imageCapture: rep.imageCapture,
           track: rep.track || null, videoInputs: rep.videoInputs || null, capabilityKeys: capKeys, capabilities: cap, settings: rep.settings || null,
           liveFps: rep.fps, live: { hr: rep.hr, sqi: rep.sqi, chan: rep.chan, pol: rep.pol, steady: rep.steady, ratio: rep.ratio } };
}

/* ───────────── 7. the verdict ───────────── */
function verdictOf(o, s) {
  const v = [], L = o.levels, T = o.timing, P = o.pulseSearch;
  const say = (level, text) => v.push({ level: level, text: text });
  if (o.problems && o.problems.length) say('warn', 'the paste looks damaged: ' + o.problems.join('; '));
  if (o.device.torch !== 'on') say('warn', 'the flash was not confirmed lit by the phone (state: ' + o.device.torch + ')');
  if (T.fps < 22) say('bad', 'low frame rate: ' + f1(T.fps) + ' images a second (the chain expects ~30)');
  if (T.gaps250 > 0) say('warn', T.gaps250 + ' hole(s) longer than 250 ms in the frames');
  if (T.clockJitterMs > 6) say('warn', 'the clock ticks unevenly (median error ' + f1(T.clockJitterMs) + ' ms from a straight line): beat timing (and so the variability) is blurred; clock used: ' + o.device.timeSrc);
  if (L.r.p50 < 60) say('bad', 'the picture is dark (red median ' + f1(L.r.p50) + '): flash off, or the lens is not covered');
  if (L.satR > 0.2) say('bad', 'the red channel is saturated on ' + pct(L.satR) + ' of the frames: the pulse is clipped away in red');
  if (L.satG > 0.2) say('warn', 'the green channel is saturated on ' + pct(L.satG) + ' of the frames');
  if (L.fingerStrict < 0.8) say('bad', 'a finger was seen on the lens only ' + pct(L.fingerStrict) + ' of the time');
  if (L.maxStepR > 12) say('warn', 'the red level jumps by up to ' + f1(L.maxStepR) + ' between two seconds (exposure adjusting, or the finger moving)');
  const best = ['r', 'g'].map(ch => ({ ch: ch, p: P[ch] })).sort((a, b) => (b.p.strong - a.p.strong) || (b.p.medianSnr - a.p.medianSnr))[0];
  if (!best.p.n) say('warn', 'the recording is too short (or has too many holes) for the spectrum of ten-second windows');
  const strongShare = best.p.n ? best.p.strong / best.p.n : 0;
  const slowVsPulse = best.p.rmsSlow / Math.max(1e-9, best.p.rmsPulse);
  const dec = o.variants[0].decision;
  if (strongShare >= 0.6 && best.p.steady >= 0.5) {
    say('info', 'a pulse IS in the signal: channel ' + best.ch + ', about ' + f1(best.p.medianBpm) + ' a minute, a clear steady peak in ' + pct(strongShare) + ' of the windows');
    if (!dec.ok) {
      const rescue = o.variants.filter(x => x.decision.ok).map(x => x.name);
      say('bad', 'the app does not read it (' + dec.reason + ') although it is there: the beat detector or its gates are too strict for this signal' + (rescue.length ? '; these variants read it: ' + rescue.join(' · ') : '; none of the variants tried reads it'));
    } else say('good', 'and the app reads it (' + f1(dec.hr) + ' a minute)');
  } else if (strongShare >= 0.25) {
    say('warn', 'a pulse shows in only ' + pct(strongShare) + ' of the ten-second windows (channel ' + best.ch + ', ~' + f1(best.p.medianBpm) + ' a minute): it comes and goes — pressure, movement or the lens only half covered');
  } else {
    say('bad', 'no steady pulse in the spectrum of either channel (best: ' + best.ch + ', clear peak in ' + pct(strongShare) + ' of the windows, median peak height ' + f1(best.p.medianSnr) + ' dB where pure noise gives ~8): the signal itself has no pulse to read');
  }
  if (slowVsPulse > 8) say('warn', 'slow movement of the level (0.05–0.5 Hz) is ' + f1(slowVsPulse) + ' times stronger than the pulse band: the finger or the phone moved, or the exposure drifted');
  const noiseVsPulse = best.p.rmsPulse / Math.max(1e-9, best.p.rmsNoise);
  if (noiseVsPulse < 1.5) say('warn', 'the pulse band is barely above the sensor noise (' + f1(noiseVsPulse) + ' times, best channel ' + best.ch + '): a very small pulse in the picture');
  const cleanWin = o.windows.filter(w => w.ok);
  if (!dec.ok && cleanWin.length) say('info', cleanWin.length + ' of ' + o.windows.length + ' twenty-second stretches are read by the app (e.g. from ' + f1(cleanWin[0].from) + ' s): a shorter, steadier attempt would work');
  return v;
}

/* ───────────── the text ───────────── */
function render(o) {
  const out = [], P = (s) => out.push(s === undefined ? '' : s);
  P('═══ REPORT ANALYSIS ═══');
  const d = o.device;
  P('app version ' + d.version + ' · taken ' + d.at);
  P('browser: ' + d.browser + (d.standalone ? ' (home-screen app)' : ''));
  P('user agent: ' + d.ua);
  P('camera state ' + d.state + ' · torch ' + d.torch + ' (tries ' + d.torchTries + ') · clock ' + d.timeSrc + ' · requestVideoFrameCallback ' + d.rvfc + ' · ImageCapture ' + d.imageCapture);
  P('track: ' + JSON.stringify(d.track) + ' · cameras: ' + JSON.stringify(d.videoInputs));
  P('capabilities: ' + (d.capabilityKeys.length ? d.capabilityKeys.join(', ') : '(none reported)'));
  P('settings: ' + JSON.stringify(d.settings));
  if (d.errors.length) P('errors: ' + d.errors.join(' | '));
  if (d.torchLog.length) P('torch log (last): ' + d.torchLog.map(x => x.what + '→' + x.result).join(' | '));
  if (o.recording) P('the lab said: ' + JSON.stringify(o.recording));
  if (o.notes && o.notes.length) P('notes: ' + JSON.stringify(o.notes));
  if (o.error) { P(); P('✗ ' + o.error); return out.join('\n'); }
  if (o.problems && o.problems.length) { P(); o.problems.forEach(x => P('⚠ ' + x)); }

  const T = o.timing, L = o.levels;
  P(); P('── frames ──');
  P(T.frames + ' frames over ' + f1(T.seconds) + ' s' + (T.stretches > 1 ? ' (in ' + T.stretches + ' stretches: the finger left in between)' : '') + ' · ' + f1(T.fps) + ' /s (median) · ' + f1(T.fpsMean) + ' /s (mean)');
  P('gap between frames (ms): median ' + f1(T.dt.p50) + ' · 5–95 % ' + f1(T.dt.p5) + '–' + f1(T.dt.p95) + ' · min ' + f1(T.dt.min) + ' · max ' + f1(T.dt.max) + ' · gaps >60 ms: ' + T.gaps60 + ', >100 ms: ' + T.gaps100 + ', >250 ms: ' + T.gaps250);
  P('commonest gaps: ' + T.common.map(c => c[0] + ' ms ' + pct(c[1])).join(' · '));
  P('clock error from a straight line: median ' + f1(T.clockJitterMs) + ' ms · worst ' + f1(T.clockJitterMax) + ' ms');

  P(); P('── the picture ──');
  P('red    p5 ' + f1(L.r.p5) + ' · median ' + f1(L.r.p50) + ' · p95 ' + f1(L.r.p95) + ' · min ' + f1(L.r.min) + ' · max ' + f1(L.r.max) + ' · ≥250 on ' + pct(L.satR) + ' · ≤5 on ' + pct(L.blackR));
  P('green  p5 ' + f1(L.g.p5) + ' · median ' + f1(L.g.p50) + ' · p95 ' + f1(L.g.p95) + ' · min ' + f1(L.g.min) + ' · max ' + f1(L.g.max) + ' · ≥250 on ' + pct(L.satG));
  P('red / green: median ' + f2(L.ratio.p50) + ' (5–95 %: ' + f2(L.ratio.p5) + '–' + f2(L.ratio.p95) + ')');
  P('finger seen (the app\'s rule, red ≥ 1.7 × green): ' + pct(L.fingerStrict) + ' of frames · lenient (1.25): ' + pct(L.fingerLenient));
  P('red per second:    ' + spark(L.perSecond.r));
  P('green per second:  ' + spark(L.perSecond.g));
  P('finger per second: ' + spark(L.perSecond.finger, 0, 1) + '   (█ = all frames of that second)');
  P('biggest step of red between two seconds: ' + f1(L.maxStepR));

  P(); P('── is there a pulse in the signal? (spectrum of 10 s windows, no beat detector) ──');
  ['r', 'g'].forEach(ch => {
    const p = o.pulseSearch[ch];
    P('channel ' + ch + ': ' + p.n + ' windows · clear peak (≥12 dB above the band median; pure noise gives ~8) in ' + p.strong + ' · steady within ±6 a minute in ' + pct(p.n ? p.steady : 0) + ' · median peak ' + (p.medianBpm ? f1(p.medianBpm) + ' /min' : '–') + ' · spread ' + f1(p.spreadBpm) + ' · median height ' + f1(p.medianSnr) + ' dB');
    P('   level (rms): slow 0.05–0.5 Hz ' + f2(p.rmsSlow) + ' · pulse 0.7–3.5 Hz ' + f2(p.rmsPulse) + ' · noise 6–13.5 Hz ' + f2(p.rmsNoise) + ' (units of the 0–255 scale)');
    P('   peak by window (bpm):  ' + p.windows.map(w => Math.round(w.bpm) + (w.snr >= 12 ? '' : '?')).join(' '));
  });

  P(); P('── the app\'s chain ──');
  o.variants.forEach((v, vi) => {
    P((vi ? '· ' : '▶ ') + v.name + ' → ' + (v.decision.ok ? 'READ' : 'not read (' + v.decision.reason + ')') + ' · beats ' + v.decision.nBeats + ' · valid ' + v.decision.nValid + ' · coverage ' + f2(v.decision.coverage) + ' · sqi ' + f2(v.decision.sqi) + ' · channel ' + v.decision.chan + (v.decision.pol > 0 ? '+' : '−') + (v.decision.hr ? ' · ' + f1(v.decision.hr) + ' /min' : ''));
    if (vi === 0) v.rows.forEach(r => {
      P('    ' + r.ch + (r.sign > 0 ? '+' : '−') + '  beats ' + r.nBeats + ' · intervals ' + r.nIntervals + ' · valid ' + r.nValid + ' · coverage ' + f2(r.coverage) + ' · sqi ' + f2(r.sqi) + (r.hr ? ' · ' + f1(r.hr) + ' /min' : '') + ' · median interval ' + f1(r.medianNn) + ' ms');
      P('        beats thrown out: ' + r.bad.any + ' of ' + r.bad.total + ' (level ' + r.bad.level + ' · weak template ' + r.bad.weak + ' · size outlier ' + r.bad.amp + ' · not periodic ' + r.bad.periodic + ' · poor match ' + r.bad.corr + ') · intervals dropped: out of range ' + r.intervalDrops.range + ', touching a thrown beat ' + r.intervalDrops.badBeat + ', off the neighbours ' + r.intervalDrops.neighbour);
      P('        template strength ' + f2(r.strength) + ' (gate 0.5) · periodicity ' + f2(r.periodic) + ' · pulse height / level ' + (r.pulsatility === null ? '–' : (Math.round(r.pulsatility * 10000) / 10000)) + ' (gate 0.0002–0.12)');
    });
  });
  P(); P('twenty-second stretches through the app\'s chain:');
  o.windows.forEach(w => P('   ' + f1(w.from).padStart(5) + '–' + f1(w.to).padStart(5) + ' s   ' + (w.ok ? 'READ    ' : 'no (' + w.reason + ')').padEnd(18) + ' beats ' + String(w.nBeats).padStart(2) + ' valid ' + String(w.nValid).padStart(2) + ' coverage ' + f2(w.coverage) + ' sqi ' + f2(w.sqi) + (w.hr ? ' ' + f1(w.hr) + ' /min' : '')));

  P(); P('── verdict ──');
  o.verdict.forEach(x => P({ good: '✓ ', info: '• ', warn: '⚠ ', bad: '✗ ', stop: '✗ ' }[x.level] + x.text));
  return out.join('\n');
}

/* ───────────── command line ───────────── */
function main(argv) {
  const files = argv.filter(a => !a.startsWith('--')), json = argv.includes('--json');
  const text = files.length ? fs.readFileSync(files[0], 'utf8') : fs.readFileSync(0, 'utf8');
  const rep = extractJSON(text), res = analyze(rep);
  if (json) {
    const slim = JSON.parse(JSON.stringify(res, (k, v) => (k === 'perSecond' || k === 'windows' && Array.isArray(v) && v.length && v[0].bpm !== undefined) ? undefined : v));
    process.stdout.write(JSON.stringify(slim, null, 1) + '\n');
  } else process.stdout.write(render(res) + '\n');
}

module.exports = { analyze: analyze, render: render, extractJSON: extractJSON, samplesOf: samplesOf, loadAnalysis: loadAnalysis };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { process.stderr.write('✗ ' + e.message + '\n'); process.exit(1); } }
