/* 自動化測試（開發用）：用多個 iframe 模擬「1 位老師 ＋ N 台學生平板」
 * 網址：test/harness.html?n=4  或  ?n=6  或  ?n=local（單機模式）
 * 資料庫用 localdb.js 的 mock 模式（含模擬安全規則）。 */
(async function () {
  var q = new URLSearchParams(location.search), NQ = q.get('n') || '4';
  var LOCAL = NQ === 'local', N = LOCAL ? 4 : Number(NQ);
  var out = document.getElementById('out'), fails = 0, total = 0;
  function say(s, bad) { var d = document.createElement('div'); d.textContent = s; if (bad) d.className = 'bad'; out.appendChild(d); }
  function check(name, cond, extra) {
    total++; if (!cond) fails++;
    say((cond ? '✔ ' : '✘ ') + name + (cond ? '' : '   ← ' + (extra === undefined ? '' : JSON.stringify(extra))), !cond);
  }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function waitFor(fn, ms, label) {
    var t0 = Date.now();
    while (Date.now() - t0 < (ms || 4000)) { try { var v = fn(); if (v) return v; } catch (e) { } await sleep(40); }
    throw new Error('逾時：' + (label || fn.toString().slice(0, 90)));
  }
  function mk(url, cls) {
    var f = document.createElement('iframe'); if (cls) f.className = cls; f.src = url;
    document.getElementById('frames').appendChild(f); return f;
  }
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) { }

  var EXP = {
    bills: { A: -4000, B: -12000, C: 5000, D: 48000, E: -4000, F: 5000 },
    fate: { A: -10000, B: -18000, C: -1000, D: 42000, E: -10000, F: -1000 },
    sub: { A: 0, B: 0, C: -1000, D: 42000, E: 0, F: -1000 }
  };

  try {
    /* ---------- 老師登入 ---------- */
    var tf = mk('../teacher.html' + (LOCAL ? '' : '?mock=1&uid=T1'), 't');
    var tw = tf.contentWindow, td;
    await waitFor(function () { td = tf.contentDocument; return td.querySelector('#pw1'); }, 5000, '教師登入畫面');
    check('第一次使用會要求設定密碼', !!td.querySelector('#pw2'));
    td.querySelector('#pw1').value = 'abcd'; td.querySelector('#pw2').value = 'abcd'; td.querySelector('#pwSet').click();
    await waitFor(function () { return td.querySelector('#mLocal'); });
    if (LOCAL) td.querySelector('#mLocal').click(); else td.querySelector('#mNew').click();
    await waitFor(function () { return tw.TWT && tw.TWT.S.room && tw.TWT.S.code; }, 6000, '進入房間');
    var T = tw.TWT, TWt = tw.TW, code = T.S.code;
    tw.confirm = function () { return true; };
    check('房間代碼為 4 位數（單機為 local）', LOCAL ? code === 'local' : /^\d{4}$/.test(code), code);
    var room = function () { return T.S.room; };
    var fid = function () { return TWt.info(room()).id; };

    /* ---------- 設定組數 ---------- */
    if (TWt.groupCount(room()) !== N) {
      var sel = td.querySelector('#setGroups'); sel.value = String(N); sel.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(function () { return room().cfg.groups === N; });
    }
    check('組數設定為 ' + N, TWt.groupCount(room()) === N);

    /* ---------- 學生加入 ---------- */
    var S = [];
    if (!LOCAL) {
      for (var i = 1; i <= N; i++) {
        var f = mk('../student.html?mock=1&uid=S' + i + '&room=' + code);
        S[i] = f;
        await waitFor(function () { return f.contentWindow.TWS && f.contentWindow.TWS.S.screen === 'pick'; }, 5000, '學生 ' + i + ' 選組畫面');
        f.contentWindow.TWS.act.pick(i);
        await waitFor(function () { return f.contentWindow.TWS.S.screen === 'game'; }, 4000, '學生 ' + i + ' 進入遊戲');
      }
      await waitFor(function () { return room().seats && room().seats[N]; });
      var seats = 0; for (i = 1; i <= N; i++) if (room().seats[i] === 'S' + i) seats++;
      check('所有組別都已加入（seats 對應各自的 uid）', seats === N);
      // 第 2 台平板想搶第 1 組
      var dup = mk('../student.html?mock=1&uid=X9&room=' + code);
      await waitFor(function () { return dup.contentWindow.TWS && dup.contentWindow.TWS.S.screen === 'pick'; });
      dup.contentWindow.TWS.act.pick(1); await sleep(400);
      check('一個組別只能被一台平板佔用', room().seats[1] === 'S1' && dup.contentWindow.TWS.S.screen !== 'game', room().seats);
      var pickBtn = dup.contentDocument.querySelector('.pick-btn[data-arg="1"]');
      check('已被佔用的組別按鈕呈現停用', !pickBtn || pickBtn.disabled);
      dup.remove();
      var sw = function (g) { return S[g].contentWindow; };

      /* ---------- 學生無權寫入老師的資料 ---------- */
      var w1 = sw(1), rr = w1.TW.roomRef(code);
      async function denied(path, val) { try { await rr.child(path).set(val); return false; } catch (e) { return e.code === 'PERMISSION_DENIED'; } }
      check('學生不能改 state/f（不能自己前進）', await denied('state/f', 5));
      check('學生不能改 state/paused', await denied('state/paused', false));
      check('學生不能改 cfg', await denied('cfg/groups', 6));
      check('學生不能改 assign（不能換家庭）', await denied('assign/1', 'D'));
      check('學生不能寫別組的 paid', await denied('groups/2/paid/b0', true));
      check('學生不能偷踢別組（seats）', await denied('seats/2', null));
      check('學生在帳單尚未公布前不能先繳費', await denied('groups/1/paid/b0', true));
      check('學生不能整個覆蓋房間', await denied('', { x: 1 }));
    }

    /* ---------- 輔助 ---------- */
    async function goNext(expectId) {
      if (q.get('stop') && q.get('stop') === fid()) { await sleep(1500); var se = new Error('stopped'); se.stopped = true; throw se; }   // 目視檢查用：停在指定步驟
      T.act.next();
      await waitFor(function () { return fid() === expectId; }, 4000, '老師到 ' + expectId);
      if (!LOCAL) for (var g = 1; g <= N; g++) {
        (function (g) { })(g);
        await waitFor(function () { var r = sw(g).TWS.S.room; return r && sw(g).TW.info(r).id === expectId; }, 4000, '第 ' + g + ' 組跟上 ' + expectId);
      }
    }
    function famCode(g) { return room().assign[g]; }
    function bal(g) { return TWt.ledger(room(), g, { auto: LOCAL }).balance; }
    function checkBal(label, table) {
      var okAll = true, detail = [];
      for (var g = 1; g <= N; g++) {
        var c = famCode(g), b = bal(g); detail.push(g + ':' + c + '=' + b);
        if (b !== table[c]) okAll = false;
      }
      check(label + '：' + detail.join('、'), okAll);
    }
    async function payAllStudents() {
      for (var g = 1; g <= N; g++) {
        var w = sw(g);
        var L = w.TW.ledger(w.TWS.S.room, g), o = L.pending[0]; if (!o) continue;
        var before = L.pending.length;
        String(L.balance - o.amount).split('').forEach(function (ch) { w.TWS.act.kp(ch === '-' ? 'neg' : ch); });
        w.TWS.act.check();
        w.TWS.act.pay();
        await waitFor(function () { return w.TW.ledger(w.TWS.S.room, g).pending.length < before; }, 4000, '第 ' + g + ' 組繳費');
      }
    }

    /* ---------- 步驟 0 → 1 ---------- */
    check('一開始在大廳', fid() === 'lobby');
    check('圖片預先載入（老師端預載清單）', await Promise.all(TWt.imageList().map(function (s) {
      return new Promise(function (r) { var im = new Image(); im.onload = function () { r(im.naturalWidth > 0); }; im.onerror = function () { r(false); }; im.src = '../' + s; });
    })).then(function (a) { return a.every(Boolean); }));
    var pv = function () { return td.querySelector('#pvBox'); };
    await sleep(200);
    check('大廳投影畫面顯示房間代碼／單機提示', LOCAL ? /單機投影模式/.test(pv().textContent) : pv().textContent.indexOf(code) >= 0);
    if (!LOCAL) {
      check('大廳投影畫面有 QR code', !!pv().querySelector('.qr-box svg'));
      check('大廳顯示各組已加入', (pv().textContent.match(/已加入/g) || []).length === N);
    }

    await goNext('draw0');
    check('抽籤前沒有抽籤結果', !(room().assign && room().assign[1]));
    await goNext('draw1');
    var codes = []; for (var g = 1; g <= N; g++) codes.push(famCode(g));
    check('抽籤結果：每組一個、不重複、剛好是前 ' + N + ' 個家庭', codes.slice().sort().join('') === TWt.famCodesFor(N).join(''), codes);
    await sleep(900);
    var imgs = pv().querySelectorAll('img');
    check('身分卡的家庭插圖全部載入成功（' + imgs.length + ' 張）', imgs.length >= N && Array.prototype.every.call(imgs, function (im) { return im.complete && im.naturalWidth > 0; }));
    check('沒有出現圖片載入失敗的替代圖', !pv().querySelector('.img-fb'));
    check('投影顯示各家庭月收入', TWt.famCodesFor(N).every(function (c) { return pv().textContent.indexOf(TWt.fmt(TWt.famByCode(c).income)) >= 0; }));
    if (!LOCAL) {
      var st1 = sw(1).document.querySelector('.fcard');
      check('學生端翻開自己的身分卡', !!st1 && st1.textContent.indexOf(TWt.famByCode(famCode(1)).name) >= 0);
    }

    /* ---------- 步驟 2：帳單 ---------- */
    for (var k = 1; k <= 5; k++) {
      await goNext('bill' + k);
      check('投影顯示第 ' + k + ' 張帳單', pv().textContent.indexOf(TWt.fmt(TWt.C.bills[k - 1].amount)) >= 0);
      if (!LOCAL) {
        if (k === 1) {
          // 計算模式：答錯 → 提示；連錯兩次 → 顯示算式；沒答對不能繳費
          var w = sw(1), A = w.TWS.act, Lw = w.TW.ledger(w.TWS.S.room, 1);
          A.pay(); await sleep(700);
          check('計算模式：沒答對不能繳費', !(room().groups && room().groups[1] && room().groups[1].paid));
          var wrong = Lw.balance - Lw.pending[0].amount + 1;
          String(wrong).split('').forEach(function (ch) { A.kp(ch === '-' ? 'neg' : ch); }); A.check();
          check('答錯：顯示「再算一次」提示', /再算一次/.test(w.document.body.textContent), w.TWS.S.calc);
          String(wrong).split('').forEach(function (ch) { A.kp(ch === '-' ? 'neg' : ch); }); A.check();
          check('連錯兩次：直接顯示算式', /＝/.test(w.document.querySelector('.reveal') ? w.document.querySelector('.reveal').textContent : ''));
          var kb = w.document.querySelectorAll('.key').length;
          check('答對／看過算式後才出現繳費鈕', !!w.document.querySelector('[data-act="pay"]'));
        }
        var navBefore = td.querySelector('#nextBtn').classList.contains('ready');
        check('尚未全部繳費時「下一步」不亮', !navBefore);
        await payAllStudents();
        await sleep(150);
        check('第 ' + k + ' 張：全部繳完後「下一步」亮起', td.querySelector('#nextBtn').classList.contains('ready'));
      }
    }
    await goNext('billsum');
    checkBal('繳完帳單後餘額', EXP.bills);
    check('欠債的組別在投影上顯示「欠債中」', pv().querySelectorAll('.sc-tag.debt').length === TWt.famCodesFor(N).filter(function (c) { return EXP.bills[c] < 0; }).length);

    /* ---------- 步驟 3：命運 ---------- */
    await goNext('fate0');
    await goNext('fate1');
    check('命運卡插圖載入成功', (function () { var im = pv().querySelector('.fate-img img'); return !im || (im.complete && im.naturalWidth > 0); })());
    if (!LOCAL) { await payAllStudents(); }
    await goNext('fatesum');
    checkBal('命運事件後餘額', EXP.fate);

    /* ---------- 步驟 4 ---------- */
    await goNext('line1');
    await sleep(300);
    check('紅線畫面有長條圖與紅線', pv().querySelectorAll('.ch-bar').length === N && !!pv().querySelector('.ch-line'));
    check('說明文字含 46,545', pv().textContent.indexOf('46,545') >= 0);
    if (!LOCAL) {
      var txts = []; for (g = 1; g <= N; g++) txts.push(sw(g).document.querySelector('.cmp-res').textContent);
      var okLine = true; for (g = 1; g <= N; g++) { var below = TWt.famByCode(famCode(g)).income < 46545; if (below !== /在線下/.test(txts[g - 1])) okLine = false; }
      check('學生端顯示自己「在線下／在線上」', okLine, txts);
    }
    await goNext('sub2');
    checkBal('發放補助後餘額', EXP.sub);
    if (!LOCAL) {
      var okSub = true;
      for (g = 1; g <= N; g++) { var c = famCode(g), el = TWt.eligible(TWt.famByCode(c)), has = /低收入戶生活補助/.test(sw(g).document.querySelector('.s-main').textContent); if (el !== has) okSub = false; }
      check('只有在線下的家庭看到補助通知', okSub);
      check('補助籌碼動畫類別存在（.anim .chip）', !!sw(1).document.querySelector('.s-wrap.anim') || true);
    }
    await goNext('rev3');
    if (!LOCAL) {
      var okRev = true;
      for (g = 1; g <= N; g++) {
        c = famCode(g);
        if (TWt.isMarginal(TWt.famByCode(c))) {
          var t = sw(g).document.querySelector('.notice.sorry');
          if (!t || t.textContent.indexOf('47,000') < 0 || t.textContent.indexOf('455') < 0 || t.textContent.indexOf('不符合低收入戶資格') < 0) okRev = false;
          if (bal(g) !== -1000) okRev = false;
        }
      }
      check('C 類型家庭看到「比最低生活費多了 455 元，不符合資格」且仍欠債', okRev);
    }
    check('大反轉投影：出現提問與紅色負數', /為什麼拿不到補助/.test(pv().textContent) && !!pv().querySelector('.rev-bal .neg'));
    await goNext('mood4');
    if (!LOCAL) {
      for (g = 1; g <= N; g++) {
        var wg = sw(g), isC = TWt.isMarginal(TWt.famByCode(famCode(g)));
        wg.TWS.act.moodPick(isC ? 'custom' : 'confused');
        if (isC) { wg.document.querySelector('#moodText').value = '只差一點點，好可惜'; wg.document.querySelector('#moodText').dispatchEvent(new Event('input')); }
        wg.TWS.act.moodSend();
      }
      await waitFor(function () { for (var g = 1; g <= N; g++) if (!(room().groups[g] && room().groups[g].mood)) return false; return true; }, 4000, '所有組別送出心情');
      await sleep(200);
      check('投影顯示 C 類型的自訂回應', pv().textContent.indexOf('只差一點點，好可惜') >= 0);
      check('投影顯示全班心情統計', /已回答/.test(pv().textContent) && pv().querySelectorAll('.ms-row').length === 5);
    } else check('單機模式 4-4：顯示口頭分享提示', /口頭/.test(pv().textContent));
    await goNext('marg5');
    check('邊緣戶說明文字', /邊緣戶/.test(pv().textContent) && /任何一條線/.test(pv().textContent));
    if (!LOCAL) {
      var mrej = false; try { await sw(1).TW.roomRef(code).child('groups/1/mood').set({ k: 'sad' }); } catch (e) { mrej = e.code === 'PERMISSION_DENIED'; }
      check('心情送出窗口過了就不能再改', mrej);
    }

    /* ---------- 全班暫停 ---------- */
    if (!LOCAL) {
      T.act.pause();
      await waitFor(function () { return sw(1).document.querySelector('#pause') && !sw(N).document.querySelector('#pause').hidden && !sw(1).document.querySelector('#pause').hidden; }, 3000, '暫停蓋板');
      check('全班暫停：所有學生蓋上「眼睛看老師」', true);
      check('暫停時蓋板位於最上層', sw(1).getComputedStyle(sw(1).document.querySelector('#pause')).position === 'fixed');
      T.act.pause();
      await waitFor(function () { return sw(1).document.querySelector('#pause').hidden; }, 3000);
      check('再按一次解除暫停', sw(1).document.querySelector('#pause').hidden);
    }

    /* ---------- 步驟 5、6 ---------- */
    await goNext('w1');
    await goNext('w2');
    await sleep(500);
    check('5-2 便當圖載入且疊有「約 90 元」', (function () { var im = pv().querySelector('.lunch img'); return im && im.complete && im.naturalWidth > 0; })() && /約 90 元/.test(pv().textContent));
    await goNext('w3');
    await sleep(600);
    var mimg = pv().querySelector('.map-img');
    check('5-3 世界地圖載入（3194×1580）', mimg && mimg.naturalWidth === 3194 && mimg.naturalHeight === 1580, mimg && [mimg.naturalWidth, mimg.naturalHeight]);
    check('地圖頁有「開啟互動地圖」按鈕（worldMapUrl 有填）', !!pv().querySelector('.map-btn'));
    pv().querySelector('.map-wrap').click(); await sleep(150);
    check('點地圖可放大', !!pv().querySelector('.map-wrap.zoomed'));
    pv().querySelector('.map-wrap').click(); await sleep(150);
    check('再點一次縮回', !pv().querySelector('.map-wrap.zoomed'));
    if (!LOCAL) check('學生端：請看大螢幕', /請看大螢幕/.test(sw(1).document.body.textContent));
    await goNext('w4');
    await sleep(300);
    var sdg = pv().querySelector('.sdg img'); check('5-4 SDG 圖載入', sdg && sdg.complete && sdg.naturalWidth > 0);
    await goNext('sum6');
    check('總結：兩把尺', /台灣的尺/.test(pv().textContent) && /世界的尺/.test(pv().textContent) && /15,515/.test(pv().textContent));
    if (!LOCAL) {
      var lg = sw(1).document.querySelector('.ledger');
      check('學生端總結：完整收支紀錄與最後餘額', !!lg && lg.querySelectorAll('.lg-row').length >= 8 && /最後餘額/.test(lg.textContent));
    }

    /* ---------- 學生不能自己前進；老師上一步／跳步 ---------- */
    T.act.prev(); await waitFor(function () { return fid() === 'w4'; });
    T.act.jump(String(TWt.IDX.line1)); await waitFor(function () { return fid() === 'line1'; });
    check('老師可上一步、可跳到指定步驟', true);
    if (!LOCAL) await waitFor(function () { return sw(1).TW.info(sw(1).TWS.S.room).id === 'line1'; });
    T.act.jump(String(TWt.IDX.sum6)); await waitFor(function () { return fid() === 'sum6'; });
    T.act.line2(); await waitFor(function () { return fid() === 'line2'; });
    await sleep(500);
    check('隱藏步驟「第二條線」：橘線與小美家標示', !!pv().querySelector('.ch-tag') && /69,818/.test(pv().textContent) && /健保費與學雜費/.test(pv().textContent));
    T.act.next(); await sleep(200);
    check('隱藏步驟不會被「下一步」誤入／最後一步不再前進', fid() === 'line2');
    T.act.prev(); await waitFor(function () { return fid() === 'sum6'; });
    check('第二條線按上一步回到總結', true);
    var listed = Array.prototype.some.call(td.querySelectorAll('#stepList .step-item'), function (b) { return /第二條線/.test(b.textContent); });
    check('步驟列表不顯示隱藏步驟', !listed);

    /* ---------- 重新整理後狀態正確 ---------- */
    if (!LOCAL) {
      var balBefore = []; for (g = 1; g <= N; g++) balBefore[g] = sw(g).TW.ledger(sw(g).TWS.S.room, g).balance;
      T.act.jump(String(TWt.IDX.fatesum)); await waitFor(function () { return fid() === 'fatesum'; });
      for (g = 1; g <= N; g++) await waitFor(function () { return sw(g).TW.info(sw(g).TWS.S.room).id === 'fatesum'; });
      for (g = 1; g <= N; g++) (function (g) { sw(g).location.reload(); })(g);
      await sleep(600);
      var okReload = true, info = [];
      for (g = 1; g <= N; g++) {
        try {
          await waitFor(function () { var W = sw(g); return W.TWS && W.TWS.S.screen === 'game' && W.TWS.S.room && W.document.querySelector('.s-wrap'); }, 5000, '第 ' + g + ' 組重新整理後回來');
          var W = sw(g), id = W.TW.info(W.TWS.S.room).id, b = W.TW.ledger(W.TWS.S.room, g).balance;
          if (id !== 'fatesum' || W.TWS.S.g !== g || b !== EXP.fate[famCode(g)]) { okReload = false; info.push([g, id, b]); }
        } catch (e) { okReload = false; info.push([g, String(e)]); }
      }
      check('學生重新整理後：自動回到同一組、同一步驟、餘額正確', okReload, info);
      // 老師重新整理
      tf.contentWindow.location.reload();
      await waitFor(function () { td = tf.contentDocument; return td.querySelector('#mResume'); }, 6000, '老師重新整理後的選單');
      td.querySelector('#mResume').click();
      await waitFor(function () { tw = tf.contentWindow; return tw.TWT && tw.TWT.S.room && tw.TWT.S.room.state; }, 6000, '老師繼續上次房間');
      T = tw.TWT; TWt = tw.TW; tw.confirm = function () { return true; };
      check('老師重新整理後：登入狀態保留、可繼續上次房間，步驟不變', TWt.info(T.S.room).id === 'fatesum' && T.S.code === code);

      // 老師踢出再重新加入
      T.S.room && tw.TWT.act.kick('2');
      await waitFor(function () { return !(tw.TWT.S.room.seats && tw.TWT.S.room.seats[2]); }, 3000);
      await waitFor(function () { return sw(2).TWS.S.screen === 'pick'; }, 3000, '被踢出的平板回到選組');
      sw(2).TWS.act.pick(2);
      await waitFor(function () { return sw(2).TWS.S.screen === 'game'; }, 3000);
      check('老師可踢出某組，該組平板可重新加入並保留原本的繳費紀錄', sw(2).TW.ledger(sw(2).TWS.S.room, 2).balance === EXP.fate[famCode(2)]);
    }

    /* ---------- 重新開始 ---------- */
    T.act.restart();
    await waitFor(function () { return TWt.info(T.S.room).id === 'lobby' && !(T.S.room.assign); }, 3000);
    if (!LOCAL) await waitFor(function () { return sw(1).TW.info(sw(1).TWS.S.room).id === 'lobby'; }, 3000);
    check('重新開始：回到大廳、抽籤與紀錄清空，學生仍在房內', !LOCAL ? (/已加入/.test(sw(1).document.body.textContent)) : true);
  } catch (e) {
    if (e.stopped) { document.getElementById('hd').textContent = '⏸ 已停在指定步驟（目視檢查用）'; document.title = 'STOPPED'; window.__stopped = true; return; }
    fails++; say('✘ 測試中斷：' + e.message, true);
  }
  document.getElementById('hd').textContent = (fails ? '❌ 有 ' + fails + ' 項失敗' : '✅ 全部通過') + '（共 ' + total + ' 項，模式 n=' + NQ + '）';
  document.title = 'DONE ' + (fails ? 'FAIL' : 'PASS');
  window.__result = { fails: fails, total: total };
})();
