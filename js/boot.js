/* boot.js — the first breath: open the store, settle taste, show the first screen, look after the service worker.
 *
 * First screen: the code, if this phone has never been given it; otherwise "Who's opening?" — at every opening.
 * Updates: the service worker fetches a new version in the background; the page reloads only at a calm moment
 * (never in the middle of a reading, a rhythm or a session).
 */
(function (root) {
  'use strict';
  var COH = root.COH = root.COH || {};
  var doc = root.document;

  function registerWorker() {
    var nav = root.navigator;
    if (!nav || !nav.serviceWorker) return;
    var secure = root.location.protocol === 'https:' || root.location.hostname === 'localhost' || root.location.hostname === '127.0.0.1';
    if (!secure || /[?&]nosw\b/.test(root.location.search)) return;
    var hadController = !!nav.serviceWorker.controller, reloading = false, waiting = false;
    function reloadIfCalm() {
      if (!waiting || reloading || !COH.flows.safeToReload()) return;
      reloading = true; root.location.reload();
    }
    nav.serviceWorker.addEventListener('controllerchange', function () { if (!hadController) { hadController = true; return; } waiting = true; reloadIfCalm(); });
    doc.addEventListener('coh:screen', reloadIfCalm);
    nav.serviceWorker.register('/sw.js').then(function (reg) {
      var check = function () { try { reg.update(); } catch (e) { /* offline: fine */ } };
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    }, function () { /* no worker: the app still runs, only without the offline copy */ });
  }

  function start() {
    COH.store.init().then(function () {
      var m = COH.store.meta;
      COH.guide.config({ sound: m.sound, vol: m.vol, mute: m.mute, ring: m.ring });
      COH.nav.init();
      COH.paint.paintSound(); COH.paint.paintBlink();
      COH.nav.go(m.unlocked ? 'qui' : 'code', null);
      doc.documentElement.setAttribute('data-ready', '1');
      registerWorker();
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof self !== 'undefined' ? self : this);
