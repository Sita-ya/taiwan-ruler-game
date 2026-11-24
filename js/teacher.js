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

  /* ================= 歷史紀錄（只存在這台電腦的瀏覽器 localStorage） =================
   * tw_teacher_hist = [{ code, createdAt, groups, f }]
   *   code 房間代碼／createdAt 開房時間（毫秒）／groups 組數／f 最後記錄到的步驟編號
   * 超過 KEEP_DAYS 天的紀錄會自動從清單移除（雲端資料不受影響）。 */
  var HIST_KEY = 'tw_teacher_hist';
  var KEEP_DAYS = Number(C.historyDays) > 0 ? Number(C.historyDays) : 30;
  var live = {};   // 首頁即時讀到的雲端狀態：live[code] = { exists, owner, f }

  function histLoad() {
    var a;
    try { a = JSON.parse(LS.get(HIST_KEY) || '[]'); } catch (e) { a = []; }
    if (!Array.isArray(a)) a = [];
    a = a.filter(function (h) { return h && /^\d{4}$/.test(String(h.code)); });
    // 舊版只記「上次的房間」：搬進清單
    var old = LS.get('tw_teacher_room');
    if (old && /^\d{4}$/.test(old) && !a.some(function (h) { return h.code === old; })) a.push({ code: old, createdAt: Date.now(), groups: null });
    if (old) LS.del('tw_teacher_room');
    var limit = Date.now() - KEEP_DAYS * 86400000;
    a = a.filter(function (h) { return typeof h.createdAt === 'number' && h.createdAt >= limit; });
    histSave(a);
    return a;
  }
  function histSave(a) { LS.set(HIST_KEY, JSON.stringify(a)); }
  function histPut(entry) {
    var a = histLoad().filter(function (h) { return h.code !== entry.code; });
    a.push(entry); histSave(a);
  }
  function histPatch(code, fields) {
    var a = histLoad(), hit = false;
    a.forEach(function (h) { if (h.code === code) { for (var k in fields) h[k] = fields[k]; hit = true; } });
    if (hit) histSave(a);
  }
  function histRemove(code) { histSave(histLoad().filter(function (h) { return h.code !== code; })); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function stepLabel(f) {
    var fr = FR[f]; if (!fr) return '—';
    return fr.step + '　' + fr.title;
  }
  function stepCell(h) {
    var L = live[h.code];
    if (L === 'loading') return '<span class="muted">讀取中…</span>';
    if (L === 'fail') return (typeof h.f === 'number' ? esc(stepLabel(h.f)) + '<br>' : '') + '<span class="muted">（目前無法連線讀取）</span>';
    if (L && !L.exists) return '<span class="muted">雲端已沒有這個房間的資料</span>';
    if (L) return esc(stepLabel(L.f)) + (L.owner ? '' : '<br><span class="warn-txt">👀 不是用這個瀏覽器開的，只能檢視</span>');
    if (typeof h.f === 'number') return esc(stepLabel(h.f)) + '<br><span class="muted">（上次在這台電腦看到的）</span>';
    return '<span class="muted">—</span>';
  }

  function showHome(msg) { showModeSelect(msg); }
  function showModeSelect(msg) {
    var fbOk = TW.firebaseReady() || TW.isMock;
    var hist = histLoad().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var h = '<h1>' + esc(C.texts.gameTitle) + '</h1><p class="small">教師控制台</p>';
    if (msg) h += '<div class="err">' + esc(msg) + '</div>';
    if (!fbOk) h += '<div class="warn">⚠️ 還沒有設定 Firebase，連線版暫時不能用。請先照 README 設定，或使用下方的「單機投影模式」。</div>';
    h += '<button class="btn big primary" id="mNew"' + (fbOk ? '' : ' disabled') + '>🌐 連線模式：開新的一局</button>';

    // 歷史紀錄
    h += '<section class="hist"><h2>📚 歷史紀錄 <small>（這台電腦開過的房間，保留 ' + KEEP_DAYS + ' 天）</small></h2>';
    if (!hist.length) {
      h += '<p class="small">還沒有紀錄。按「開新的一局」之後，房間會自動記在這裡。</p>';
    } else {
      h += '<div class="hist-wrap"><table class="hist-table"><thead><tr><th>房間代碼</th><th>建立時間</th><th>摘要</th><th>目前步驟</th><th>操作</th></tr></thead><tbody>';
      hist.forEach(function (it) {
        h += '<tr><td class="hc">' + esc(it.code) + '</td><td>' + esc(fmtTime(it.createdAt)) + '</td>' +
          '<td>' + (it.groups ? esc(it.groups) + ' 組' : '—') + '</td>' +
          '<td id="hs' + esc(it.code) + '">' + stepCell(it) + '</td>' +
          '<td class="hb"><button class="btn hbtn primary" data-h="open" data-code="' + esc(it.code) + '"' + (fbOk ? '' : ' disabled') + '>▶ 繼續</button>' +
          '<button class="btn hbtn danger" data-h="del" data-code="' + esc(it.code) + '">✕ 移除</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="code-open"><label for="codeIn">用房間代碼打開</label>' +
      '<input id="codeIn" inputmode="numeric" maxlength="4" placeholder="4 位數代碼" autocomplete="off">' +
      '<button class="btn hbtn" id="codeGo"' + (fbOk ? '' : ' disabled') + '>打開</button></div>' +
      '<p class="small">清單被清掉、或換了一台電腦時用。不是用這個瀏覽器開的房間，只能檢視、不能控場。</p></section>';

    // 單機投影模式（只有一個固定的「單機房間」，存在這台電腦）
    h += '<button class="btn big" id="mLocal">🖥 單機投影模式（不連線）</button>';
    var lf = localStep();
    h += '<p class="small">' + (lf === null ? '單機模式只有一個房間，資料存在這台電腦。'
      : '單機模式會自動接續上次的進度（目前：' + esc(stepLabel(lf)) + '）。要重來請在控制台按「⏮ 重新開始」。') + '</p>';
    h += '<p class="small"><a href="#" id="chPw">變更教師密碼</a></p>';
    gate(h);
    $('#gateCard').classList.add('wide');

    $('#mNew').onclick = function () { startOnline('new'); };
    $('#mLocal').onclick = startLocal;
    $('#codeGo').onclick = function () {
      var c = $('#codeIn').value.replace(/\D/g, '');
      if (!/^\d{4}$/.test(c)) { toast('請輸入 4 位數的房間代碼。'); $('#codeIn').focus(); return; }
      openRoom(c);
    };
    $('#codeIn').onkeydown = function (e) { if (e.key === 'Enter') $('#codeGo').click(); };
    Array.prototype.forEach.call(document.querySelectorAll('#gateCard [data-h]'), function (b) {
      b.onclick = function () {
        var c = b.getAttribute('data-code');
        if (b.getAttribute('data-h') === 'open') openRoom(c); else askRemove(c);
      };
    });
    $('#chPw').onclick = function (e) {
      e.preventDefault();
      var p = prompt('請輸入新的教師密碼（至少 4 個字）：');
      if (p && p.length >= 4) sha(p).then(function (h2) { LS.set('tw_teacher_pw', h2); toast('密碼已更新'); });
    };
    if (fbOk && hist.length) peekRooms(hist);
  }

  /** 首頁：連線讀取各房間「目前步驟」與「是不是我開的」（只讀，不寫入） */
  function peekRooms(hist) {
    hist.forEach(function (it) { if (!live[it.code]) live[it.code] = 'loading'; });
    refreshCells(hist);
    TW.peekNet().then(function (net) {      // 背景讀取：不搶走老師之後選的模式（例如單機模式）
      hist.forEach(function (it) {
        net.db.ref('rooms/' + it.code).once('value').then(function (s) {
          var v = s.val();
          live[it.code] = v ? { exists: true, owner: v.teacherUid === net.uid, f: TW.info(v).f } : { exists: false };
          if (v && v.teacherUid === net.uid) histPatch(it.code, { f: TW.info(v).f, groups: TW.groupCount(v) });
        }).catch(function () { live[it.code] = 'fail'; }).then(function () { refreshCells([it]); });
      });
    }).catch(function () {
      hist.forEach(function (it) { live[it.code] = 'fail'; });
      refreshCells(hist);
    });
  }
  function refreshCells(list) {
    list.forEach(function (it) { var td = document.getElementById('hs' + it.code); if (td) td.innerHTML = stepCell(it); });
  }
  function localStep() {
    try {
      var t = JSON.parse(localStorage.getItem('tw_local_db'));
      var r = t && t.rooms && t.rooms.local;
      return r ? TW.info(r).f : null;
    } catch (e) { return null; }
  }

  /* ---------- 移除（預設只移除清單；刪雲端要再確認，而且只有開房的瀏覽器能刪） ---------- */
  function askRemove(code) {
    var L = live[code], owner = !!(L && L.exists && L.owner);
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="modal-card"><h2>移除房間 ' + esc(code) + '？</h2>' +
      '<p>「只從清單移除」：只是把它從<b>這台電腦的歷史清單</b>拿掉，<b>雲端上的房間資料不會刪除</b>，之後還能用房間代碼打開。</p>' +
      (owner
        ? '<p>「一併刪除雲端資料」：連同雲端上這一局的步驟、抽籤與各組紀錄<b>永久刪除</b>，學生端會馬上看不到這一局。</p>'
        : '<p class="small">（要刪除雲端資料，必須連上網路，而且使用當初開房的這個瀏覽器。）</p>') +
      '<div class="modal-btns"><button class="btn hbtn primary" data-m="list">🗂 只從清單移除</button>' +
      (owner ? '<button class="btn hbtn danger" data-m="cloud">🗑 一併刪除雲端資料</button>' : '') +
      '<button class="btn hbtn" data-m="cancel">取消</button></div></div>';
    document.body.appendChild(m);
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]');
      if (!b && e.target !== m) return;
      var w = b ? b.getAttribute('data-m') : 'cancel';
      if (w === 'cloud' && !confirm('確定要「永久刪除」房間 ' + code + ' 的雲端資料嗎？\n刪除後無法復原，學生也無法再回到這一局。')) return;
      m.remove();
      if (w === 'list') { histRemove(code); delete live[code]; showHome(); toast('已從這台電腦的清單移除（雲端資料還在）。'); }
      if (w === 'cloud') {
        TW.peekNet().then(function (net) { return net.db.ref('rooms/' + code).remove(); }).then(function () {
          histRemove(code); delete live[code]; showHome(); toast('已刪除房間 ' + code + ' 的雲端資料，也從清單移除。');
        }).catch(function (err) { showHome('刪除失敗：' + TW.friendlyError(err)); });
      }
    };
  }

  /* ================= 進入房間 ================= */
  function busy(msg) { $('#gateCard').classList.remove('wide'); gate('<h1>' + esc(msg) + '</h1><div class="spinner"></div>'); }

  /** 繼續／用代碼打開：重新訂閱這個房間。是自己開的就能控場，否則只能檢視。 */
  function openRoom(code) {
    busy('連線中…');
    TW.initNet('online').then(function () {
      return TW.roomRef(code).once('value');
    }).then(function (s) {
      var v = s.val();
      if (!v) throw new Error('找不到房間 ' + code + ' 的資料（可能已被刪除，或代碼打錯）。');
      S.kind = 'online'; S.code = code;
      S.readonly = v.teacherUid !== TW.net.uid;
      var old = histLoad().filter(function (h) { return h.code === code; })[0];
      histPut({
        code: code,
        createdAt: old ? old.createdAt : (typeof v.createdAt === 'number' ? v.createdAt : Date.now()),
        groups: TW.groupCount(v), f: TW.info(v).f
      });
    }).then(enterApp).then(function () {
      if (S.readonly) toast('👀 這個房間不是用這個瀏覽器開的：只能檢視，不能控場。');
    }).catch(function (e) { showHome(TW.friendlyError(e)); });
  }

  function randCode() { return String(Math.floor(1000 + Math.random() * 9000)); }
  function newRoomData() {
    return {
      teacherUid: TW.net.uid,
      createdAt: TW.TS,
      cfg: { groups: C.defaultGroups || 6, calc: C.calcMode, subMode: C.subsidy.mode, subFixed: C.subsidy.fixed, sound: false },
      state: { f: 0, shown: 0, fate: false, moodOpen: false, paused: false, ts: TW.TS }
    };
  }

  function startOnline() {
    busy('連線中…');
    TW.initNet('online').then(function () {
      S.kind = 'online'; S.readonly = false;
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
        var data = newRoomData();
        return TW.roomRef(code).set(data).then(function () {
          S.code = code; S.readonly = false;
          histPut({ code: code, createdAt: Date.now(), groups: data.cfg.groups, f: 0 });   // 記進這台電腦的歷史清單
        });
      });
    }
    return attempt();
  }

  function startLocal() {
    busy('準備中…');
    TW.initNet('local').then(function () {
      S.kind = 'local'; S.code = 'local'; S.readonly = false;
      return TW.roomRef('local').once('value');
    }).then(function (s) {
      if (!s.exists()) return TW.roomRef('local').set(newRoomData());
    }).then(enterApp).catch(function (e) { showModeSelect(TW.friendlyError(e)); });
  }

  function enterApp() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    $('#tbRoom').innerHTML = S.kind === 'online'
      ? '房間代碼 <b>' + esc(S.code) + '</b>' + (S.readonly ? '　<span class="ro-tag" title="不是用這個瀏覽器開的房間，不能控場">👀 只能檢視</span>' : '')
      : '<b>單機投影模式</b>（不連線）';
    document.body.classList.toggle('readonly', !!S.readonly);
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
  var RO_MSG = '👀 這個房間不是用這個瀏覽器開的，只能檢視、不能控場。';
  function write(updates) {
    if (S.readonly) { toast(RO_MSG); return Promise.resolve(); }
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
    vid: function (cmd) {
      var v = (S.room.state && S.room.state.vid) || {};
      write({ 'state/vid': { cmd: cmd, n: (v.n || 0) + 1 } });
    },
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
      if (!confirm('回到選單？（房間資料會保留，可以在「歷史紀錄」按「繼續」回來）')) return;
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
  function env(preview) { return TW.projEnv(S.kind, S.code, S.mapZoom, preview); }

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
    if (S.kind === 'online' && !S.readonly && S.lastF !== inf.f) histPatch(S.code, { f: inf.f, groups: cfg.groups });
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
    var playing = inf.id === 'video' && !fresh && box.querySelector('iframe.yt');   // 影片播放中：不要重畫，否則影片會重來
    if ((gates.pv(sigPv) || fresh) && !playing) renderStage(box, fresh);
    applyVideoCmd();

    if (S.mode !== 'control') return;

    if (gates.steps([inf.f])) renderSteps(inf);
    if (gates.notes([inf.f])) renderNotes(inf);
    renderNav(inf);
    if (gates.groups([room.assign, room.seats, room.groups, room.state, room.cfg && room.cfg.groups])) renderGroups(inf);
    if (gates.settings([room.cfg, inf.f])) renderSettings(inf, cfg);
  }

  /** 老師按了 ▶／⏸／⏮：只對「投影模式」這個視窗裡的影片下指令（獨立投影視窗自己會處理） */
  function applyVideoCmd() {
    var v = S.room && S.room.state && S.room.state.vid;
    var n = v ? v.n : 0;
    if (S.vidN === undefined) { S.vidN = n; return; }       // 剛打開頁面：不重播舊指令
    if (n === S.vidN) return;
    S.vidN = n;
    if (S.mode === 'proj' && v) TW.yt($('#fullBox'), v.cmd);
  }
  function renderStage(box, fresh) {
    var h = '<div class="stage ' + (fresh ? 'anim' : 'noanim') + '">' + TW.projection(S.room, env(box.id === 'pvBox')) + '</div>';
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
    var N = TW.notesFor(inf.frame);
    function line(n) {
      var t = TW.NOTE_TYPES[n.type] || TW.NOTE_TYPES.say;
      return '<p class="note n-' + esc(n.type || 'say') + '"><b>' + t.icon + ' ' + esc(t.label) + '</b>' + esc(n.text) + '</p>';
    }
    // ① 上課要說的話：開場 → 引起動機 → 說明 → 提問〔＋預期反應〕→ 收攏 → 過渡（接到下一頁）
    //    （想換順序，改這裡的數字即可：數字越小越上面）
    var RANK = { open: 1, hook: 2, explain: 4, say: 4, ask: 5, close: 6, next: 7 };
    var talk = [], tips = [], prev = 4;
    N.lines.forEach(function (n, i) {
      if (n.type === 'tip') { tips.push(n); return; }
      var r = n.type === 'expect' ? prev : (RANK[n.type] || 4);   // 預期反應緊跟在它前面的提問後
      if (n.type !== 'expect') prev = r;
      talk.push({ n: n, r: r, i: i });
    });
    talk.sort(function (a, b) { return a.r - b.r || a.i - b.i; });
    if (talk.length) h += '<div class="note-sec">🗣 上課要說的話</div>' + talk.map(function (x) { return line(x.n); }).join('');
    // ② 老師提醒
    if (tips.length) h += '<div class="note-sec">⚠️ 老師提醒</div>' + tips.map(line).join('');
    // ③ 整節課的教學目標（只在大廳，預設收合）
    var LG = C.lessonGoals;
    if (inf.id === 'lobby' && LG) {
      h += '<details class="lesson-goals"><summary>📚 ' + esc(LG.title) + '（點開看教學目標）</summary><ul>' +
        (LG.goals || []).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' +
        (LG.timeline ? '<div class="lg-time">⏱ ' + esc(LG.timeline) + '</div>' : '') + '</details>';
    }
    // ④ 這一步的目標（備查，放在所有敘述的最下面）
    if (N.goal) {
      h += '<div class="note-goal"><b>🎯 這一步的目標</b>' + esc(N.goal) +
        ((N.ref || N.time) ? '<div class="ng-meta">' + (N.ref ? '<span class="ng-ref">' + esc(N.ref) + '</span>' : '') + (N.time ? '<span class="ng-time">⏱ ' + esc(N.time) + '</span>' : '') + '</div>' : '') + '</div>';
    }
    if (!N.goal && !N.lines.length) h += '<p class="note n-tip">（這一步沒有設定口白，可在 config.js 的 notes 加上）</p>';
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
    $('#vidCtl').hidden = inf.id !== 'video';
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
    if (m !== 'proj') $('#fullBox').innerHTML = '';     // 離開投影模式：清掉畫面，影片也會停止
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
    if (S.readonly && act[a] && !/^(mode|openProj|copy|logout)$/.test(a)) { e.preventDefault(); toast(RO_MSG); return; }
    if (act[a]) { e.preventDefault(); act[a](arg); }
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (!S.room) return;
    if (S.readonly && /^set/.test(id)) {   // 只能檢視：把設定畫面還原
      toast(RO_MSG); gates.settings({ r: Math.random() }); renderAll(false); return;
    }
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
    if (S.readonly && e.key !== 'c' && e.key !== 'C' && e.key !== 'Escape') return;
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
