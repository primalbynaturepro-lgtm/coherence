'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../js/model.js');
const Store = require('../../js/store.js');

const T = (iso, hh, mm) => { const p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], hh || 8, mm || 0, 0).getTime(); };
const sess = (iso, kind, extra, hh) => Object.assign({ id: 'x' + Math.random(), ts: T(iso, hh || 8, 5), day: iso, kind, secs: 300, rhythm: 5.5, rest: null, hrv: null, coh: null, curve: null }, extra || {});

test('days: keys, arithmetic across month ends and daylight saving', () => {
  assert.strictEqual(M.dayKey(T('2026-09-29', 23, 59)), '2026-09-29');
  assert.strictEqual(M.addDays('2026-09-29', 1), '2026-09-30');
  assert.strictEqual(M.addDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(M.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(M.addDays('2028-03-01', -1), '2028-02-29');
  assert.strictEqual(M.addDays('2026-10-24', 2), '2026-10-26');          // the clocks go back on the 25th in Europe
  assert.strictEqual(M.addDays('2026-03-28', 2), '2026-03-30');          // and forward on the 29th
  assert.strictEqual(M.weekday('2026-09-29'), 1);                        // a Tuesday
  assert.strictEqual(M.weekday('2026-09-28'), 0);
  assert.strictEqual(M.weekday('2026-10-04'), 6);
  assert.strictEqual(M.mondayOf('2026-10-04'), '2026-09-28');
  assert.strictEqual(M.longDate('2026-09-29'), 'Tuesday 29 September');
  assert.strictEqual(M.shortDate('2026-08-11'), 'Tue 11 Aug');
  assert.strictEqual(M.dayMonth('2026-09-28'), '28 Sep');
});

test('a day: latest session per kind, readings, sighs', () => {
  const p = Store.emptyProfile('mehdi');
  p.sessions.push(sess('2026-09-29', 'morning', { rest: 60, hrv: 40, coh: 6 }, 7));
  p.sessions.push(sess('2026-09-29', 'morning', { rest: 62, hrv: 48, coh: 7.8 }, 9));            // done twice: the later one shows
  p.sessions.push(sess('2026-09-29', 'late', {}, 17));
  p.sos.push({ id: 'a', ts: T('2026-09-29', 21, 5), day: '2026-09-29', n: 2 }, { id: 'b', ts: T('2026-09-29', 22, 0), day: '2026-09-29', n: 1 });
  p.cyc.push({ id: 'c', ts: T('2026-09-29', 18, 10), day: '2026-09-29', secs: 300 });
  const d = M.dayInfo(p, '2026-09-29');
  assert.deepStrictEqual(d.kinds, ['morning', 'late']);
  assert.strictEqual(d.n, 2);
  assert.strictEqual(d.reading.rest, 62);
  assert.strictEqual(d.sos.n, 2); assert.strictEqual(d.sos.sighs, 3);
  assert.strictEqual(d.cyc.secs, 300);
  assert.strictEqual(M.dayInfo(p, '2026-09-28').n, 0);
  assert.strictEqual(M.dayInfo(p, '2026-09-28').reading, null);
});

test('a morning without reading counts as a session but not as a reading', () => {
  const p = Store.emptyProfile('adri');
  p.sessions.push(sess('2026-09-29', 'morning', {}));
  assert.strictEqual(M.dayInfo(p, '2026-09-29').n, 1);
  assert.strictEqual(M.dayInfo(p, '2026-09-29').reading, null);
  assert.strictEqual(M.hasReadings(p), false);
  assert.strictEqual(M.hasSessions(p), true);
  assert.strictEqual(M.latestReading(p), null);
  p.sessions.push(sess('2026-09-30', 'morning', { rest: 58 }));                              // a resting heart alone is a reading
  assert.strictEqual(M.hasReadings(p), true);
  assert.strictEqual(M.latestReading(p).rest, 58);
});

test('the week: seven days ending today, oldest first', () => {
  const p = Store.emptyProfile('mehdi');
  ['morning', 'midday', 'late'].forEach(k => p.sessions.push(sess('2026-09-29', k)));
  p.sessions.push(sess('2026-09-27', 'morning'), sess('2026-09-27', 'midday'), sess('2026-09-23', 'late'), sess('2026-09-22', 'late'));
  assert.deepStrictEqual(M.weekCounts(p, '2026-09-29'), [1, 0, 0, 0, 2, 0, 3]);      // 23 24 25 26 27 28 29 — the 22nd is out
  assert.deepStrictEqual(M.weekInitials('2026-09-29'), ['W', 'T', 'F', 'S', 'S', 'M', 'T']);
});

test('weeks: Monday to Sunday means of the morning readings, gaps kept', () => {
  const p = Store.emptyProfile('mehdi');
  p.sessions.push(sess('2026-08-10', 'morning', { rest: 66, hrv: 40, coh: 5 }));
  p.sessions.push(sess('2026-08-14', 'morning', { rest: 64, hrv: 44, coh: 5.4 }));
  p.sessions.push(sess('2026-09-28', 'morning', { rest: 60, hrv: 60, coh: 8 }));
  p.sessions.push(sess('2026-09-29', 'morning', { rest: 58, hrv: 64, coh: 8.4 }));
  p.sessions.push(sess('2026-09-29', 'midday', {}));
  const w = M.weeklySeries(p, '2026-09-29', 8);
  assert.deepStrictEqual(w.starts[0], '2026-08-10'); assert.strictEqual(w.starts[7], '2026-09-28');
  assert.strictEqual(w.rest[0], 65); assert.strictEqual(w.rest[1], null); assert.strictEqual(w.rest[7], 59);
  assert.strictEqual(w.hrv[0], 42); assert.strictEqual(w.coh[7], 8.2);
  assert.strictEqual(w.coh[3], null);
});

test('the test in progress: valid for a day, resumes at the first rhythm without a score', () => {
  const p = Store.emptyProfile('mehdi');
  const now = T('2026-09-29', 10, 0);
  assert.strictEqual(M.partialInfo(p, now).valid, false);
  p.partial = { scores: [{ s: 40 }, { s: 55 }, null, null, null], savedAt: now - 3600 * 1000 };
  let i = M.partialInfo(p, now);
  assert.strictEqual(i.valid, true); assert.strictEqual(i.stopAt, 3); assert.strictEqual(i.done, 2); assert.deepStrictEqual(i.scores, [40, 55, null, null, null]);
  p.partial.scores = [{ s: 40 }, null, { s: 60 }, { s: 50 }, { s: 20 }];                              // rhythm 2 was unreadable: it is the one to redo
  i = M.partialInfo(p, now); assert.strictEqual(i.stopAt, 2); assert.strictEqual(i.complete, false);
  p.partial.scores[1] = { s: 66 };
  i = M.partialInfo(p, now); assert.strictEqual(i.complete, true); assert.strictEqual(i.stopAt, 0);
  p.partial.savedAt = now - 25 * 3600 * 1000;
  assert.strictEqual(M.partialInfo(p, now).valid, false);
});

test('the calendar: Monday-first offset, month steps, limits', () => {
  const mo = M.monthOf('2026-09-29');
  assert.deepStrictEqual(mo, { y: 2026, m: 8 });
  const g = M.monthGrid(mo);
  assert.strictEqual(g.title, 'September 2026'); assert.strictEqual(g.days, 30); assert.strictEqual(g.offset, 1);   // the 1st is a Tuesday
  assert.deepStrictEqual(M.monthStep(mo, 4), { y: 2027, m: 0 });
  assert.deepStrictEqual(M.monthStep({ y: 2026, m: 0 }, -1), { y: 2025, m: 11 });
  assert.strictEqual(M.monthGrid({ y: 2028, m: 1 }).days, 29);
  const p = Store.emptyProfile('mehdi');
  assert.strictEqual(M.canStep(p, mo, -1, '2026-09-29'), false);           // nothing before the first day
  assert.strictEqual(M.canStep(p, mo, 1, '2026-09-29'), false);            // nothing after today
  p.sessions.push(sess('2026-07-15', 'morning'));
  assert.strictEqual(M.canStep(p, mo, -1, '2026-09-29'), true);
  assert.strictEqual(M.canStep(p, M.monthStep(mo, -1), -1, '2026-09-29'), true);
  assert.strictEqual(M.canStep(p, M.monthStep(mo, -2), -1, '2026-09-29'), false);
  assert.strictEqual(M.canStep(p, M.monthStep(mo, -1), 1, '2026-09-29'), true);
});

/* ───────────── the store ───────────── */
test('store: round trip through a backend, in order, with the other person kept apart', async () => {
  Store._reset();
  const be = new Store.Memory();
  await Store.init({ backend: be });
  assert.strictEqual(Store.meta.unlocked, false);
  await Store.setMeta({ unlocked: true, sound: 'note', vol: 0.4 });
  await Store.load('mehdi'); await Store.load('adri');
  await Store.update('mehdi', p => { p.rhythm = { value: 5.5, scores: [1, 2, 3, 2, 1], at: 1, date: '2026-09-29' }; p.sessions.push(sess('2026-09-29', 'morning', { rest: 60 })); });
  await Store.update('adri', p => { p.sos.push({ id: 'q', ts: 5, day: '2026-09-29', n: 1 }); });
  await Store.flush();
  Store._reset();
  await Store.init({ backend: be });
  assert.strictEqual(Store.meta.unlocked, true); assert.strictEqual(Store.meta.sound, 'note'); assert.strictEqual(Store.meta.vol, 0.4);
  const m = await Store.load('mehdi'), a = await Store.load('adri');
  assert.strictEqual(m.rhythm.value, 5.5); assert.strictEqual(m.sessions.length, 1); assert.strictEqual(m.sos.length, 0);
  assert.strictEqual(a.rhythm, null); assert.strictEqual(a.sos.length, 1); assert.strictEqual(a.sessions.length, 0);
});

test('store: garbage in the documents does not break the app', async () => {
  Store._reset();
  const be = new Store.Memory();
  be.data['meta'] = JSON.stringify({ unlocked: 'yes', sound: 'trumpet', vol: 7, ring: 'z' });
  be.data['profile:mehdi'] = JSON.stringify({ rhythm: { value: 'fast' }, sessions: [{ kind: 'nap', ts: 1 }, { kind: 'morning', ts: 'x' }, { kind: 'late', ts: 9, day: '2026-09-29' }], sos: 5, cyc: [null] });
  await Store.init({ backend: be });
  assert.strictEqual(Store.meta.unlocked, false); assert.strictEqual(Store.meta.sound, 'bowl'); assert.strictEqual(Store.meta.vol, 1); assert.strictEqual(Store.meta.ring, 'b');
  const m = await Store.load('mehdi');
  assert.strictEqual(m.rhythm, null); assert.strictEqual(m.sessions.length, 1); assert.deepStrictEqual(m.sos, []); assert.deepStrictEqual(m.cyc, []);
  await assert.rejects(Store.load('mallory'));
});

test('store: a phone that refuses storage falls back to memory, and says so', async () => {
  Store._reset();
  const broken = { setItem() { throw new Error('denied'); }, getItem() { throw new Error('denied'); }, removeItem() {} };
  global.localStorage = broken;
  const r = await Store.init();
  assert.strictEqual(r.backend, 'memory'); assert.strictEqual(r.volatile, true);
  await Store.load('adri'); await Store.update('adri', p => { p.cyc.push({ id: 'z', ts: 1, day: '2026-09-29', secs: 300 }); });
  assert.strictEqual(Store.profile('adri').cyc.length, 1);
  delete global.localStorage;
});

test('store: localStorage backend keeps a corrupt document aside instead of erasing it', async () => {
  Store._reset();
  const mem = {}; const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  mem['coh:v1:profile:mehdi'] = '{"sessions":[{"kind":';
  await Store.init({ backend: new Store.Local(ls) });
  const p = await Store.load('mehdi');
  assert.strictEqual(p.sessions.length, 0);
  assert.ok(Object.keys(mem).some(k => k.indexOf('coh:v1:corrupt:profile:mehdi') === 0));
  assert.strictEqual(Store.lastError.kind, 'corrupt');
});

test('store: export then import into another phone', async () => {
  Store._reset();
  const a = new Store.Memory(); await Store.init({ backend: a });
  await Store.load('mehdi'); await Store.update('mehdi', p => { p.sessions.push(sess('2026-09-29', 'midday')); });
  const text = await Store.exportAll();
  Store._reset();
  const b = new Store.Memory(); await Store.init({ backend: b });
  await Store.importAll(text);
  const p = await Store.load('mehdi');
  assert.strictEqual(p.sessions.length, 1); assert.strictEqual(p.sessions[0].kind, 'midday');
  await assert.rejects(Store.importAll('{"hello":1}'));
  await assert.rejects(Store.importAll('not json'));
});
