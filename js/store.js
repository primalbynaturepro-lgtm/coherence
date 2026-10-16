/* store.js — what the app keeps, and where.
 *
 * The app remembers one small document per person (rhythm, sessions, sighs) and one for the phone (code entered,
 * sound, ring). The documents live behind a backend that speaks two verbs — load(key) and save(key, doc) — so where
 * they live can change without the rest of the app noticing.
 *
 *   today   this phone: localStorage (or memory, if the phone refuses storage — then nothing outlives the visit)
 *   later   DOG-CORE (`coh_` tables): a backend with the same two verbs, and a one-off copy of what is on the phone.
 *           The records already carry what a table row needs: an id, a timestamp, a day.
 *
 * Reading is synchronous once a document is loaded (Store.profile(who)); writing goes through Store.update(who, fn),
 * which changes the document, then saves it, in order, without ever blocking the screen.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.COH = root.COH || {}; root.COH.store = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var PREFIX = 'coh:v1:';
  var WHO = ['adri', 'mehdi'];
  var KINDS = ['morning', 'midday', 'late'];
  var SOUNDS = ['note', 'bowl', 'breath'];

  /* ───────────── the documents ───────────── */
  function emptyMeta() { return { v: 1, unlocked: false, sound: 'bowl', vol: 0.7, mute: false, ring: 'b', blink: true }; }
  function emptyProfile(who) { return { v: 1, who: who, rhythm: null, history: [], partial: null, sessions: [], sos: [], cyc: [] }; }

  function num(x, d) { return typeof x === 'number' && isFinite(x) ? x : d; }
  function normalizeMeta(m) {
    var o = emptyMeta();
    if (!m || typeof m !== 'object') return o;
    o.unlocked = m.unlocked === true;
    o.sound = SOUNDS.indexOf(m.sound) >= 0 ? m.sound : o.sound;
    o.vol = Math.max(0, Math.min(1, num(m.vol, o.vol)));
    o.mute = m.mute === true;
    o.ring = m.ring === 'a' ? 'a' : 'b';
    o.blink = m.blink !== false;
    return o;
  }
  function normalizeProfile(p, who) {
    var o = emptyProfile(who);
    if (!p || typeof p !== 'object') return o;
    if (p.rhythm && typeof p.rhythm === 'object' && isFinite(p.rhythm.value)) o.rhythm = p.rhythm;
    if (Array.isArray(p.history)) o.history = p.history;
    if (p.partial && Array.isArray(p.partial.scores)) o.partial = p.partial;
    if (Array.isArray(p.sessions)) o.sessions = p.sessions.filter(function (s) { return s && KINDS.indexOf(s.kind) >= 0 && isFinite(s.ts); });
    if (Array.isArray(p.sos)) o.sos = p.sos.filter(function (s) { return s && isFinite(s.ts); });
    if (Array.isArray(p.cyc)) o.cyc = p.cyc.filter(function (s) { return s && isFinite(s.ts); });
    return o;
  }

  /* ───────────── the backends ───────────── */
  function MemoryBackend() { this.name = 'memory'; this.sync = true; this.data = {}; }
  MemoryBackend.prototype.load = function (key) { return Promise.resolve(Object.prototype.hasOwnProperty.call(this.data, key) ? JSON.parse(this.data[key]) : null); };
  MemoryBackend.prototype.save = function (key, doc) { this.data[key] = JSON.stringify(doc); return Promise.resolve(); };

  function LocalBackend(ls) { this.name = 'local'; this.sync = true; this.ls = ls; }
  LocalBackend.works = function (ls) {
    try { var k = PREFIX + 'probe'; ls.setItem(k, '1'); var ok = ls.getItem(k) === '1'; ls.removeItem(k); return ok; } catch (e) { return false; }
  };
  LocalBackend.prototype.load = function (key) {
    var raw = null;
    try { raw = this.ls.getItem(PREFIX + key); } catch (e) { return Promise.reject(e); }
    if (raw === null || raw === undefined) return Promise.resolve(null);
    try { return Promise.resolve(JSON.parse(raw)); }
    catch (e) {                                       // never lose what we cannot read: keep it aside, start clean
      try { this.ls.setItem(PREFIX + 'corrupt:' + key + ':' + Date.now(), raw); } catch (e2) { /* nothing more to do */ }
      Store.lastError = { kind: 'corrupt', key: key };
      return Promise.resolve(null);
    }
  };
  LocalBackend.prototype.save = function (key, doc) {
    try { this.ls.setItem(PREFIX + key, JSON.stringify(doc)); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
  };

  /* ───────────── the store ───────────── */
  var backend = null, meta = emptyMeta(), profiles = {}, queue = Promise.resolve(), persisted = false;

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function enqueue(key, doc) {
    var snap = JSON.stringify(doc), be = backend;
    queue = queue.then(function () {
      return be.save(key, be.sync ? JSON.parse(snap) : JSON.parse(snap)).then(function () {
        if (Store.lastError && Store.lastError.kind === 'save' && Store.lastError.key === key) Store.lastError = null;      // it works again: Settings stops saying it does not
      });
    }).catch(function (e) {
      Store.lastError = { kind: 'save', key: key, name: e && e.name, message: e && e.message };
      if (key.indexOf('profile:') === 0 && e && (e.name === 'QuotaExceededError' || e.code === 22)) {   // the phone is full: the old curves go first
        var p = profiles[key.slice(8)];
        if (p) { pruneCurves(p, 60); return be.save(key, p).catch(function (e2) { Store.lastError = { kind: 'save', key: key, name: e2 && e2.name }; }); }
      }
    });
    return queue;
  }
  function pruneCurves(p, keepDays) {
    var limit = Date.now() - keepDays * 86400000;
    p.sessions.forEach(function (s) { if (s.ts < limit && s.curve) s.curve = null; });
  }

  var Store = {
    VERSION: 1, WHO: WHO, KINDS: KINDS,
    Local: LocalBackend, Memory: MemoryBackend,
    lastError: null, volatile: false,
    newId: newId, emptyMeta: emptyMeta, emptyProfile: emptyProfile, normalizeProfile: normalizeProfile, normalizeMeta: normalizeMeta,

    get backendName() { return backend ? backend.name : null; },
    get persisted() { return persisted; },

    /* opts.backend: force one (tests, later DOG-CORE). Otherwise: this phone if it lets us, memory if it does not. */
    init: function (opts) {
      opts = opts || {};
      var be = opts.backend;
      if (!be) {
        var ls = null;
        try { ls = root.localStorage; } catch (e) { ls = null; }
        if (ls && LocalBackend.works(ls)) be = new LocalBackend(ls);
        else { be = new MemoryBackend(); Store.volatile = true; }
      }
      return Store.use(be).then(function () {
        try { if (root.navigator && root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist().then(function (v) { persisted = !!v; }, function () {}); } catch (e) { /* not everywhere */ }
        return { backend: backend.name, volatile: Store.volatile };
      });
    },
    use: function (be) {
      backend = be; profiles = {};
      return be.load('meta').then(function (m) { meta = normalizeMeta(m); return meta; }, function (e) { Store.lastError = { kind: 'load', key: 'meta', name: e && e.name }; meta = emptyMeta(); return meta; });
    },

    get meta() { return meta; },
    setMeta: function (patch) { meta = normalizeMeta(Object.assign({}, meta, patch)); return enqueue('meta', meta); },

    load: function (who) {
      if (WHO.indexOf(who) < 0) return Promise.reject(new Error('unknown profile ' + who));
      if (profiles[who]) return Promise.resolve(profiles[who]);
      return backend.load('profile:' + who).then(function (d) { profiles[who] = normalizeProfile(d, who); return profiles[who]; },
        function (e) { Store.lastError = { kind: 'load', key: 'profile:' + who, name: e && e.name }; profiles[who] = emptyProfile(who); return profiles[who]; });
    },
    profile: function (who) { return profiles[who] || null; },
    update: function (who, fn) {
      var p = profiles[who];
      if (!p) return Promise.reject(new Error('profile not loaded: ' + who));
      fn(p);
      return enqueue('profile:' + who, p);
    },
    flush: function () { return queue; },

    /* the whole thing as one piece of text — to keep a copy, or to move it (lab/data.html) */
    exportAll: function () {
      return Promise.all(WHO.map(function (w) { return Store.load(w); })).then(function (ps) {
        var out = { app: 'coherence', v: 1, exportedAt: new Date().toISOString(), meta: meta, profiles: {} };
        ps.forEach(function (p) { out.profiles[p.who] = p; });
        return JSON.stringify(out);
      });
    },
    importAll: function (text) {
      var d;
      try { d = JSON.parse(text); } catch (e) { return Promise.reject(new Error('not JSON')); }
      if (!d || d.app !== 'coherence' || !d.profiles) return Promise.reject(new Error('not a Cohérence export'));
      var jobs = [];
      WHO.forEach(function (w) { if (d.profiles[w]) { profiles[w] = normalizeProfile(d.profiles[w], w); jobs.push(enqueue('profile:' + w, profiles[w])); } });
      if (d.meta) { var keep = meta.unlocked; meta = normalizeMeta(d.meta); meta.unlocked = keep || meta.unlocked; jobs.push(enqueue('meta', meta)); }
      return Promise.all(jobs);
    },

    _reset: function () { backend = null; meta = emptyMeta(); profiles = {}; queue = Promise.resolve(); Store.lastError = null; Store.volatile = false; }
  };
  return Store;
});
