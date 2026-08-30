/* FLINT — анимация сборки логотипа «точки-люди → камень → молния-взрыв 360°».
   Логотип собирается НА ВСЮ ШИРИНУ canvas-бокса (а не в точку в центре).
   Если canvas имеет атрибут data-content="#id", то на время сбора
   фон секции становится чёрным, а указанный контент скрыт;
   по завершении контент плавно открывается. */
(function () {
  if (!document.querySelector) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TAU = Math.PI * 2;

  var stoneD = "M19.83 80.02C21.14 77.9 22.68 75.94 24.08 73.89L44.97 43.8C46.25 41.94 49.96 36.28 51.47 34.92L51.57 34.83C50.29 37.99 49.9 41.19 49.36 44.56L46.92 59.06C46.67 60.51 46.37 61.96 46.16 63.42C47.26 63.22 48.36 62.86 49.44 62.55L60.05 59.52C61.1 59.22 62.16 58.95 63.2 58.63C63.74 58.49 64.28 58.37 64.81 58.2C60.87 64.12 57.2 70.33 53.22 76.17L39.31 96.7C38.24 98.32 36.57 100.82 35.81 102.54C35.84 92.31 38.6 84 39.62 74.41L22.66 79.22C21.74 79.47 20.72 79.64 19.83 80.02Z";
  var boltD = "M6.16 90.5L0 74.3L14.6 45.7L16.9 28.6L30.8 18.6L44.7 0L50.8 9.3L68.6 20.1L76.3 59.6L80.9 66.6L83.2 92.9L74.7 109.1L37.7 116.1L4.6 105.3Z";
  var LOGO_W = 328, LOGO_H = 117; // viewBox логотипа

  function pathToPoints(d, offX, offY, count) {
    var pts = [], re = /([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?),([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g, arr = [], m;
    while ((m = re.exec(d))) arr.push([parseFloat(m[1]) + (offX || 0), parseFloat(m[2]) + (offY || 0)]);
    var full = [];
    for (var i = 0; i + 1 < arr.length; i++) {
      var a = arr[i], b = arr[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(len / 4));
      for (var s = 0; s <= steps; s++) { var t = s / steps; full.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!full.length) return pts;
    var total = 0, lens = [];
    for (var k = 0; k + 1 < full.length; k++) { var L = Math.hypot(full[k+1][0]-full[k][0], full[k+1][1]-full[k][1]); lens.push(L); total += L; }
    for (var n = 0; n < count; n++) {
      var target = (n + 0.5) / count * total, acc = 0;
      for (var j = 0; j < lens.length; j++) {
        acc += lens[j];
        if (acc >= target) {
          var t2 = (target - (acc - lens[j])) / Math.max(0.0001, lens[j]), base = full[j];
          pts.push([base[0] + (full[j+1][0]-base[0])*t2, base[1] + (full[j+1][1]-base[1])*t2]);
          break;
        }
      }
    }
    return pts;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function initBolt(cv) {
    if (reduce) {
      cv.style.display = 'none';
      var cSel0 = cv.getAttribute && cv.getAttribute('data-content');
      if (cSel0) { var c0 = document.querySelector(cSel0); if (c0) c0.style.opacity = '1'; }
      return;
    }
    var ctx = cv.getContext('2d'); if (!ctx) return;
    var parent = cv.parentElement;
    var DPR = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0, cx = 0, cy = 0, logoScale = 1;

    // данные для чёрного экрана hero
    var contentSel = cv.getAttribute && cv.getAttribute('data-content');
    var contentEl = contentSel ? document.querySelector(contentSel) : null;
    var heroEl = parent; // родитель canvas (контейнер-бокс)
    var started = false;
    function blackOut() {
      if (!contentEl) return;
      contentEl.style.opacity = '0';
      contentEl.style.transition = 'opacity 0.9s ease';
      if (parent.style) { parent.style.background = '#070707'; }
    }
    function reveal() {
      if (contentEl) { contentEl.style.opacity = '1'; }
    }

    function resize() {
      var r = parent.getBoundingClientRect();
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2;
      cy = H * 0.34;
      // логотип занимает ~86% ширины бокса (или вписываемся по высоте)
      logoScale = Math.min((W * 0.86) / LOGO_W, (H * 0.8) / LOGO_H);
    }
    resize(); window.addEventListener('resize', resize);

    var sparks = [], bolts = [], phase = 'float', phaseT = 0, hold = 0;
    var DUR = { float: 0.7, gather: 1.6, spark: 0.3, bolt: 0.9 };

    function makeBoltAngles() {
      var n = 12, arr = [];
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU + (Math.random() - 0.5) * 0.28; // равномерно по 360°
        if (Math.random() < 0.4) a += Math.PI / n; // разнести нечётные
        arr.push({ a: a, len: logoScale * (120 + Math.random() * 110) });
      }
      return arr;
    }
    function buildSparks(x, y) {
      sparks = [];
      for (var i = 0; i < 90; i++) { var a = Math.random() * TAU, sp = Math.random() * 220 + 80; sparks.push({ x: x, y: y, a: a, sp: sp, life: 0.7 + Math.random() * 0.6, age: 0 }); }
    }
    function logoPt(bx, by) {
      // маппим данную точку viewBox в центр-масштабированный логотип
      return [cx + (bx - LOGO_W / 2) * logoScale, cy + (by - LOGO_H / 2) * logoScale];
    }
    function drawDot(x, y, r, color, glow) {
      if (glow) { ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill(); }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }

    var stonePts = pathToPoints(stoneD, 0, 0, 640);
    var boltPts = pathToPoints(boltD, 0, 0, 420);
    var floaters = [];
    for (var i = 0; i < 720; i++) floaters.push({ sp: 0.3 + Math.random() * 0.9, a: Math.random() * TAU, or: Math.random() * TAU });

    function draw(t, dt) {
      ctx.clearRect(0, 0, W, H);
      if (!started) { blackOut(); started = true; }

      if (phase === 'float') { phaseT += dt / (DUR.float * 1000); if (phaseT >= 1) { phase = 'gather'; phaseT = 0; } }
      else if (phase === 'gather') { phaseT += dt / (DUR.gather * 1000); if (phaseT >= 1) { phase = 'spark'; phaseT = 0; buildSparks(cx, cy); } }
      else if (phase === 'spark') {
        phaseT += dt / (DUR.spark * 1000);
        if (phaseT >= 1) { phase = 'bolt'; phaseT = 0; bolts = makeBoltAngles(); reveal(); }
      }
      else if (phase === 'bolt') { phaseT += dt / (DUR.bolt * 1000); if (phaseT >= 1) { phase = 'done'; } }

      if (phase === 'float') {
        var f = 1 - easeOutCubic(clamp(phaseT / 1));
        var spread = Math.max(W, H) * 0.5;
        for (var i = 0; i < floaters.length; i++) {
          var p = floaters[i];
          var a2 = p.a + p.or;
          var x = cx + Math.cos(a2) * spread * f * p.sp;
          var y = cy + Math.sin(a2) * (H * 0.45) * f * p.sp;
          drawDot(x, y, 1.8, 'rgba(230,253,58,0.5)', 'rgba(230,253,58,0.18)');
        }
        return;
      }

      var g = (phase === 'bolt' || phase === 'done') ? 1 : easeInOut(clamp(phaseT / (phase === 'gather' ? 1 : 1.3))), i2;
      // молния-внешний контур
      for (i2 = 0; i2 < boltPts.length; i2++) {
        var tb = logoPt(boltPts[i2][0], boltPts[i2][1]);
        var ab = clamp((g * 1.15) - (i2 / boltPts.length) * 0.7);
        if (ab <= 0) continue;
        drawDot(tb[0], tb[1], 2.2 * ab + 0.4, 'rgba(230,253,58,' + (0.6 * ab) + ')', 'rgba(230,253,58,' + (0.25 * ab) + ')');
      }
      // камень — плотнее, крупнее, заметнее
      for (i2 = 0; i2 < stonePts.length; i2++) {
        var sp2 = stonePts[i2], target = logoPt(sp2[0], sp2[1]);
        var app = clamp((g * 1.1) - (i2 / stonePts.length) * 0.55);
        if (app <= 0) continue;
        drawDot(target[0], target[1], 2.6 * app + 0.6, 'rgba(230,253,58,' + (0.9 * app) + ')', 'rgba(230,253,58,' + (0.35 * app) + ')');
      }

      if (phase === 'spark') {
        var flash = Math.sin(Math.min(1, phaseT) * Math.PI);
        var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 130 * logoScale);
        gr.addColorStop(0, 'rgba(255,255,255,' + (0.95 * flash) + ')');
        gr.addColorStop(0.5, 'rgba(230,253,58,' + (0.6 * flash) + ')');
        gr.addColorStop(1, 'rgba(230,253,58,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, 130 * logoScale, 0, TAU); ctx.fill();
      }

      if (phase === 'bolt' || phase === 'done') {
        var bP = phase === 'bolt' ? easeOutCubic(clamp(phaseT)) : 1;
        for (i2 = 0; i2 < sparks.length; i2++) {
          var s = sparks[i2]; s.age += dt;
          var life = s.age / (s.life * 1000);
          if (life >= 1) continue;
          drawDot(s.x + Math.cos(s.a) * s.sp * life * 3 * logoScale, s.y + Math.sin(s.a) * s.sp * life * 3 * logoScale, 3 * (1 - life) + 0.6, 'rgba(255,255,255,' + (0.9 * (1 - life)) + ')');
        }
        ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(230,253,58,' + (0.9 * bP) + ')';
        ctx.lineJoin = 'round';
        for (i2 = 0; i2 < bolts.length; i2++) {
          var bl = bolts[i2], len = bl.len * bP;
          ctx.beginPath(); ctx.moveTo(cx, cy); var px = cx, py = cy;
          for (var k = 0; k < len; k += 5) {
            px += Math.cos(bl.a) * 5 * logoScale + (Math.random() - 0.5) * 3;
            py += Math.sin(bl.a) * 5 * logoScale + (Math.random() - 0.5) * 3;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
    }

    var last = performance.now(), timer = null, stopped = false;
    // Драйвер на setInterval — надёжно работает везде (RAF может замирать в фоне/headless)
    function step() {
      var now = performance.now();
      var dt = Math.min(60, now - last); last = now;
      draw(now, dt);
      if (phase === 'done') {
        if (++hold < 12) return;
        if (stopped) return;
        stopped = true; clearInterval(timer);
        cv.style.transition = 'opacity 0.8s ease'; cv.style.opacity = '0';
        setTimeout(function () { cv.style.display = 'none'; }, 850);
      }
    }
    timer = setInterval(step, 16);
  }

  function boot() {
    var canvases = document.querySelectorAll('canvas.bolt-canvas');
    for (var i = 0; i < canvases.length; i++) initBolt(canvases[i]);
// Обработка вкладок телефона — единообразно на всех страницах
    function phoneInit() {
      var img = document.getElementById('phone-screen');
      var wrap = document.getElementById('phone-tabs');
      if (!img || !wrap) return;
      wrap.querySelectorAll('.phonetab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-phone');
          if (!name) return;
          img.style.opacity = '0';
          setTimeout(function () {
            img.src = 'assets/phones/' + name + '.png';
            img.style.opacity = '1';
          }, 180);
          wrap.querySelectorAll('.phonetab').forEach(function (b) {
            b.classList.remove('bg-brand/[0.08]', 'border-brand/40', 'text-white');
            b.classList.add('bg-white/[0.03]', 'border-white/[0.08]', 'text-white/75');
          });
          btn.classList.remove('bg-white/[0.03]', 'border-white/[0.08]', 'text-white/75');
          btn.classList.add('bg-brand/[0.08]', 'border-brand/40', 'text-white');
        });
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', phoneInit);
    else phoneInit();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
