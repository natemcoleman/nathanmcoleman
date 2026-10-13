/* Venn — daily rotating-circle puzzle. UI layer; puzzle logic lives in engine.js. */
(function () {
  'use strict';

  var E = window.VennEngine;
  var LAUNCH = '2026-10-14'; // Venn #1
  var STORE_KEY = 'venn-v1';
  var SITE_URL = location.origin + location.pathname.replace(/[^/]*$/, '');
  var ASSET_BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');

  // Face colors, assigned clockwise from the top cluster, plus color-blind glyphs.
  var PALETTE = ['#e5484d', '#30a46c', '#f76b15', '#f5c400', '#8e4ec6', '#3e63dd'];
  var GLYPHS = ['circle', 'triangle', 'square', 'diamond', 'plus', 'star'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var LEVELS = ['Easy', 'Medium', 'Hard', 'Expert'];

  // ---------- dates ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function dayIndex(s) { var p = s.split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function puzzleNumber(s) { return dayIndex(s) - dayIndex(LAUNCH) + 1; }
  function today() { return dateStr(new Date()); }
  function fmtTime(ms) {
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  function numberLabel(s) { var n = puzzleNumber(s); return n >= 1 ? '#' + n : 'Preview'; }

  // ---------- storage ----------
  var store = { games: {}, settings: { colorblind: false, pauseWhenAway: true, seenHelp: false } };
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      store.games = parsed.games || {};
      Object.assign(store.settings, parsed.settings || {});
    }
  } catch (e) { /* storage unavailable: play without saving */ }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }

  // ---------- theme ----------
  function isDark() { return document.documentElement.classList.contains('dark'); }
  function setDark(on) {
    document.documentElement.classList.toggle('dark', on);
    try { localStorage.setItem('pref-theme', on ? 'dark' : 'light'); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', on ? '#121213' : '#ffffff');
    board.draw();
    if (demo) demo.draw();
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------- board renderer ----------
  function Board(canvas, puzzle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.puzzle = puzzle;
    this.state = puzzle.solvedState.slice();
    this.turn = null;      // { c, s } circle currently being turned by s steps (fractional)
    this.hintMove = null;  // { c, k }
    this.pulse = 0;        // win celebration progress 0..1
    this.w = 0; this.h = 0;

    var xs = puzzle.slots.map(function (s) { return s.x; });
    var ys = puzzle.slots.map(function (s) { return s.y; });
    this.bbox = { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
    this.ringBox = {
      x0: Math.min.apply(null, puzzle.circles.map(function (c) { return c.cx - c.r; })),
      x1: Math.max.apply(null, puzzle.circles.map(function (c) { return c.cx + c.r; })),
      y0: Math.min.apply(null, puzzle.circles.map(function (c) { return c.cy - c.r; })),
      y1: Math.max.apply(null, puzzle.circles.map(function (c) { return c.cy + c.r; }))
    };
    var minD = Infinity;
    for (var i = 0; i < puzzle.slots.length; i++) {
      for (var j = i + 1; j < puzzle.slots.length; j++) {
        var a = puzzle.slots[i], b = puzzle.slots[j];
        minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    this.minSlotDist = minD;
  }

  Board.prototype.resize = function (w, h) {
    var dpr = window.devicePixelRatio || 1;
    this.w = w; this.h = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit every circle fully on screen, leaving room for the points' radius and the stroke.
    var b = this.ringBox;
    var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var self = this;
    function fit(padPx) { return Math.min((w - 2 * padPx) / bw, (h - 2 * padPx) / bh); }
    function radiusFor(scale) { return Math.max(5, Math.min(self.minSlotDist * scale * 0.36, 16)); }
    var pad = radiusFor(fit(4)) + 4;
    this.scale = fit(pad);
    this.pointR = radiusFor(this.scale);
    this.ox = w / 2 - ((b.x0 + b.x1) / 2) * this.scale;
    this.oy = h / 2 + ((b.y0 + b.y1) / 2) * this.scale;
    this.draw();
  };

  Board.prototype.toScreen = function (x, y) { return { x: this.ox + x * this.scale, y: this.oy - y * this.scale }; };
  Board.prototype.toWorld = function (x, y) { return { x: (x - this.ox) / this.scale, y: (this.oy - y) / this.scale }; };

  // Where the point that sits in `slotIndex` of circle c is drawn when the circle is turned by s steps.
  Board.prototype.turnedPos = function (c, i, s) {
    var circ = this.puzzle.circles[c], m = circ.slots.length;
    var fl = Math.floor(s), fr = s - fl;
    var j = ((i + fl) % m + m) % m, j2 = (j + 1) % m;
    var a1 = circ.slotAngles[j], gap = circ.slotAngles[j2] - a1;
    if (gap <= 0) gap += Math.PI * 2;
    var a = a1 + gap * fr;
    return { x: circ.cx + circ.r * Math.cos(a), y: circ.cy + circ.r * Math.sin(a) };
  };

  Board.prototype.draw = function () {
    var ctx = this.ctx, p = this.puzzle, self = this;
    if (!this.w) return;
    ctx.clearRect(0, 0, this.w, this.h);
    var ringColor = cssVar('--ring'), activeColor = cssVar('--ring-active'), hintColor = cssVar('--hint');

    // circles
    p.circles.forEach(function (c) {
      var ctr = self.toScreen(c.cx, c.cy);
      var active = self.turn && self.turn.c === c.id;
      var hinted = self.hintMove && self.hintMove.c === c.id;
      ctx.beginPath();
      ctx.arc(ctr.x, ctr.y, c.r * self.scale, 0, Math.PI * 2);
      ctx.lineWidth = active ? 3 : hinted ? 4 : 1.5;
      ctx.strokeStyle = active ? activeColor : hinted ? hintColor : ringColor;
      ctx.stroke();
    });

    if (this.hintMove) this.drawHintArrow(hintColor);

    // points
    var moving = {};
    if (this.turn && this.turn.s !== 0) {
      var circ = p.circles[this.turn.c];
      circ.slots.forEach(function (sid, i) { moving[sid] = self.turnedPos(self.turn.c, i, self.turn.s); });
    }
    var edge = cssVar('--point-edge');
    var order = p.slots.slice().sort(function (a, b) { return (moving[a.id] ? 1 : 0) - (moving[b.id] ? 1 : 0); });
    order.forEach(function (slot) {
      var pos = moving[slot.id] || slot;
      var sp = self.toScreen(pos.x, pos.y);
      var color = self.state[slot.id];
      var r = self.pointR;
      if (self.pulse > 0) {
        var f = p.faces[slot.face];
        var phase = self.pulse * 1.6 - (f.color / p.faces.length) * 0.6;
        if (phase > 0 && phase < 1) r *= 1 + 0.35 * Math.sin(phase * Math.PI);
      }
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[color % PALETTE.length];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = edge;
      ctx.stroke();
      if (store.settings.colorblind) drawGlyph(ctx, GLYPHS[color % GLYPHS.length], sp.x, sp.y, r * 0.55);
    });
  };

  Board.prototype.drawHintArrow = function (color) {
    var ctx = this.ctx, c = this.puzzle.circles[this.hintMove.c], self = this;
    var m = c.slots.length, k = this.hintMove.k;
    // Anchor on the circle's point nearest the middle of the board, so the arrow is visible.
    var mx = (this.bbox.x0 + this.bbox.x1) / 2, my = (this.bbox.y0 + this.bbox.y1) / 2;
    var best = 0, bestD = Infinity;
    c.slots.forEach(function (sid, i) {
      var s = self.puzzle.slots[sid], d = Math.hypot(s.x - mx, s.y - my);
      if (d < bestD) { bestD = d; best = i; }
    });
    var a0 = c.slotAngles[best];
    var span = (k * Math.PI * 2) / m;
    var ctr = this.toScreen(c.cx, c.cy);
    // Drawn just inside the circle so it always stays on screen.
    var R = c.r * this.scale - this.pointR * 1.9;
    // canvas y is flipped: math angle a -> screen angle -a
    var s0 = -a0, s1 = -(a0 + span);
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(ctr.x, ctr.y, R, s0, s1, span > 0);
    ctx.stroke();
    // arrowhead at the end, pointing along the direction of travel
    var ex = ctr.x + R * Math.cos(s1), ey = ctr.y + R * Math.sin(s1);
    var dir = span > 0 ? -1 : 1;
    var tx = -Math.sin(s1) * dir, ty = Math.cos(s1) * dir;
    var nx = Math.cos(s1), ny = Math.sin(s1), L = 12;
    ctx.beginPath();
    ctx.moveTo(ex + tx * L * 0.9, ey + ty * L * 0.9);
    ctx.lineTo(ex + nx * L * 0.6, ey + ny * L * 0.6);
    ctx.lineTo(ex - nx * L * 0.6, ey - ny * L * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  function drawGlyph(ctx, kind, x, y, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1.5, r * 0.4);
    ctx.beginPath();
    if (kind === 'circle') { ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill(); }
    else if (kind === 'triangle') { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.65); ctx.lineTo(x - r * 0.9, y + r * 0.65); ctx.closePath(); ctx.fill(); }
    else if (kind === 'square') { ctx.rect(x - r * 0.65, y - r * 0.65, r * 1.3, r * 1.3); ctx.fill(); }
    else if (kind === 'diamond') { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.8, y); ctx.closePath(); ctx.fill(); }
    else if (kind === 'plus') { ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); }
    else if (kind === 'star') {
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        if (i) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- animation helper ----------
  function animate(duration, step, done) {
    var t0 = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - t0) / duration);
      step(t);
      if (t < 1) requestAnimationFrame(frame); else if (done) done();
    }
    requestAnimationFrame(frame);
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ---------- game ----------
  var params = new URLSearchParams(location.search);
  var todayStr = today();
  var playDate = params.get('d');
  if (!playDate || !/^\d{4}-\d{2}-\d{2}$/.test(playDate) || playDate > todayStr || puzzleNumber(playDate) < 1) playDate = todayStr;
  var isArchive = playDate !== todayStr;

  var day = E.dailyPuzzle(playDate);
  var puzzle = day.puzzle;
  var game = store.games[playDate] || { stack: [], elapsed: 0, started: false, solved: false, hints: 0, daily: false };
  store.games[playDate] = game;

  var state = E.applyMoves(puzzle, day.start.slice(), game.stack);
  var canvas = document.getElementById('board');
  var board = new Board(canvas, puzzle);
  board.state = state;
  var demo = null;
  var busy = false;         // an animation owns the board
  var runningSince = null;  // timestamp when the timer last resumed

  var el = {
    label: document.getElementById('puzzle-label'),
    timer: document.getElementById('timer'),
    moves: document.getElementById('moves'),
    banner: document.getElementById('archive-banner'),
    undo: document.getElementById('undo-btn'),
    hint: document.getElementById('hint-btn'),
    controls: document.getElementById('controls')
  };

  el.label.innerHTML = '<strong>' + numberLabel(playDate) + '</strong> · ' + day.config.label;
  if (isArchive) {
    var pd = parseDate(playDate);
    el.banner.innerHTML = DAY_NAMES[pd.getDay()] + ', ' + MONTHS[pd.getMonth()].slice(0, 3) + ' ' + pd.getDate() + ' · <a href="' + location.pathname + '">Back to today</a>';
  }

  function elapsed() { return game.elapsed + (runningSince ? performance.now() - runningSince : 0); }
  function startTimer() {
    if (game.solved || runningSince) return;
    if (!game.started) {
      game.started = true;
      game.startedOn = today();
      game.daily = !isArchive && game.startedOn === playDate;
    }
    runningSince = performance.now();
  }
  function pauseTimer() {
    if (!runningSince) return;
    game.elapsed = elapsed();
    runningSince = null;
    save();
  }
  function renderStatus() {
    el.timer.textContent = fmtTime(game.solved ? game.time : elapsed());
    var n = game.stack.length;
    el.moves.textContent = n + (n === 1 ? ' move' : ' moves');
    el.undo.disabled = game.solved || n === 0;
    el.hint.disabled = game.solved;
  }
  setInterval(renderStatus, 250);

  function layout() {
    var wrap = document.getElementById('board-wrap');
    var w = wrap.clientWidth - 16, h = wrap.clientHeight;
    board.resize(Math.max(100, w), Math.max(100, h));
  }
  if (window.ResizeObserver) new ResizeObserver(layout).observe(document.getElementById('board-wrap'));
  window.addEventListener('resize', layout);

  function commitMove(c, k) {
    k = E.shortest(puzzle, c, k);
    if (k === 0) return;
    state = E.applyMove(puzzle, state, c, k);
    board.state = state;
    game.stack = game.stack.concat([{ c: c, k: k }]);
    board.hintMove = null;
    save();
    renderStatus();
    if (E.isSolved(puzzle, state)) win();
  }

  // Animate circle c from s0 to s1 steps, then commit the whole-step result.
  function playTurn(c, s0, s1, duration, done) {
    busy = true;
    board.turn = { c: c, s: s0 };
    animate(duration, function (t) {
      board.turn.s = s0 + (s1 - s0) * easeOut(t);
      board.draw();
    }, function () {
      board.turn = null;
      busy = false;
      if (done) done();
      board.draw();
    });
  }

  // ---------- input ----------
  var drag = null;
  function pointerPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function nearCircles(sp) {
    var w = board.toWorld(sp.x, sp.y);
    var tolPx = Math.max(24, board.pointR * 1.8);
    return puzzle.circles.map(function (c) {
      return { c: c, d: Math.abs(Math.hypot(w.x - c.cx, w.y - c.cy) - c.r) * board.scale };
    }).filter(function (x) { return x.d <= tolPx; }).map(function (x) { x.tol = tolPx; return x; });
  }
  function angleAround(c, sp) {
    var w = board.toWorld(sp.x, sp.y);
    return Math.atan2(w.y - c.cy, w.x - c.cx);
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (busy || game.solved || drag) return;
    var sp = pointerPos(e);
    var cands = nearCircles(sp);
    if (!cands.length) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, start: sp, cands: cands, c: null };
    // Only one candidate (or concentric ones, which share a center): pick the closest right away.
    var centers = {};
    cands.forEach(function (x) { centers[x.c.center] = true; });
    if (Object.keys(centers).length === 1) lockCircle(cands.reduce(function (a, b) { return a.d <= b.d ? a : b; }).c);
    e.preventDefault();
  });

  function lockCircle(c) {
    drag.c = c.id;
    drag.a0 = angleAround(c, drag.start);
    drag.prevA = drag.a0;
    drag.total = 0;
    board.turn = { c: c.id, s: 0 };
    canvas.classList.add('dragging');
    startTimer();
    board.draw();
  }

  canvas.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var sp = pointerPos(e);
    if (drag.c === null) {
      var dx = sp.x - drag.start.x, dy = sp.y - drag.start.y, dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      // Pick the circle whose direction best matches the drag (screen coords: y down).
      var best = null, bestScore = -Infinity;
      drag.cands.forEach(function (x) {
        var c = x.c, ctr = board.toScreen(c.cx, c.cy);
        var rx = drag.start.x - ctr.x, ry = drag.start.y - ctr.y, rl = Math.hypot(rx, ry) || 1;
        var tx = -ry / rl, ty = rx / rl;
        var align = Math.abs((dx * tx + dy * ty) / dist);
        var score = align - 0.8 * (x.d / x.tol);
        if (score > bestScore) { bestScore = score; best = c; }
      });
      lockCircle(best);
    }
    var c = puzzle.circles[drag.c];
    var a = angleAround(c, sp);
    var da = a - drag.prevA;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    drag.total += da;
    drag.prevA = a;
    var m = c.slots.length;
    var s = (drag.total * m) / (Math.PI * 2);
    if (Math.round(s) !== Math.round(board.turn.s) && navigator.vibrate) { try { navigator.vibrate(6); } catch (err) {} }
    board.turn.s = s;
    board.draw();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    canvas.classList.remove('dragging');
    if (d.c === null) return;
    var s = board.turn ? board.turn.s : 0;
    var target = Math.round(s);
    playTurn(d.c, s, target, 140 + Math.min(200, Math.abs(target - s) * 160), function () {
      commitMove(d.c, target);
    });
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  el.undo.addEventListener('click', function () {
    if (busy || game.solved || !game.stack.length) return;
    var last = game.stack[game.stack.length - 1];
    board.hintMove = null;
    // Draw the current position turning backwards, then show the undone state.
    var shown = state;
    state = E.applyMove(puzzle, state, last.c, -last.k);
    game.stack = game.stack.slice(0, -1);
    board.state = shown;
    playTurn(last.c, 0, -last.k, 260, function () {
      board.state = state;
      save();
      renderStatus();
    });
  });

  el.hint.addEventListener('click', function () {
    if (busy || game.solved) return;
    var history = day.scramble.concat(game.stack);
    var h = E.hint(puzzle, state, history, { nodeBudget: 150000, maxDepth: 3 });
    if (!h) return;
    startTimer();
    game.hints += 1;
    save();
    board.hintMove = { c: h.c, k: h.k };
    // nudge the circle in the right direction so it is easy to spot
    var dir = h.k > 0 ? 1 : -1;
    playTurn(h.c, 0, dir * 0.3, 180, function () {
      playTurn(h.c, dir * 0.3, 0, 220);
    });
    board.draw();
  });

  // ---------- winning ----------
  function win() {
    if (!game.started) startTimer(); // records the game as played (normally done by the first drag)
    game.time = elapsed();
    game.elapsed = game.time;
    runningSince = null;
    game.solved = true;
    game.solvedOn = today();
    save();
    renderStatus();
    var msg = winMessage();
    busy = true;
    animate(1100, function (t) { board.pulse = t; board.draw(); }, function () {
      board.pulse = 0; busy = false; board.draw();
    });
    setTimeout(function () { toast(msg, 1500); }, 300);
    setTimeout(function () { openModal('stats'); }, 1800);
    showSolvedControls();
    if (window.gtag) gtag('event', 'venn_solved', { puzzle: puzzleNumber(playDate), seconds: Math.round(game.time / 1000), hints: game.hints });
  }
  function winMessage() {
    var extra = game.stack.length - day.scramble.length;
    if (game.hints > 0) return 'Nice work';
    if (extra <= 0) return 'Genius';
    if (extra <= 2) return 'Magnificent';
    if (extra <= 5) return 'Impressive';
    if (extra <= 10) return 'Splendid';
    return 'Great';
  }
  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
  function showSolvedControls() {
    el.controls.innerHTML = '';
    function add(label, cls, onClick, id) {
      var b = document.createElement('button');
      b.className = 'btn' + (cls ? ' ' + cls : '');
      b.innerHTML = label;
      if (id) b.id = id;
      b.addEventListener('click', onClick);
      el.controls.appendChild(b);
      return b;
    }
    add('Stats', 'primary', function () { openModal('stats'); });
    add(ICON_PLAY + 'Solution', '', watchSolution, 'solution-btn');
    add('Share', '', share);
  }

  // ---------- optimal solution replay ----------
  var solutionCache = null;
  // Calls back with { moves: [{c,k}], optimal: bool }. Uses the precomputed shortest
  // solution when it matches this puzzle, otherwise unwinds the scramble.
  function getSolution(cb) {
    if (solutionCache) { cb(solutionCache); return; }
    function fallback() {
      var plan = E.reduceMoves(puzzle, day.scramble);
      var moves = plan.slice().reverse().map(function (m) { return { c: m.c, k: E.shortest(puzzle, m.c, -m.k) }; });
      solutionCache = { moves: moves, optimal: false };
      cb(solutionCache);
    }
    if (!window.fetch) { fallback(); return; }
    fetch(ASSET_BASE + 'solutions.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('missing');
      return r.json();
    }).then(function (data) {
      var entry = data && data.puzzles && data.puzzles[playDate];
      if (!entry || entry.h !== E.hashString(day.start.join(','))) throw new Error('no match');
      var moves = entry.s.map(function (m) { return { c: m[0], k: m[1] }; });
      var valid = moves.every(function (m) { return m.c >= 0 && m.c < puzzle.circles.length; }) &&
        E.isSolved(puzzle, E.applyMoves(puzzle, day.start.slice(), moves));
      if (!valid) throw new Error('invalid');
      solutionCache = { moves: moves, optimal: true };
      cb(solutionCache);
    }).catch(fallback);
  }

  var replaying = false;
  function watchSolution() {
    if (busy || replaying || !game.solved) return;
    closeModal();
    replaying = true;
    var btn = document.getElementById('solution-btn');
    if (btn) btn.disabled = true;
    var bannerBefore = el.banner.innerHTML;
    getSolution(function (sol) {
      var moves = sol.moves, n = moves.length, name = sol.optimal ? 'Shortest solution' : 'Solution';
      var shown = day.start.slice();
      busy = true;
      board.hintMove = null;
      board.state = shown;
      board.draw();
      el.banner.textContent = name + ' · ready';
      function step(i) {
        if (i === n) {
          el.banner.textContent = name + ': ' + n + (n === 1 ? ' move' : ' moves');
          animate(900, function (t) { board.pulse = t; board.draw(); }, function () {
            board.pulse = 0; board.draw();
            busy = false;
            replaying = false;
            if (btn) btn.disabled = false;
            setTimeout(function () { if (!replaying) el.banner.innerHTML = bannerBefore; }, 2500);
          });
          return;
        }
        var mv = moves[i];
        el.banner.textContent = name + ' · move ' + (i + 1) + ' of ' + n;
        board.hintMove = { c: mv.c, k: mv.k };
        board.draw();
        setTimeout(function () {
          playTurn(mv.c, 0, mv.k, 450 + 90 * Math.abs(mv.k), function () {
            busy = true; // keep the board locked between moves
            shown = E.applyMove(puzzle, shown, mv.c, mv.k);
            board.state = shown;
            board.hintMove = null;
            setTimeout(function () { step(i + 1); }, 350);
          });
        }, 550);
      }
      setTimeout(function () { step(0); }, 500);
    });
  }

  // ---------- sharing ----------
  function shareText() {
    var dots = { Easy: '🟢', Medium: '🟡', Hard: '🟠', Expert: '🔴' }[day.config.label];
    var lines = [
      'Venn ' + numberLabel(playDate) + ' ' + dots + ' ' + day.config.label,
      '⏱️ ' + fmtTime(game.time) + '  🔄 ' + game.stack.length + ' moves  💡 ' + game.hints + (game.hints === 1 ? ' hint' : ' hints'),
      SITE_URL
    ];
    return lines.join('\n');
  }
  function share() {
    var text = shareText();
    var mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (mobile && navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied results to clipboard'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied results to clipboard'); } catch (e) { toast('Could not copy'); }
    document.body.removeChild(ta);
  }

  // ---------- toasts ----------
  function toast(text, ms) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.getElementById('toasts').appendChild(t);
    setTimeout(function () { t.classList.add('fade'); }, ms || 1500);
    setTimeout(function () { t.remove(); }, (ms || 1500) + 400);
  }

  // ---------- modals ----------
  var openId = null;
  function openModal(id) {
    if (openId) closeModal();
    if (id === 'stats') renderStats();
    if (id === 'archive') renderArchive();
    if (id === 'help') renderDemo();
    if (id === 'settings') syncSettings();
    document.getElementById(id).classList.add('open');
    openId = id;
  }
  function closeModal() {
    if (!openId) return;
    document.getElementById(openId).classList.remove('open');
    if (openId === 'help' && !store.settings.seenHelp) { store.settings.seenHelp = true; save(); }
    openId = null;
  }
  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () { openModal(b.getAttribute('data-open')); });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
  document.querySelectorAll('.overlay').forEach(function (o) {
    o.addEventListener('click', function (e) { if (e.target === o) closeModal(); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function renderDemo() {
    var c = document.getElementById('help-demo');
    if (!demo) {
      demo = new Board(c, E.buildPuzzle(E.LAYOUTS[2]));
      demo.resize(220, 200);
    } else demo.draw();
  }

  // ---------- stats ----------
  function computeStats() {
    var now = today();
    var dates = Object.keys(store.games).filter(function (d) {
      var g = store.games[d];
      return g.daily && puzzleNumber(d) >= 1 && (g.solved || d < now);
    }).sort();
    var played = dates.length;
    var solvedDates = dates.filter(function (d) { var g = store.games[d]; return g.solved && g.solvedOn === d; });
    var solvedSet = {};
    solvedDates.forEach(function (d) { solvedSet[d] = true; });
    // current streak: ends today (if solved) or yesterday
    var cur = 0, d = solvedSet[now] ? now : addDays(now, -1);
    while (solvedSet[d]) { cur++; d = addDays(d, -1); }
    var max = 0, run = 0, prev = null;
    solvedDates.forEach(function (x) {
      run = prev && dayIndex(x) - dayIndex(prev) === 1 ? run + 1 : 1;
      max = Math.max(max, run);
      prev = x;
    });
    var times = solvedDates.map(function (x) { return store.games[x].time; });
    var byLevel = {};
    LEVELS.forEach(function (l) { byLevel[l] = []; });
    solvedDates.forEach(function (x) {
      var wd = parseDate(x).getDay();
      byLevel[E.SCHEDULE[wd].label].push(store.games[x].time);
    });
    function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
    return {
      played: played,
      solvedPct: played ? Math.round((solvedDates.length / played) * 100) : 0,
      streak: cur,
      maxStreak: max,
      avg: avg(times),
      best: times.length ? Math.min.apply(null, times) : null,
      byLevel: LEVELS.map(function (l) { return { label: l, avg: avg(byLevel[l]), count: byLevel[l].length }; })
    };
  }

  function statHtml(num, lbl) { return '<div class="stat"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>'; }

  function renderStats() {
    var s = computeStats();
    document.getElementById('stats-row').innerHTML =
      statHtml(s.played, 'Played') + statHtml(s.solvedPct, 'Solved %') + statHtml(s.streak, 'Current Streak') + statHtml(s.maxStreak, 'Max Streak');
    document.getElementById('stats-row2').innerHTML =
      statHtml(s.avg == null ? '–' : fmtTime(s.avg), 'Average Time') + statHtml(s.best == null ? '–' : fmtTime(s.best), 'Best Time');
    var maxAvg = Math.max.apply(null, s.byLevel.map(function (x) { return x.avg || 0; })) || 1;
    document.getElementById('stats-dist').innerHTML = s.byLevel.map(function (x) {
      var pct = x.avg ? Math.max(12, Math.round((x.avg / maxAvg) * 100)) : 0;
      var cls = 'bar' + (x.label === day.config.label && game.solved && !isArchive ? ' today' : '');
      return '<div class="dist-label">' + x.label + '</div>' +
        '<div class="dist-track"><div class="' + cls + '"' + (x.avg ? ' style="width:' + pct + '%"' : '') + '>' + (x.avg ? fmtTime(x.avg) : '–') + '</div></div>' +
        '<div class="dist-count">' + (x.count ? x.count + ' solved' : '') + '</div>';
    }).join('');

    var result = document.getElementById('stats-result');
    var shareBox = document.getElementById('stats-share');
    if (game.solved) {
      result.innerHTML = '<div class="result-box"><h3>Solved!</h3><div class="big">Venn ' + numberLabel(playDate) + ' · ' + day.config.label + '</div>' +
        '<p>' + fmtTime(game.time) + ' · ' + game.stack.length + ' moves · ' + game.hints + (game.hints === 1 ? ' hint' : ' hints') +
        (isArchive ? '<br><span class="small">Past puzzles don\'t count toward your stats.</span>' : '') + '</p>' +
        '<p class="small" id="optimal-line">&nbsp;</p>' +
        '<button class="btn" id="watch-btn" style="max-width:260px;width:100%">' + ICON_PLAY + 'Watch Solution</button></div><hr>';
      shareBox.innerHTML = '<hr><div class="share-row">' +
        (isArchive ? '' : '<div class="countdown"><h2 style="margin:0 0 4px">Next Venn</h2><div class="num" id="countdown"></div></div><div class="divider"></div>') +
        '<button class="btn primary" id="share-btn" style="max-width:160px">Share ' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg></button></div>';
      document.getElementById('share-btn').addEventListener('click', share);
      document.getElementById('watch-btn').addEventListener('click', watchSolution);
      getSolution(function (sol) {
        var line = document.getElementById('optimal-line');
        if (!line) return;
        line.textContent = sol.optimal
          ? 'Fewest possible: ' + sol.moves.length + (sol.moves.length === 1 ? ' move' : ' moves') +
            (game.stack.length <= sol.moves.length ? ' — you matched it!' : '')
          : 'Solution available: ' + sol.moves.length + (sol.moves.length === 1 ? ' move' : ' moves');
      });
      tickCountdown();
    } else {
      result.innerHTML = '';
      shareBox.innerHTML = '';
    }
  }
  function tickCountdown() {
    var node = document.getElementById('countdown');
    if (!node) return;
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var ms = next - now;
    if (ms <= 1000) { location.reload(); return; }
    var t = Math.floor(ms / 1000);
    node.textContent = pad(Math.floor(t / 3600)) + ':' + pad(Math.floor((t % 3600) / 60)) + ':' + pad(t % 60);
  }
  setInterval(tickCountdown, 1000);

  // ---------- archive ----------
  function renderArchive() {
    var body = document.getElementById('archive-body');
    if (puzzleNumber(todayStr) < 1) {
      var l = parseDate(LAUNCH);
      body.innerHTML = '<p class="small" style="text-align:center">Past puzzles will appear here once Venn #1 launches on ' +
        MONTHS[l.getMonth()] + ' ' + l.getDate() + '.</p>';
      return;
    }
    var html = '', month = null;
    for (var d = todayStr; puzzleNumber(d) >= 1; d = addDays(d, -1)) {
      var pd = parseDate(d), mk = MONTHS[pd.getMonth()] + ' ' + pd.getFullYear();
      if (mk !== month) { html += (month ? '</ul>' : '') + '<div class="archive-month">' + mk + '</div><ul class="archive-list">'; month = mk; }
      var g = store.games[d], label = E.SCHEDULE[pd.getDay()].label;
      var status = g && g.solved ? '<span class="status done">✓ ' + fmtTime(g.time) + '</span>'
        : g && g.started ? '<span class="status">In progress</span>' : '<span class="status small">Play</span>';
      html += '<li><button data-date="' + d + '"><span><strong>#' + puzzleNumber(d) + '</strong> · ' + label +
        '<br><span class="when">' + (d === todayStr ? 'Today' : DAY_NAMES[pd.getDay()] + ', ' + MONTHS[pd.getMonth()].slice(0, 3) + ' ' + pd.getDate()) +
        '</span></span>' + status + '</button></li>';
    }
    body.innerHTML = html + '</ul>';
    body.querySelectorAll('button[data-date]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.getAttribute('data-date');
        pauseTimer();
        location.href = location.pathname + (d === todayStr ? '' : '?d=' + d);
      });
    });
  }

  // ---------- feedback ----------
  (function () {
    var form = document.getElementById('feedback-form');
    var status = document.getElementById('fb-status');
    var submit = document.getElementById('fb-submit');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('fb-message');
      if (!msg.value.trim()) { status.className = 'fb-status error'; status.textContent = 'Please write a message first.'; msg.focus(); return; }
      document.getElementById('fb-puzzle').value = 'Venn ' + numberLabel(playDate) + ' (' + playDate + ')' +
        (game.solved ? ', solved' : game.started ? ', in progress' : '');
      submit.disabled = true;
      submit.textContent = 'Sending…';
      status.className = 'fb-status';
      status.textContent = '';
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString()
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        form.reset();
        closeModal();
        toast('Thanks for the feedback!', 2000);
      }).catch(function () {
        status.className = 'fb-status error';
        status.textContent = 'Couldn\'t send right now. Please try again later.';
      }).then(function () {
        submit.disabled = false;
        submit.textContent = 'Send';
      });
    });
  })();

  // ---------- settings ----------
  function syncSettings() {
    document.getElementById('set-dark').checked = isDark();
    document.getElementById('set-cb').checked = !!store.settings.colorblind;
    document.getElementById('set-pause').checked = store.settings.pauseWhenAway !== false;
  }
  document.getElementById('set-dark').addEventListener('change', function (e) { setDark(e.target.checked); });
  document.getElementById('set-cb').addEventListener('change', function (e) {
    store.settings.colorblind = e.target.checked; save(); board.draw(); if (demo) demo.draw();
  });
  document.getElementById('set-pause').addEventListener('change', function (e) { store.settings.pauseWhenAway = e.target.checked; save(); });

  // ---------- lifecycle ----------
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (store.settings.pauseWhenAway !== false) pauseTimer(); else { game.elapsed = elapsed(); if (runningSince) runningSince = performance.now(); save(); }
    } else if (game.started && !game.solved && !runningSince && store.settings.pauseWhenAway !== false) {
      // resume on return only if the player had started
      runningSince = performance.now();
    }
  });
  window.addEventListener('pagehide', function () {
    if (runningSince) { game.elapsed = elapsed(); runningSince = performance.now(); }
    save();
  });

  layout();
  renderStatus();
  if (game.solved) showSolvedControls();
  else if (game.started) runningSince = performance.now(); // resume a game in progress
  if (!store.settings.seenHelp) openModal('help');

  // exposed for debugging and automated checks
  window.Venn = { puzzle: puzzle, day: day, game: game, board: board, getState: function () { return state; }, commitMove: commitMove };
})();
