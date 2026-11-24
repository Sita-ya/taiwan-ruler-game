/* =====================================================================
 *  projection.js —— 「投影畫面」：給全班看的大畫面（1920×1080 的舞台，再縮放到螢幕大小）
 *  TW.projection(room, env) 會依照目前步驟回傳一段 HTML
 *    env = { kind:'online'|'local', code, qr, baseUrl, mapZoom }
 * ===================================================================== */
(function () {
  'use strict';
  var TW = window.TW, C = TW.C, esc = TW.esc, T = C.texts;
  var P = {};

  /* ---------- 共用元件 ---------- */
  function gname(g) { return '第 ' + g + ' 組'; }
  /** 文字裡的 \n（config.js 中寫成 \n）＝在這裡換行 */
  function br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function groups(room) { var a = [], n = TW.groupCount(room); for (var g = 1; g <= n; g++) a.push(g); return a; }
  function auto(env) { return env.kind === 'local'; }
  function ledgerOf(room, g, env) { return TW.ledger(room, g, { auto: auto(env) }); }
  function isMarginal(fam) { return TW.isMarginal(fam); }

  function title(txt, sub) {
    return '<h1 class="pj-title">' + esc(txt) + '</h1>' + (sub ? '<div class="pj-sub">' + sub + '</div>' : '');
  }
  /** 簡報文字（config.js 的 slides）。帳單沒有個別設定時用 slides.bills */
  function SL(id) {
    var s = C.slides || {};
    return s[id] || (/^bill\d$/.test(id) ? s.bills : null) || {};
  }
  /** 畫面下方的「❓ 想一想」提問條 */
  function askBar(t, cls) {
    return t ? '<div class="pj-ask ' + (cls || '') + '"><span class="ask-l">❓ 想一想</span>' + br(t) + '</div>' : '';
  }
  function points(list, cls) {
    if (!list || !list.length) return '';
    return '<ul class="pj-points ' + (cls || '') + '">' + list.map(function (p) { return '<li>' + br(p) + '</li>'; }).join('') + '</ul>';
  }

  function progressBar(room, env, label) {
    if (auto(env)) return '';
    var gs = groups(room), done = 0, dots = '';
    gs.forEach(function (g) {
      var L = ledgerOf(room, g, env), ok = L && L.pending.length === 0;
      if (ok) done++;
      dots += '<span class="pdot ' + (ok ? 'ok' : '') + '">' + (ok ? '✔' : g) + '</span>';
    });
    return '<div class="progress"><span class="pl">' + esc(label) + '</span>' + dots +
      '<span class="pc">' + done + ' / ' + gs.length + ' 組</span></div>';
  }

  function statusCards(room, env) {
    var gs = groups(room), cols = gs.length <= 4 ? 2 : 3;
    var h = '<div class="status-grid cols' + cols + '">';
    gs.forEach(function (g, i) {
      var L = ledgerOf(room, g, env);
      if (!L) return;
      var neg = L.balance < 0;
      h += '<div class="status-card" style="--fc:' + L.fam.color + ';animation-delay:' + (i * 0.08) + 's">' +
        '<div class="sc-head">' + TW.avatar(L.fam, 110) +
        '<div><div class="sc-g">' + gname(g) + '</div><div class="sc-name">' + esc(L.fam.name) + '</div></div></div>' +
        '<div class="sc-bal">' + TW.money(L.balance, { rich: true, sign: true }) + '</div>' +
        '<div class="sc-tag ' + (neg ? 'debt' : 'okk') + '">' + (neg ? '欠債中' : '還有錢') + '</div>' +
        '</div>';
    });
    return h + '</div>';
  }

  function familyCards(room, faceUp) {
    var gs = groups(room), n = gs.length;
    var w = Math.min(400, Math.floor((1760 - (n - 1) * 28) / n));
    var h = '<div class="fam-row' + (n >= 5 ? ' many' : '') + '" style="--cw:' + w + 'px">';
    gs.forEach(function (g) {
      var fam = TW.famOf(room, g);
      var front = '';
      if (faceUp && fam) {
        front = '<div class="fcard" style="--fc:' + fam.color + '">' +
          '<div class="fc-g">' + gname(g) + '</div>' + TW.famImg(fam, 'fc-img') +
          '<div class="fc-name">' + esc(fam.name) + '</div>' +
          '<div class="fc-intro">' + esc(fam.intro) + '</div>' +
          '<div class="fc-inc"><small>月收入</small>' + TW.fmt(fam.income) + '</div></div>';
      }
      h += '<div class="fc-slot"><div class="flipper" data-up="' + (faceUp ? 1 : 0) + '">' +
        '<div class="face cover"><div class="cover-in"><span class="cv-q">？</span><span class="cv-g">' + gname(g) + '</span></div></div>' +
        '<div class="face content">' + front + '</div></div></div>';
    });
    return h + '</div>';
  }

  /* ---------- 長條圖（紅線、第二條線、放大鏡都用它） ---------- */
  function chart(o) {
    var W = o.w, H = o.h, AV = o.avatars === false ? 70 : (o.avH || 200), plotH = H - AV, axisW = 110;
    var yMin = o.yMin || 0, yMax = o.yMax;
    function y(v) { return Math.max(0, (v - yMin) / (yMax - yMin) * plotH); }
    var h = '<div class="chart" style="width:' + W + 'px;height:' + H + 'px">';
    // 座標軸與格線
    (o.ticks || []).forEach(function (t) {
      h += '<div class="ch-tick" style="bottom:' + (AV + y(t)) + 'px"><span>' + TW.fmt(t) + '</span><i></i></div>';
    });
    h += '<div class="ch-plot" style="left:' + axisW + 'px;right:0;bottom:' + AV + 'px;height:' + plotH + 'px">';
    h += '<div class="ch-bars">';
    o.items.forEach(function (it, i) {
      var fam = it.fam, bh = y(fam.income);
      h += '<div class="ch-slot"><div class="ch-bar' + (it.hl ? ' hl' : '') + (o.dim && !it.hl ? ' dim' : '') + '" style="height:' + bh + 'px;--fc:' + fam.color + ';width:' + (o.barW || 110) + 'px;animation-delay:' + (i * 0.07) + 's">' +
        '<span class="ch-val">' + TW.fmt(fam.income) + '</span></div></div>';
    });
    h += '</div>';
    (o.lines || []).forEach(function (ln, i) {
      h += '<div class="ch-line" style="bottom:' + y(ln.v) + 'px;--lc:' + ln.color + ';animation-delay:' + (0.5 + i * 0.4) + 's"></div>' +
        '<div class="ch-tag" style="bottom:' + (y(ln.v) + 12) + 'px;--lc:' + ln.color + ';animation-delay:' + (0.9 + i * 0.4) + 's' + (ln.right ? ';left:auto;right:14px' : '') + '">' + ln.label + '</div>';
    });
    h += '</div>';
    if (o.avatars !== false) {
      h += '<div class="ch-foot" style="left:' + axisW + 'px;height:' + AV + 'px">';
      o.items.forEach(function (it) {
        h += '<div class="ch-who' + (o.dim && !it.hl ? ' dim' : '') + '">' + TW.avatar(it.fam, o.avSize || 110) +
          '<div class="who-n">' + esc(it.fam.name) + '</div><div class="who-g">' + gname(it.g) + '</div>' +
          (o.marks ? (TW.eligible(it.fam) ? '<div class="who-mark below">⬇ 線下</div>' : '<div class="who-mark above">⬆ 線上</div>') : '') + '</div>';
      });
      h += '</div>';
    }
    return h + '</div>';
  }
  function chartItems(room, hlFn) {
    var items = groups(room).map(function (g) { return { g: g, fam: TW.famOf(room, g) }; }).filter(function (x) { return x.fam; });
    items.sort(function (a, b) { return a.fam.income - b.fam.income || a.g - b.g; });
    items.forEach(function (it) { it.hl = hlFn ? hlFn(it.fam) : false; });
    return items;
  }
  var RED = '#D62839', ORANGE = '#F28C28';
  function redLine() { return { v: TW.lineTotal(), color: RED, label: '最低生活費　' + TW.fmt(TW.lineTotal()) + ' 元' }; }

  /* ---------- 各步驟 ---------- */
  P.lobby = function (room, inf, env) {
    var n = TW.groupCount(room), h = '<div class="lobby">' + '<h1 class="pj-title huge">' + esc(T.gameTitle) + '</h1>' +
      (SL('lobby').sub ? '<div class="pj-sub lobby-sub">' + br(SL('lobby').sub) + '</div>' : '');
    if (env.kind === 'online') {
      h += '<div class="lobby-body"><div class="code-box"><div class="cb-l">房間代碼</div><div class="code">' + esc(env.code || '----') +
        '</div><div class="cb-u">學生用平板掃描 QR code，或打開<br><b>' + esc((env.baseUrl || '').replace(/^https?:\/\//, '')) + '</b><br>輸入代碼</div></div>' +
        '<div class="qr-box">' + (env.qr || '') + '<div class="qr-l">掃我加入</div></div></div>';
    } else {
      h += '<div class="lobby-body local"><div class="local-box">📋 單機投影模式<br><small>不需要連線。各組使用實體籌碼，老師用電子白板操作。</small></div></div>';
    }
    h += '<div class="join-row">';
    for (var g = 1; g <= n; g++) {
      var joined = env.kind === 'online' ? !!(room.seats && room.seats[g]) : null;
      h += '<div class="join-chip ' + (joined ? 'in' : '') + '"><b>' + gname(g) + '</b><span>' +
        (joined === null ? '' : (joined ? '✔ 已加入' : '等待加入')) + '</span></div>';
    }
    return h + '</div></div>';
  };

  P.draw0 = function (room) {
    return title('抽身分卡', br(SL('draw0').sub || '每一組抽一個「三人家庭」，用抽籤決定！')) + familyCards(room, false) + askBar(SL('draw0').ask);
  };
  P.draw1 = function (room) {
    return title('我們這個月的身分') + familyCards(room, true) + askBar(SL('draw1').ask);
  };

  function billPanel(room, inf, env) {
    var k = inf.shown;       // 目前這一張 = 第 k 張
    var b = C.bills[k - 1];
    var left = '<div class="bill-big" style="animation-delay:0s"><div class="bb-icon">' + b.icon + '</div>' +
      '<div class="bb-cat">' + esc(b.cat) + '</div><div class="bb-name">' + esc(b.name) + '</div>' +
      (b.note ? '<div class="bb-note">' + esc(b.note) + '</div>' : '') +
      '<div class="bb-amt">' + MINUSTXT() + TW.fmt(b.amount) + '<small>元</small></div>' +
      (SL(inf.id).ask ? '<div class="bb-ask">❓ ' + br(SL(inf.id).ask) + '</div>' : '') + '</div>';
    var total = 0, rows = '';
    C.bills.forEach(function (x, i) {
      var open = i < k; if (open) total += x.amount;
      rows += '<div class="bl-row ' + (open ? 'open' : '') + (i === k - 1 ? ' cur' : '') + '"><span class="bl-i">' + (open ? x.icon : '▫️') + '</span>' +
        '<span class="bl-n">' + (open ? esc(x.name) : '第 ' + (i + 1) + ' 張帳單') + '</span>' +
        '<span class="bl-a">' + (open ? TW.fmt(x.amount) : '？') + '</span></div>';
    });
    var right = '<div class="bill-list"><div class="bl-title">這個月的必要帳單</div>' + rows +
      '<div class="bl-sum"><span>目前合計</span><b>' + TW.fmt(total) + '</b></div></div>';
    return '<div class="bills">' + left + right + '</div>' +
      progressBar(room, env, '已繳費') +
      '<div class="foot-small">' + esc(T.billFootnote) + '</div>';
  }
  function MINUSTXT() { return '−'; }
  C.bills.forEach(function (b, i) { P['bill' + (i + 1)] = function (room, inf, env) { return title('生活大扣血') + billPanel(room, inf, env); }; });

  P.billsum = function (room, inf, env) {
    var s = SL('billsum');
    return title('帳單都繳完了！各組現況', br(s.sub || '誰開始欠錢了呢？')) + statusCards(room, env) + askBar(s.ask);
  };

  function fateCard(room, up) {
    var f = C.fate;
    var content = '<div class="fate-card">' + TW.plainImg(f.img, 'fate-img', f.title) +
      '<div class="fate-text">' + esc(f.text) + '</div></div>';
    return '<div class="fate-slot"><div class="flipper big" data-up="' + (up ? 1 : 0) + '">' +
      '<div class="face cover fate"><div class="cover-in"><span class="cv-q">🃏</span><span class="cv-g">命運卡</span></div></div>' +
      '<div class="face content">' + (up ? content : '') + '</div></div></div>';
  }
  P.fate0 = function (room) {
    return title('命運事件', br(SL('fate0').sub || '生活中總有意外……')) + fateCard(room, false) + askBar(SL('fate0').ask);
  };
  P.fate1 = function (room, inf, env) {
    var a = SL('fate1').ask;
    return title('命運事件') + '<div class="fate-wrap">' + fateCard(room, true) +
      '<div class="fate-side"><div class="fs-l">每一組都要支付</div><div class="fs-amt">−' + TW.fmt(C.fate.amount) + '<small>元</small></div>' +
      (a ? '<div class="side-ask">❓ ' + br(a) + '</div>' : '') +
      progressBar(room, env, '已繳費') + '</div></div>';
  };
  P.fatesum = function (room, inf, env) {
    var s = SL('fatesum');
    return title('命運事件之後，各組現況', br(s.sub || 'C 組現在的狀況怎麼樣？')) + statusCards(room, env) + askBar(s.ask);
  };

  P.line1 = function (room) {
    var L = TW.lineTotal();
    var txt = TW.fillText(T.line1Text, { perPerson: TW.fmt(C.line.perPerson), line: TW.fmt(L) });
    return title('政府的紅線') + '<div class="line-layout">' +
      chart({ w: 1180, h: 800, avH: 240, marks: true, yMax: 100000, ticks: [0, 20000, 40000, 60000, 80000, 100000], items: chartItems(room), lines: [redLine()] }) +
      '<div class="line-text"><div class="lt-big">約 ' + TW.fmt(Math.round(L / 100) * 100) + ' 元</div>' + br(txt) +
      points(SL('line1').points, 'in-box') +
      (SL('line1').ask ? '<div class="box-ask">❓ ' + br(SL('line1').ask) + '</div>' : '') + '</div></div>';
  };

  P.sub2 = function (room, inf, env) {
    var gs = groups(room), got = [], none = [];
    gs.forEach(function (g) {
      var L = ledgerOf(room, g, env);
      if (!L) return;
      (L.eligible ? got : none).push(L);
    });
    var h = title('發放補助', '收入在紅線下的家庭，可以領到「' + T.subsidyTitle + '」');
    h += '<div class="sub-cards">';
    got.forEach(function (L, i) {
      h += '<div class="sub-card" style="--fc:' + L.fam.color + ';animation-delay:' + (i * 0.12) + 's"><div class="sc-head">' + TW.avatar(L.fam, 110) +
        '<div><div class="sc-g">' + esc(L.fam.name) + '</div><div class="sc-name small">補助 <b class="money pos">+' + TW.fmt(L.subsidy) + '</b></div></div></div>' +
        '<div class="sc-bal">' + TW.money(L.balance, { rich: true, sign: true }) + '</div><div class="sc-tag okk">債務還清</div></div>';
    });
    none.forEach(function (L, i) {
      h += '<div class="sub-card dimmed" style="--fc:' + L.fam.color + '"><div class="sc-head">' + TW.avatar(L.fam, 110) +
        '<div><div class="sc-g">' + esc(L.fam.name) + '</div><div class="sc-name small">收入在紅線上</div></div></div>' +
        '<div class="sc-bal">' + TW.money(L.balance, { rich: true, sign: true }) + '</div><div class="sc-tag ' + (L.balance < 0 ? 'debt' : 'okk') + '">' + (L.balance < 0 ? '欠債中' : '還有錢') + '</div></div>';
    });
    return h + '</div>' + askBar(SL('sub2').ask);
  };

  P.rev3 = function (room, inf, env) {
    var gs = groups(room), cs = [], ref = null;
    gs.forEach(function (g) {
      var L = ledgerOf(room, g, env);
      if (!L) return;
      if (isMarginal(L.fam)) cs.push(L);
      if (!ref && L.eligible) ref = L;
    });
    if (!cs.length) return title('大反轉') + '<div class="pj-sub">這一局沒有「剛好在線外」的家庭。</div>';
    var line = TW.lineTotal(), income = cs[0].fam.income, gap = income - line;
    var zoom = chart({
      w: 760, h: 640, yMin: 44000, yMax: 49000, avatars: false, barW: cs.length > 1 ? 150 : 170, ticks: [44000, 45000, 46000, 47000, 48000, 49000],
      items: cs.slice(0, 2).map(function (L) { return { g: 0, fam: L.fam, hl: true }; }),
      lines: [{ v: line, color: RED, label: '紅線 ' + TW.fmt(line), right: cs.length > 1 }]
    });
    var cards = '';
    cs.forEach(function (L) {
      cards += '<div class="rev-card" style="--fc:' + L.fam.color + '"><div class="sc-head">' + TW.avatar(L.fam, 130) +
        '<div><div class="sc-g">' + esc(L.fam.name) + '</div><div class="sc-name small">月收入 ' + TW.fmt(L.fam.income) + '</div></div></div>' +
        '<div class="rev-l">目前餘額</div><div class="rev-bal">' + TW.money(L.balance, { rich: true, sign: true }) + '</div>' +
        '<div class="sc-tag ' + (L.balance < 0 ? 'debt' : 'okk') + '">' + (L.balance < 0 ? '欠債中・沒有補助' : '沒有補助') + '</div></div>';
    });
    var cmp = '';
    if (ref) {
      var before = ref.balance - ref.subsidy;
      cmp = '<div class="rev-cmp"><b>' + esc(ref.fam.name) + '</b>：欠 ' + TW.fmt(before) + ' 元 → 領補助 ' + TW.fmt(ref.subsidy) + ' 元 → <b class="money pos">' + TW.money(ref.balance) + '</b></div>';
    }
    return '<div class="rev-q">' + esc(T.reverseQuestion) + '</div><div class="rev-layout">' +
      '<div class="rev-zoom"><div class="rz-title">🔍 放大看：收入和紅線</div>' + zoom +
      '<div class="rz-gap">只多 <b>' + TW.fmt(gap) + '</b> 元</div></div>' +
      '<div class="rev-right' + (cs.length > 1 ? ' two' : '') + '">' + cards + cmp + '</div></div>';
  };

  function moodStats(room, env) {
    var counts = {}, total = 0, n = groups(room).length;
    C.moods.forEach(function (m) { counts[m.key] = 0; });
    groups(room).forEach(function (g) {
      var m = room.groups && room.groups[g] && room.groups[g].mood;
      if (m && counts[m.k] != null) { counts[m.k]++; total++; }
    });
    var hasCustom = counts.custom > 0;
    var h = '<div class="mood-stats' + (hasCustom ? ' has-custom' : '') + '"><div class="ms-title">全班的心情（' + total + ' / ' + n + ' 組已回答）</div>';
    C.moods.forEach(function (m) {
      var c = counts[m.key];
      h += '<div class="ms-row"><span class="ms-e">' + m.emoji + '</span><span class="ms-l">' + esc(m.label) + '</span>' +
        '<span class="ms-bar"><i style="width:' + (n ? c / n * 100 : 0) + '%"></i></span><span class="ms-c">' + c + '</span></div>';
      if (m.key === 'custom') h += customList(room);   // 「自訂一句話」底下：小字列出各組寫的話
    });
    return h + '</div>';
  }
  /** 列出有寫「自訂一句話」的組別與內容（老師按「隱藏回應」的不顯示） */
  function customList(room) {
    var items = '';
    groups(room).forEach(function (g) {
      var gd = room.groups && room.groups[g], m = gd && gd.mood;
      if (!m || m.k !== 'custom' || !m.t) return;
      var fam = TW.famOf(room, g);
      var who = '第 ' + g + ' 組' + (fam ? '・' + esc(fam.name) : '');
      items += '<li style="--fc:' + (fam ? fam.color : '#999') + '"><b>' + who + '</b>' +
        (gd.hide ? '<span class="mc-hide">（老師已隱藏）</span>' : '「' + esc(m.t) + '」') + '</li>';
    });
    return items ? '<ul class="ms-custom">' + items + '</ul>' : '';
  }
  P.mood4 = function (room, inf, env) {
    var h = title('說說心情', '小美家和小明家一樣在欠債，卻拿不到補助……');
    if (env.kind === 'local') {
      return h + '<div class="mood-local">單機模式：請 C 組口頭說說現在的心情。<br>其他同學也想一想：如果你是小美家，你的心情是？</div>';
    }
    var cs = '';
    groups(room).forEach(function (g) {
      var fam = TW.famOf(room, g);
      if (!fam || !isMarginal(fam)) return;
      var gd = room.groups && room.groups[g], m = gd && gd.mood, hidden = gd && gd.hide;
      var body;
      if (!m || hidden) body = '<div class="mr-wait">' + (hidden ? '（回應已隱藏）' : '思考中…') + '</div>';
      else {
        var mo = C.moods.filter(function (x) { return x.key === m.k; })[0];
        body = '<div class="mr-e">' + (mo ? mo.emoji : '') + '</div><div class="mr-t">' + esc(m.k === 'custom' ? (m.t || '') : (mo ? mo.label : '')) + '</div>';
      }
      cs += '<div class="mood-resp" style="--fc:' + fam.color + '"><div class="mr-who">' + TW.avatar(fam, 100) +
        '<div><div class="sc-g">' + gname(g) + '</div><div class="sc-name small">' + esc(fam.name) + '</div></div></div>' + body + '</div>';
    });
    return h + '<div class="mood-layout"><div class="mood-resps">' + cs + '</div>' + moodStats(room, env) + '</div>';
  };

  P.marg5 = function (room, inf, env) {
    var cs = [];
    groups(room).forEach(function (g) { var f = TW.famOf(room, g); if (f && isMarginal(f)) cs.push(f); });
    var av = cs.map(function (f) { return TW.avatar(f, 150); }).join('');
    var p = SL('marg5').point;
    return '<div class="marg"><div class="marg-av">' + av + '</div>' +
      '<div class="marg-t1">' + br(T.marginalText) + '</div><div class="marg-t2">' + br(T.marginalText2) + '</div>' +
      (p ? '<div class="marg-t3">' + br(p) + '</div>' : '') + '</div>';
  };

  /* ---- 影片：老師用控制台的 ▶／⏸／⏮ 遙控；控制台的小預覽只放縮圖，避免兩邊同時出聲 ---- */
  P.video = function (room, inf, env) {
    var V = C.video || {}, src = TW.ytSrc();
    var head = '<div class="vid-head"><div class="vid-t">🎬 ' + esc(V.heading || '影片') + '</div>' +
      (SL('video').sub ? '<div class="vid-s">' + br(SL('video').sub) + '</div>' : '') + '</div>';
    var foot = '<div class="vid-credit">' + esc(V.credit || '') + '</div>';
    if (!src) return head + '<div class="vid-box ph"><div class="vid-ph-t">（config.js 的 video 尚未設定影片）</div></div>';
    if (env.preview) {
      return head + '<div class="vid-box ph"><img src="https://i.ytimg.com/vi/' + esc(V.youtubeId) + '/hqdefault.jpg" alt="">' +
        '<div class="vid-ph-t">🎬 影片在「投影畫面」播放<br><small>請用控制台下方的 ▶ 播放／⏸ 暫停／⏮ 從頭</small></div></div>' + foot;
    }
    return head + '<div class="vid-box"><iframe class="yt" src="' + esc(src) + '" title="' + esc(V.title || '影片') + '" ' +
      'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>' + foot;
  };
  P.videoSum = function () {
    var s = SL('videoSum');
    var stats = (s.stats || []).map(function (x, i) {
      return '<div class="vs-card" style="animation-delay:' + (i * 0.15) + 's"><div class="vs-big">' + esc(x.big) + '</div><div class="vs-l">' + br(x.label) + '</div></div>';
    }).join('');
    return title(s.title || '影片之後', s.sub ? br(s.sub) : '') +
      (stats ? '<div class="vs-row">' + stats + '</div>' : '') +
      (s.source ? '<div class="vs-src">' + esc(s.source) + '</div>' : '') +
      (s.statement ? '<div class="vs-stmt">' + br(s.statement) + '</div>' : '') +
      askBar(s.ask);
  };

  P.w1 = function () {
    return '<div class="w1"><div class="w1-t">' + esc(T.world1) + '</div>' +
      '<div class="w1-big"><span class="w1-n">$3</span><span class="w1-u">美元<br>每人每天</span></div>' +
      '<div class="w1-g">🌍 全世界通用的「極端貧窮線」</div></div>' + askBar(SL('w1').ask);
  };
  P.w2 = function () {
    return '<div class="w2"><div class="w2-a">' + esc(T.world2a) + '</div>' +
      '<div class="w2-img">' + TW.plainImg('assets/lunch_90.jpg', 'lunch', '便當和礦泉水') + '<div class="price-tag">' + esc(T.world2tag) + '</div></div>' +
      '<div class="w2-b">' + esc(T.world2b) + '</div></div>' + askBar(SL('w2').ask, 'right');
  };
  P.w3 = function (room, inf, env) {
    var btn = C.worldMapUrl ? '<a class="map-btn" href="' + esc(C.worldMapUrl) + '" target="_blank" rel="noopener">🌏 開啟互動地圖</a>' : '';
    var hint = SL('w3').hint;
    return '<div class="w3"><div class="w3-t">' + esc(T.world3) + '</div>' +
      '<div class="map-wrap ' + (env.mapZoom ? 'zoomed' : '') + '" data-act="mapzoom"><img class="map-img" src="assets/world_map.jpg" alt="極端貧窮人口比例世界地圖" draggable="false"></div>' +
      '<div class="map-hint">' + (hint ? esc(hint) + '<br>' : '') + (env.mapZoom ? '點一下縮回' : '點一下地圖可以放大') + '</div>' + btn + '</div>';
  };
  P.w4 = function () {
    var p = SL('w4').point;
    return '<div class="w4"><div class="w4-img">' + TW.plainImg('assets/sdg1.png', 'sdg', 'SDG 1 消除貧窮') + '</div>' +
      '<div><div class="w4-t">' + esc(T.world4) + '</div>' + (p ? '<div class="w4-p">' + br(p) + '</div>' : '') + '</div></div>';
  };

  function ruler(cls, o) {
    return '<div class="ruler-card ' + cls + '"><div class="rc-title">' + esc(o.title) + '</div>' +
      '<div class="ruler-gfx"><i class="ticks"></i><i class="mark"></i></div>' +
      '<div class="rc-big">' + esc(o.big) + '</div><div class="rc-sub">' + esc(o.sub) + '</div><div class="rc-desc">' + esc(o.desc) + '</div></div>';
  }
  P.sum6 = function () {
    var a = SL('sum6').ask;
    return title('今天的兩把尺') + '<div class="rulers">' + ruler('tw', T.summaryTW) + ruler('wd', T.summaryWorld) + '</div>' +
      (a ? '<div class="sum-ask">❓ ' + br(a) + '</div>' : '') +
      '<div class="sum-next">' + esc(T.summaryNext) + '</div>';
  };

  P.line2 = function (room) {
    var L = TW.lineTotal();
    var items = chartItems(room, function (f) { return isMarginal(f); });
    return title('第二條線') + '<div class="line-layout">' +
      chart({
        w: 1180, h: 760, yMax: 100000, ticks: [0, 20000, 40000, 60000, 80000, 100000], items: items, dim: true,
        lines: [redLine(), { v: C.line.midTotal, color: ORANGE, label: '中低收入戶　' + TW.fmt(C.line.midTotal) + ' 元' }]
      }) +
      '<div class="line-text two"><div class="lt-o">' + esc(T.line2Text) + '</div>' +
      '<div class="callout">⭐ ' + esc(T.line2Callout) + '</div>' +
      points(SL('line2').points, 'in-box') +
      (SL('line2').ask ? '<div class="box-ask">❓ ' + br(SL('line2').ask) + '</div>' : '') + '</div></div>';
  };

  /* ---------- 對外入口 ---------- */
  TW.projection = function (room, env) {
    env = env || { kind: 'online' };
    var inf = TW.info(room);
    var fn = P[inf.id] || function () { return title(inf.frame.title); };
    var h = '<div class="pj pj-' + inf.id + '">' + fn(room, inf, env) + '</div>';
    if (inf.paused) h += '<div class="pj-paused">⏸ 全班暫停中</div>';
    return h;
  };
})();
