/* =====================================================================
 *  LocalDB：一個「很小的假 Firebase Realtime Database」
 *  用途一：單機投影模式——資料只存在這台電腦（瀏覽器 localStorage），完全不需要網路。
 *  用途二：測試用——網址加上 ?mock=1 時，同一個瀏覽器的多個分頁/視窗可以互相同步，
 *          並且模擬 database.rules.json 的安全規則（正式上課不會用到）。
 *  只實作本遊戲用到的語法：ref / child / set / update / remove / on / off / once / onDisconnect
 * ===================================================================== */
(function () {
  'use strict';

  function split(p) { return String(p || '').split('/').filter(Boolean); }
  function clone(x) { return x === undefined ? null : JSON.parse(JSON.stringify(x)); }

  function getAt(tree, segs) {
    var n = tree;
    for (var i = 0; i < segs.length; i++) {
      if (n == null || typeof n !== 'object') return null;
      n = n[segs[i]];
      if (n === undefined) return null;
    }
    return n === undefined ? null : n;
  }

  function prune(n) {
    if (n && typeof n === 'object') {
      Object.keys(n).forEach(function (k) {
        n[k] = prune(n[k]);
        if (n[k] === null || n[k] === undefined) delete n[k];
      });
      if (!Object.keys(n).length) return null;
    }
    return n;
  }

  function setAt(tree, segs, val) {
    if (!segs.length) return val === null ? {} : val;
    var root = tree && typeof tree === 'object' ? tree : {};
    var n = root;
    for (var i = 0; i < segs.length - 1; i++) {
      if (n[segs[i]] == null || typeof n[segs[i]] !== 'object') n[segs[i]] = {};
      n = n[segs[i]];
    }
    n[segs[segs.length - 1]] = val;
    return prune(root) || {};
  }

  function stamp(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      Object.keys(v).forEach(function (k) { v[k] = stamp(v[k]); });
    }
    return v;
  }

  // 模擬真 Firebase：key 都是整數且夠密時，val() 會回傳陣列
  function fbVal(v) {
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      keys.forEach(function (k) { v[k] = fbVal(v[k]); });
      if (keys.length && keys.every(function (k) { return /^\d+$/.test(k); })) {
        var max = Math.max.apply(null, keys.map(Number));
        if (keys.length >= (max + 1) / 2 && max < 1000) {
          var arr = [];
          for (var i = 0; i <= max; i++) arr.push(v[i] === undefined ? null : v[i]);
          return arr;
        }
      }
    }
    return v;
  }

  function Snap(key, raw) {
    this.key = key;
    this._raw = raw;
  }
  Snap.prototype.val = function () { return fbVal(clone(this._raw)); };
  Snap.prototype.exists = function () { return this._raw !== null && this._raw !== undefined; };
  Snap.prototype.child = function (p) { return new Snap(split(p).pop(), getAt(this._raw, split(p))); };

  function permissionError() {
    var e = new Error('PERMISSION_DENIED: Permission denied');
    e.code = 'PERMISSION_DENIED';
    return e;
  }

  /* ---- 模擬 database.rules.json（只在 mock 模式開啟）---- */
  function rulesAllow(tree, segs, newVal, uid) {
    if (!uid) return false;
    if (segs[0] !== 'rooms' || segs.length < 2) return false;
    var room = segs[1];
    var oldRoom = getAt(tree, ['rooms', room]);
    var after = setAt(clone(tree), segs, clone(newVal));
    var newRoom = getAt(after, ['rooms', room]);
    var stale = oldRoom && typeof oldRoom.createdAt === 'number' && oldRoom.createdAt < Date.now() - 43200000;
    var teacherOK = (!oldRoom && newRoom && newRoom.teacherUid === uid) ||
      (oldRoom && oldRoom.teacherUid === uid) ||
      (stale && newRoom && newRoom.teacherUid === uid);
    if (teacherOK) return /^[0-9]{4}$/.test(room) || room === 'local';
    if (!oldRoom || !oldRoom.teacherUid) return false;
    var sub = segs[2], g = segs[3];
    if (sub === 'seats' && segs.length === 4 && /^[1-6]$/.test(g)) {
      var cur = oldRoom.seats && oldRoom.seats[g];
      if (newVal === uid && (!cur || cur === uid)) return true;
      if (newVal === null && cur === uid) return true;
      return false;
    }
    if (sub === 'groups' && /^[1-6]$/.test(g)) {
      var mine = oldRoom.seats && oldRoom.seats[g] === uid;
      if (!mine) return false;
      var st = oldRoom.state || {};
      var field = segs[4];
      if (field === 'online') return segs.length === 5 && typeof newVal === 'boolean';
      if (field === 'paid' && segs.length === 6) {
        var k = segs[5];
        if (newVal !== true) return false;
        if (k === 'fate') return st.fate === true;
        var m = /^b([0-4])$/.exec(k);
        return !!m && (st.shown || 0) >= Number(m[1]) + 1;
      }
      if (field === 'mood') {
        if (st.moodOpen !== true) return false;
        if (segs.length === 5) {
          if (newVal === null) return true;
          if (typeof newVal !== 'object' || !newVal) return false;
          var ks = Object.keys(newVal);
          if (ks.some(function (x) { return x !== 'k' && x !== 't'; })) return false;
          if (!/^(angry|sad|confused|unfair|custom)$/.test(newVal.k || '')) return false;
          if (newVal.t != null && (typeof newVal.t !== 'string' || newVal.t.length > 40)) return false;
          return true;
        }
        return false;
      }
    }
    return false;
  }

  function Ref(db, segs) { this._db = db; this._segs = segs; this.key = segs[segs.length - 1] || null; }
  Ref.prototype.child = function (p) { return new Ref(this._db, this._segs.concat(split(p))); };
  Ref.prototype.set = function (v) {
    return this._db._write([{ segs: this._segs, val: v }]);
  };
  Ref.prototype.remove = function () { return this.set(null); };
  Ref.prototype.update = function (obj) {
    var base = this._segs, ops = [];
    Object.keys(obj).forEach(function (k) { ops.push({ segs: base.concat(split(k)), val: obj[k] }); });
    return this._db._write(ops);
  };
  Ref.prototype.once = function () {
    var self = this;
    return new Promise(function (res) { setTimeout(function () { res(self._db._snap(self._segs)); }, 0); });
  };
  Ref.prototype.on = function (evt, cb, errCb) {
    var self = this, db = this._db;
    var l = { segs: this._segs, cb: cb, last: undefined, ref: this };
    db._listeners.push(l);
    setTimeout(function () { db._fire(l, true); }, 0);
    return cb;
  };
  Ref.prototype.off = function (evt, cb) {
    var db = this._db;
    db._listeners = db._listeners.filter(function (l) { return !(l.ref === this && (!cb || l.cb === cb)); }, this);
  };
  Ref.prototype.onDisconnect = function () {
    return { set: function () { return Promise.resolve(); }, remove: function () { return Promise.resolve(); } };
  };

  function LocalDB(opts) {
    opts = opts || {};
    this._key = opts.persistKey || null;
    this._rules = !!opts.rules;
    this._uid = opts.uid || null;
    this._listeners = [];
    this._tree = this._load();
    var self = this;
    if (opts.shared && typeof BroadcastChannel !== 'undefined' && this._key) {
      this._bc = new BroadcastChannel(this._key + '_bc');
      this._bc.onmessage = function () { self._tree = self._load(); self._notify(); };
    }
  }
  LocalDB.prototype._load = function () {
    if (!this._key) return this._tree || {};
    try { return JSON.parse(localStorage.getItem(this._key)) || {}; } catch (e) { return {}; }
  };
  LocalDB.prototype._save = function () {
    if (!this._key) return;
    try { localStorage.setItem(this._key, JSON.stringify(this._tree)); } catch (e) { /* 空間不足或被禁用：略過 */ }
    if (this._bc) this._bc.postMessage(1);
  };
  LocalDB.prototype.ref = function (p) { return new Ref(this, split(p)); };
  LocalDB.prototype._snap = function (segs) {
    if (segs.join('/') === '.info/connected') return new Snap('connected', true);
    return new Snap(segs[segs.length - 1] || null, getAt(this._tree, segs));
  };
  LocalDB.prototype._fire = function (l, force) {
    var s = this._snap(l.segs), j = JSON.stringify(s._raw);
    if (!force && j === l.last) return;
    l.last = j;
    try { l.cb(s); } catch (e) { console.error(e); }
  };
  LocalDB.prototype._notify = function () {
    var self = this;
    this._listeners.slice().forEach(function (l) { self._fire(l, false); });
  };
  LocalDB.prototype._write = function (ops) {
    var self = this;
    this._tree = this._load();
    if (this._rules) {
      for (var i = 0; i < ops.length; i++) {
        var v = clone(ops[i].val);
        if (!rulesAllow(this._tree, ops[i].segs, v, this._uid)) {
          return Promise.reject(permissionError());
        }
      }
    }
    ops.forEach(function (op) {
      var v = stamp(clone(op.val));
      self._tree = setAt(self._tree, op.segs, v);
    });
    this._save();
    setTimeout(function () { self._notify(); }, 0);
    return Promise.resolve();
  };

  window.LocalDB = LocalDB;
})();
