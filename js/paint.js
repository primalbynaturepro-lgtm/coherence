/* paint.js — the words and figures of each screen, from what is stored.
 *
 * Each painter fills the bound spots (data-bind="…") of one screen. They only read: model.js for the questions,
 * the store for the documents, COH.ST for the story of this visit. Scales, as decided: coherence note out of 10
 * (one decimal), test score out of 100, variability in ms, resting heart in beats a minute.
 */
(function (root) {
  'use strict';
  var COH = root.COH = root.COH || {};
  var doc = root.document, M = COH.model, ST = COH.ST, A = COH.analysis;

  function $(sel, r) { return (r || doc).querySelector(sel); }
  function $$(sel, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(sel)); }
  function sec(id) { return doc.getElementById('s-' + id); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function f1(n) { return r1(n).toFixed(1); }
  function pace(v) { return r1(v).toFixed(1); }
  function has(v) { return v !== null && v !== undefined && isFinite(v); }

  var NAMES = { adri: 'Adri', mehdi: 'Mehdi' };
  var KIND = { morning: 'Morning', midday: 'Midday', late: 'Late afternoon' };
  var SOUND = { note: 'A note', bowl: 'A bowl', breath: 'A breath' };
  var ICON = {
    sound: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'
  };

  function profile() { return COH.store.profile(ST.who) || COH.store.emptyProfile(ST.who || 'mehdi'); }
  function meta() { return COH.store.meta; }
  function rhythm() { return M.rhythmValue(profile()); }
  function bind(sid, key, val) { $$('[data-bind="' + key + '"]', sec(sid)).forEach(function (e) { e.textContent = val; }); }
  function bindHtml(sid, key, val) { $$('[data-bind="' + key + '"]', sec(sid)).forEach(function (e) { e.innerHTML = val; }); }

  /* ───────────── small drawings: arcs, sparklines, the heart curve ───────────── */
  function pol(cx, cy, r, a) { var t = a * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }
  function arc(cx, cy, r, a0, a1) { var p0 = pol(cx, cy, r, a0), p1 = pol(cx, cy, r, a1); return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2); }
  function miniRing(n, size) {
    size = size || 34; var c = size / 2, r = c - 3.5, out = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">';
    for (var i = 0; i < 3; i++) out += '<path d="' + arc(c, c, r, -90 + i * 120 + 14, -90 + (i + 1) * 120 - 14) + '"' + (i < n ? ' class="on"' : '') + '/>';
    return out + '</svg>';
  }
  /* week by week: a value or null for each week; weeks without a reading are bridged, not invented */
  function spark(vals) {
    var w = 320, h = 64, px = 8, py = 9, n = vals.length, have = vals.filter(has);
    if (!have.length) return '';
    var mn = Math.min.apply(null, have), mx = Math.max.apply(null, have);
    if (mx === mn) { mx += 1; mn -= 1; }
    var pts = [];
    vals.forEach(function (v, i) { if (has(v)) pts.push([px + i * (w - 2 * px) / Math.max(1, n - 1), h - py - (v - mn) / (mx - mn) * (h - 2 * py)]); });
    var last = pts[pts.length - 1], out = '';
    if (pts.length > 1) {
      var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
      out += '<path class="sp-a" d="' + d + ' L' + last[0].toFixed(1) + ' ' + h + ' L' + pts[0][0].toFixed(1) + ' ' + h + ' Z"/><path class="sp-l" d="' + d + '"/>';
    }
    return out + pts.map(function (q, i) { return '<circle class="' + (i === pts.length - 1 ? 'sp-e' : 'sp-d') + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + (i === pts.length - 1 ? 4.5 : 2.4) + '"/>'; }).join('');
  }
  /* the heart across the morning: one minute at rest, then five of coherence (a dashed line marks the change) */
  function curve(vals, split) {
    var have = vals.filter(has);
    if (have.length < 3) return '';
    var mn = Math.min.apply(null, have), mx = Math.max.apply(null, have), mid = (mn + mx) / 2, span = Math.max(12, mx - mn) * 1.15;
    var n = vals.length, d = '', pen = false;
    vals.forEach(function (v, i) {
      if (!has(v)) { pen = false; return; }
      var x = i / Math.max(1, n - 1) * 320, y = 48 - (v - mid) / span * 88;
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + Math.max(4, Math.min(92, y)).toFixed(1) + ' '; pen = true;
    });
    var sx = split > 0 && split < n ? (split / Math.max(1, n - 1) * 320).toFixed(1) : null;
    return '<path class="cv" d="' + d + '"/>' + (sx ? '<path class="cv-s" d="M' + sx + ' 6 L' + sx + ' 90"/>' : '');
  }
  function paintSegs(sid, done, cur, frac) {
    $$('.segs i', sec(sid)).forEach(function (e, i) {
      var on = !!done[i];
      e.className = on ? 'on' : '';
      e.style.setProperty('--f', on ? '1' : (i === cur ? String(frac || 0) : '0'));
    });
  }

  var P = {};

  /* ───────────── home ───────────── */
  P.accueil = function () {
    var p = profile(), r = rhythm(), locked = r == null, today = M.today(), di = M.dayInfo(p, today), pi = M.partialInfo(p, Date.now());
    bind('accueil', 'acWho', NAMES[ST.who] || ''); bind('accueil', 'acDate', M.longDate(today));
    bind('accueil', 'acRhythm', locked ? '—' : pace(r));
    bind('accueil', 'lockTxt', pi.stopAt > 0 ? 'You stopped at rhythm ' + pi.stopAt + ' of 5. Pick up where you left off.' : 'Fifteen minutes, once. Your sessions open right after.');
    bind('accueil', 'lockBtn', pi.stopAt > 0 ? 'Resume the test' : 'Take the test');
    var s = sec('accueil');
    M.KINDS.forEach(function (k) {
      var e = $('[data-do="kind:' + k + '"]', s), done = di.kinds.indexOf(k) >= 0;
      e.className = 'sr ' + (locked ? 'locked' : (done ? 'done' : 'todo'));
      bind('accueil', 'srt-' + k, locked ? 'Locked' : (done ? 'Done' : 'Not yet'));
    });
    var wc = M.weekCounts(p, today), ini = M.weekInitials(today);
    $$('.wkd', s).forEach(function (d, i) { var w = $('.wk', d), b = $('b', d); w.innerHTML = miniRing(wc[i]); if (b) b.textContent = ini[i]; });
    bind('accueil', 'wkN', String(wc.reduce(function (a, b) { return a + b; }, 0)));
    var lr = M.latestReading(p);
    if (lr) {
      var ser = M.weeklySeries(p, today, 8);
      bind('accueil', 'hLbl', lr.day === today ? 'Your heart · this morning' : 'Your heart · last reading');
      bind('accueil', 'hRest', has(lr.rest) ? String(Math.round(lr.rest)) : '—');
      bind('accueil', 'hCoh', has(lr.coh) ? f1(lr.coh) : '—');
      bind('accueil', 'hVar', has(lr.hrv) ? Math.round(lr.hrv) + ' ms' : '—');
      bindHtml('accueil', 'hSpark', spark(ser.rest));
    }
  };

  /* ───────────── progress ───────────── */
  function deltaText(a, unit, dec) {
    var idx = [], i; a.forEach(function (v, k) { if (has(v)) idx.push(k); });
    if (idx.length < 2) return 'Week by week';
    var d = a[idx[idx.length - 1]] - a[idx[0]], weeks = idx[idx.length - 1] - idx[0] + 1, over = ' in ' + weeks + ' weeks';           // weeks of measuring, counted as the drawing does: eight weekly points = "8 weeks"
    var shown = dec ? r1(Math.abs(d)) : Math.round(Math.abs(d));
    if (shown === 0) return 'Steady over ' + weeks + ' weeks';
    return (d > 0 ? '+' : '−') + shown + unit + over;
  }
  P.progres = function () {
    var p = profile(), today = M.today(), lr = M.latestReading(p);
    if (lr) {
      var ser = M.weeklySeries(p, today, 8);
      bind('progres', 'pg-rest', has(lr.rest) ? String(Math.round(lr.rest)) : '—');
      bind('progres', 'pg-var', has(lr.hrv) ? String(Math.round(lr.hrv)) : '—');
      bind('progres', 'pg-coh', has(lr.coh) ? f1(lr.coh) : '—');
      bindHtml('progres', 'pgs-rest', spark(ser.rest)); bindHtml('progres', 'pgs-var', spark(ser.hrv)); bindHtml('progres', 'pgs-coh', spark(ser.coh));
      bind('progres', 'pgd-rest', deltaText(ser.rest, '', false)); bind('progres', 'pgd-var', deltaText(ser.hrv, ' ms', false)); bind('progres', 'pgd-coh', deltaText(ser.coh, '', true));
      bind('progres', 'wkFrom', M.dayMonth(ser.starts[0])); bind('progres', 'wkTo', M.dayMonth(ser.starts[ser.starts.length - 1]));
    }
    P.calendar();
    var pr = p.rhythm;
    bind('progres', 'pgRhythm', pr ? pace(pr.value) : '—');
    bind('progres', 'pgTested', pr ? 'tested ' + M.shortDate(pr.date) : '');
  };
  P.calendar = function () {
    var s = sec('progres'), cal = $('.cal', s), p = profile(), today = M.today();
    if (!ST.month) ST.month = M.monthOf(today);
    var mo = ST.month, g = M.monthGrid(mo), html = 'MTWTFSS'.split('').map(function (d) { return '<span class="calh">' + d + '</span>'; }).join(''), i;
    for (i = 0; i < g.offset; i++) html += '<span class="calb" aria-hidden="true"></span>';
    for (i = 1; i <= g.days; i++) {
      var iso = M.monthIso(mo, i), dd = (i < 10 ? '0' : '') + i;
      if (iso <= today) {
        var info = M.dayInfo(p, iso);
        html += '<button class="cal-c' + (iso === today ? ' today' : '') + '" type="button" data-id="progres/day-' + dd + '" data-how="push" data-go="jour" data-do="day:' + iso + '"' +
                ' aria-label="' + M.longDate(iso) + ', ' + info.n + ' of 3 sessions"><b>' + i + '</b><i class="wk">' + miniRing(info.n, 26) + '</i></button>';
      } else html += '<span class="cal-c off" data-id="progres/day-' + dd + '" data-how="dead"><b>' + i + '</b></span>';
    }
    cal.innerHTML = html;
    bind('progres', 'calTitle', g.title);
    $$('[data-do^="calStep:"]', s).forEach(function (b) { var d = +b.getAttribute('data-do').slice(8); b.disabled = !M.canStep(p, mo, d, today); });
  };

  /* ───────────── one day ───────────── */
  P.jour = function () {
    var p = profile(), iso = ST.day || M.today(), today = M.today(), info = M.dayInfo(p, iso);
    bind('jour', 'jShort', M.shortDate(iso)); bind('jour', 'jTitle', M.longDate(iso));
    M.KINDS.forEach(function (k) {
      var rec = info.by[k];
      bind('jour', 'j-' + k + '-t', rec ? '5 minutes · ' + M.clock(rec.ts) + (k === 'morning' && !M.hasReading(rec) ? ' · no reading' : '') : (iso === today ? 'Not yet' : 'Not done'));
      bind('jour', 'j-' + k + '-s', rec ? (k === 'morning' && has(rec.coh) ? f1(rec.coh) + ' / 10' : '✓') : '—');
    });
    var rd = info.reading;
    if (rd) {
      bind('jour', 'jRest', has(rd.rest) ? String(Math.round(rd.rest)) : '—'); bind('jour', 'jVar', has(rd.hrv) ? String(Math.round(rd.hrv)) : '—'); bind('jour', 'jCoh', has(rd.coh) ? f1(rd.coh) : '—');
      bindHtml('jour', 'jCurve', rd.curve ? curve(rd.curve, rd.curveAt || 0) : '');
    }
    var so = info.sos, cy = info.cyc;
    bind('jour', 'j-sos-t', so.n ? (so.n === 1 ? M.clock(so.at) + ' · ' + so.sighs + (so.sighs === 1 ? ' sigh' : ' sighs') : so.n + ' times · ' + so.sighs + ' sighs') : 'None');
    bind('jour', 'j-sos-s', so.n ? '✓' : '—');
    bind('jour', 'j-cyc-t', cy.n ? (cy.n === 1 ? '5 minutes · ' + M.clock(cy.at) : cy.n + ' × 5 minutes') : 'None');
    bind('jour', 'j-cyc-s', cy.n ? '✓' : '—');
  };

  /* ───────────── the rhythm and its test ───────────── */
  P.rythme = function (shown) {                                   // shown: a result not yet accepted, when we come from the result screen
    var pr = shown || profile().rhythm;
    if (!pr) return;
    var sc = pr.scores || [], best = sc.indexOf(Math.max.apply(null, sc.filter(has)));
    bind('rythme', 'ryNum', pace(pr.value)); bind('rythme', 'ryDate', M.longDate(pr.date));
    $$('.prow', sec('rythme')).forEach(function (row) {
      var i = +row.getAttribute('data-i'), v = has(sc[i]) ? sc[i] : 0;
      $('.pb i', row).style.width = v + '%'; $('b', row).textContent = has(sc[i]) ? String(sc[i]) : '—';
      row.classList.toggle('best', A.RHYTHMS[i] === pr.value);
    });
  };
  P.testIntro = function () {
    var p = profile(), pr = p.rhythm, pi = M.partialInfo(p, Date.now());
    bind('test-intro', 'tiTitle', pi.stopAt > 0 ? 'Pick up where you stopped.' : (pr ? 'Find your rhythm again.' : 'Let’s find your rhythm.'));
    bind('test-intro', 'tiNow', pr ? pace(pr.value) : '—'); bind('test-intro', 'tiNowDate', pr ? 'Tested ' + M.shortDate(pr.date) : '');
    bind('test-intro', 'tiStop', 'You stopped at rhythm ' + pi.stopAt + ' of 5.'); bind('test-intro', 'tiResume', 'Resume at rhythm ' + pi.stopAt);
  };
  function doneFlags() { var pi = M.partialInfo(profile(), Date.now()); return pi.scores.map(function (x) { return x !== null; }); }
  P.testPalier = function (frac) {
    bind('test-palier', 'pn', 'Rhythm ' + ST.palier + ' of 5'); bind('test-palier', 'pbpm', pace(A.RHYTHMS[ST.palier - 1]));
    paintSegs('test-palier', doneFlags(), ST.palier - 1, frac || 0);
  };
  P.testPause = function () {
    var flags = doneFlags();
    flags[ST.palier - 1] = true;                                  // the rhythm just finished shows as done at once; its score follows a moment later
    bind('test-pause', 'pdone', 'Rhythm ' + ST.palier + ' done');
    paintSegs('test-pause', flags, -1, 0);
  };
  P.testArreter = function () {
    var first = M.partialInfo(profile(), Date.now()).scores.indexOf(null);          // the rhythm to pick up at: the first without a valid score
    bind('test-arreter', 'pn2', String(first < 0 ? ST.palier : first + 1));
  };
  P.testResultat = function () {
    var pd = ST.pending; if (!pd) return;
    var best = A.RHYTHMS.indexOf(pd.rhythm);
    bind('test-resultat', 'rNum', pace(pd.rhythm)); bind('test-resultat', 'rBest', String(best + 1)); bind('test-resultat', 'rUse', 'Use ' + pace(pd.rhythm) + ' a minute');
    $$('.rbar', sec('test-resultat')).forEach(function (b) {
      var i = +b.getAttribute('data-i'), v = pd.scores[i];
      $('i', b).style.height = Math.round((has(v) ? v : 0) * 0.9) + 'px'; $('i', b).setAttribute('data-v', has(v) ? v : '');
      b.classList.toggle('best', i === best);
    });
  };
  P.testRemplacer = function () {
    var pr = profile().rhythm, pd = ST.pending;
    bind('test-remplacer', 'oldNum', pr ? pace(pr.value) : '—'); bind('test-remplacer', 'oldDate', pr ? M.shortDate(pr.date) : '');
    bind('test-remplacer', 'newNum', pd ? pace(pd.rhythm) : '—');
  };

  /* ───────────── after a session ───────────── */
  function doneToday() { var d = (ST.lastSession && ST.lastSession.day) || M.today(); return M.dayInfo(profile(), d).n; }       // the day the session belongs to
  P.finMatin = function () {
    var s = ST.lastSession || {};
    bind('fin-matin', 'fmCoh', has(s.coh) ? f1(s.coh) : '—'); bind('fin-matin', 'fmRest', has(s.rest) ? String(Math.round(s.rest)) : '—'); bind('fin-matin', 'fmVar', has(s.hrv) ? String(Math.round(s.hrv)) : '—');
    bind('fin-matin', 'fmToday', doneToday() + ' of 3');
  };
  P.finSeance = function () {
    var k = (ST.lastSession && ST.lastSession.kind) || ST.kind;
    bind('fin-seance', 'fsKind', KIND[k] + ' session'); bind('fin-seance', 'fsToday', doneToday() + ' of 3');
  };
  P.finSansNote = function () { bind('fin-sans-note', 'fsnToday', doneToday() + ' of 3'); };
  P.seancePrete = function () { bind('seance-prete', 'kindName', KIND[ST.kind]); bind('seance-prete', 'spRhythm', pace(rhythm() || 6)); };
  P.seance = function () { bind('seance', 'kindName', KIND[ST.kind]); bind('seance', 'pbpm', pace(rhythm() || 6)); };
  P.sos = function () { bind('sos', 'sosN', 'Sigh ' + ST.sighs + ' of 3'); };
  P.sosEncore = function () { bind('sos-encore', 'sosDone', 'Sigh ' + ST.sighs + ' done'); };
  P.sosFin = function () { bind('sos-fin', 'sosLog', ST.sighs <= 1 ? 'One sigh' : ST.sighs + ' sighs'); };

  /* ───────────── settings ───────────── */
  P.reglages = function () {
    var pr = profile().rhythm, m = meta();
    bind('reglages', 'rgInitial', (NAMES[ST.who] || '?').charAt(0)); bind('reglages', 'rgWho', NAMES[ST.who] || '');
    bind('reglages', 'rgSound', SOUND[m.sound] + ' · volume ' + Math.round(m.vol * 100));
    bind('reglages', 'rgRing', m.ring === 'a' ? 'Version A · a film' : 'Version B · drawn live');
    bind('reglages', 'rgRhythm', pr ? pace(pr.value) + ' a minute · tested ' + M.shortDate(pr.date) : 'Not found yet');
    bind('reglages', 'rgData', COH.store.volatile ? 'Not kept — this browser blocks storage' : (COH.store.lastError ? 'The last save failed — storage is full or blocked' : 'Saved on this phone'));
    bind('reglages', 'version', COH.VERSION || '');
  };
  P.reglagesSon = function () {
    var s = sec('reglages-son'), m = meta();
    $$('.snd', s).forEach(function (e) { e.classList.toggle('on', e.getAttribute('data-sound') === m.sound); });
    var v = $('input[data-vol]', s); if (v) v.value = String(Math.round(m.vol * 100));
  };
  function paintSound() {
    var mute = !!meta().mute;
    $$('.sndbtn').forEach(function (b) { b.innerHTML = mute ? ICON.mute : ICON.sound; b.classList.toggle('off', mute); b.setAttribute('aria-pressed', mute ? 'true' : 'false'); });
  }
  function paintBlink() { $$('.dogm').forEach(function (d) { d.classList.toggle('still', !meta().blink); }); }

  /* ───────────── the code ───────────── */
  function paintDots(sid) { $$('.dots i', sec(sid)).forEach(function (e, i) { e.className = i < ST.buf.length ? 'on' : ''; }); }

  COH.paint = {
    P: P, bind: bind, bindHtml: bindHtml, spark: spark, curve: curve, miniRing: miniRing, paintSegs: paintSegs, paintSound: paintSound, paintBlink: paintBlink, paintDots: paintDots,
    KIND: KIND, NAMES: NAMES, f1: f1, pace: pace
  };
})(typeof self !== 'undefined' ? self : this);
