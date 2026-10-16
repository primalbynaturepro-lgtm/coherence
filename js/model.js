/* model.js — questions the screens ask about what is stored. Pure: no screen, no clock of its own, no storage.
 *
 * Days are local calendar days, written 'YYYY-MM-DD'. A week is Monday to Sunday. A "session" is one of the three
 * of the day (morning, midday, late); if one was done twice the day, the later one is the one that shows.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.COH = root.COH || {}; root.COH.model = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['morning', 'midday', 'late'];
  var DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var HOLD_MS = 24 * 3600 * 1000;                    // a half-finished test stays valid for a day

  /* ───────────── days ───────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }          // at noon: no daylight-saving surprises
  function addDays(iso, n) { var d = parseDay(iso); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }
  function weekday(iso) { return (parseDay(iso).getDay() + 6) % 7; }                                             // Monday = 0
  function today(nowTs) { return dayKey(nowTs === undefined ? Date.now() : nowTs); }
  function dow(iso) { return DOW[weekday(iso)]; }
  function dom(iso) { return +iso.slice(8, 10); }
  function mon(iso) { return MON[+iso.slice(5, 7) - 1]; }
  function longDate(iso) { return dow(iso) + ' ' + dom(iso) + ' ' + mon(iso); }                                   // Tuesday 29 September
  function shortDate(iso) { return dow(iso).slice(0, 3) + ' ' + dom(iso) + ' ' + mon(iso).slice(0, 3); }          // Tue 29 Sep
  function dayMonth(iso) { return dom(iso) + ' ' + mon(iso).slice(0, 3); }                                        // 29 Sep
  function initial(iso) { return dow(iso).charAt(0); }
  function clock(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function mondayOf(iso) { return addDays(iso, -weekday(iso)); }

  /* ───────────── what a day holds ───────────── */
  function rec(x) { return x && typeof x === 'object'; }
  function hasReading(s) { return !!s && (s.rest != null || s.hrv != null || s.coh != null); }

  function sessionsOn(p, iso) {
    var by = {};
    p.sessions.forEach(function (s) { if (s.day === iso && (!by[s.kind] || s.ts >= by[s.kind].ts)) by[s.kind] = s; });
    return by;
  }
  function dayInfo(p, iso) {
    var by = sessionsOn(p, iso), kinds = KINDS.filter(function (k) { return !!by[k]; });
    var sos = p.sos.filter(function (s) { return s.day === iso; }), cyc = p.cyc.filter(function (s) { return s.day === iso; });
    var sighs = 0, last = 0;
    sos.forEach(function (s) { sighs += s.n || 1; last = Math.max(last, s.ts); });
    var cs = 0, cl = 0;
    cyc.forEach(function (s) { cs += s.secs || 300; cl = Math.max(cl, s.ts); });
    return {
      iso: iso, by: by, kinds: kinds, n: kinds.length,
      reading: hasReading(by.morning) ? by.morning : null,
      sos: { n: sos.length, sighs: sighs, at: last || null },
      cyc: { n: cyc.length, secs: cs, at: cl || null }
    };
  }
  function doneKinds(p, iso) { return dayInfo(p, iso).kinds; }

  /* the seven days that end today, oldest first: how many of the three sessions were done each day */
  function weekCounts(p, todayIso) {
    var out = [], i;
    for (i = 6; i >= 0; i--) out.push(dayInfo(p, addDays(todayIso, -i)).n);
    return out;
  }
  function weekInitials(todayIso) { var out = [], i; for (i = 6; i >= 0; i--) out.push(initial(addDays(todayIso, -i))); return out; }

  function hasSessions(p) { return p.sessions.length > 0; }
  function hasReadings(p) { return p.sessions.some(function (s) { return s.kind === 'morning' && hasReading(s); }); }
  function latestReading(p) {
    var best = null;
    p.sessions.forEach(function (s) { if (s.kind === 'morning' && hasReading(s) && (!best || s.ts >= best.ts)) best = s; });
    return best;
  }

  /* the morning readings, week by week (Monday to Sunday), for the n weeks that end this week */
  function weeklySeries(p, todayIso, n) {
    var m0 = mondayOf(todayIso), starts = [], i;
    for (i = n - 1; i >= 0; i--) starts.push(addDays(m0, -7 * i));
    var acc = starts.map(function () { return { rest: [], hrv: [], coh: [] }; });
    p.sessions.forEach(function (s) {
      if (s.kind !== 'morning' || !hasReading(s)) return;
      for (var w = n - 1; w >= 0; w--) {
        if (s.day >= starts[w]) { if (s.day <= addDays(starts[w], 6)) { if (s.rest != null) acc[w].rest.push(s.rest); if (s.hrv != null) acc[w].hrv.push(s.hrv); if (s.coh != null) acc[w].coh.push(s.coh); } break; }
      }
    });
    function avg(a) { if (!a.length) return null; var t = 0; a.forEach(function (x) { t += x; }); return t / a.length; }
    return { starts: starts, rest: acc.map(function (a) { return avg(a.rest); }), hrv: acc.map(function (a) { return avg(a.hrv); }), coh: acc.map(function (a) { return avg(a.coh); }) };
  }

  /* ───────────── the rhythm and the test in progress ───────────── */
  function rhythmValue(p) { return p && p.rhythm ? p.rhythm.value : null; }
  function partialInfo(p, nowTs) {
    var pt = p && p.partial, empty = { valid: false, done: 0, complete: false, stopAt: 0, scores: [null, null, null, null, null], raw: [null, null, null, null, null] };
    if (!pt || !Array.isArray(pt.scores)) return empty;
    if (nowTs - pt.savedAt > HOLD_MS) return empty;
    var raw = [0, 1, 2, 3, 4].map(function (i) { return rec(pt.scores[i]) && isFinite(pt.scores[i].s) ? pt.scores[i] : null; });
    var done = raw.filter(function (x) { return !!x; }).length, first = raw.indexOf(null);
    return { valid: done > 0, done: done, complete: done === 5, stopAt: done > 0 && done < 5 ? first + 1 : 0, scores: raw.map(function (x) { return x ? x.s : null; }), raw: raw };
  }

  /* ───────────── the calendar ───────────── */
  function monthOf(iso) { return { y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1 }; }
  function monthStep(mo, d) { var t = mo.y * 12 + mo.m + d; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; }
  function monthIso(mo, day) { return mo.y + '-' + pad(mo.m + 1) + '-' + pad(day); }
  function monthGrid(mo) {
    var first = monthIso(mo, 1), n = new Date(mo.y, mo.m + 1, 0).getDate();
    return { title: MON[mo.m] + ' ' + mo.y, offset: weekday(first), days: n };
  }
  function firstDay(p) {
    var d = null;
    [p.sessions, p.sos, p.cyc].forEach(function (a) { a.forEach(function (s) { if (s.day && (!d || s.day < d)) d = s.day; }); });
    return d;
  }
  function canStep(p, mo, d, todayIso) {
    var next = monthStep(mo, d), cur = monthOf(todayIso), fd = firstDay(p), first = fd ? monthOf(fd) : cur;
    var k = function (x) { return x.y * 12 + x.m; };
    return k(next) <= k(cur) && k(next) >= k(first);
  }

  return {
    KINDS: KINDS, DOW: DOW, MON: MON, HOLD_MS: HOLD_MS,
    dayKey: dayKey, parseDay: parseDay, addDays: addDays, weekday: weekday, today: today, dow: dow, dom: dom, mon: mon,
    longDate: longDate, shortDate: shortDate, dayMonth: dayMonth, initial: initial, clock: clock, mondayOf: mondayOf,
    hasReading: hasReading, sessionsOn: sessionsOn, dayInfo: dayInfo, doneKinds: doneKinds, weekCounts: weekCounts, weekInitials: weekInitials,
    hasSessions: hasSessions, hasReadings: hasReadings, latestReading: latestReading, weeklySeries: weeklySeries,
    rhythmValue: rhythmValue, partialInfo: partialInfo,
    monthOf: monthOf, monthStep: monthStep, monthIso: monthIso, monthGrid: monthGrid, firstDay: firstDay, canStep: canStep
  };
});
