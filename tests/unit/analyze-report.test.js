'use strict';
/* node --test tests/unit/
   The tool that reads the lab's raw report (scripts/analyze-report.js) is checked on fake reports whose truth is known:
   it must find the heart rate that was put in, notice a damaged paste, and say the right thing when the picture is bad. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require(path.join(__dirname, '../../scripts/analyze-report.js'));
const { makeReport } = require('./report-fixture.js');

const say = (res) => res.verdict.map(v => v.text).join(' | ');

test('the hooks into analysis.js still match (a change there must be followed here)', () => {
  const A = M.loadAnalysis();
  assert.ok(A.__x && typeof A.__x.scan === 'function' && A.__x.BEAT && A.__x.QUALITY);
});

test('a good finger: the pulse is found in the spectrum, the app reads it, the numbers agree with the truth', () => {
  const rep = makeReport({ check: true }), res = M.analyze(rep);
  assert.deepEqual(res.problems, []);
  assert.ok(Math.abs(res.variants[0].decision.hr - rep.truth.hr) < 1, 'chain hr ' + res.variants[0].decision.hr);
  const p = res.pulseSearch.r;
  assert.ok(Math.abs(p.medianBpm - rep.truth.hr) < 4 && p.strong >= 0.9 * p.n, 'spectrum ' + p.medianBpm);
  assert.match(say(res), /a pulse IS in the signal/);
  assert.match(say(res), /the app reads it/);
  assert.ok(Math.abs(res.timing.fps - 30) < 1.5);
  assert.ok(res.levels.fingerStrict > 0.99);
  const text = M.render(res);
  assert.match(text, /REPORT ANALYSIS/); assert.match(text, /verdict/);
});

test('a damaged paste is caught by the sums', () => {
  const rep = makeReport({ check: true });
  rep.samples.r[100] += 0.01;                                          // one digit changed
  assert.match(M.analyze(rep).problems.join(' '), /check sum of r differs/);
  const rep2 = makeReport({ check: true });
  rep2.samples.g.pop();                                                // a cut paste
  const res2 = M.analyze(rep2);
  assert.match(res2.problems.join(' '), /lengths differ/);
});

test('a report with no samples says how to get them', () => {
  const res = M.analyze({ ua: 'x', at: 'now' });
  assert.match(res.error, /Copier avec les mesures brutes/);
  assert.match(M.render(res), /✗/);
});

test('text around the JSON (a chat message) is tolerated, garbage is refused with a reason', () => {
  const rep = makeReport({});
  const wrapped = 'Voici le rapport :\n```json\n' + JSON.stringify(rep) + '\n```\nmerci';
  assert.equal(M.extractJSON(wrapped).samples.dt.length, rep.samples.dt.length);
  assert.throws(() => M.extractJSON('rien à voir'), /no JSON/);
  assert.throws(() => M.extractJSON('{"a": [1, 2,'), /no JSON|not valid JSON/);
  assert.throws(() => M.extractJSON(JSON.stringify(rep).slice(0, 3000) + '}'), /not valid JSON/);
});

test('no finger on the lens: it says so, and that there is no pulse to read', () => {
  const res = M.analyze(makeReport({ finger: { acR: 0, acG: 0, dcR: 120, dcG: 118 } }));
  assert.match(say(res), /finger was seen on the lens only/);
  assert.match(say(res), /no steady pulse/);
});

test('a red channel that saturates is pointed out, and the green one still reads', () => {
  const res = M.analyze(makeReport({ finger: { dcR: 254, dcG: 60, acG: 1.4 } }));
  assert.match(say(res), /red channel is saturated/);
  assert.equal(res.variants[0].decision.ok, true);
  assert.equal(res.variants[0].decision.chan, 'g');
});

test('a pulse too weak for the spectrum is called weak, not invented', () => {
  const res = M.analyze(makeReport({ finger: { acR: 0.5, acG: 0.2, noise: 0.35 } }));
  assert.doesNotMatch(say(res), /a pulse IS in the signal/);
  assert.match(say(res), /no steady pulse|comes and goes/);
});

test('a slow clock that only ticks with the screen is noticed; a clean one is not', () => {
  const ok = M.analyze(makeReport({ quantise: 16.667, timeSrc: 'now' }));
  assert.doesNotMatch(say(ok), /clock ticks unevenly/);
  const bad = makeReport({ timeSrc: 'now' });
  const jit = bad.samples.dt.map((d, i) => d + ((i * 7919) % 41) - 20);                                        // ±20 ms of scatter on each date
  for (let i = 1; i < jit.length; i++) if (jit[i] <= jit[i - 1]) jit[i] = jit[i - 1] + 1;
  bad.samples.dt = jit; delete bad.samples.check;
  assert.match(say(M.analyze(bad)), /clock ticks unevenly/);
});

test('a finger that left for a while makes two stretches, and the gap is not taken for a fault', () => {
  const rep = makeReport({ dur: 44 });
  const s = rep.samples, t0 = s.t0, cut0 = 15000, cut1 = 19000;          // the frames between 15 s and 19 s were not recorded
  const keep = s.dt.map((d, i) => (d < cut0 || d >= cut1) ? i : -1).filter(i => i >= 0);
  const pick = (a) => keep.map(i => a[i]);
  rep.samples = { t0: t0, unit: s.unit, dt: pick(s.dt), r: pick(s.r), g: pick(s.g), segs: [[t0, t0 + (cut0 - 34) / 1000], [t0 + cut1 / 1000, t0 + s.dt[s.dt.length - 1] / 1000]] };
  const res = M.analyze(rep);
  assert.equal(res.timing.stretches, 2);
  assert.equal(res.timing.gaps250, 0);
  assert.doesNotMatch(say(res), /hole\(s\) longer than 250 ms/);
  assert.equal(res.variants[0].decision.ok, true, res.variants[0].decision.reason);
});

test('tiny or damaged inputs never crash it, they are named', () => {
  const cut = (n) => { const rep = makeReport({}); ['dt', 'r', 'g'].forEach(k => { rep.samples[k] = rep.samples[k].slice(0, n); }); delete rep.samples.check; rep.samples.segs = [[rep.samples.t0, rep.samples.t0 + n / 30]]; return rep; };
  [0, 2, 10].forEach(n => { const res = M.analyze(cut(n)); assert.match(res.error, /too few to analyse/); assert.ok(M.render(res).length > 50); });
  const holes = makeReport({}); holes.samples.r[50] = null; holes.samples.g[60] = null;
  assert.match(M.analyze(holes).problems.join(' '), /not numbers/);
  const back = makeReport({}); back.samples.dt[200] = back.samples.dt[100];
  assert.match(M.analyze(back).problems.join(' '), /time does not increase/);
  const flat = makeReport({ finger: { acR: 0, acG: 0, dcR: 255, dcG: 255 } });
  assert.match(say(M.analyze(flat)), /saturated/);
});

test('a hole in the frames is reported as a hole, not as a badly ticking clock', () => {
  const rep = makeReport({}), s = rep.samples, k = s.dt.map((d, i) => (d > 10000 && d < 12000) ? -1 : i).filter(i => i >= 0);
  ['dt', 'r', 'g'].forEach(key => { s[key] = k.map(i => s[key][i]); }); delete s.check;
  const res = M.analyze(rep);
  assert.equal(res.timing.gaps250, 1);
  assert.doesNotMatch(say(res), /clock ticks unevenly/);
});
