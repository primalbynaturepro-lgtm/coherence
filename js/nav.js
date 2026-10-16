/* nav.js — one screen at a time, and the way from one to the next.
 *
 * The screens are <section class="scr" id="s-<id>"> in index.html, all present, one shown (class "on"). What a tap does
 * is written on the element itself, as in the drawing:
 *
 *   data-go="id"         the screen this leads to
 *   data-how="…"         how it arrives: push (slides in) · back (slides out) · sheet (rises) · swap / wait (no slide)
 *   data-dyn="name"      the destination depends on the story so far: COH.nav.DEST[name]() decides, at the moment of the tap
 *   data-do="name:arg"   something happens besides moving: COH.nav.DO[name](arg, element) runs first (return false: do not move)
 *   data-when="cond"     shown only while COH.nav.COND[cond]() is true ("!cond": only while false)
 *
 * Screens ask to be told when they arrive or leave: COH.nav.onEnter(id, fn(prev, how)), COH.nav.onLeave(id, fn(next)).
 * The old screen leaves as a frozen copy, so the new one can slide over it; a sheet rises over a frozen copy of what was there.
 */
(function (root) {
  'use strict';
  var COH = root.COH = root.COH || {};
  var doc = root.document;

  /* what lives for one visit (nothing here is remembered: what is remembered is in store.js) */
  var ST = COH.ST = COH.ST || {};
  var defaults = { who: null, kind: 'morning', palier: 1, sighs: 1, noRead: false, redoing: false, redoFrom: 'progres', pending: null, buf: '',
                   day: null, month: null, failFrom: 'test-doigt', resumeTo: 'seance', pauseWhy: 'user', sosRec: null, session: null };
  Object.keys(defaults).forEach(function (k) { if (!(k in ST)) ST[k] = defaults[k]; });

  function $(sel, r) { return (r || doc).querySelector(sel); }
  function $$(sel, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(sel)); }
  function sec(id) { return doc.getElementById('s-' + id); }

  var app = null, SCREENS = [], SHEETS = [], lastShown = null, prevShown = null, pendingHow = null, ghostTimer = 0, timers = [];
  var DEST = {}, DO = {}, COND = {}, enterFns = {}, leaveFns = {}, from = {}, sheetBack = 'accueil';

  function later(fn, ms) { var t = setTimeout(function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ───────────── conditions ───────────── */
  function applyWhen(id) {
    var s = sec(id); if (!s) return;
    $$('[data-when]', s).forEach(function (e) {
      var k = e.getAttribute('data-when'), neg = k.charAt(0) === '!';
      if (neg) k = k.slice(1);
      var v = COND[k] ? !!COND[k]() : true;
      e.classList.toggle('hidden', neg ? v : !v);
    });
  }

  /* ───────────── the old screen leaves as a frozen copy ───────────── */
  var STRIP = ['id', 'data-id', 'data-how', 'data-do', 'data-go', 'data-dyn', 'data-bind', 'data-when', 'tabindex'];
  function freeze(el) {
    var c = el.cloneNode(true), a = $$('video', el), b = $$('video', c);
    a.forEach(function (v, i) {
      try {
        var cn = doc.createElement('canvas'); cn.width = v.videoWidth || 320; cn.height = v.videoHeight || 320;
        cn.getContext('2d').drawImage(v, 0, 0, cn.width, cn.height); cn.className = 'vsnap'; b[i].parentNode.replaceChild(cn, b[i]);
      } catch (e) { if (b[i] && b[i].parentNode) b[i].parentNode.removeChild(b[i]); }
    });
    [c].concat($$('*', c)).forEach(function (n) { STRIP.forEach(function (k) { n.removeAttribute(k); }); });
    c.setAttribute('inert', ''); c.setAttribute('aria-hidden', 'true');
    return c;
  }
  function removeGhosts() {
    clearTimeout(ghostTimer);
    $$('.xghost').forEach(function (g) { g.parentNode.removeChild(g); });
    $$('.scr').forEach(function (s) { s.classList.remove('in-push', 'in-back', 'in-sheet'); });
  }

  function fire(map, id, a, b) {
    (map[id] || []).concat(map['*'] || []).forEach(function (fn) {
      try { fn(a, b, id); } catch (err) { if (root.console) console.error('nav ' + id + ': ' + (err && err.stack || err)); }
    });
  }

  /* ───────────── moving ───────────── */
  function show(id, how) {
    var prev = lastShown;
    clearTimers(); removeGhosts();
    if (prev) fire(leaveFns, prev, id);
    var next = sec(id), old = prev ? sec(prev) : null;
    var toSheet = SHEETS.indexOf(id) >= 0, fromSheet = !!prev && SHEETS.indexOf(prev) >= 0;
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (how === 'wait' || how === 'swap' || how === 'dead') how = null;

    if (how !== 'back' && prev && prev !== id && !fromSheet) from[id] = prev;                         // where we came from, for the doors that lead back
    if (toSheet && prev && !fromSheet && prev !== id) sheetBack = prev;

    var oldBody = old ? $('.body', old) : null, oldScroll = oldBody ? oldBody.scrollTop : 0, underScroll = 0, ghost = null;
    if (!reduce && old && prev !== id && old !== next) {
      if (how === 'push' && !toSheet) { ghost = freeze(old); ghost.className = 'xghost g-push'; }
      else if (how === 'back' && !fromSheet) { ghost = freeze(old); ghost.className = 'xghost g-back'; }
      else if (fromSheet) { ghost = freeze(old); ghost.className = 'xghost g-sheetout'; }
    }
    if (toSheet) {
      var under = $('.under', next), base = sec(sheetBack);
      if (under && base) {
        var bb = $('.body', base); underScroll = bb ? bb.scrollTop : 0;
        under.innerHTML = ''; var fz = freeze(base); fz.className = 'frozen'; under.appendChild(fz);
      }
    }
    SCREENS.forEach(function (s) { var e = sec(s); if (e) e.classList.remove('on'); });
    next.classList.add('on');
    if (!reduce && prev !== id) {
      if (how === 'push' && !toSheet) next.classList.add('in-push');
      else if (how === 'back' && !fromSheet) next.classList.add('in-back');
      else if ((how === 'sheet' || toSheet) && how !== 'back') next.classList.add('in-sheet');
    }
    if (ghost) { app.appendChild(ghost); var gb = $('.body', ghost); if (gb) gb.scrollTop = oldScroll; }
    if (toSheet && underScroll) { var fb = $('.under .frozen .body', next); if (fb) fb.scrollTop = underScroll; }
    ghostTimer = setTimeout(removeGhosts, 360);
    $$('.body', next).forEach(function (b) { b.scrollTop = 0; });
    prevShown = prev; lastShown = id;
    applyWhen(id);
    fire(enterFns, id, prev, how);
    applyWhen(id);
    if (root.CustomEvent) doc.dispatchEvent(new CustomEvent('coh:screen', { detail: { id: id, prev: prev, how: how } }));
  }

  function go(id, how) {
    if (SCREENS.indexOf(id) < 0) { if (root.console) console.error('nav: no screen ' + id); return false; }
    var h = how !== undefined ? how : pendingHow; pendingHow = null;
    try { show(id, h); } catch (err) { if (root.console) console.error('go ' + id + ': ' + (err && err.stack || err)); return false; }
    return true;
  }

  /* ───────────── taps ───────────── */
  function parseDo(spec) { var i = spec.indexOf(':'); return { name: i < 0 ? spec : spec.slice(0, i), arg: i < 0 ? '' : spec.slice(i + 1) }; }
  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-do],[data-go],[data-dyn]') : null;
    if (!el || (el.closest && el.closest('.xghost'))) return;
    var how = el.getAttribute('data-how'), dyn = el.getAttribute('data-dyn'), dest = null;
    if (dyn && DEST[dyn]) dest = DEST[dyn](); else dest = el.getAttribute('data-go');       // the destination is settled before anything changes
    var spec = el.getAttribute('data-do'), stay = false;
    if (spec) { var d = parseDo(spec); if (DO[d.name] && DO[d.name](d.arg, el, e) === false) stay = true; }
    if (dest && !stay) go(dest, how);
  }
  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON') { e.preventDefault(); t.click(); }
  }

  function init() {
    app = $('.app');
    SCREENS = $$('.scr').map(function (s) { return s.id.replace(/^s-/, ''); });
    SHEETS = $$('.scr.sheeted').map(function (s) { return s.id.replace(/^s-/, ''); });
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('touchstart', function () {}, { passive: true });
    return { screens: SCREENS.slice(), sheets: SHEETS.slice() };
  }

  function on(map, id, fn) { (map[id] = map[id] || []).push(fn); }

  COH.nav = {
    init: init, go: go, show: show, applyWhen: applyWhen, later: later, clearTimers: clearTimers, freeze: freeze,
    DEST: DEST, DO: DO, COND: COND, from: from,
    onEnter: function (id, fn) { on(enterFns, id, fn); },
    onLeave: function (id, fn) { on(leaveFns, id, fn); },
    get current() { return lastShown; }, get prev() { return prevShown; }, get screens() { return SCREENS; }, get sheets() { return SHEETS; },
    get sheetBack() { return sheetBack; },
    set how(v) { pendingHow = v; }
  };
})(typeof self !== 'undefined' ? self : this);
