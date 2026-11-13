/* =====================================================================
 *  student.js —— 學生端
 *  學生端「只讀」步驟（state/f），永遠不能自己前進或後退。
 *  學生只能寫入：自己組別的「繳費紀錄 paid」「心情 mood」「在線 online」，以及選組（seats）。
 * ===================================================================== */
(function () {
  'use strict';
  var TW = window.TW, C = TW.C, esc = TW.esc, IDX = TW.IDX, T = C.texts;
  var $ = function (s) { return document.querySelector(s); };
  var LSK = 'tw_student' + (TW.isMock ? ':' + (TW.params.get('uid') || '') : '');   // 測試模式下，同一個瀏覽器的多個「假平板」要分開存

  var S = {
    code: null, g: null, room: null, started: false,    // started＝已經進過遊戲畫面（用來判斷被踢出）
    screen: 'loading', msg: '', lastF: null,
    pre: { done: 0, total: 1, ok: false },
    calc: {},                  // 每個待繳項目的計算狀態
    paying: false,
    moodSel: null, moodText: '',
    online: true
  };
  var LS = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  var gate = TW.makeGate();

  /* ================= 啟動 ================= */
  function boot() {
    root('<div class="s-center"><div class="spinner"></div><div class="s-big">連線中…</div></div>');
    TW.preload(TW.imageList(), function (d, t) { S.pre.done = d; S.pre.total = t; S.pre.ok = d >= t; if (S.screen === 'game' && S.room && TW.info(S.room).id === 'lobby') renderGame(true); });
    TW.initNet('online').then(function () {
      TW.watchConnection(function (ok) {
        S.online = ok; $('#conn').hidden = ok;
        if (ok && S.g && S.code && S.room) presence();
      });
      var saved = LS.get(LSK), urlRoom = TW.params.get('room');
      if (saved && (!urlRoom || saved.code === urlRoom)) { S.g = saved.g; subscribe(saved.code); }
      else if (urlRoom && /^\d{4}$/.test(urlRoom)) subscribe(urlRoom);
      else showCode();
    }).catch(function (e) {
      root('<div class="s-center"><div class="s-big">😢 連不上</div><p class="s-p">' + esc(TW.friendlyError(e)) + '</p>' +
        '<button class="btn big primary" onclick="location.reload()">重試</button></div>');
    });
  }
  function root(h) { $('#root').innerHTML = h; }

  /* ================= 輸入房間代碼 ================= */
  function showCode(msg) {
    S.screen = 'code';
    root('<div class="s-center join"><div class="s-logo">📏</div><h1>' + esc(T.gameTitle) + '</h1>' +
      '<p class="s-p">請輸入老師投影幕上的「房間代碼」</p>' +
      '<input id="codeIn" class="code-in" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="4 位數" autocomplete="off">' +
      (msg ? '<div class="err">' + esc(msg) + '</div>' : '') +
      '<button class="btn big primary" data-act="codeGo">加入</button></div>');
    var inp = $('#codeIn');
    inp.oninput = function () { inp.value = inp.value.replace(/\D/g, '').slice(0, 4); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') act.codeGo(); };
    inp.focus();
  }

  var unsub = null;
  function subscribe(code) {
    if (unsub) unsub();
    S.code = code; S.room = null; S.first = true;
    var ref = TW.roomRef(code);
    var cb = ref.on('value', function (snap) { S.room = snap.val(); onRoom(); }, function (e) {
      showCode('這個房間不能進入：' + TW.friendlyError(e));
    });
    unsub = function () { ref.off('value', cb); };
  }

  /* ================= 房間資料更新 ================= */
  function mySeat() { return S.room && S.room.seats && S.g ? S.room.seats[S.g] : null; }
  function onRoom() {
    if (!S.room) {                       // 房間不存在
      if (S.first) { S.first = false; LS.del(LSK); S.g = null; showCode('找不到房間 ' + S.code + '，請確認代碼。'); }
      return;
    }
    S.first = false;
    var mine = mySeat() === TW.net.uid;
    if (S.g && !mine && !S.started && !mySeat() && S.claiming) return;   // 剛送出選組，等伺服器回報
    if (S.g && mine) {
      S.started = true; S.claiming = false;
      if (S.screen !== 'game') { S.screen = 'game'; presence(); LS.set(LSK, { code: S.code, g: S.g }); }
      renderGame();
    } else {
      if (S.g && S.started) { S.msg = '老師請你重新加入，請再選一次組別。'; }   // 被老師踢出
      if (S.g && !S.started && mySeat() && mySeat() !== TW.net.uid) S.msg = '第 ' + S.g + ' 組已經被其他平板選走了。';
      S.g = null; S.started = false; LS.del(LSK);
      showPick();
    }
  }
  function presence() {
    if (!S.g) return;
    var r = TW.net.db.ref('rooms/' + S.code + '/groups/' + S.g + '/online');
    r.set(true).catch(function () { /* 規則還沒就緒時略過 */ });
    try { r.onDisconnect().set(false); } catch (e) { /* ignore */ }
  }

  /* ================= 選組別 ================= */
  function showPick() {
    S.screen = 'pick';
    var n = TW.groupCount(S.room), seats = S.room.seats || {};
    var h = '<div class="s-center join"><h1>選擇你們的組別</h1><p class="s-p">房間 ' + esc(S.code) + '・一個組別只能一台平板</p>';
    if (S.msg) h += '<div class="err">' + esc(S.msg) + '</div>';
    h += '<div class="pick-grid">';
    for (var g = 1; g <= n; g++) {
      var taken = seats[g] && seats[g] !== TW.net.uid;
      h += '<button class="pick-btn" data-act="pick" data-arg="' + g + '"' + (taken ? ' disabled' : '') + '><b>第 ' + g + ' 組</b><span>' + (taken ? '已有人' : '點我加入') + '</span></button>';
    }
    h += '</div><p class="s-p small"><a href="#" data-act="otherRoom">輸入別的房間代碼</a></p></div>';
    root(h);
  }

  /* ================= 動作 ================= */
  var act = {
    codeGo: function () {
      var c = ($('#codeIn').value || '').trim();
      if (!/^\d{4}$/.test(c)) { toast('請輸入 4 位數字'); return; }
      S.msg = ''; subscribe(c);
    },
    otherRoom: function () { if (unsub) unsub(); S.room = null; S.g = null; LS.del(LSK); showCode(); },
    pick: function (g) {
      g = Number(g); S.msg = '';
      S.g = g; S.started = false; S.claiming = true;
      TW.roomRef(S.code).child('seats/' + g).set(TW.net.uid).then(function () {
        LS.set(LSK, { code: S.code, g: g });
        onRoom();
      }).catch(function (e) {
        S.g = null; S.claiming = false;
        S.msg = TW.friendlyError(e).indexOf('沒有權限') === 0 ? '第 ' + g + ' 組剛剛被別的平板選走了，請選別組。' : TW.friendlyError(e);
        showPick();
      });
    },
    changeGroup: function () {
      var g = S.g; if (!g) return;
      TW.roomRef(S.code).child('seats/' + g).remove().then(function () { S.g = null; S.started = false; LS.del(LSK); S.screen = 'x'; onRoom(); });
    },
    kp: function (k) {
      var st = calcState(); if (!st || st.solved) return;
      var s = st.input;
      if (k === 'back') s = s.slice(0, -1);
      else if (k === 'clear') s = '';
      else if (k === '000') { if (s.length && s.length <= 4) s += '000'; }
      else { if (s.length < 7) s += k; }
      st.input = s.replace(/^0+(?=\d)/, '');          // 去掉多餘的 0
      st.msg = ''; renderGame(true);
    },
    /* 學生輸入「帳單上要繳的金額」（不需要算負數）；餘額由下方自動扣除 */
    check: function () {
      var L = ledger(), o = L && L.pending[0], st = calcState(); if (!o || !st || st.solved) return;
      var n = parseInt(st.input, 10);
      if (isNaN(n)) { st.msg = '請先輸入金額喔'; renderGame(true); return; }
      if (n === o.amount) { st.solved = true; st.msg = ''; TW.sound.play('ok'); }
      else {
        st.wrong++;
        if (st.wrong >= 2) { st.solved = true; st.input = String(o.amount); st.reveal = true; st.msg = ''; }
        else { st.msg = '再看一次帳單上的金額喔'; st.input = ''; }
      }
      renderGame(true);
    },
    pay: function () {
      var L = ledger(), o = L && L.pending[0]; if (!o || S.paying) return;
      var cfg = TW.cfgOf(S.room), st = calcState();
      if (cfg.calc && !(st && st.solved)) return;
      S.paying = true;
      flyCoins(Math.min(8, Math.ceil(o.amount / 1000)));
      TW.sound.play('coin');
      var u = {}; u['groups/' + S.g + '/paid/' + o.key] = true;
      setTimeout(function () {
        TW.roomRef(S.code).update(u).catch(function (e) { toast('❗ ' + TW.friendlyError(e)); }).then(function () { S.paying = false; renderGame(true); });
      }, 450);
    },
    moodPick: function (k) { S.moodSel = k; renderGame(true); },
    moodSend: function () {
      if (!S.moodSel) return;
      var val = { k: S.moodSel };
      if (S.moodSel === 'custom') {
        var t = ($('#moodText') ? $('#moodText').value : S.moodText).trim().slice(0, 40);
        if (!t) { toast('請先寫一句話'); return; }
        val.t = t;
      }
      TW.roomRef(S.code).child('groups/' + S.g + '/mood').set(val).then(function () { toast('已送出 ✔'); TW.sound.play('ok'); })
        .catch(function (e) { toast('❗ ' + TW.friendlyError(e)); });
    }
  };
  function calcState() {
    var L = ledger(), o = L && L.pending[0]; if (!o) return null;
    if (!S.calc[o.key]) S.calc[o.key] = { input: '', wrong: 0, solved: false, msg: '', reveal: false };
    return S.calc[o.key];
  }
  function ledger() { return S.room && S.g ? TW.ledger(S.room, S.g) : null; }

  /* ================= 遊戲畫面 ================= */
  function sigOf() {
    var r = S.room, g = S.g, gd = (r.groups && r.groups[g]) || {};
    var cfg = TW.cfgOf(r), inf = TW.info(r);
    return [S.screen, inf.f, inf.paused, r.assign && r.assign[g], gd.paid, gd.mood, cfg, S.pre.ok, mySeat(), S.paying,
      JSON.stringify(S.calc), S.moodSel];
  }
  function renderGame(force) {
    if (S.screen !== 'game' || !S.room) return;
    var inf = TW.info(S.room);
    $('#pause').hidden = !inf.paused;
    updateFsOverlay();
    if (!force && !gate(sigOf())) return;
    if (force) gate(sigOf());
    var fresh = S.lastF !== null && S.lastF !== inf.f;
    if (fresh) {
      S.moodSel = null;
      if (inf.id === 'sub2') TW.sound.play('subsidy');
      else if (/^bill\d$/.test(inf.id)) TW.sound.play('bill');
    }
    var L = ledger();
    var h = '<div class="s-wrap ' + (fresh ? 'anim' : 'noanim') + '">' + header(L, inf) + '<div class="s-main">' + body(L, inf) + '</div>' + tray(L, inf) + '</div>';
    var keep = $('#moodText') && document.activeElement === $('#moodText');
    if (keep) { return; }       // 正在打字時不重畫，避免鍵盤收起來
    root(h);
    if (fresh || S.lastF === null) { /* 動畫由 CSS 的 .anim 觸發 */ }
    TW.runFlips($('#root'), fresh);
    var mt = $('#moodText');
    if (mt) mt.oninput = function () { S.moodText = mt.value; var b = $('#moodSendBtn'); if (b) b.disabled = !mt.value.trim(); };
    S.lastF = inf.f;
  }
  function render(force) { if (S.screen === 'game') renderGame(force); else if (S.screen === 'lobby') renderGame(force); }

  function header(L, inf) {
    var fam = L && inf.drawn ? L.fam : null;
    return '<div class="s-head" style="--fc:' + (fam ? fam.color : '#2B2D42') + '"><div class="sh-g">第 ' + S.g + ' 組</div>' +
      '<div class="sh-f">' + (fam ? esc(fam.name) : '') + '</div><div class="sh-s">' + esc(inf.frame.step) + '</div></div>';
  }

  function bigWait(emoji, t1, t2) {
    return '<div class="s-wait"><div class="sw-e">' + emoji + '</div><div class="sw-t">' + esc(t1) + '</div>' + (t2 ? '<div class="sw-s">' + esc(t2) + '</div>' : '') + '</div>';
  }

  function famCardHtml(L) {
    var f = L.fam;
    return '<div class="fcard stu" style="--fc:' + f.color + '">' + TW.famImg(f, 'fc-img') +
      '<div class="fc-name">' + esc(f.name) + '</div><div class="fc-intro">' + esc(f.intro) + '</div>' +
      '<div class="fc-inc"><small>月收入</small>' + TW.fmt(f.income) + '<small>元</small></div></div>';
  }
  function flipper(coverTxt, contentHtml, up) {
    return '<div class="flipper s" data-up="' + (up ? 1 : 0) + '"><div class="face cover"><div class="cover-in"><span class="cv-q">' + coverTxt[0] + '</span><span class="cv-g">' + coverTxt[1] + '</span></div></div>' +
      '<div class="face content">' + (up ? contentHtml : '') + '</div></div>';
  }

  function body(L, inf) {
    var id = inf.id, cfg = TW.cfgOf(S.room);
    if (id === 'lobby') {
      return '<div class="s-wait"><div class="sw-e">✅</div><div class="sw-t">第 ' + S.g + ' 組已加入</div><div class="sw-s">等待老師開始…</div>' +
        '<div class="pre">' + (S.pre.ok ? '🖼 圖片準備好了' : '🖼 圖片載入中 ' + S.pre.done + '/' + S.pre.total) + '</div>' +
        '<a href="#" class="chg" data-act="changeGroup">選錯組別了？換組</a></div>';
    }
    if (!L) return bigWait('🎲', '等待老師抽籤…');
    if (id === 'draw0') return '<div class="stage-card">' + flipper(['？', '身分卡'], '', false) + '</div>' + '<div class="s-hint">等老師按「抽籤」</div>';
    if (id === 'draw1') return '<div class="stage-card">' + flipper(['？', '身分卡'], famCardHtml(L), true) + '</div><div class="s-hint">請念出我們家的介紹和月收入</div>';
    if (/^bill\d$/.test(id) || id === 'fate1') return payView(L, inf, cfg);
    if (id === 'fate0') return '<div class="stage-card">' + flipper(['🃏', '命運卡'], '', false) + '</div><div class="s-hint">等老師抽命運卡</div>';
    if (id === 'billsum' || id === 'fatesum') return balanceView(L, '請看大螢幕');
    if (id === 'line1') return lineView(L);
    if (id === 'sub2') return subsidyView(L);
    if (id === 'rev3') return reverseView(L);
    if (id === 'mood4') return moodView(L, inf);
    if (id === 'marg5') return margView(L);
    if (id === 'sum6') return summaryView(L);
    return bigWait('👀', '請看大螢幕', '聽老師說');
  }

  /* ---- 繳費 ---- */
  function payView(L, inf, cfg) {
    var cur = inf.id === 'fate1' ? L.obligations[L.obligations.length - 1] : L.obligations[inf.shown - 1];
    if (!cur) return bigWait('⏳', '等待下一張帳單');
    var o = L.pending[0] || cur;                   // 有漏繳的，先繳最舊的
    var catchUp = L.pending[0] && L.pending[0].key !== cur.key;
    var h = '<div class="bill-card" id="billcard">';
    if (catchUp) h += '<div class="catch">還有帳單沒繳，先繳這一張：</div>';
    h += (o.fate ? '<div class="bc-pic">' + TW.plainImg(C.fate.img, 'bc-img', C.fate.title) + '</div>' : '<div class="bc-icon">' + o.icon + '</div>') + '<div class="bc-cat">' + esc(o.cat) + '</div><div class="bc-name">' + esc(o.label) + '</div>' +
      (o.bill && o.bill.note ? '<div class="bc-note">' + esc(o.bill.note) + '</div>' : '') +
      (o.fate ? '<div class="bc-note">' + esc(C.fate.text) + '</div>' : '') +
      '<div class="bc-pay">繳款</div><div class="bc-amt">' + TW.fmt(o.amount) + '<small>元</small></div>';
    if (!L.pending.length) {
      h += '<div class="paid-ok">✔ 已繳費</div><div class="s-hint">等老師公布下一步</div></div>';
      return '<div class="pay-layout">' + h + '</div>';
    }
    h += '</div>';
    var ans = L.balance - o.amount, r = '';
    if (cfg.calc) {
      var st = calcState();
      r += '<div class="calc"><div class="calc-q">請輸入要繳的金額：<b>' + TW.fmt(o.amount) + '</b> 元</div>' +
        '<div class="calc-show"><span class="calc-in ' + (st.input ? '' : 'ph') + '">' + (st.input ? fmtInput(st.input) : '？') + '</span></div>';
      if (st.msg) r += '<div class="calc-msg">' + esc(st.msg) + '</div>';
      if (st.solved) {
        r += '<div class="calc-ok">' + (st.reveal ? '就是這個金額，按繳費！' : '✔ 金額正確！') + '</div>' +
          '<button class="btn pay" data-act="pay"' + (S.paying ? ' disabled' : '') + '>💸 繳費</button>';
      } else {
        r += keypad();
      }
      r += '</div>';
    } else {
      r += '<button class="btn pay solo" data-act="pay"' + (S.paying ? ' disabled' : '') + '>💸 繳費</button>';
    }
    return '<div class="pay-layout">' + h + '<div class="pay-right">' + r + '</div></div>';
  }
  function fmtInput(s) {
    var neg = s.charAt(0) === '-', d = s.replace('-', '');
    return (neg ? '−' : '') + (d === '' ? '' : TW.fmt(parseInt(d, 10)));
  }
  function keypad() {
    var k = function (a, t, cls) { return '<button class="key ' + (cls || '') + '" data-act="kp" data-arg="' + a + '">' + t + '</button>'; };
    return '<div class="keypad">' + k('7', '7') + k('8', '8') + k('9', '9') + k('back', '⌫', 'fn') +
      k('4', '4') + k('5', '5') + k('6', '6') + k('clear', '清除', 'fn small') +
      k('1', '1') + k('2', '2') + k('3', '3') + k('000', '000') +
      k('0', '0') + '<button class="key ok" data-act="check">確定</button></div>';
  }

  function balanceView(L, hint) {
    var neg = L.balance < 0;
    return '<div class="bal-card"><div class="bal-l">我們家現在</div><div class="bal-n">' + TW.money(L.balance, { rich: true, sign: true }) + '<small>元</small></div>' +
      (neg ? '<div class="debt-tag">欠債中</div>' : '') + '</div><div class="s-hint">' + esc(hint) + '</div>';
  }

  function lineView(L) {
    var line = TW.lineTotal(), f = L.fam, below = f.income < line, max = Math.max(line, f.income) * 1.1;
    return '<div class="cmp-card"><div class="cmp-t">我們家的收入 和 政府的紅線</div>' +
      '<div class="cmp-row"><span class="cmp-n">我們家月收入</span><span class="cmp-bar"><i style="width:' + (f.income / max * 100) + '%;background:' + f.color + '"></i></span><b>' + TW.fmt(f.income) + '</b></div>' +
      '<div class="cmp-row"><span class="cmp-n">最低生活費（三人）</span><span class="cmp-bar"><i style="width:' + (line / max * 100) + '%;background:#D62839"></i></span><b>' + TW.fmt(line) + '</b></div>' +
      '<div class="cmp-res ' + (below ? 'below' : 'above') + '">' + (below ? '⬇ 我們家的收入「在線下」' : '⬆ 我們家的收入「在線上」') + '</div>' +
      '<div class="cmp-note">全家收入平均下來比這條線低，就可以申請成為低收入戶。</div></div>';
  }

  function subsidyView(L) {
    if (L.eligible) {
      return '<div class="notice good"><div class="nt-e">💰</div><div class="nt-t">' + esc(T.subsidyTitle) + '</div>' +
        '<div class="nt-s">通過審核！政府補助 <b class="money pos">+' + TW.fmt(L.subsidy) + '</b> 元</div>' +
        (L.balance >= 0 && L.subsidy > 0 ? '<div class="nt-b">債務還清了</div>' : '') + '</div>';
    }
    return bigWait('👀', '這次補助只發給「收入在線下」的家庭', '請看大螢幕');
  }

  function reverseView(L) {
    var line = TW.lineTotal(), f = L.fam;
    if (L.eligible) return bigWait('👀', '你們家已經領到補助了', '請看大螢幕，想一想小美家的情況');
    if (L.balance < 0) {
      return '<div class="notice sorry"><div class="nt-e">✉️</div><div class="nt-t">審核結果通知</div>' +
        '<div class="nt-s">很抱歉，你們家每月收入 ' + TW.fmt(f.income) + ' 元，比最低生活費多了 ' + TW.fmt(f.income - line) + ' 元，不符合低收入戶資格。</div>' +
        '<div class="nt-b">目前餘額 ' + TW.money(L.balance, { rich: true, sign: true }) + ' 元（欠債中）</div></div>';
    }
    return '<div class="notice"><div class="nt-e">✉️</div><div class="nt-t">審核結果通知</div>' +
      '<div class="nt-s">你們家每月收入 ' + TW.fmt(f.income) + ' 元，比最低生活費多了 ' + TW.fmt(f.income - line) + ' 元，不符合低收入戶資格，也不需要補助。</div>' +
      '<div class="nt-b">目前餘額 ' + TW.money(L.balance, { rich: true, sign: true }) + ' 元</div></div>';
  }

  function moodView(L, inf) {
    var gd = (S.room.groups && S.room.groups[S.g]) || {}, sent = gd.mood;
    var c = TW.isMarginal(L.fam);
    var h = '<div class="mood-q">' + esc(c ? T.moodPromptC : T.moodPromptOthers) + '</div><div class="mood-btns">';
    C.moods.forEach(function (m) {
      var on = S.moodSel === m.key || (!S.moodSel && sent && sent.k === m.key);
      h += '<button class="mood-btn' + (on ? ' on' : '') + '" data-act="moodPick" data-arg="' + m.key + '"><span>' + m.emoji + '</span>' + esc(m.label) + '</button>';
    });
    h += '</div>';
    var sel = S.moodSel || (sent && sent.k);
    if (sel === 'custom') {
      var pre = S.moodText || (sent && sent.t) || '';
      h += '<input id="moodText" class="mood-text" maxlength="40" placeholder="寫一句話（40 字以內）" value="' + esc(pre) + '">';
    }
    var ready = sel && (sel !== 'custom' || (S.moodText || (sent && sent.t) || '').trim());
    h += '<button class="btn pay" id="moodSendBtn" data-act="moodSend"' + (ready && S.moodSel ? '' : ' disabled') + '>送出</button>';
    if (sent) h += '<div class="sent">✔ 已送出' + (sent.k === 'custom' ? '：' + esc(sent.t || '') : '') + '（可以改了再送出）</div>';
    if (!S.moodText && sent && sent.k === 'custom') S.moodText = sent.t || '';
    return h;
  }

  function margView(L) {
    var gd = (S.room.groups && S.room.groups[S.g]) || {}, sent = gd.mood;
    var mo = sent && C.moods.filter(function (m) { return m.key === sent.k; })[0];
    return bigWait('💭', '聽聽大家的想法', '請看大螢幕') + (mo ? '<div class="sent">你的心情：' + mo.emoji + ' ' + esc(sent.k === 'custom' ? (sent.t || '') : mo.label) + '</div>' : '');
  }

  function summaryView(L) {
    var h = '<div class="sum-card"><div class="sum-t">🎉 ' + esc(T.endStudent) + '</div><div class="sum-sub">' + esc(L.fam.name) + ' 這個月的收支紀錄</div><div class="ledger">';
    L.items.forEach(function (it) {
      h += '<div class="lg-row"><span class="lg-i">' + it.icon + '</span><span class="lg-n">' + esc(it.label) + '</span><span class="lg-a">' + TW.money(it.amount, { rich: true, sign: true }) + '</span></div>';
    });
    L.pending.forEach(function (o) {
      h += '<div class="lg-row unpaid"><span class="lg-i">' + o.icon + '</span><span class="lg-n">' + esc(o.label) + '（未繳）</span><span class="lg-a">−' + TW.fmt(o.amount) + '</span></div>';
    });
    if (!L.eligible || L.subsidy === 0) {
      h += '<div class="lg-row note"><span class="lg-i">📄</span><span class="lg-n">低收入戶補助：' + (L.eligible ? '不需要' : '不符資格') + '</span><span class="lg-a">0</span></div>';
    }
    h += '<div class="lg-row total"><span class="lg-i">🧮</span><span class="lg-n">最後餘額</span><span class="lg-a">' + TW.money(L.balance, { rich: true, sign: true }) + '</span></div></div></div>';
    return h;
  }

  /* ---- 底部：我們家的錢 ---- */
  function tray(L, inf) {
    if (!L || !inf.drawn || inf.id === 'lobby' || inf.id === 'sum6') return '';
    return '<div class="s-tray" id="tray"><div class="tr-l">我們家的錢<b>' + TW.money(L.balance, { rich: true, sign: true }) + '</b>' + (L.balance < 0 ? '<span class="debt-tag sm">欠債中</span>' : '') + '</div>' +
      TW.chips(L.balance) + '</div>';
  }

  /* ---- 籌碼飛出去 ---- */
  function flyCoins(n) {
    var tray = $('#tray'), target = $('#billcard') || $('.s-main');
    if (!tray || !target) return;
    var a = tray.getBoundingClientRect(), b = target.getBoundingClientRect();
    for (var i = 0; i < n; i++) {
      var el = document.createElement('div');
      el.className = 'fly-coin';
      el.innerHTML = '<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#F5B82E" stroke="#2B2D42" stroke-width="4"/><text x="30" y="37" text-anchor="middle" font-size="18" font-weight="900" fill="#7A5200">1K</text></svg>';
      var sx = a.left + 40 + Math.random() * Math.min(300, a.width - 80), sy = a.top + a.height / 2 - 22;
      el.style.left = sx + 'px'; el.style.top = sy + 'px';
      document.body.appendChild(el);
      (function (el, dx, dy, d) {
        requestAnimationFrame(function () {
          el.style.transitionDelay = d + 'ms';
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.6) rotate(200deg)';
          el.style.opacity = '0';
        });
        setTimeout(function () { el.remove(); }, 900 + d);
      })(el, (b.left + b.width / 2) - sx, (b.top + b.height / 2) - sy, i * 40);
    }
  }

  /* ---- 老師按「平板全螢幕」：瀏覽器規定一定要學生自己點一下，所以蓋一層大按鈕 ---- */
  function updateFsOverlay() {
    var want = S.screen === 'game' && S.room && S.room.state && S.room.state.fs === true;
    var show = want && TW.fs.supported() && !TW.fs.isOn();
    $('#fsOverlay').hidden = !show;
    // iPad 不支援網頁全螢幕 → 顯示「加入主畫面」教學（按「知道了」後這次不再出現）
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('#iosTip').hidden = !(want && isIOS && !TW.fs.supported() && !TW.fs.isOn() && !S.iosTipDone);
  }
  $('#iosOk').addEventListener('click', function () { S.iosTipDone = true; updateFsOverlay(); });
  $('#fsGo').addEventListener('click', function () { TW.fs.enter(); setTimeout(updateFsOverlay, 300); });
  TW.fs.onChange(updateFsOverlay);

  /* ================= 事件 ================= */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (act[a]) { e.preventDefault(); act[a](t.getAttribute('data-arg')); }
  });
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }

  window.TWS = { S: S, act: act };
  boot();
})();
