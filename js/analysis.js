/* analysis.js — from a fingertip video to a heartbeat, a resting heart, a variability, a coherence.
 *
 * Pure functions, no DOM: the same file runs in the browser and in Node (tests/unit/analysis.test.js).
 *
 * What goes in: the mean red and green of the frames, with their times (what the camera saw).
 * What comes out: the beats, the intervals between them, and four numbers:
 *
 *   hr        beats a minute (60 000 ms / mean interval)
 *   rmssd     ms — the "variability" of the drawing: root mean square of successive interval differences
 *             (the short-term measure the camera-versus-ECG studies validate at rest, Plews 2017)
 *   ampMs     ms — the height of the heart-rate wave that keeps step with the breathing: the amplitude of the
 *             strongest steady wave within ±0.015 Hz of the guide, in the interval series
 *   R         0..1 — that wave's share of all the variation of the intervals between 0.04 and 0.40 Hz
 *             (the ratio HeartMath calls coherence, measured where the guide is)
 *
 * and two scores built from R and ampMs:
 *
 *   testScore  0..100  100 · sqrt( (1 − e^(−ampMs/60)) · R )       « the biggest and most regular waves »
 *   cohNote    0..10   10 · R · min(1, ampMs / 15)                  « how much of the wave kept step with the breath »
 *
 * Neither is a medical measure. They rank a person's own five rhythms against each other and follow one
 * person over weeks; the absolute values carry no claim.
 *
 * The chain: red and green, both polarities → band-pass 0.5–6 Hz (zero phase) → local period from the
 * autocorrelation → beats by dynamic programming (heights + a steady rhythm) → intervals checked against their
 * neighbours → template correlation (quality) → intervals as a 4 Hz wave → lock-in at the guide frequency.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.COH = root.COH || {}; root.COH.analysis = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FS = 30;            // Hz — the uniform rate the raw waveform is resampled to
  var FS_T = 4;           // Hz — the rate of the interval series (tachogram)
  var BAND = [0.04, 0.40];
  var LOCK = 0.015;
  var NFFT = 4096;
  var AMP_SCALE = 60;     // ms — the height that earns 63 % of the amplitude credit in the test score
  var AMP_GATE_NOTE = 15; // ms — below this, a session note is scaled down (a tiny wave can be perfectly regular)
  var MAX_HOLE = 4.0;     // s — a hole in the intervals this short is bridged; a longer one splits the series
  var QUALITY = { minCoverage: 0.6, minSqi: 0.7, minBeats: 20 };

  /* ───────────── small tools ───────────── */
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; }
  function sorted(a) { return Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }); }
  function quantile(a, q) {
    if (!a.length) return NaN;
    var s = sorted(a), p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return s[lo] + (s[hi] - s[lo]) * (p - lo);
  }
  function median(a) { return quantile(a, 0.5); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ───────────── resampling ───────────── */
  /* ts (s, ascending) and vs -> uniform grid at fs over [t0, t1). ok[i] = 0 where the sample lies in a hole
     (no frame within maxGap seconds) or outside every segment. */
  function resample(ts, vs, t0, t1, fs, maxGap, segs) {
    var n = Math.max(0, Math.floor((t1 - t0) * fs));
    var x = new Float64Array(n), ok = new Uint8Array(n), j = 0;
    for (var i = 0; i < n; i++) {
      var t = t0 + i / fs;
      while (j < ts.length - 2 && ts[j + 1] < t) j++;
      if (ts.length < 2 || t < ts[0] || t > ts[ts.length - 1]) { x[i] = NaN; continue; }
      var a = ts[j], b = ts[j + 1];
      if (b < t) { x[i] = NaN; continue; }
      var gap = b - a, good = gap <= maxGap;
      if (segs) good = good && inSegs(segs, t);
      x[i] = vs[j] + (vs[j + 1] - vs[j]) * (gap > 0 ? (t - a) / gap : 0);
      ok[i] = good ? 1 : 0;
    }
    return { x: x, ok: ok, t0: t0, fs: fs };
  }
  function inSegs(segs, t) {
    for (var k = 0; k < segs.length; k++) if (t >= segs[k][0] && t <= segs[k][1]) return true;
    return false;
  }
  function runs(ok, minLen) {
    var out = [], s = -1;
    for (var i = 0; i <= ok.length; i++) {
      var v = i < ok.length && ok[i];
      if (v && s < 0) s = i;
      if (!v && s >= 0) { if (i - s >= minLen) out.push([s, i]); s = -1; }
    }
    return out;
  }

  /* ───────────── filters: RBJ biquads, run forward and backward (zero phase) ───────────── */
  function biquad(type, fc, fs, Q) {
    var w0 = 2 * Math.PI * fc / fs, cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * Q), b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    var a0 = 1 + al;
    return { b: [b0 / a0, b1 / a0, b2 / a0], a: [1, -2 * cw / a0, (1 - al) / a0] };
  }
  function filt(c, x) {
    var y = new Float64Array(x.length), x1 = x[0], x2 = x[0], y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
      var v = c.b[0] * x[i] + c.b[1] * x1 + c.b[2] * x2 - c.a[1] * y1 - c.a[2] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  function filtfilt(c, x) {
    var n = x.length; if (n < 8) return Float64Array.from(x);
    var pad = Math.min(n - 1, 120), ext = new Float64Array(n + 2 * pad), i;
    for (i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
    for (i = 0; i < n; i++) ext[pad + i] = x[i];
    for (i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    var f = filt(c, ext); f.reverse(); f = filt(c, f); f.reverse();
    return f.subarray(pad, pad + n);
  }
  function bandpass(x, fs, lo, hi) {
    var m = mean(x), z = new Float64Array(x.length);
    for (var i = 0; i < x.length; i++) z[i] = x[i] - m;
    var hp = biquad('hp', lo, fs, Math.SQRT1_2), lp = biquad('lp', hi, fs, Math.SQRT1_2);
    return filtfilt(lp, filtfilt(hp, z));
  }
  /* causal version, for the wave drawn on screen (no look-ahead, so it does not jump when a frame arrives) */
  function causalBandpass(fs, lo, hi) {
    var hp = biquad('hp', lo, fs, Math.SQRT1_2), lp = biquad('lp', hi, fs, Math.SQRT1_2);
    var s = { hx1: 0, hx2: 0, hy1: 0, hy2: 0, lx1: 0, lx2: 0, ly1: 0, ly2: 0, init: false };
    return function (v) {
      if (!s.init) { s.hx1 = s.hx2 = v; s.init = true; }
      var h = hp.b[0] * v + hp.b[1] * s.hx1 + hp.b[2] * s.hx2 - hp.a[1] * s.hy1 - hp.a[2] * s.hy2;
      s.hx2 = s.hx1; s.hx1 = v; s.hy2 = s.hy1; s.hy1 = h;
      var l = lp.b[0] * h + lp.b[1] * s.lx1 + lp.b[2] * s.lx2 - lp.a[1] * s.ly1 - lp.a[2] * s.ly2;
      s.lx2 = s.lx1; s.lx1 = h; s.ly2 = s.ly1; s.ly1 = l;
      return l;
    };
  }

  /* ───────────── the local period of the heart (from the autocorrelation of 10 s windows) ───────────── */
  /* returns { P: Float64Array (samples per beat, for every sample), acf: 0..1 (how periodic the segment is) } */
  function periodTrack(x, fs) {
    var n = x.length, W = Math.min(n, Math.round(10 * fs)), hop = Math.round(2 * fs);
    var lmin = Math.max(2, Math.round(0.33 * fs)), lmax = Math.min(Math.round(1.6 * fs), Math.floor(W / 2) - 2);
    var cx = [], cp = [], cs = [], a, l, i;
    if (lmax <= lmin + 2) return { P: null, acf: 0 };
    for (a = 0; ; a += hop) {
      var s = Math.min(a, n - W), e = s + W, r = new Float64Array(lmax + 2);
      for (l = lmin - 1; l <= lmax + 1; l++) {
        var sxy = 0, sxx = 0, syy = 0;
        for (i = s; i + l < e; i++) { var u = x[i], v = x[i + l]; sxy += u * v; sxx += u * u; syy += v * v; }
        r[l] = sxy / Math.sqrt(sxx * syy + 1e-12);
      }
      var rmax = 0, maxima = [];
      for (l = lmin; l <= lmax; l++) if (r[l] > r[l - 1] && r[l] >= r[l + 1] && r[l] > 0) { maxima.push(l); if (r[l] > rmax) rmax = r[l]; }
      var lag = 0;
      for (i = 0; i < maxima.length; i++) if (r[maxima[i]] >= 0.9 * rmax) { lag = maxima[i]; break; }
      if (lag) {
        var d = r[lag - 1] - 2 * r[lag] + r[lag + 1], off = d !== 0 ? 0.5 * (r[lag - 1] - r[lag + 1]) / d : 0;
        cx.push((s + e) / 2); cp.push(lag + clamp(off, -0.5, 0.5)); cs.push(r[lag]);
      } else { cx.push((s + e) / 2); cp.push(NaN); cs.push(0); }
      if (e >= n) break;
    }
    var good = [];
    for (i = 0; i < cp.length; i++) if (cs[i] >= 0.25 && isFinite(cp[i])) good.push(i);
    var acf = cs.length ? median(cs) : 0;
    var P = new Float64Array(n), St = new Float64Array(n);
    // strength track: linear between the window centres (how periodic the signal is around that sample)
    var wi = 0;
    for (i = 0; i < n; i++) {
      while (wi < cx.length - 1 && cx[wi + 1] <= i) wi++;
      var w1 = Math.min(wi + 1, cx.length - 1);
      St[i] = (i <= cx[wi] || w1 === wi) ? cs[wi] : cs[wi] + (cs[w1] - cs[wi]) * clamp((i - cx[wi]) / (cx[w1] - cx[wi]), 0, 1);
    }
    if (!good.length) { var fb = 0.9 * fs; for (i = 0; i < n; i++) P[i] = fb; return { P: P, S: St, acf: acf }; }
    var gi = 0;
    for (i = 0; i < n; i++) {
      while (gi < good.length - 1 && cx[good[gi + 1]] <= i) gi++;
      var k0 = good[gi], k1 = good[Math.min(gi + 1, good.length - 1)];
      if (i <= cx[k0] || k0 === k1) P[i] = cp[k0];
      else { var w = clamp((i - cx[k0]) / (cx[k1] - cx[k0]), 0, 1); P[i] = cp[k0] + (cp[k1] - cp[k0]) * w; }
    }
    return { P: P, S: St, acf: acf };
  }

  /* ───────────── beats ───────────── */
  /* the beats of a band-passed segment. Candidates are the local maxima; the chosen ones are the chain that
     maximises (heights) − (how far each gap strays from the local period).  Returns fractional sample
     indices and heights. */
  function detectPeaks(x, fs, isNcc) {
    var n = x.length, cand = [], i, j, k;
    for (i = 1; i < n - 1; i++) if (x[i] > 0 && x[i] > x[i - 1] && x[i] >= x[i + 1]) cand.push(i);
    if (cand.length < 3) return [];
    var pt = periodTrack(x, fs);
    if (!pt.P) return [];
    // heights relative to what the segment usually gives around that moment
    var m = cand.length, h = new Float64Array(m), win = Math.round(6 * fs), lo = 0, hi = 0;
    for (k = 0; k < m; k++) {
      while (cand[lo] < cand[k] - win) lo++;
      while (hi < m && cand[hi] <= cand[k] + win) hi++;
      var loc = []; for (j = lo; j < hi; j++) loc.push(x[cand[j]]);
      var ref = quantile(loc, 0.8) || 1e-9;
      h[k] = Math.min(2, x[cand[k]] / ref);
    }
    var ALPHA = 3.0, best = new Float64Array(m), prev = new Int32Array(m);
    for (k = 0; k < m; k++) {
      best[k] = h[k] >= 0.15 ? h[k] : 0; prev[k] = -1;
      if (h[k] < 0.15) continue;
      var Pk = pt.P[cand[k]];
      for (j = k - 1; j >= 0; j--) {
        var g = cand[k] - cand[j];
        if (g > 1.7 * Pk) break;
        if (g < 0.55 * Pk || h[j] < 0.15) continue;
        var v = best[j] - ALPHA * Math.pow(Math.log(g / Pk), 2) + h[k];
        if (v > best[k]) { best[k] = v; prev[k] = j; }
      }
    }
    var end = 0; for (k = 1; k < m; k++) if (best[k] > best[end]) end = k;
    var chain = [];
    for (k = end; k >= 0; k = prev[k]) chain.push(k);
    chain.reverse();
    return chain.map(function (kk) {
      var c = cand[kk], y0 = x[c - 1], y1 = x[c], y2 = x[c + 1], den = y0 - 2 * y1 + y2, d = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
      return { i: c + clamp(d, -0.5, 0.5), h: y1 };
    });
  }

  /* intervals between successive peaks, each marked valid or not.
     bad[k] (optional): the beat k was not a convincing beat — every interval that touches it is thrown out. */
  function intervals(peaksT, bad) {
    var nn = [], t = [], i;
    for (i = 1; i < peaksT.length; i++) { nn.push((peaksT[i] - peaksT[i - 1]) * 1000); t.push(peaksT[i]); }
    var valid = new Array(nn.length), K = 4;
    for (i = 0; i < nn.length; i++) {
      var nb = [];
      for (var j = Math.max(0, i - K); j <= Math.min(nn.length - 1, i + K); j++) if (j !== i) nb.push(nn[j]);
      var m = nb.length ? median(nb) : nn[i];
      valid[i] = nn[i] >= 350 && nn[i] <= 1600 && Math.abs(nn[i] - m) <= 0.24 * m && !(bad && (bad[i] || bad[i + 1]));
    }
    return { nn: nn, t: t, valid: valid };
  }

  /* ───────────── does it look like a heartbeat? ───────────── */
  var BEAT = { minCorr: 0.6, minStrength: 0.5, ampHigh: 3.0, ampLow: 0.25, minBeats: 6,
               minPeriodic: 0.30,               // autocorrelation at the beat period: a pulse is periodic, noise is not (0.17–0.22 vs 0.4–0.9)
               maxPulsatility: 0.12, minPulsatility: 0.0002 };   // peak-to-peak of the pulse over the mean level: a hand slosh is far above, a saturated channel far below

  /* the window of one beat: from 0.30 period before its peak to 0.55 after; and the two directions we throw away
     (the mean and the slope of the window — a drifting baseline must not decide what a beat looks like) */
  function beatFrame(P) {
    var pre = Math.max(3, Math.round(0.30 * P)), post = Math.max(4, Math.round(0.55 * P)), L = pre + post + 1, k;
    var e0 = new Float64Array(L), e1 = new Float64Array(L), n1 = 0;
    for (k = 0; k < L; k++) { e0[k] = 1 / Math.sqrt(L); e1[k] = k - (L - 1) / 2; n1 += e1[k] * e1[k]; }
    n1 = Math.sqrt(n1); for (k = 0; k < L; k++) e1[k] /= n1;
    return { pre: pre, post: post, L: L, e0: e0, e1: e1 };
  }
  /* windows around the given peaks, cleaned and made unit length (null where the window falls off the signal) */
  function beatSegments(x, idx, fr) {
    var out = [], i, k;
    for (i = 0; i < idx.length; i++) {
      var c = Math.round(idx[i]);
      if (c - fr.pre < 0 || c + fr.post >= x.length) { out.push(null); continue; }
      var seg = new Float64Array(fr.L), a0 = 0, a1 = 0, e = 0;
      for (k = 0; k < fr.L; k++) { var v = x[c - fr.pre + k]; a0 += v * fr.e0[k]; a1 += v * fr.e1[k]; }
      for (k = 0; k < fr.L; k++) { seg[k] = x[c - fr.pre + k] - a0 * fr.e0[k] - a1 * fr.e1[k]; e += seg[k] * seg[k]; }
      e = Math.sqrt(e);
      if (!(e > 1e-9)) { out.push(null); continue; }
      for (k = 0; k < fr.L; k++) seg[k] /= e;
      out.push(seg);
    }
    return out;
  }
  /* the typical beat: the median of the windows. Its length before we make it unit length says how much the beats
     agree with each other: near 1 for a steady pulse, near 0.1 for noise (the median of unrelated things is nothing). */
  function typicalBeat(segs, L) {
    var good = segs.filter(function (s) { return s; }), tpl = new Float64Array(L), k, i, te = 0;
    if (good.length < BEAT.minBeats) return null;
    for (k = 0; k < L; k++) { var col = []; for (i = 0; i < good.length; i++) col.push(good[i][k]); tpl[k] = median(col); te += tpl[k] * tpl[k]; }
    te = Math.sqrt(te);
    if (!(te > 1e-9)) return null;
    for (k = 0; k < L; k++) tpl[k] /= te;
    return { tpl: tpl, strength: te };
  }
  /* for every beat: how much it looks like the typical beat (-1..1, NaN where it cannot be told), and how big it is
     against the others. Returns { q, bad, sqi, strength }. */
  function beatQuality(bp, idx, fs, dc) {
    var n = idx.length, res = { q: new Array(n), bad: new Array(n), sqi: 0, strength: 0, periodic: 0, pulsatility: 0 }, i, k;
    for (i = 0; i < n; i++) { res.q[i] = NaN; res.bad[i] = true; }
    if (n < BEAT.minBeats) return res;
    var gaps = []; for (i = 1; i < n; i++) gaps.push(idx[i] - idx[i - 1]);
    var fr = beatFrame(median(gaps)), segs = beatSegments(bp, idx, fr), tb = typicalBeat(segs, fr.L), pt = periodTrack(bp, fs);
    res.periodic = pt.acf;
    if (!tb) return res;
    res.strength = tb.strength;
    var hs = idx.map(function (v) { return Math.abs(bp[Math.round(v)]); }), hm = median(hs), sum = 0, cnt = 0;
    res.pulsatility = dc > 0 ? 2 * hm / dc : 0;
    var levelBad = dc > 0 && (res.pulsatility > BEAT.maxPulsatility || res.pulsatility < BEAT.minPulsatility);
    for (i = 0; i < n; i++) {
      var amp = hs[i] > BEAT.ampHigh * hm || hs[i] < BEAT.ampLow * hm, per = pt.S ? pt.S[Math.round(idx[i])] : 1;
      if (segs[i]) { var d = 0; for (k = 0; k < fr.L; k++) d += segs[i][k] * tb.tpl[k]; res.q[i] = d; sum += clamp(d, 0, 1); cnt++; }
      res.bad[i] = levelBad || tb.strength < BEAT.minStrength || amp || per < BEAT.minPeriodic || (segs[i] ? res.q[i] < BEAT.minCorr : false);
    }
    res.sqi = cnt ? (sum / cnt) * Math.min(1, tb.strength / 0.85) * Math.min(1, pt.acf / 0.35) * (levelBad ? 0 : 1) : 0;
    return res;
  }

  /* Second look: slide the typical beat along the whole signal (normalised correlation) and pick the beats again
     on that — the whole pulse votes for its position, not one sample of its top. Timing gets steadier, a wrong
     local maximum (the dicrotic bump) stops winning. */
  function refineBeats(bp, first, fs) {
    if (first.length < 12) return first;
    var i, k, gaps = [];
    for (i = 1; i < first.length; i++) gaps.push(first[i].i - first[i - 1].i);
    var fr = beatFrame(median(gaps)), tb = typicalBeat(beatSegments(bp, first.map(function (p) { return p.i; }), fr), fr.L), n = bp.length;
    if (!tb) return first;
    var ncc = new Float64Array(n);
    for (i = fr.pre; i + fr.post < n; i++) {
      var a0 = 0, a1 = 0, sxx = 0, sxt = 0;
      for (k = 0; k < fr.L; k++) { var v = bp[i - fr.pre + k]; a0 += v * fr.e0[k]; a1 += v * fr.e1[k]; sxx += v * v; sxt += v * tb.tpl[k]; }
      var varx = sxx - a0 * a0 - a1 * a1;
      ncc[i] = varx > 1e-12 ? sxt / Math.sqrt(varx) : 0;
    }
    var second = detectPeaks(ncc, fs, true);
    return second.length >= 0.6 * first.length ? second.map(function (p) { return { i: p.i, h: bp[Math.round(p.i)] }; }) : first;
  }

  /* one channel, one polarity, all the segments of a window -> beats, intervals, quality */
  function scanChannel(rs, sign, opts) {
    var fs = rs.fs, peaksT = [], sqiNum = 0, sqiDen = 0, si;
    var segsIdx = runs(rs.ok, Math.round(4 * fs));                 // a stretch needs 4 s to be read
    var beatsBySeg = [];
    for (si = 0; si < segsIdx.length; si++) {
      var a = segsIdx[si][0], b = segsIdx[si][1], raw = new Float64Array(b - a), q;
      for (q = a; q < b; q++) raw[q - a] = sign * rs.x[q];
      var bp = bandpass(raw, fs, opts.hp || 0.5, opts.lp || 6.0);
      var pk = refineBeats(bp, detectPeaks(bp, fs), fs);
      var idx = pk.map(function (p) { return p.i; }), ts = idx.map(function (i) { return rs.t0 + (a + i) / fs; });
      var dc = 0; for (q = a; q < b; q++) dc += Math.abs(rs.x[q]); dc /= (b - a);
      var bq = beatQuality(bp, idx, fs, dc);
      beatsBySeg.push({ t: ts, idx: idx, bad: bq.bad, q: bq.q, bp: bp, a: a, b: b });
      sqiNum += bq.sqi * idx.length; sqiDen += idx.length;
    }
    // intervals never span two stretches
    var nn = [], nt = [], valid = [], qs = [];
    beatsBySeg.forEach(function (bs) {
      if (bs.t.length < 2) return;
      var iv = intervals(bs.t, bs.bad);
      for (var q = 0; q < iv.nn.length; q++) { nn.push(iv.nn[q]); nt.push(iv.t[q]); valid.push(iv.valid[q]); }
      bs.t.forEach(function (t, k) { peaksT.push(t); });
      bs.q.forEach(function (v) { if (isFinite(v)) qs.push(v); });
    });
    var validTime = 0; for (var q2 = 0; q2 < nn.length; q2++) if (valid[q2]) validTime += nn[q2] / 1000;
    var goodTime = 0; for (q2 = 0; q2 < rs.ok.length; q2++) goodTime += rs.ok[q2] ? 1 / fs : 0;
    return { peaksT: peaksT, nn: nn, nt: nt, valid: valid, sqi: sqiDen ? sqiNum / sqiDen : 0, beatQ: qs,
             coverage: goodTime > 0 ? clamp(validTime / goodTime, 0, 1) : 0, goodTime: goodTime, sign: sign };
  }

  /* ───────────── the intervals as a wave: FFT of the tachogram ───────────── */
  function fft(re, im) {
    var n = re.length, i, j = 0, k;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function polyDetrend(y, order) {
    var n = y.length, m = order + 1, i, j, k, A = [], b = [];
    for (j = 0; j < m; j++) { A.push(new Float64Array(m)); b.push(0); }
    for (i = 0; i < n; i++) {
      var u = 2 * i / (n - 1) - 1, pw = [1]; for (j = 1; j < 2 * m; j++) pw.push(pw[j - 1] * u);
      for (j = 0; j < m; j++) { for (k = 0; k < m; k++) A[j][k] += pw[j + k]; b[j] += y[i] * pw[j]; }
    }
    for (j = 0; j < m; j++) {                                   // gauss
      var p = j; for (i = j + 1; i < m; i++) if (Math.abs(A[i][j]) > Math.abs(A[p][j])) p = i;
      var tmp = A[j]; A[j] = A[p]; A[p] = tmp; var tb = b[j]; b[j] = b[p]; b[p] = tb;
      for (i = j + 1; i < m; i++) { var f = A[i][j] / A[j][j]; for (k = j; k < m; k++) A[i][k] -= f * A[j][k]; b[i] -= f * b[j]; }
    }
    var c = new Array(m);
    for (j = m - 1; j >= 0; j--) { var s = b[j]; for (k = j + 1; k < m; k++) s -= A[j][k] * c[k]; c[j] = s / A[j][j]; }
    var out = new Float64Array(n);
    for (i = 0; i < n; i++) { var uu = 2 * i / (n - 1) - 1, v = 0, pp = 1; for (j = 0; j < m; j++) { v += c[j] * pp; pp *= uu; } out[i] = y[i] - v; }
    return out;
  }

  /* runs of valid intervals; a hole shorter than MAX_HOLE (an interval thrown out, a missed beat) is bridged,
     a longer one splits the series. Each run is rebuilt as a continuous 4 Hz series of interval lengths. */
  function tachStretches(nn, nt, valid, minSeconds) {
    var out = [], cur = null, lastT = -1e9;
    function close() { if (cur && cur.t.length > 1 && cur.t[cur.t.length - 1] - cur.t[0] >= minSeconds) out.push(cur); cur = null; }
    for (var i = 0; i < nn.length; i++) {
      if (!valid[i]) continue;
      if (cur && nt[i] - lastT > MAX_HOLE) close();
      if (!cur) cur = { t: [], v: [] };
      cur.t.push(nt[i]); cur.v.push(nn[i]); lastT = nt[i];
    }
    close();
    return out;
  }
  function tachSeries(st) {
    var t0 = st.t[0], t1 = st.t[st.t.length - 1], n = Math.floor((t1 - t0) * FS_T) + 1, y = new Float64Array(n), j = 0;
    for (var i = 0; i < n; i++) {
      var t = t0 + i / FS_T;
      while (j < st.t.length - 2 && st.t[j + 1] < t) j++;
      var a = st.t[j], b = st.t[j + 1], u = b > a ? clamp((t - a) / (b - a), 0, 1) : 0;
      y[i] = st.v[j] + (st.v[j + 1] - st.v[j]) * u;
    }
    return y;
  }
  /* The lock-in. For each stretch: detrend, Hann window, zero-padded FFT.
       total   the variance between 0.04 and 0.40 Hz (ms²) — Parseval, the whole spectrum counted
       locked  the power of the strongest steady wave within ±LOCK of f0 (ms², amplitude²/2) — read at the peak of
               the amplitude spectrum, so the window's spread does not eat it
     Stretches are averaged, the longer ones weighing more. */
  function lockIn(stretches, f0) {
    var lockedNum = 0, totalNum = 0, W = 0, fpeakNum = 0, df = FS_T / NFFT, used = 0;
    stretches.forEach(function (st) {
      var y = tachSeries(st), n = y.length;
      if (n < 8 * FS_T) return;
      y = polyDetrend(y, (n / FS_T) >= 150 ? 2 : 1);
      var re = new Float64Array(NFFT), im = new Float64Array(NFFT), sw = 0, sw2 = 0, k;
      for (var i = 0; i < n; i++) { var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); re[i] = y[i] * w; sw += w; sw2 += w * w; }
      fft(re, im);
      var tot = 0, pk = 0, pkf = f0;
      for (k = 1; k < NFFT / 2; k++) {
        var f = k * df, p2 = re[k] * re[k] + im[k] * im[k];
        if (f >= BAND[0] && f <= BAND[1]) tot += 2 * p2 / (FS_T * sw2) * df;
        if (f >= f0 - LOCK && f <= f0 + LOCK) { var v = 2 * p2 / (sw * sw); if (v > pk) { pk = v; pkf = f; } }
      }
      lockedNum += pk * n; totalNum += tot * n; fpeakNum += pkf * n; W += n; used += (n - 1) / FS_T;
    });
    if (!W) return null;
    var total = totalNum / W, locked = Math.min(lockedNum / W, total);
    if (!(total > 0)) return null;
    return { R: clamp(locked / total, 0, 1), ampMs: Math.sqrt(2 * locked), lockedVar: locked, totalVar: total, fPeak: fpeakNum / W, seconds: used };
  }

  /* ───────────── the scores ───────────── */
  function testScore(st) { return st ? Math.round(100 * Math.sqrt((1 - Math.exp(-st.ampMs / AMP_SCALE)) * st.R)) : null; }
  function cohNote(st) { return st ? Math.round(10 * st.R * Math.min(1, st.ampMs / AMP_GATE_NOTE) * 10) / 10 : null; }

  /* the five rhythms of the test, breaths a minute, in the order they are run */
  var RHYTHMS = [6.5, 6.0, 5.5, 5.0, 4.5];
  /* the winner of a test: the highest score; a tie goes to the rhythm closest to 6.0, and between two equally close, the slower. scores: five numbers or null. */
  function winnerOf(scores) {
    var best = -1;
    for (var i = 0; i < scores.length; i++) {
      if (scores[i] === null || scores[i] === undefined) continue;
      if (best < 0 || scores[i] > scores[best]) { best = i; continue; }
      if (scores[i] === scores[best]) {
        var di = Math.abs(RHYTHMS[i] - 6), db = Math.abs(RHYTHMS[best] - 6);
        if (di < db || (di === db && RHYTHMS[i] < RHYTHMS[best])) best = i;       // as close to 6 as it gets; if both are, the slower
      }
    }
    return best;
  }

  /* heart rate on a fixed grid, for the curve of a day (null where no beat was read) */
  function hrCurve(scan, t0, t1, step) {
    var out = [], bt = [], hr = [];
    for (var i = 0; i < scan.nn.length; i++) if (scan.valid[i]) { bt.push(scan.nt[i]); hr.push(60000 / scan.nn[i]); }
    var j0 = 0;
    for (var t = t0 + step / 2; t < t1; t += step) {
      while (j0 < bt.length - 1 && bt[j0 + 1] < t) j0++;
      var best = -1, bd = 1e9;
      for (var j = Math.max(0, j0 - 1); j <= Math.min(bt.length - 1, j0 + 2); j++) { var d = Math.abs(bt[j] - t); if (d < bd) { bd = d; best = j; } }
      out.push(best >= 0 && bd <= 3 ? Math.round(hr[best] * 2) / 2 : null);
    }
    return out;
  }

  /* ───────────── one window, start to finish ───────────── */
  /* win: { t: [s], r: [], g: [], segs: [[t0,t1]...] } — opts: { pace (breaths a minute) or f0 (Hz), spectral: bool, curve: bool } */
  function analyzeWindow(win, opts) {
    opts = opts || {};
    var n = win.t.length, res = { ok: false, reason: 'short', durationS: 0, coverage: 0, sqi: 0, nBeats: 0, nValid: 0 };
    if (n < 2 * FS) return res;
    var segs = win.segs && win.segs.length ? win.segs : [[win.t[0], win.t[n - 1]]];
    var t0 = segs[0][0], t1 = segs[segs.length - 1][1], dur = 0;
    segs.forEach(function (s) { dur += s[1] - s[0]; });
    res.durationS = dur;
    var best = null;
    ['r', 'g'].forEach(function (ch) {
      if (!win[ch]) return;
      var rs = resample(win.t, win[ch], t0, t1, FS, 0.25, segs);
      [1, -1].forEach(function (sign) {
        var sc = scanChannel(rs, sign, opts), score = sc.coverage * sc.sqi;
        if (!best || score > best.score) best = { score: score, scan: sc, ch: ch, sign: sign, rs: rs };
      });
    });
    if (!best) return res;
    var sc = best.scan, valid = [], i;
    for (i = 0; i < sc.nn.length; i++) if (sc.valid[i]) valid.push(sc.nn[i]);
    res.coverage = sc.coverage; res.sqi = sc.sqi; res.nBeats = sc.peaksT.length; res.nValid = valid.length; res.chan = best.ch; res.pol = best.sign;
    if (valid.length < QUALITY.minBeats * Math.min(1, dur / 60)) { res.reason = 'few-beats'; return res; }
    var mn = mean(valid);
    res.hr = 60000 / mn;
    var d2 = 0, dn = 0;
    for (i = 1; i < sc.nn.length; i++) if (sc.valid[i] && sc.valid[i - 1] && sc.nt[i] - sc.nt[i - 1] < 2.0) { var d = sc.nn[i] - sc.nn[i - 1]; d2 += d * d; dn++; }
    res.rmssd = dn ? Math.sqrt(d2 / dn) : null;
    var v = 0; valid.forEach(function (x) { v += (x - mn) * (x - mn); }); res.sdnn = valid.length > 1 ? Math.sqrt(v / (valid.length - 1)) : null;
    if (opts.spectral) {
      var f0 = opts.f0 || (opts.pace / 60);
      var minS = Math.max(20, 2 / f0 * 1.2);
      var st = tachStretches(sc.nn, sc.nt, sc.valid, minS), cs = lockIn(st, f0);
      res.spectral = cs; res.spectralSeconds = cs ? cs.seconds : 0;
      if (cs) { res.R = cs.R; res.ampMs = cs.ampMs; res.testScore = testScore(cs); res.cohNote = cohNote(cs); }
    }
    if (opts.curve) res.curve = hrCurve(sc, t0, t1, 2);
    res.beats = sc.peaksT;
    res.ok = res.coverage >= QUALITY.minCoverage && res.sqi >= QUALITY.minSqi && (!opts.spectral || (!!res.spectral && res.spectralSeconds >= 0.5 * dur));
    res.reason = res.ok ? 'ok' : (res.coverage < QUALITY.minCoverage ? 'low-coverage' : (res.sqi < QUALITY.minSqi ? 'low-quality' : 'short-stretches'));
    return res;
  }

  /* ───────────── the last seconds, live ───────────── */
  /* win: the last frames { t, r, g } (about 10 s). Is there a steady pulse right now? */
  function liveScan(win, pref) {
    var n = win.t.length, out = { steady: false, hr: null, beats: [], n: 0, sqi: 0, chan: null, pol: 1 };
    if (n < 4 * FS) return out;
    var t0 = win.t[0], t1 = win.t[n - 1], best = null;
    var chans = pref && pref.chan ? [pref.chan] : ['r', 'g'], signs = pref && pref.pol ? [pref.pol] : [1, -1];
    chans.forEach(function (ch) {
      var rs = resample(win.t, win[ch], t0, t1, FS, 0.25, null);
      signs.forEach(function (sign) {
        var sc = scanChannel(rs, sign, {}), score = sc.coverage * sc.sqi;
        if (!best || score > best.score) best = { score: score, scan: sc, ch: ch, sign: sign };
      });
    });
    var sc = best.scan;
    out.chan = best.ch; out.pol = best.sign; out.sqi = sc.sqi;
    var last = [], i;
    for (i = sc.nn.length - 1; i >= 0 && last.length < 6; i--) { if (!sc.valid[i]) break; last.unshift(sc.nn[i]); }
    out.beats = sc.peaksT; out.n = last.length;
    if (last.length >= 4) {
      var m = mean(last), sd = 0; last.forEach(function (x) { sd += (x - m) * (x - m); }); sd = Math.sqrt(sd / last.length);
      out.hr = 60000 / m;
      var lastBeat = sc.peaksT[sc.peaksT.length - 1];
      out.steady = last.length >= 5 && sd / m < 0.14 && sc.sqi >= 0.6 && (t1 - lastBeat) < 2.0;
    }
    return out;
  }

  return {
    FS: FS, QUALITY: QUALITY, BAND: BAND, LOCK: LOCK, AMP_SCALE: AMP_SCALE, AMP_GATE_NOTE: AMP_GATE_NOTE,
    resample: resample, bandpass: bandpass, causalBandpass: causalBandpass, detectPeaks: detectPeaks, refineBeats: refineBeats, periodTrack: periodTrack,
    intervals: intervals, beatQuality: beatQuality, lockIn: lockIn, tachStretches: tachStretches, fft: fft, polyDetrend: polyDetrend,
    RHYTHMS: RHYTHMS, winnerOf: winnerOf, testScore: testScore, cohNote: cohNote, hrCurve: hrCurve,
    analyzeWindow: analyzeWindow, liveScan: liveScan, median: median, mean: mean, quantile: quantile
  };
});
