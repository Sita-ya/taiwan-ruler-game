/* =====================================================================
 *  app.js —— 老師端與學生端共用的核心：步驟表、金額計算、籌碼、圖片、音效、連線
 * ===================================================================== */
(function () {
  'use strict';
  var C = window.GAME_CONFIG;
  var TW = window.TW = { C: C };
  var MINUS = '−';
  var TS = { '.sv': 'timestamp' };      // Firebase 伺服器時間
  TW.TS = TS;

  /* ---------------- 小工具 ---------------- */
  TW.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var esc = TW.esc;
  TW.fmt = function (n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  /** 金額文字：負數加「−」，rich=true 時回傳帶顏色的 HTML */
  TW.money = function (n, o) {
    o = o || {};
    var neg = n < 0;
    var sign = neg ? MINUS : (o.sign && n > 0 ? '+' : '');
    var txt = sign + TW.fmt(n);
    if (!o.rich) return txt;
    return '<span class="money ' + (neg ? 'neg' : 'pos') + '">' + txt + '</span>';
  };
  TW.fillText = function (tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  };
  TW.params = new URLSearchParams(location.search);
  TW.isMock = TW.params.has('mock');

  /* ---------------- 線與資格 ---------------- */
  TW.lineTotal = function () { return C.line.perPerson * C.line.people; };           // 46,545
  TW.eligible = function (fam) { return fam.income < TW.lineTotal(); };               // 收入 < 紅線
  /** 邊緣戶（C 類型）：收入沒有低於紅線，但只比紅線多一點點 */
  TW.isMarginal = function (fam) { return !TW.eligible(fam) && (fam.income - TW.lineTotal()) <= (C.line.marginalGap || 5000); };
  TW.famByCode =function (code) { return C.families.filter(function (f) { return f.code === code; })[0] || null; };

  /* ---------------- 步驟表（全部由老師控制） ---------------- */
  var FRAMES = [];
  function add(id, step, title, enter, note, extra) {
    var f = { id: id, step: step, title: title, enter: enter, note: note };
    if (extra) for (var k in extra) f[k] = extra[k];
    FRAMES.push(f);
  }
  add('lobby', '0', '大廳（等待加入）', '回到大廳', 'lobby');
  add('draw0', '1', '抽身分卡（等待抽籤）', '進入：抽身分卡', 'draw');
  add('draw1', '1', '身分卡翻開', '🎲 抽籤', 'draw');
  C.bills.forEach(function (b, i) {
    add('bill' + (i + 1), '2', '帳單 ' + (i + 1) + '/' + C.bills.length + '：' + b.name, '公布第 ' + (i + 1) + ' 張帳單', 'bills');
  });
  add('billsum', '2', '帳單結算：各組現況', '帳單結算：看各組現況', 'bills');
  add('fate0', '3', '命運事件（待抽）', '進入：命運事件', 'fate');
  add('fate1', '3', '命運卡翻開', '🃏 抽命運卡', 'fate');
  add('fatesum', '3', '命運事件後：各組現況', '看各組現況', 'fate');
  add('line1', '4-1', '紅線登場', '進入：政府的紅線', 'line1');
  add('sub2', '4-2', '發放補助', '💰 發放補助', 'sub2');
  add('rev3', '4-3', '大反轉', '大反轉', 'rev3');
  add('mood4', '4-4', '說說心情', '說說心情', 'mood');
  add('marg5', '4-4', '「邊緣戶」說明', '說明「邊緣戶」', 'marg');
  add('w1', '5-1', '世界的尺：每人每天 3 美元', '進入：世界的尺', 'world');
  add('w2', '5-2', '約 90 元的一天', '下一頁', 'world');
  add('w3', '5-3', '世界地圖', '下一頁', 'world');
  add('w4', '5-4', 'SDG 1 消除貧窮', '下一頁', 'world');
  add('sum6', '6', '總結：兩把尺', '總結', 'sum');
  add('line2', '隱', '隱藏步驟：第二條線', '第二條線', 'line2', { hidden: true });
  TW.FRAMES = FRAMES;
  var IDX = TW.IDX = {};
  FRAMES.forEach(function (f, i) { IDX[f.id] = i; });
  TW.prevIndex = function (i) { return i > 0 ? i - 1 : 0; };
  TW.nextIndex = function (i) {
    var n = i + 1;
    return (n < FRAMES.length && !FRAMES[n].hidden) ? n : i;
  };

  /* ---------------- 房間資料 → 目前狀況 ---------------- */
  TW.cfgOf = function (room) {
    var c = (room && room.cfg) || {};
    return {
      groups: c.groups || C.defaultGroups || 6,
      calc: c.calc == null ? C.calcMode : !!c.calc,
      subMode: c.subMode || C.subsidy.mode,
      subFixed: c.subFixed == null ? C.subsidy.fixed : Number(c.subFixed),
      sound: !!c.sound
    };
  };
  TW.info = function (room) {
    var f = (room && room.state && room.state.f) || 0;
    if (f < 0 || f >= FRAMES.length) f = 0;
    var shown = 0;
    for (var k = 1; k <= C.bills.length; k++) if (f >= IDX['bill' + k]) shown = k;
    return {
      f: f, id: FRAMES[f].id, frame: FRAMES[f], shown: shown,
      drawn: f >= IDX.draw1,
      fate: f >= IDX.fate1,
      subsidy: f >= IDX.sub2,
      moodOpen: f === IDX.mood4,
      paused: !!(room && room.state && room.state.paused)
    };
  };
  TW.groupCount = function (room) { return TW.cfgOf(room).groups; };
  TW.famCodesFor = function (n) { return C.families.slice(0, n).map(function (f) { return f.code; }); };
  TW.famOf = function (room, g) {
    var code = room && room.assign && room.assign[g];
    return code ? TW.famByCode(code) : null;
  };
  TW.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  /** 隨機把家庭分配給第 1..n 組，回傳 { 1:'C', 2:'A', ... } */
  TW.randomAssign = function (n) {
    var codes = TW.shuffle(TW.famCodesFor(n)), out = {};
    for (var g = 1; g <= n; g++) out[g] = codes[g - 1];
    return out;
  };

  /** 該組的收支紀錄與餘額。opt.auto = true 代表「所有帳單都當作已繳」（單機模式） */
  TW.ledger = function (room, g, opt) {
    opt = opt || {};
    var fam = TW.famOf(room, g);
    if (!fam) return null;
    var inf = TW.info(room), cfg = TW.cfgOf(room);
    var flags = (room.groups && room.groups[g] && room.groups[g].paid) || {};
    var bal = fam.income, items = [], pending = [];
    items.push({ key: 'income', icon: '💼', label: '本月收入', amount: fam.income });
    // 目前開放繳費的項目（依序）
    var obligations = [];
    for (var i = 0; i < inf.shown; i++) {
      obligations.push({ key: 'b' + i, icon: C.bills[i].icon, label: C.bills[i].name, cat: C.bills[i].cat, amount: C.bills[i].amount, bill: C.bills[i] });
    }
    if (inf.fate) obligations.push({ key: 'fate', icon: C.fate.icon, label: C.fate.title, cat: '命運卡', amount: C.fate.amount, fate: true });
    obligations.forEach(function (o) {
      var paid = opt.auto || flags[o.key] === true;
      o.paid = paid;
      if (paid) { bal -= o.amount; items.push({ key: o.key, icon: o.icon, label: o.label, amount: -o.amount }); }
      else pending.push(o);
    });
    var sub = 0, elig = TW.eligible(fam);
    if (inf.subsidy && elig) {
      sub = cfg.subMode === 'fixed' ? cfg.subFixed : Math.max(0, -bal);
      if (sub > 0) { bal += sub; items.push({ key: 'subsidy', icon: '💰', label: C.texts.subsidyTitle, amount: sub }); }
    }
    return { fam: fam, balance: bal, items: items, obligations: obligations, pending: pending, eligible: elig, subsidy: sub };
  };

  /* ---------------- 圖片 ---------------- */
  TW.imageList = function () {
    var l = C.families.map(function (f) { return f.img; });
    l.push(C.fate.img, 'assets/lunch_90.jpg', 'assets/sdg1.png', 'assets/world_map.jpg');
    return l;
  };
  TW.preload = function (list, onProgress) {
    var done = 0, total = list.length;
    return Promise.all(list.map(function (src) {
      return new Promise(function (res) {
        var im = new Image();
        var fin = function () { done++; if (onProgress) onProgress(done, total); res(); };
        im.onload = fin; im.onerror = fin; im.src = src;
        TW._pre = TW._pre || []; TW._pre.push(im);   // 保留參考，避免被瀏覽器丟棄
      });
    }));
  };
  TW.imgFail = function (img) {
    var box = img.parentNode, c = img.getAttribute('data-color') || '#999', em = img.getAttribute('data-emoji') || '🏠';
    var d = document.createElement('div');
    d.className = 'img-fb';
    d.style.background = c;
    d.textContent = em;
    box.replaceChild(d, img);
  };
  function imgTag(src, fam, alt) {
    return '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" data-color="' + esc(fam ? fam.color : '#999') +
      '" data-emoji="' + esc(fam ? fam.emoji : '🏠') + '" onerror="TW.imgFail(this)">';
  }
  /** 白色圓角卡片（外框＝家庭代表色），內含完整插圖 */
  TW.famImg = function (fam, cls) {
    return '<div class="famimg ' + (cls || '') + '" style="--fc:' + fam.color + '">' + imgTag(fam.img, fam, fam.name) + '</div>';
  };
  /** 圓形頭像（取畫面中央偏上，讓臉在圓內） */
  TW.avatar = function (fam, size) {
    return '<div class="avatar" style="--fc:' + fam.color + ';width:' + size + 'px;height:' + size + 'px">' + imgTag(fam.img, fam, fam.name) + '</div>';
  };
  TW.plainImg = function (src, cls, alt) {
    return '<div class="plainimg ' + (cls || '') + '"><img src="' + esc(src) + '" alt="' + esc(alt || '') +
      '" onerror="this.parentNode.classList.add(\'broken\')"></div>';
  };

  /* ---------------- 籌碼（SVG 自己畫） ---------------- */
  function coinSvg(neg) {
    if (neg) return '<svg class="chip coin iou" viewBox="0 0 60 60"><circle cx="30" cy="30" r="25" fill="#FFE8EA" stroke="#D62839" stroke-width="4" stroke-dasharray="7 5"/><text x="30" y="38" text-anchor="middle" font-size="22" font-weight="900" fill="#D62839">欠</text></svg>';
    return '<svg class="chip coin" viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#F5B82E" stroke="#2B2D42" stroke-width="4"/><circle cx="30" cy="30" r="19" fill="none" stroke="#C98A00" stroke-width="3"/><text x="30" y="37" text-anchor="middle" font-size="18" font-weight="900" fill="#7A5200">1K</text></svg>';
  }
  function noteSvg(neg) {
    if (neg) return '<svg class="chip note iou" viewBox="0 0 120 64"><rect x="3" y="3" width="114" height="58" rx="10" fill="#FFE8EA" stroke="#D62839" stroke-width="4" stroke-dasharray="9 6"/><text x="60" y="42" text-anchor="middle" font-size="26" font-weight="900" fill="#D62839">欠條 1 萬</text></svg>';
    return '<svg class="chip note" viewBox="0 0 120 64"><rect x="3" y="3" width="114" height="58" rx="10" fill="#4C8DD9" stroke="#2B2D42" stroke-width="4"/><rect x="12" y="12" width="96" height="40" rx="6" fill="none" stroke="#BBD7F7" stroke-width="2.5"/><circle cx="26" cy="32" r="7" fill="#BBD7F7"/><text x="68" y="40" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">10,000</text></svg>';
  }
  /** 把金額換成「萬元鈔票 ＋ 千元硬幣」。負數顯示紅色欠條。 */
  TW.chips = function (amount) {
    var neg = amount < 0, a = Math.abs(amount);
    var notes = Math.floor(a / 10000), coins = Math.ceil((a % 10000) / 1000 - 1e-9);
    if (coins >= 10) { notes += 1; coins = 0; }
    if (a === 0) return '<div class="chips empty">目前沒有籌碼</div>';
    var h = '<div class="chips' + (neg ? ' debt' : '') + '">';
    if (notes) { h += '<div class="chip-group notes">'; for (var i = 0; i < notes; i++) h += noteSvg(neg); h += '</div>'; }
    if (coins) { h += '<div class="chip-group coins">'; for (var j = 0; j < coins; j++) h += coinSvg(neg); h += '</div>'; }
    if (neg) h += '<div class="chips-label">紅色＝欠條</div>';
    return h + '</div>';
  };

  /* ---------------- 音效（預設關閉） ---------------- */
  var audio = { ctx: null };
  TW.sound = { on: false };
  TW.sound.play = function (name) {
    if (!TW.sound.on) return;
    try {
      audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
      var ctx = audio.ctx, t0 = ctx.currentTime;
      var seqs = {
        flip: [[400, 0, .08], [700, .08, .1]],
        coin: [[988, 0, .07], [1319, .07, .16]],
        subsidy: [[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .25]],
        pause: [[300, 0, .12], [220, .14, .2]],
        bill: [[520, 0, .1], [390, .1, .14]],
        ok: [[660, 0, .1], [880, .1, .14]]
      };
      (seqs[name] || seqs.ok).forEach(function (s) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = s[0];
        g.gain.setValueAtTime(0.0001, t0 + s[1]);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + s[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + s[1] + s[2]);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + s[1]); o.stop(t0 + s[1] + s[2] + 0.05);
      });
    } catch (e) { /* 瀏覽器不支援就算了 */ }
  };

  /* ---------------- 翻牌動畫（共用） ---------------- */
  /** 渲染後呼叫：fresh=true 時才有翻牌動畫，否則直接顯示翻開的樣子 */
  TW.runFlips = function (root, fresh) {
    var cards = root.querySelectorAll('.flipper[data-up="1"]');
    Array.prototype.forEach.call(cards, function (el, i) {
      if (fresh) {
        setTimeout(function () { el.classList.add('up'); TW.sound.play('flip'); }, 120 + i * 140);
      } else {
        el.classList.add('nt'); el.classList.add('up');
      }
    });
  };

  /* ---------------- 連線層 ---------------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      var timer = setTimeout(function () { rej(new Error('載入逾時：' + src)); }, 20000);
      s.src = src;
      s.onload = function () { clearTimeout(timer); res(); };
      s.onerror = function () { clearTimeout(timer); rej(new Error('無法載入 ' + src)); };
      document.head.appendChild(s);
    });
  }
  TW.firebaseReady = function () {
    var c = C.firebase || {};
    return !!(c.apiKey && c.databaseURL && c.projectId);
  };
  /**
   * kind = 'local'  單機投影模式（不連線）
   *      = 'online' 連線版（Firebase；網址有 ?mock=1 時改用測試用假資料庫）
   * 回傳 { db, uid, kind }
   */
  TW.initNet = function (kind) {
    if (kind === 'local') {
      TW.net = { db: new window.LocalDB({ persistKey: 'tw_local_db' }), uid: 'local', kind: 'local' };
      return Promise.resolve(TW.net);
    }
    if (TW.isMock) {
      var uid = TW.params.get('uid') || ('u' + Math.random().toString(36).slice(2, 8));
      TW.net = { db: new window.LocalDB({ persistKey: 'tw_mock_db', shared: true, rules: true, uid: uid }), uid: uid, kind: 'online' };
      return Promise.resolve(TW.net);
    }
    if (!TW.firebaseReady()) {
      return Promise.reject(new Error('尚未設定 Firebase。請先照 README 把設定貼進 config.js，或改用「單機投影模式」。'));
    }
    var base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    return loadScript(base + 'firebase-app-compat.js')
      .then(function () { return loadScript(base + 'firebase-auth-compat.js'); })
      .then(function () { return loadScript(base + 'firebase-database-compat.js'); })
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(C.firebase);
        return firebase.auth().signInAnonymously();
      })
      .then(function () {
        TW.net = { db: firebase.database(), uid: firebase.auth().currentUser.uid, kind: 'online' };
        return TW.net;
      })
      .catch(function (e) {
        var code = e && e.code;
        if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation')
          e = new Error('Firebase 還沒開啟「匿名登入」。請到 Authentication → Sign-in method 開啟 Anonymous（README 第二章）。');
        else if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.')
          e = new Error('config.js 裡的 apiKey 不正確，請重新複製貼上。');
        else if (!(e instanceof Error) || /載入|無法載入/.test(e.message))
          e = new Error((e && e.message) || '連線失敗，請檢查網路。');
        throw e;
      });
  };
  TW.roomRef = function (code) { return TW.net.db.ref('rooms/' + code); };
  TW.watchConnection = function (cb) {
    TW.net.db.ref('.info/connected').on('value', function (s) { cb(!!s.val()); });
  };
  TW.friendlyError = function (e) {
    if (e && (e.code === 'PERMISSION_DENIED' || /PERMISSION_DENIED/.test(e.message || ''))) return '沒有權限（可能是安全規則還沒貼上，或這個動作現在不能做）。';
    return (e && e.message) || '發生錯誤';
  };

  /* ---------------- 教師口白查詢 ---------------- */
  TW.notesFor = function (frame) { return (C.notes && C.notes[frame.note]) || []; };

  /* ---------------- 簡單的偵測：訊號相同就不重畫 ---------------- */
  TW.makeGate = function () {
    var last = null;
    return function (sig) { var s = JSON.stringify(sig); if (s === last) return false; last = s; return true; };
  };
})();
