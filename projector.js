/* =====================================================================
 *  projector.js —— 獨立的「投影視窗」（只顯示，不控制）
 *  由老師控制台的「🖥 開啟投影視窗」打開：
 *    projector.html?room=1234   連線版
 *    projector.html?local=1     單機投影模式
 *  老師在筆電上操作控制台，這個視窗放在電子白板（延伸螢幕）上全螢幕顯示。
 * ===================================================================== */
(function () {
  'use strict';
  var TW = window.TW, $ = function (s) { return document.querySelector(s); };
  var local = TW.params.has('local'), code = local ? 'local' : TW.params.get('room');
  var room = null, lastF = null, mapZoom = false, dragged = false;
  var gate = TW.makeGate();

  function msg(t) { $('#msg').textContent = t || ''; $('#msg').hidden = !t; }

  function render(force) {
    if (!room) return;
    var inf = TW.info(room);
    var fresh = lastF !== null && lastF !== inf.f;
    if (fresh) mapZoom = false;
    if (!gate([JSON.stringify(room), mapZoom]) && !force && !fresh) return;
    var box = $('#box');
    box.innerHTML = '<div class="stage ' + (fresh ? 'anim' : 'noanim') + '">' + TW.projection(room, TW.projEnv(local ? 'local' : 'online', code, mapZoom)) + '</div>';
    fit();
    TW.runFlips(box, fresh);
    if (mapZoom) { var mw = box.querySelector('.map-wrap'); if (mw) { mw.scrollLeft = (mw.scrollWidth - mw.clientWidth) / 2; mw.scrollTop = (mw.scrollHeight - mw.clientHeight) / 2; } }
    lastF = inf.f;
  }
  function fit() {
    var box = $('#box'), st = box.querySelector('.stage'); if (!st) return;
    var w = box.clientWidth, h = box.clientHeight, s = Math.min(w / 1920, h / 1080);
    st.style.transform = 'scale(' + s + ')';
    st.style.left = ((w - 1920 * s) / 2) + 'px';
    st.style.top = ((h - 1080 * s) / 2) + 'px';
  }

  function updateFsBtn() { $('#fsBtn').hidden = TW.fs.isOn(); }
  function toggleFs() { if (TW.fs.isOn()) TW.fs.exit(); else TW.fs.enter(); }

  /* ---- 事件 ---- */
  $('#fsBtn').onclick = toggleFs;
  document.addEventListener('dblclick', function (e) { if (!e.target.closest('.map-wrap')) toggleFs(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'f' || e.key === 'F') toggleFs(); });
  TW.fs.onChange(function () { updateFsBtn(); setTimeout(fit, 50); });
  window.addEventListener('resize', fit);
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-act="mapzoom"]')) return;
    if (dragged) { dragged = false; return; }
    mapZoom = !mapZoom; render(true);
  });
  (function () {   // 地圖放大後可拖曳
    var d = null;
    document.addEventListener('mousedown', function (e) {
      var w = e.target.closest('.map-wrap.zoomed'); if (!w) return;
      d = { w: w, x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop }; dragged = false;
    });
    document.addEventListener('mousemove', function (e) {
      if (!d) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) dragged = true;
      d.w.scrollLeft = d.sl - dx; d.w.scrollTop = d.st - dy;
    });
    document.addEventListener('mouseup', function () { d = null; setTimeout(function () { dragged = false; }, 0); });
  })();

  /* ---- 啟動 ---- */
  if (!code) { msg('缺少房間代碼。請從老師控制台按「🖥 開啟投影視窗」。'); return; }
  msg('連線中…');
  updateFsBtn();
  TW.preload(TW.imageList());
  TW.initNet(local ? 'local' : 'online').then(function () {
    TW.roomRef(code).on('value', function (s) {
      room = s.val();
      if (!room) { msg('找不到房間 ' + code + '。請回老師控制台重新開啟投影視窗。'); return; }
      msg('');
      render();
    }, function (e) { msg('無法讀取房間：' + TW.friendlyError(e)); });
  }).catch(function (e) { msg('連線失敗：' + TW.friendlyError(e)); });

  window.TWP = { get room() { return room; } };   // 自動測試用
})();
