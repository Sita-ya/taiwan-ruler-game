/* =====================================================================
 *  teacher.js —— 教師控制台（控制模式＋投影模式）
 *  所有步驟都由這裡寫入 state/f；學生端只能「讀」，不能改。
 * ===================================================================== */
(function () {
  'use strict';
  var TW = window.TW, C = TW.C, esc = TW.esc, IDX = TW.IDX, FR = TW.FRAMES;
  var $ = function (s) { return document.querySelector(s); };

  var S = {
    mode: 'control',      // control | proj
    kind: null,           // online | local
    code: null,
    room: null,
    mapZoom: false,
    lastF: null,
    pending: false
  };
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ================= 登入（教師密碼存在這台電腦的 localStorage） ================= */
  function sha(str) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode('tw-ruler:' + str)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    return Promise.resolve('plain:' + str);
  }
  function gate(html) { $('#gateCard').innerHTML = html; }

  function showLogin() {
    var has = LS.get('tw_teacher_pw');
    if (has && sessionStorage.getItem('tw_t_ok') === '1') return showModeSelect();
    if (!has) {
      gate('<h1>🎓 第一次使用</h1><p>請先設定「教師密碼」，避免學生打開這個頁面亂按。<br>密碼只存在這台電腦的瀏覽器裡，不會上傳。</p>' +
        '<input id="pw1" type="password" placeholder="設定密碼（至少 4 個字）" autocomplete="new-password">' +
        '<input id="pw2" type="password" placeholder="再輸入一次" autocomplete="new-password">' +
        '<div class="err" id="gErr"></div><button class="btn big primary" id="pwSet">設定並進入</button>');
      $('#pwSet').onclick = function () {
        var a = $('#pw1').value, b = $('#pw2').value;
        if (a.length < 4) { $('#gErr').textContent = '密碼至少要 4 個字。'; return; }
        if (a !== b) { $('#gErr').textContent = '兩次輸入不一樣，請再試一次。'; return; }
        sha(a).then(function (h) { LS.set('tw_teacher_pw', h); sessionStorage.setItem('tw_t_ok', '1'); showModeSelect(); });
      };
      return;
    }
    gate('<h1>🔒 教師登入</h1><input id="pw1" type="password" placeholder="輸入教師密碼" autocomplete="current-password">' +
      '<div class="err" id="gErr"></div><button class="btn big primary" id="pwGo">進入</button>' +
      '<p class="small">忘記密碼？在這台電腦的瀏覽器清除這個網站的資料後，就能重新設定。</p>');
    function go() {
      sha($('#pw1').value).then(function (h) {
        if (h === LS.get('tw_teacher_pw')) { sessionStorage.setItem('tw_t_ok', '1'); showModeSelect(); }
        else $('#gErr').textContent = '密碼不正確。';
      });
    }
    $('#pwGo').onclick = go;
    $('#pw1').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    $('#pw1').focus();
  }

  function showModeSelect(msg) {
    var saved = LS.get('tw_teacher_room');
    var fbOk = TW.firebaseReady() || TW.isMock;
    var h = '<h1>' + esc(C.texts.gameTitle) + '</h1><p class="small">教師控制台</p>';
    if (msg) h += '<div class="err">' + esc(msg) + '</div>';
    if (!fbOk) h += '<div class="warn">⚠️ 還沒有設定 Firebase，連線版暫時不能用。請先照 README 設定，或使用下方的「單機投影模式」。</div>';
    h += '<button class="btn big primary" id="mNew"' + (fbOk ? '' : ' disabled') + '>🌐 連線模式：開新的一局</button>';
    if (saved) h += '<button class="btn big" id="mResume"' + (fbOk ? '' : ' disabled') + '>↩ 繼續上次的房間（' + esc(saved) + '）</button>';
    h += '<button class="btn big" id="mLocal">🖥 單機投影模式（不連線）</button>' +
      '<p class="small"><a href="#" id="chPw">變更教師密碼</a></p>';
    gate(h);
    $('#mNew').onclick = function () { startOnline('new'); };
    if (saved) $('#mResume').onclick = function () { startOnline('resume'); };
    $('#mLocal').onclick = startLocal;
    $('#chPw').onclick = function (e) {
      e.preventDefault();
      var p = prompt('請輸入新的教師密碼（至少 4 個字）：');
      if (p && p.length >= 4) sha(p).then(function (h2) { LS.set('tw_teacher_pw', h2); toast('密碼已更新'); });
    };
  }

  /* ================= 進入房間 ================= */
  function busy(msg) { gate('<h1>' + esc(msg) + '</h1><div class="spinner"></div>'); }

  function randCode() { return String(Math.floor(1000 + Math.random() * 9000)); }
  function newRoomData() {
    return {
      teacherUid: TW.net.uid,
      createdAt: TW.TS,
      cfg: { groups: C.defaultGroups || 6, calc: C.calcMode, subMode: C.subsidy.mode, subFixed: C.subsidy.fixed, sound: false },
      state: { f: 0, shown: 0, fate: false, moodOpen: false, paused: false, ts: TW.TS }
    };
  }

  function startOnline(how) {
    busy('連線中…');
    TW.initNet('online').then(function () {
      S.kind = 'online';
      if (how === 'resume') {
        var code = LS.get('tw_teacher_room');
        return TW.roomRef(code).once('value').then(function (s) {
          var v = s.val();
          if (!v || v.teacherUid !== TW.net.uid) throw new Error('找不到這個房間，或它不是用這台電腦開的。請開新的一局。');
          S.code = code;
        });
      }
      return createRoom();
    }).then(enterApp).catch(function (e) {
      showModeSelect(TW.friendlyError(e));
    });
  }

  function createRoom() {
    var tries = 0;
    function attempt() {
      if (++tries > 30) return Promise.reject(new Error('暫時找不到可用的房間代碼，請稍後再試。'));
      var code = randCode();
      return TW.roomRef(code).once('value').then(function (s) {
        var v = s.val();
        var stale = v && typeof v.createdAt === 'number' && v.createdAt < Date.now() - 43200000;
        if (v && !stale) return attempt();
        return TW.roomRef(code).set(newRoomData()).then(function () { S.code = code; LS.set('tw_teacher_room', code); });
      });
    }
    return attempt();
  }

  function startLocal() {
    busy('準備中…');
    TW.initNet('local').then(function () {
      S.kind = 'local'; S.code = 'local';
      return TW.roomRef('local').once('value');
    }).then(function (s) {
      if (!s.exists()) return TW.roomRef('local').set(newRoomData());
    }).then(enterApp).catch(function (e) { showModeSelect(TW.friendlyError(e)); });
  }

  function enterApp() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    $('#tbRoom').innerHTML = S.kind === 'online'
      ? '房間代碼 <b>' + esc(S.code) + '</b>'
      : '<b>單機投影模式</b>（不連線）';
    TW.preload(TW.imageList());                     // 大廳階段就把圖片載好
    if (S.kind === 'online') {
      TW.watchConnection(function (ok) {
        $('#tbConn').textContent = ok ? '🟢 已連線' : '🔴 連線中斷（會自動重連）';
        $('#tbConn').className = 'conn ' + (ok ? 'ok' : 'bad');
      });
    } else $('#tbConn').textContent = '🖥 離線';
    TW.roomRef(S.code).on('value', function (snap) {
      S.room = snap.val();
      if (!S.room) {            // 房間被刪掉了
        toast('房間資料不見了，請重新開局。');
        return;
      }
      onRoom();
    });
    setMode('control');
    window.addEventListener('resize', fitAll);
  }

  /* ================= 寫入動作（只有老師能做） ================= */
  function R() { return TW.roomRef(S.code); }
  function write(updates) {
    return R().update(updates).catch(function (e) { toast('❗ ' + TW.friendlyError(e)); });
  }
  function frameUpdates(idx) {
    var inf = TW.info({ state: { f: idx } });
    var u = {
      'state/f': idx, 'state/ts': TW.TS, 'state/shown': inf.shown,
      'state/fate': inf.fate, 'state/moodOpen': inf.moodOpen
    };
    var room = S.room || {};
    if (idx >= IDX.draw1 && !(room.assign && room.assign[1])) u['assign'] = TW.randomAssign(TW.groupCount(room));
    return u;
  }
  function goto(idx) {
    if (idx < 0 || idx >= FR.length || !S.room) return;
    if (idx === TW.info(S.room).f) return;
    write(frameUpdates(idx));
  }
  var act = {
    next: function () { var f = TW.info(S.room).f; goto(TW.nextIndex(f)); },
    prev: function () { var f = TW.info(S.room).f; goto(TW.prevIndex(f)); },
    jump: function (a) { goto(Number(a)); },
    line2: function () { goto(IDX.line2); },
    pause: function () {
      var p = !(S.room.state && S.room.state.paused);
      write({ 'state/paused': p, 'state/ts': TW.TS });
      if (p) TW.sound.play('pause');
    },
    mode: function (a) { setMode(a); },
    openProj: function () {
      var url = 'projector.html?' + (S.kind === 'local' ? 'local=1' : 'room=' + S.code) +
        (TW.isMock ? '&mock=1&uid=' + encodeURIComponent(TW.net.uid) : '');
      var w = window.open(url, 'tw_projector', 'popup,width=1280,height=760');
      if (!w) { toast('瀏覽器擋下了新視窗：請在網址列右邊允許「彈出式視窗」後再按一次。'); return; }
      try { w.focus(); } catch (e) { /* ignore */ }
      toast('已開啟投影視窗：把它拖到電子白板，再按視窗裡的「⛶ 全螢幕」。');
    },
    stuFs: function () {
      var on = !(S.room.state && S.room.state.fs);
      write({ 'state/fs': on, 'state/ts': TW.TS });
      toast(on ? '學生平板會出現「點一下進入全螢幕」，請學生點一下。' : '已關閉平板全螢幕提示。');
    },
    redraw: function () {
      if (!confirm('要重新抽籤嗎？\n各組的繳費與心情紀錄會一起清掉。')) return;
      var u = resetGroupsUpdates();
      u['assign'] = TW.randomAssign(TW.groupCount(S.room));
      write(u);
    },
    restart: function () {
      if (!confirm('確定要「重新開始」嗎？\n步驟會回到大廳，抽籤結果、各組的繳費與心情都會清掉（學生不用重新加入）。')) return;
      var u = resetGroupsUpdates();
      u['assign'] = null; u['state/f'] = 0; u['state/shown'] = 0; u['state/fate'] = false;
      u['state/moodOpen'] = false; u['state/paused'] = false; u['state/ts'] = TW.TS;
      write(u);
    },
    newRoom: function () {
      if (!confirm('要開新的一局嗎？會產生新的房間代碼，目前這一局的學生需要重新加入。')) return;
      busy('開新的一局…');
      R().off();
      createRoom().then(enterApp).catch(function (e) { showModeSelect(TW.friendlyError(e)); $('#gate').hidden = false; $('#app').hidden = true; });
    },
    logout: function () {
      if (!confirm('回到選單？（房間資料會保留，可以按「繼續上次的房間」回來）')) return;
      location.reload();
    },
    kick: function (g) {
      if (!confirm('要讓第 ' + g + ' 組的平板離開嗎？他們可以重新選組加入。')) return;
      var u = {}; u['seats/' + g] = null; u['groups/' + g + '/online'] = false; write(u);
    },
    pay: function (g) {
      var L = TW.ledger(S.room, Number(g)); if (!L) return;
      var u = {}; L.pending.forEach(function (o) { u['groups/' + g + '/paid/' + o.key] = true; });
      if (Object.keys(u).length) write(u);
    },
    payAll: function () {
      var u = {};
      groupsList().forEach(function (g) {
        var L = TW.ledger(S.room, g); if (!L) return;
        L.pending.forEach(function (o) { u['groups/' + g + '/paid/' + o.key] = true; });
      });
      if (Object.keys(u).length) write(u);
    },
    hide: function (g) {
      var cur = S.room.groups && S.room.groups[g] && S.room.groups[g].hide;
      var u = {}; u['groups/' + g + '/hide'] = cur ? null : true; write(u);
    },
    copy: function () {
      var url = studentUrl();
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('已複製學生網址'); });
    }
  };
  function resetGroupsUpdates() {
    var u = {};
    for (var g = 1; g <= 6; g++) { u['groups/' + g + '/paid'] = null; u['groups/' + g + '/mood'] = null; u['groups/' + g + '/hide'] = null; }
    return u;
  }
  function groupsList() { var a = [], n = TW.groupCount(S.room); for (var g = 1; g <= n; g++) a.push(g); return a; }

  /* ================= 畫面 ================= */
  var gates = { steps: TW.makeGate(), notes: TW.makeGate(), groups: TW.makeGate(), settings: TW.makeGate(), pv: TW.makeGate(), nav: TW.makeGate(), top: TW.makeGate() };

  function studentUrl() { return TW.studentUrl(S.code); }
  function env() { return TW.projEnv(S.kind, S.code, S.mapZoom); }

  function onRoom() {
    var inf = TW.info(S.room), cfg = TW.cfgOf(S.room);
    TW.sound.on = cfg.sound;
    var fresh = S.lastF !== null && S.lastF !== inf.f;
    if (fresh) {
      S.mapZoom = false;
      var id = inf.id;
      if (/^bill\d$/.test(id)) TW.sound.play('bill');
      else if (id === 'sub2') TW.sound.play('subsidy');
      else if (id === 'line1' || id === 'rev3') TW.sound.play('ok');
    }
    renderAll(fresh);
    S.lastF = inf.f;
  }

  function renderAll(fresh) {
    var el = document.activeElement;
    if (el && el.matches && el.matches('#control input[type=number], #control input[type=text]')) { S.pending = true; return; }
    S.pending = false;
    var room = S.room, inf = TW.info(room), cfg = TW.cfgOf(room);

    // 全班暫停按鈕
    var pb = $('#pauseBtn');
    pb.textContent = inf.paused ? '▶ 解除暫停（學生畫面：👀 眼睛看老師）' : '⏸ 全班暫停';
    pb.classList.toggle('on', inf.paused);
    var fb = $('#stuFsBtn'), fsOn = !!(room.state && room.state.fs);
    fb.hidden = S.kind !== 'online';
    fb.textContent = fsOn ? '📱 平板全螢幕 ✓' : '📱 平板全螢幕';
    fb.title = fsOn ? '已開啟：學生平板會出現「點一下進入全螢幕」。再按一次關閉。' : '讓學生平板出現「點一下進入全螢幕」';
    fb.classList.toggle('on', fsOn);

    // 投影舞台（預覽或全螢幕）
    var box = S.mode === 'proj' ? $('#fullBox') : $('#pvBox');
    var sigPv = [JSON.stringify(room), S.mode, S.mapZoom];
    if (gates.pv(sigPv) || fresh) renderStage(box, fresh);

    if (S.mode !== 'control') return;

    if (gates.steps([inf.f])) renderSteps(inf);
    if (gates.notes([inf.f])) renderNotes(inf);
    renderNav(inf);
    if (gates.groups([room.assign, room.seats, room.groups, room.state, room.cfg && room.cfg.groups])) renderGroups(inf);
    if (gates.settings([room.cfg, inf.f])) renderSettings(inf, cfg);
  }

  function renderStage(box, fresh) {
    var h = '<div class="stage ' + (fresh ? 'anim' : 'noanim') + '">' + TW.projection(S.room, env()) + '</div>';
    box.innerHTML = h;
    fit(box);
    TW.runFlips(box, fresh);
    if (S.mapZoom) { var mw = box.querySelector('.map-wrap'); if (mw) { mw.scrollLeft = (mw.scrollWidth - mw.clientWidth) / 2; mw.scrollTop = (mw.scrollHeight - mw.clientHeight) / 2; } }
  }
  function fit(box) {
    var st = box.querySelector('.stage'); if (!st) return;
    var w = box.clientWidth, h = box.clientHeight;
    var s = Math.min(w / 1920, h / 1080);
    st.style.transform = 'scale(' + s + ')';
    st.style.left = ((w - 1920 * s) / 2) + 'px';
    st.style.top = ((h - 1080 * s) / 2) + 'px';
  }
  function fitAll() { fit($('#pvBox')); fit($('#fullBox')); }

  function renderSteps(inf) {
    var h = '';
    FR.forEach(function (f, i) {
      if (f.hidden) return;
      h += '<button class="step-item' + (i === inf.f ? ' cur' : '') + (i < inf.f ? ' done' : '') + '" data-act="jump" data-arg="' + i + '">' +
        '<span class="si-n">' + esc(f.step) + '</span><span class="si-t">' + esc(f.title) + '</span></button>';
    });
    $('#stepList').innerHTML = h;
    $('#line2Btn').classList.toggle('cur', inf.id === 'line2');
    var cur = $('#stepList .cur'), box = $('.col-steps');    // 只捲動左邊的步驟列表，不要捲動整個頁面
    if (cur && box) box.scrollTop = Math.max(0, cur.offsetTop - box.offsetTop - box.clientHeight / 2);
  }

  function renderNotes(inf) {
    var h = '<h3>🗒 教師口白提示 <small>（' + esc(inf.frame.step) + '・' + esc(inf.frame.title) + '）</small></h3>';
    TW.notesFor(inf.frame).forEach(function (n) {
      if (n.say) h += '<p class="note say"><b>💬 可以說</b>' + esc(n.say) + '</p>';
      if (n.tip) h += '<p class="note tip"><b>📌 提醒</b>' + esc(n.tip) + '</p>';
    });
    $('#notesPanel').innerHTML = h;
  }

  function allPaid(inf) {
    if (S.kind !== 'online') return null;
    var open = (/^bill\d$/.test(inf.id)) || inf.id === 'fate1';
    if (!open) return null;
    var joined = groupsList().filter(function (g) { return S.room.seats && S.room.seats[g]; });
    if (!joined.length) return false;
    return joined.every(function (g) { var L = TW.ledger(S.room, g); return L && L.pending.length === 0; });
  }
  function renderNav(inf) {
    var ni = TW.nextIndex(inf.f), pi = TW.prevIndex(inf.f);
    var ap = allPaid(inf);
    var nb = $('#nextBtn'), pbn = $('#prevBtn');
    nb.disabled = ni === inf.f;
    nb.innerHTML = ni === inf.f ? '已是最後一步' : esc(FR[ni].enter) + ' ▶';
    nb.classList.toggle('ready', ap === true);
    pbn.disabled = pi === inf.f;
    $('#navMid').innerHTML = ap === true ? '<span class="ok">✔ 全部繳完了，可以進行下一步</span>'
      : (ap === false ? '<span class="wait">等學生繳費中…</span>' : '<span>目前：' + esc(inf.frame.step) + '　' + esc(inf.frame.title) + '</span>');
  }

  function renderGroups(inf) {
    var room = S.room, online = S.kind === 'online';
    var h = '<h3>👥 各組即時狀態</h3>';
    if (online && (/^bill\d$/.test(inf.id) || inf.id === 'fate1')) h += '<button class="btn small" data-act="payAll">全部代為繳費</button>';
    h += '<div class="gtable">';
    groupsList().forEach(function (g) {
      var seat = online ? (room.seats && room.seats[g]) : true;
      var gd = room.groups && room.groups[g];
      var L = TW.ledger(room, g, { auto: !online });
      var dot = !online ? '' : (!seat ? '<span class="dot none">未加入</span>' : (gd && gd.online ? '<span class="dot on">● 線上</span>' : '<span class="dot off">○ 離線</span>'));
      h += '<div class="grow"><div class="gr-top"><b>第 ' + g + ' 組</b>' + (L ? '<span class="gr-fam" style="--fc:' + L.fam.color + '">' + esc(L.fam.name) + '</span>' : '<span class="gr-fam none">未抽籤</span>') + dot + '</div>';
      if (L) {
        var stat = '';
        if (online && L.obligations.length && (/^bill\d$/.test(inf.id) || inf.id === 'fate1')) {
          var paid = L.obligations.length - L.pending.length;
          stat = (L.pending.length ? '⏳ 已繳 ' + paid + '/' + L.obligations.length : '✔ 全部已繳');
        }
        if (inf.id === 'mood4' && gd && gd.mood) {
          var mo = C.moods.filter(function (x) { return x.key === gd.mood.k; })[0];
          stat = (mo ? mo.emoji : '') + ' ' + (gd.mood.k === 'custom' ? esc(gd.mood.t || '') : (mo ? esc(mo.label) : ''));
        }
        h += '<div class="gr-bot"><span class="gr-bal">' + TW.money(L.balance, { rich: true, sign: true }) + '</span><span class="gr-stat">' + stat + '</span><span class="gr-btns">';
        if (online && L.pending.length) h += '<button class="btn tiny" data-act="pay" data-arg="' + g + '">代繳</button>';
        if (inf.id === 'mood4' && gd && gd.mood) h += '<button class="btn tiny" data-act="hide" data-arg="' + g + '">' + (gd.hide ? '顯示回應' : '隱藏回應') + '</button>';
        if (online && seat) h += '<button class="btn tiny danger" data-act="kick" data-arg="' + g + '">踢出</button>';
        h += '</span></div>';
      } else if (online && seat) {
        h += '<div class="gr-bot"><span class="gr-stat">已加入，等待抽籤</span><span class="gr-btns"><button class="btn tiny danger" data-act="kick" data-arg="' + g + '">踢出</button></span></div>';
      }
      h += '</div>';
    });
    $('#groupsPanel').innerHTML = h + '</div>';
  }

  function renderSettings(inf, cfg) {
    var locked = inf.f > IDX.draw0;
    var h = '<h3>⚙️ 設定</h3>' +
      '<label class="set">本局組數 <select id="setGroups"' + (locked ? ' disabled title="抽籤後不能改，請先「重新開始」"' : '') + '>' +
      [4, 5, 6].map(function (n) { return '<option value="' + n + '"' + (cfg.groups === n ? ' selected' : '') + '>' + n + ' 組</option>'; }).join('') + '</select></label>' +
      '<label class="set"><input type="checkbox" id="setCalc"' + (cfg.calc ? ' checked' : '') + '> 輸入模式（學生要先在鍵盤輸入「繳款金額」才能繳費）</label>' +
      '<label class="set"><input type="checkbox" id="setSound"' + (cfg.sound ? ' checked' : '') + '> 開啟音效</label>' +
      '<label class="set">補助方式 <select id="setSub"><option value="cover"' + (cfg.subMode === 'cover' ? ' selected' : '') + '>剛好補到 0（還清債務）</option>' +
      '<option value="fixed"' + (cfg.subMode === 'fixed' ? ' selected' : '') + '>固定金額</option></select></label>' +
      '<label class="set">固定金額 <input type="number" id="setFixed" min="0" step="1000" value="' + cfg.subFixed + '"' + (cfg.subMode === 'fixed' ? '' : ' disabled') + '> 元</label>' +
      '<div class="set-btns">' +
      (inf.f >= IDX.draw1 ? '<button class="btn small" data-act="redraw">🔄 重新抽籤</button>' : '') +
      '<button class="btn small danger" data-act="restart">⏮ 重新開始</button>' +
      (S.kind === 'online' ? '<button class="btn small" data-act="newRoom">🆕 開新的一局（新代碼）</button><button class="btn small" data-act="copy">📋 複製學生網址</button>' : '') +
      '<button class="btn small" data-act="logout">🚪 回到選單</button></div>';
    if (S.kind === 'online') h += '<div class="set-url">學生網址：<br><code>' + esc(studentUrl()) + '</code></div>';
    $('#settingsPanel').innerHTML = h;
  }

  /* ================= 事件 ================= */
  function setMode(m) {
    S.mode = m;
    $('#control').hidden = m !== 'control';
    $('#topbar').hidden = m !== 'control';
    $('#projFull').hidden = m !== 'proj';
    document.body.classList.toggle('proj-mode', m === 'proj');
    Array.prototype.forEach.call(document.querySelectorAll('.tb-mid .tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-arg') === m); });
    // 強制重畫
    Object.keys(gates).forEach(function (k) { gates[k]({ reset: Math.random() }); });
    if (S.room) renderAll(false);
    fitAll();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var a = t.getAttribute('data-act'), arg = t.getAttribute('data-arg');
    if (a === 'mapzoom') {
      if (S.dragged) { S.dragged = false; return; }
      S.mapZoom = !S.mapZoom; gates.pv({ r: Math.random() }); renderStage(S.mode === 'proj' ? $('#fullBox') : $('#pvBox'), false); return;
    }
    if (act[a]) { e.preventDefault(); act[a](arg); }
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (!S.room) return;
    if (id === 'setGroups') {
      if (TW.info(S.room).f > IDX.draw0) return;
      write({ 'cfg/groups': Number(e.target.value), 'assign': null });
    } else if (id === 'setCalc') write({ 'cfg/calc': e.target.checked });
    else if (id === 'setSound') { write({ 'cfg/sound': e.target.checked }); TW.sound.on = e.target.checked; TW.sound.play('ok'); }
    else if (id === 'setSub') write({ 'cfg/subMode': e.target.value });
    else if (id === 'setFixed') write({ 'cfg/subFixed': Math.max(0, Math.round(Number(e.target.value) || 0)) });
  });
  document.addEventListener('focusout', function () {
    setTimeout(function () { if (S.pending && S.room) { gates.groups({ r: Math.random() }); gates.settings({ r: Math.random() }); renderAll(false); } }, 50);
  });
  document.addEventListener('keydown', function (e) {
    if (S.mode !== 'proj' || !S.room) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); act.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); act.prev(); }
    else if (e.key === 'p' || e.key === 'P') act.pause();
    else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') setMode('control');
  });
  // 地圖拖曳平移（放大後）
  (function () {
    var drag = null;
    document.addEventListener('mousedown', function (e) {
      var w = e.target.closest('.map-wrap.zoomed'); if (!w) return;
      drag = { w: w, x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop }; S.dragged = false;
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) S.dragged = true;
      var k = 1 / (parseFloat(drag.w.closest('.stage').style.transform.replace(/[^0-9.]/g, '')) || 1);
      drag.w.scrollLeft = drag.sl - dx * 1; drag.w.scrollTop = drag.st - dy * 1;
    });
    document.addEventListener('mouseup', function () { drag = null; setTimeout(function () { S.dragged = false; }, 0); });
  })();

  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  showLogin();
  window.TWT = { S: S, act: act };   // 方便除錯與自動測試
})();
