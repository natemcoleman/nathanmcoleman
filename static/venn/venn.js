/* Venn — daily rotating-circle puzzle. UI layer; puzzle logic lives in engine.js. */
(function () {
  'use strict';

  var E = window.VennEngine;
  var LAUNCH = '2026-10-14'; // Venn #1
  var STORE_KEY = 'venn-v1';
  // Canonical page URL from Hugo (so shares from preview deploys still link to the live site).
  var SITE_URL = document.body.getAttribute('data-url') || (location.origin + location.pathname.replace(/[^/]*$/, ''));
  var ASSET_BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');

  // Face colors, assigned clockwise from the top cluster, plus color-blind glyphs.
  var PALETTE = ['#e5484d', '#30a46c', '#f76b15', '#f5c400', '#8e4ec6', '#3e63dd'];
  var GLYPHS = ['circle', 'triangle', 'square', 'diamond', 'plus', 'star'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var LEVELS = ['Easy', 'Medium', 'Hard', 'Expert'];
  var HINT_COST = E.HINT_COST; // each hint adds this many moves (shared with the score server)
  var DRAG_SPEED = 0.75;       // how far the circle turns relative to the finger (1 = follows exactly)
  var SCORES_URL = '/.netlify/functions/venn-scores';

  // Score: moves made (undo takes one back) plus a penalty per hint.
  function score(g) { return E.moveScore(g.stack, g.hints); }
  function movesText(n) { return n + (n === 1 ? ' move' : ' moves'); }

  // ---------- dates ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function dayIndex(s) { var p = s.split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function puzzleNumber(s) { return dayIndex(s) - dayIndex(LAUNCH) + 1; }
  function today() { return dateStr(new Date()); }
  function numberLabel(s) { var n = puzzleNumber(s); return n >= 1 ? '#' + n : 'Preview'; }

  // ---------- storage ----------
  var store = { games: {}, settings: { colorblind: false, seenHelp: false } };
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
  function validDate(d, allowPreview) {
    return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayStr && (allowPreview ? d >= E.SCHEDULES[0].from : puzzleNumber(d) >= 1);
  }
  // Practice modes (never saved or counted): ?free=Easy|Medium|Hard|Expert, ?replay=YYYY-MM-DD
  var freeLevel = LEVELS.indexOf(params.get('free')) >= 0 ? params.get('free') : null;
  var replayDate = !freeLevel && validDate(params.get('replay'), true) ? params.get('replay') : null;
  var practice = !!(freeLevel || replayDate);
  var playDate = replayDate || params.get('d');
  if (!practice && !validDate(playDate, false)) playDate = todayStr;
  if (freeLevel) playDate = todayStr;
  var isArchive = practice || playDate !== todayStr;

  var day = freeLevel
    ? E.practicePuzzle(freeLevel, params.get('seed') || String(Date.now()))
    : E.dailyPuzzle(playDate);
  var puzzle = day.puzzle;
  var newGame = function () { return { stack: [], started: false, solved: false, hints: 0, daily: false }; };
  var game;
  if (practice) game = newGame();
  else {
    game = store.games[playDate] || newGame();
    store.games[playDate] = game;
  }

  var state = E.applyMoves(puzzle, day.start.slice(), game.stack);
  var canvas = document.getElementById('board');
  var board = new Board(canvas, puzzle);
  board.state = state;
  var demo = null;
  var busy = false;         // an animation owns the board

  var el = {
    label: document.getElementById('puzzle-label'),
    hintsCount: document.getElementById('hints-count'),
    moves: document.getElementById('moves'),
    banner: document.getElementById('archive-banner'),
    undo: document.getElementById('undo-btn'),
    hint: document.getElementById('hint-btn'),
    controls: document.getElementById('controls')
  };

  el.label.innerHTML = '<strong>' + (freeLevel ? 'Free play' : replayDate ? 'Replay ' + numberLabel(playDate) : numberLabel(playDate)) +
    '</strong> · ' + day.config.label;
  if (practice) {
    el.banner.innerHTML = 'Practice · doesn\'t count · <a href="' + location.pathname + '">Back to today</a>';
  } else if (isArchive) {
    var pd = parseDate(playDate);
    el.banner.innerHTML = DAY_NAMES[pd.getDay()] + ', ' + MONTHS[pd.getMonth()].slice(0, 3) + ' ' + pd.getDate() + ' · <a href="' + location.pathname + '">Back to today</a>';
  }

  // Records that the game was started (and whether on its own day, for stats).
  function markStarted() {
    if (game.started || game.solved) return;
    game.started = true;
    game.startedOn = today();
    game.daily = !isArchive && game.startedOn === playDate;
  }
  function renderStatus() {
    el.moves.textContent = movesText(score(game));
    el.hintsCount.textContent = game.hints ? game.hints + (game.hints === 1 ? ' hint' : ' hints') : '';
    el.undo.disabled = game.solved || game.stack.length === 0;
    el.hint.disabled = game.solved;
  }

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
    animateTurn(board, c, s0, s1, duration, function () {
      busy = false;
      if (done) done();
    });
  }

  // ---------- input ----------
  // Lets the player drag circles on any Board. opts:
  //   locked(): true while the board should ignore touches
  //   onGrab(): a circle was picked up
  //   onRelease(c, s, target): finger lifted after turning circle c by s steps (target = nearest whole step)
  function attachDrag(b, opts) {
    var cv = b.canvas, drag = null;
    function pointerPos(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function nearCircles(sp) {
      var w = b.toWorld(sp.x, sp.y);
      var tolPx = Math.max(24, b.pointR * 1.8);
      return b.puzzle.circles.map(function (c) {
        return { c: c, d: Math.abs(Math.hypot(w.x - c.cx, w.y - c.cy) - c.r) * b.scale };
      }).filter(function (x) { return x.d <= tolPx; }).map(function (x) { x.tol = tolPx; return x; });
    }
    function angleAround(c, sp) {
      var w = b.toWorld(sp.x, sp.y);
      return Math.atan2(w.y - c.cy, w.x - c.cx);
    }
    function lockCircle(c) {
      drag.c = c.id;
      drag.prevA = angleAround(c, drag.start);
      drag.total = 0;
      b.turn = { c: c.id, s: 0 };
      cv.classList.add('dragging');
      if (opts.onGrab) opts.onGrab();
      b.draw();
    }
    cv.addEventListener('pointerdown', function (e) {
      if (opts.locked() || drag) return;
      var sp = pointerPos(e);
      var cands = nearCircles(sp);
      if (!cands.length) return;
      cv.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, start: sp, cands: cands, c: null };
      // Only one candidate (or concentric ones, which share a center): pick the closest right away.
      var centers = {};
      cands.forEach(function (x) { centers[x.c.center] = true; });
      if (Object.keys(centers).length === 1) lockCircle(cands.reduce(function (a, z) { return a.d <= z.d ? a : z; }).c);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var sp = pointerPos(e);
      if (drag.c === null) {
        var dx = sp.x - drag.start.x, dy = sp.y - drag.start.y, dist = Math.hypot(dx, dy);
        if (dist < 7) return;
        // Pick the circle whose direction best matches the drag (screen coords: y down).
        var best = null, bestScore = -Infinity;
        drag.cands.forEach(function (x) {
          var c = x.c, ctr = b.toScreen(c.cx, c.cy);
          var rx = drag.start.x - ctr.x, ry = drag.start.y - ctr.y, rl = Math.hypot(rx, ry) || 1;
          var tx = -ry / rl, ty = rx / rl;
          var align = Math.abs((dx * tx + dy * ty) / dist);
          var score = align - 0.8 * (x.d / x.tol);
          if (score > bestScore) { bestScore = score; best = c; }
        });
        lockCircle(best);
      }
      var c = b.puzzle.circles[drag.c];
      var a = angleAround(c, sp);
      var da = a - drag.prevA;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      drag.total += da;
      drag.prevA = a;
      var s = (DRAG_SPEED * drag.total * c.slots.length) / (Math.PI * 2);
      if (Math.round(s) !== Math.round(b.turn.s) && navigator.vibrate) { try { navigator.vibrate(6); } catch (err) {} }
      b.turn.s = s;
      b.draw();
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      cv.classList.remove('dragging');
      if (d.c === null) return;
      var s = b.turn ? b.turn.s : 0;
      opts.onRelease(d.c, s, Math.round(s));
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
  }

  // Animate circle c on board b from s0 to s1 steps.
  function animateTurn(b, c, s0, s1, duration, done) {
    b.turn = { c: c, s: s0 };
    animate(duration, function (t) {
      b.turn.s = s0 + (s1 - s0) * easeOut(t);
      b.draw();
    }, function () {
      b.turn = null;
      if (done) done();
      b.draw();
    });
  }
  function snapDuration(s, target) { return 180 + Math.min(240, Math.abs(target - s) * 200); }

  attachDrag(board, {
    locked: function () { return busy || game.solved; },
    onGrab: markStarted,
    onRelease: function (c, s, target) {
      playTurn(c, s, target, snapDuration(s, target), function () { commitMove(c, target); });
    }
  });

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

  var hintPending = false;
  el.hint.addEventListener('click', function () {
    if (busy || game.solved || hintPending) return;
    hintPending = true;
    getSolution(function (sol) {
      hintPending = false;
      if (busy || game.solved) return;
      // Plans toward the shortest solution: exact when 4 or fewer moves remain,
      // otherwise back along the player's own moves and onto the shortest route.
      var h = E.hint(puzzle, state, {
        stack: game.stack,
        scramble: day.scramble,
        solution: sol.optimal ? sol.moves : null
      });
      if (!h) return;
      markStarted();
      game.hints += 1;
      save();
      renderStatus();
      board.hintMove = { c: h.c, k: h.k };
      toast('+' + HINT_COST + ' moves' + (h.exact ? ' · ' + (h.remaining === 1 ? 'one move to go' : h.remaining + ' moves to go') : ''), 1400);
      // nudge the circle in the right direction so it is easy to spot
      var dir = h.k > 0 ? 1 : -1;
      playTurn(h.c, 0, dir * 0.3, 180, function () {
        playTurn(h.c, dir * 0.3, 0, 220);
      });
      board.draw();
    });
  });

  // Warm up hint data while the player looks at the board.
  setTimeout(function () {
    if (game.solved) return;
    getSolution(function () {});
    try { E.solveShort(puzzle, puzzle.solvedState); } catch (e) {}
  }, 1200);

  // ---------- winning ----------
  function win() {
    markStarted(); // records the game as played (normally done by the first drag)
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
    if (counts()) submitScore();
    if (window.gtag && !practice) gtag('event', 'venn_solved', { puzzle: puzzleNumber(playDate), moves: score(game), hints: game.hints });
  }
  function winMessage() {
    var extra = score(game) - day.scramble.length;
    if (game.hints > 0) return 'Nice work';
    if (extra <= 0) return 'Genius';
    if (extra <= 2) return 'Magnificent';
    if (extra <= 5) return 'Impressive';
    if (extra <= 10) return 'Splendid';
    return 'Great';
  }
  var ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>';
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
    if (practice) {
      add(freeLevel ? 'New puzzle' : 'Play again', 'primary', playAgain);
      add(ICON_PLAY + 'Solution', '', watchSolution, 'solution-btn');
      add('Today', '', function () { location.href = location.pathname; });
      return;
    }
    add('Stats', 'primary', function () { openModal('stats'); });
    add(ICON_PLAY + 'Solution', '', watchSolution, 'solution-btn');
    add('Share', '', share);
  }
  function playAgain() {
    location.href = location.pathname + (freeLevel ? '?free=' + freeLevel : '?replay=' + playDate);
  }

  // ---------- optimal solution replay ----------
  var solutionCache = null;
  // Calls back with { moves: [{c,k}], optimal: bool }. Uses the precomputed shortest
  // solution when it matches this puzzle, otherwise unwinds the scramble.
  function getSolution(cb) {
    if (solutionCache) { cb(solutionCache); return; }
    function fallback() {
      var exact = E.solveShort(puzzle, day.start);
      if (exact) { solutionCache = { moves: exact, optimal: true }; cb(solutionCache); return; }
      var plan = E.reduceMoves(puzzle, day.scramble);
      var moves = plan.slice().reverse().map(function (m) { return { c: m.c, k: E.shortest(puzzle, m.c, -m.k) }; });
      solutionCache = { moves: moves, optimal: false };
      cb(solutionCache);
    }
    if (!window.fetch || freeLevel) { fallback(); return; }
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
      '🔄 ' + movesText(score(game)) + ' · 💡 ' + game.hints + (game.hints === 1 ? ' hint' : ' hints') +
        (globalStats && globalStats.players > 1 ? ' · ' + beatText(globalStats, score(game)) : ''),
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
    if (id === 'settings') syncSettings();
    document.getElementById(id).classList.add('open');
    openId = id;
    if (id === 'help') startTutorial(1); // after opening, so the board can measure its space
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

  // ---------- interactive tutorial (in How To Play) ----------
  // Round 1: one quarter turn, with an arrow showing what to do.
  // Round 2 (optional): two turns, arrow only on request.
  var tut = { round: 1, state: null, busy: false, solved: false, showArrow: true };
  var tutPuzzle = E.buildPuzzle(E.LAYOUTS[2]);
  function tutMsg(text) { document.getElementById('tut-msg').textContent = text; }
  function tutActions(buttons) {
    var box = document.getElementById('tut-actions');
    box.innerHTML = '';
    buttons.forEach(function (b) {
      var el2 = document.createElement('button');
      el2.className = 'btn' + (b.primary ? ' primary' : '');
      el2.textContent = b.label;
      el2.addEventListener('click', b.onClick);
      box.appendChild(el2);
    });
  }
  function tutArrow() {
    var h = tut.showArrow ? E.hint(tutPuzzle, tut.state, { stack: tut.stack, scramble: tut.scramble }) : null;
    demo.hintMove = h ? { c: h.c, k: h.k } : null;
  }
  function startTutorial(round) {
    var canvasEl = document.getElementById('tut-board');
    if (!demo) {
      demo = new Board(canvasEl, tutPuzzle);
      attachDrag(demo, {
        locked: function () { return tut.busy || tut.solved; },
        onRelease: function (c, s, target) {
          tut.busy = true;
          animateTurn(demo, c, s, target, snapDuration(s, target), function () {
            tut.busy = false;
            if (E.shortest(tutPuzzle, c, target) === 0) return;
            tut.state = E.applyMove(tutPuzzle, tut.state, c, target);
            tut.stack.push({ c: c, k: E.shortest(tutPuzzle, c, target) });
            demo.state = tut.state;
            if (E.isSolved(tutPuzzle, tut.state)) return tutorialSolved();
            tutArrow();
            tutMsg(tut.showArrow ? 'Keep going: follow the arrow.' : 'Keep going!');
          });
        }
      });
    }
    var w = Math.min(300, (canvasEl.parentElement.clientWidth || 280) - 16);
    demo.resize(w, Math.round(w * 0.86));
    tut.round = round;
    tut.solved = false;
    tut.busy = false;
    tut.stack = [];
    if (round === 1) {
      // Outer circle of the bottom center, one quarter turn.
      tut.scramble = [{ c: 1, k: 2 }];
      tut.state = E.applyMoves(tutPuzzle, tutPuzzle.solvedState.slice(), tut.scramble);
      tut.showArrow = true;
      tutMsg('Try it: drag the highlighted circle the way the arrow points.');
      tutActions([]);
    } else {
      var s2, n = 0;
      do {
        s2 = E.scramble(tutPuzzle, 2, 'tutorial:' + Date.now() + ':' + n++, 2);
      } while (n < 20 && (E.solveShort(tutPuzzle, s2.state) || []).length !== 2);
      tut.scramble = s2.moves;
      tut.state = s2.state;
      tut.showArrow = false;
      tutMsg('Two turns this time. You\'ve got it.');
      tutActions([{ label: 'Show me', onClick: function () { tut.showArrow = true; tutArrow(); demo.draw(); } }]);
    }
    demo.state = tut.state;
    tutArrow();
    demo.draw();
  }
  function tutorialSolved() {
    tut.solved = true;
    demo.hintMove = null;
    tut.busy = true;
    animate(900, function (t) { demo.pulse = t; demo.draw(); }, function () {
      demo.pulse = 0; tut.busy = false; demo.draw();
    });
    tutMsg(tut.round === 1 ? 'Solved! Every cluster is one color.' : 'Nice! You\'re ready.');
    var play = { label: game.solved ? 'Close' : 'Play today\'s puzzle', primary: true, onClick: closeModal };
    tutActions(tut.round === 1
      ? [{ label: 'Try a harder one', onClick: function () { startTutorial(2); } }, play]
      : [{ label: 'Again', onClick: function () { startTutorial(2); } }, play]);
  }

  // ---------- everyone's results today (anonymous) ----------
  // Only today's daily puzzle, played on its own day, is sent and compared.
  function counts() { return !practice && !isArchive && game.solved && game.daily && game.solvedOn === playDate; }
  var globalStats = null;  // { players, counts: { moves: number of players } }
  var globalState = 'loading';

  function playerId() {
    if (!store.settings.pid) {
      var id = '';
      if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
      else for (var i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
      store.settings.pid = id;
      save();
    }
    return store.settings.pid;
  }
  function gotGlobal(data) {
    if (!data || typeof data.players !== 'number' || !data.counts) throw new Error('bad data');
    globalStats = data;
    globalState = 'ok';
    renderGlobal();
  }
  function globalFailed() {
    globalState = 'error';
    renderGlobal();
  }
  var submitting = false;
  function submitScore() {
    if (!window.fetch) return globalFailed();
    if (submitting) return; // the result will render when the first request finishes
    submitting = true;
    fetch(SCORES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: playDate,
        playerId: playerId(),
        stack: game.stack.map(function (m) { return [m.c, m.k]; }),
        hints: game.hints
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      game.submitted = true; // accepted now or earlier (the server keeps one score per player per day)
      save();
      gotGlobal(data.stats);
    }).catch(globalFailed).then(function () { submitting = false; });
  }
  function fetchGlobal() {
    if (!window.fetch) return globalFailed();
    fetch(SCORES_URL + '?date=' + playDate).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) { gotGlobal(data.stats); }).catch(globalFailed);
  }
  // Share of other players who needed more moves.
  function beatPct(stats, mine) {
    var more = 0;
    Object.keys(stats.counts).forEach(function (k) { if (Number(k) > mine) more += stats.counts[k]; });
    return stats.players > 1 ? Math.round((more / (stats.players - 1)) * 100) : 0;
  }
  function beatText(stats, mine) { return 'beat ' + beatPct(stats, mine) + '% of players'; }

  // Bar per move count (Wordle-style), with the player's own row highlighted.
  function renderGlobal() {
    var box = document.getElementById('global');
    if (!box) return;
    if (globalState === 'error') { box.innerHTML = ''; return; }
    if (globalState === 'loading' || !globalStats) {
      box.innerHTML = '<h2 class="sub">Everyone today</h2><p class="global-note">Loading…</p>';
      return;
    }
    var mine = score(game), st = globalStats;
    var keys = Object.keys(st.counts).map(Number).filter(function (k) { return st.counts[k] > 0; });
    if (keys.indexOf(mine) < 0) keys.push(mine);
    keys.sort(function (a, b) { return a - b; });
    // Keep the chart short: everything past 12 rows joins the last row.
    var rows = [], MAX_ROWS = 12;
    keys.forEach(function (k) { rows.push({ label: String(k), from: k, to: k, n: st.counts[k] || 0 }); });
    if (rows.length > MAX_ROWS) {
      var tail = rows.splice(MAX_ROWS - 1);
      rows.push({ label: tail[0].from + '+', from: tail[0].from, to: Infinity, n: tail.reduce(function (a, r) { return a + r.n; }, 0) });
    }
    var maxN = Math.max.apply(null, rows.map(function (r) { return r.n; })) || 1;
    var note = st.players <= 1
      ? 'You\'re the first to finish today!'
      : 'You ' + beatText(st, mine) + ' (' + st.players + ' played today).';
    box.innerHTML = '<h2 class="sub">Everyone today</h2>' +
      '<div class="dist global-dist">' + rows.map(function (r) {
        var you = mine >= r.from && mine <= r.to;
        var pct = Math.max(r.n ? 8 : 0, Math.round((r.n / maxN) * 100));
        return '<div class="dist-label">' + r.label + '</div>' +
          '<div class="dist-track"><div class="bar' + (you ? ' today' : '') + '" style="width:' + pct + '%">' + r.n + '</div></div>' +
          '<div class="dist-count">' + (you ? 'you' : '') + '</div>';
      }).join('') + '</div>' +
      '<p class="global-note">' + note + ' Moves include +' + HINT_COST + ' per hint.</p>';
  }

  // ---------- stats ----------
  function computeStats() {
    var now = today();
    var dates = Object.keys(store.games).filter(function (d) {
      var g = store.games[d];
      return g.daily && (g.solved || d < now);
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
    var byLevel = {};
    LEVELS.forEach(function (l) { byLevel[l] = []; });
    solvedDates.forEach(function (x) {
      byLevel[E.configFor(x).label].push(score(store.games[x]));
    });
    function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
    return {
      played: played,
      solvedPct: played ? Math.round((solvedDates.length / played) * 100) : 0,
      streak: cur,
      maxStreak: max,
      byLevel: LEVELS.map(function (l) { return { label: l, avg: avg(byLevel[l]), count: byLevel[l].length }; })
    };
  }

  function fmtAvg(v) { return (Math.round(v * 10) / 10).toString(); }
  function statHtml(num, lbl) { return '<div class="stat"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>'; }

  function renderStats() {
    var s = computeStats();
    document.getElementById('stats-row').innerHTML =
      statHtml(s.played, 'Played') + statHtml(s.solvedPct, 'Solved %') + statHtml(s.streak, 'Streak') +
      statHtml(s.maxStreak, 'Max Streak');
    var maxAvg = Math.max.apply(null, s.byLevel.map(function (x) { return x.avg || 0; })) || 1;
    document.getElementById('stats-dist').innerHTML = s.byLevel.map(function (x) {
      var pct = x.avg ? Math.max(12, Math.round((x.avg / maxAvg) * 100)) : 0;
      var cls = 'bar' + (x.label === day.config.label && game.solved && !isArchive ? ' today' : '');
      return '<div class="dist-label">' + x.label + '</div>' +
        '<div class="dist-track"><div class="' + cls + '"' + (x.avg ? ' style="width:' + pct + '%"' : '') + '>' + (x.avg ? fmtAvg(x.avg) : '–') + '</div></div>' +
        '<div class="dist-count">' + (x.count ? x.count + ' solved' : '') + '</div>';
    }).join('');

    var result = document.getElementById('stats-result');
    if (game.solved) {
      result.innerHTML = '<div class="result">' +
        '<div class="result-title">Solved · ' + (freeLevel ? 'Free play' : 'Venn ' + numberLabel(playDate)) + ' · ' + day.config.label + '</div>' +
        '<div class="result-score">' + score(game) + '<span>' + (score(game) === 1 ? 'move' : 'moves') + '</span></div>' +
        '<div class="result-meta">' + game.hints + (game.hints === 1 ? ' hint' : ' hints') +
          (game.hints ? ' (+' + HINT_COST * game.hints + ')' : '') + '<span id="optimal-line"></span></div>' +
        (practice ? '<div class="result-note">Practice games don\'t count toward your stats.</div>'
          : isArchive ? '<div class="result-note">Past puzzles don\'t count toward your stats.</div>' : '') +
        '<div class="result-actions">' +
          '<button class="btn" id="watch-btn">' + ICON_PLAY + 'Solution</button>' +
          (practice ? '<button class="btn primary" id="again-btn">' + (freeLevel ? 'New puzzle' : 'Play again') + '</button>'
            : '<button class="btn primary" id="share-btn">Share ' + ICON_SHARE + '</button>') +
        '</div>' +
        (isArchive ? '' : '<div class="result-next">Next Venn in <span id="countdown"></span></div>') +
        (practice ? '' : '<div class="result-next"><a href="?replay=' + playDate + '">Play it again</a> (practice)</div>') +
        '</div>' +
        (counts() ? '<div id="global"></div>' : '');
      if (practice) document.getElementById('again-btn').addEventListener('click', playAgain);
      else document.getElementById('share-btn').addEventListener('click', share);
      document.getElementById('watch-btn').addEventListener('click', watchSolution);
      getSolution(function (sol) {
        var line = document.getElementById('optimal-line');
        if (!line || !sol.optimal) return;
        var n = sol.moves.length;
        line.textContent = score(game) <= n ? ' · fewest possible!' : ' · fewest possible: ' + n;
      });
      tickCountdown();
      if (counts()) {
        renderGlobal();
        if (game.submitted) fetchGlobal(); else submitScore();
      }
    } else {
      result.innerHTML = '';
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
    var free = '<div class="archive-month">Free play</div><p class="small" style="margin:2px 0 8px">Random puzzles for practice. They don\'t count.</p>' +
      '<div class="free-levels">' + LEVELS.map(function (l) {
        return '<a class="btn" href="' + location.pathname + '?free=' + l + '">' + l + '</a>';
      }).join('') + '</div>';
    if (puzzleNumber(todayStr) < 1) {
      var l = parseDate(LAUNCH);
      body.innerHTML = free + '<p class="small" style="text-align:center;margin-top:16px">Past puzzles will appear here once Venn #1 launches on ' +
        MONTHS[l.getMonth()] + ' ' + l.getDate() + '.</p>';
      return;
    }
    var html = free, month = null;
    for (var d = todayStr; puzzleNumber(d) >= 1; d = addDays(d, -1)) {
      var pd = parseDate(d), mk = MONTHS[pd.getMonth()] + ' ' + pd.getFullYear();
      if (mk !== month) { html += (month ? '</ul>' : '') + '<div class="archive-month">' + mk + '</div><ul class="archive-list">'; month = mk; }
      var g = store.games[d], label = E.configFor(d).label;
      var status = g && g.solved ? '<span class="status done">✓ ' + movesText(score(g)) + '</span>'
        : g && g.started ? '<span class="status">In progress</span>' : '<span class="status small">Play</span>';
      html += '<li><button data-date="' + d + '"><span><strong>#' + puzzleNumber(d) + '</strong> · ' + label +
        '<br><span class="when">' + (d === todayStr ? 'Today' : DAY_NAMES[pd.getDay()] + ', ' + MONTHS[pd.getMonth()].slice(0, 3) + ' ' + pd.getDate()) +
        '</span></span>' + status + '</button></li>';
    }
    body.innerHTML = html + '</ul>';
    body.querySelectorAll('button[data-date]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.getAttribute('data-date');
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
  }
  document.getElementById('set-dark').addEventListener('change', function (e) { setDark(e.target.checked); });
  document.getElementById('set-cb').addEventListener('change', function (e) {
    store.settings.colorblind = e.target.checked; save(); board.draw(); if (demo) demo.draw();
  });

  // ---------- lifecycle ----------
  window.addEventListener('pagehide', save);

  layout();
  renderStatus();
  if (game.solved) showSolvedControls();
  if (!store.settings.seenHelp) openModal('help');

  // exposed for debugging and automated checks
  window.Venn = { puzzle: puzzle, day: day, game: game, board: board, tutorialBoard: function () { return demo; }, getState: function () { return state; }, commitMove: commitMove };
})();
