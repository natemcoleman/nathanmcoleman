/*
 * Venn puzzle engine — pure logic, no DOM.
 *
 * A puzzle is generated from a handful of numbers:
 *   centers : number of circle centers, evenly spaced on a unit ring (3 = the classic layout)
 *   radii   : radius of each concentric circle around every center (unit = center distance from origin)
 *
 * Slots (where points can sit) are every crossing between circles that belong to
 * different centers. A face is the cluster of slots where one pair of centers'
 * circles cross on one side of the line joining those centers, so 3 centers
 * give 6 faces. With N radii per center each face has N*N points, mirroring an
 * NxNxN cube (1 ring = 6 points, 2 rings = 24, 3 rings = 54).
 *
 * Turning a circle by k steps moves every point on it k slots along the circle.
 *
 * Works in the browser (window.VennEngine) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var EPS = 1e-6;

  // ---------- geometry ----------

  function circleIntersections(c1, r1, c2, r2) {
    var dx = c2.x - c1.x, dy = c2.y - c1.y;
    var d = Math.hypot(dx, dy);
    if (d < EPS || d > r1 + r2 - EPS || d < Math.abs(r1 - r2) + EPS) return [];
    var a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    var mx = c1.x + (a * dx) / d, my = c1.y + (a * dy) / d;
    return [
      { x: mx + (h * dy) / d, y: my - (h * dx) / d },
      { x: mx - (h * dy) / d, y: my + (h * dx) / d }
    ];
  }

  function normAngle(a) {
    a %= TAU;
    return a < 0 ? a + TAU : a;
  }

  /**
   * Build a puzzle from its definition. Coordinates are math-style (y up).
   * def: { centers: 3, radii: [1.6, 1.93] }
   */
  function buildPuzzle(def) {
    var n = def.centers || 3;
    var radii = def.radii;
    var centers = [];
    for (var k = 0; k < n; k++) {
      var t = -Math.PI / 2 + (TAU * k) / n; // first center straight down
      centers.push({ x: Math.cos(t), y: Math.sin(t) });
    }

    var circles = [];
    centers.forEach(function (c, ci) {
      radii.forEach(function (r, ri) {
        circles.push({ id: circles.length, center: ci, ring: ri, cx: c.x, cy: c.y, r: r, slots: [] });
      });
    });

    // Slots: crossings between circles of different centers (merged if coincident).
    var slots = [];
    function addSlot(p, ca, cb) {
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (Math.hypot(s.x - p.x, s.y - p.y) < 1e-4) {
          if (s.circles.indexOf(ca.id) < 0) s.circles.push(ca.id);
          if (s.circles.indexOf(cb.id) < 0) s.circles.push(cb.id);
          return;
        }
      }
      slots.push({ id: slots.length, x: p.x, y: p.y, circles: [ca.id, cb.id], pair: [ca.center, cb.center] });
    }
    for (var i = 0; i < circles.length; i++) {
      for (var j = i + 1; j < circles.length; j++) {
        var A = circles[i], B = circles[j];
        if (A.center === B.center) continue;
        circleIntersections({ x: A.cx, y: A.cy }, A.r, { x: B.cx, y: B.cy }, B.r).forEach(function (p) {
          addSlot(p, A, B);
        });
      }
    }

    // Faces: (center pair, side of the line between the two centers).
    var faceKeys = {};
    var faces = [];
    slots.forEach(function (s) {
      var a = Math.min(s.pair[0], s.pair[1]), b = Math.max(s.pair[0], s.pair[1]);
      var ca = centers[a], cb = centers[b];
      var cross = (cb.x - ca.x) * (s.y - ca.y) - (cb.y - ca.y) * (s.x - ca.x);
      var key = a + ':' + b + ':' + (cross > 0 ? 1 : 0);
      if (!(key in faceKeys)) {
        faceKeys[key] = faces.length;
        faces.push({ id: faces.length, key: key, slots: [] });
      }
      s.face = faceKeys[key];
      faces[s.face].slots.push(s.id);
    });

    // Order faces by angle of their centroid (from the top, clockwise on screen),
    // so colors are assigned in a stable, pleasant order.
    faces.forEach(function (f) {
      var x = 0, y = 0;
      f.slots.forEach(function (id) { x += slots[id].x; y += slots[id].y; });
      f.cx = x / f.slots.length; f.cy = y / f.slots.length;
      f.order = normAngle(Math.PI / 2 - Math.atan2(f.cy, f.cx));
    });
    var sortedFaces = faces.slice().sort(function (a, b) { return a.order - b.order; });
    sortedFaces.forEach(function (f, idx) { f.color = idx; });

    // Each circle's slots in angular order (counter-clockwise in math coords).
    slots.forEach(function (s) {
      s.circles.forEach(function (cid) { circles[cid].slots.push(s.id); });
    });
    circles.forEach(function (c) {
      c.angles = {};
      c.slots.forEach(function (sid) {
        c.angles[sid] = normAngle(Math.atan2(slots[sid].y - c.cy, slots[sid].x - c.cx));
      });
      c.slots.sort(function (a, b) { return c.angles[a] - c.angles[b]; });
      c.slotAngles = c.slots.map(function (sid) { return c.angles[sid]; });
      delete c.angles;
    });

    // Circles that share no slots commute (e.g. concentric rings).
    var commute = circles.map(function (a) {
      return circles.map(function (b) {
        if (a.id === b.id) return false;
        return !a.slots.some(function (s) { return b.slots.indexOf(s) >= 0; });
      });
    });

    var solved = slots.map(function (s) { return faces[s.face].color; });

    return {
      def: def,
      centers: centers,
      circles: circles,
      slots: slots,
      faces: faces,
      commute: commute,
      solvedState: solved,
      colorCount: faces.length
    };
  }

  // ---------- moves ----------

  function mod(a, m) { return ((a % m) + m) % m; }

  /** Turn circle `cid` by k steps (positive = counter-clockwise in math coords). Returns new state. */
  function applyMove(puzzle, state, cid, k) {
    var L = puzzle.circles[cid].slots, m = L.length;
    k = mod(k, m);
    if (k === 0) return state.slice();
    var next = state.slice();
    for (var i = 0; i < m; i++) next[L[(i + k) % m]] = state[L[i]];
    return next;
  }

  function applyMoves(puzzle, state, moves) {
    moves.forEach(function (mv) { state = applyMove(puzzle, state, mv.c, mv.k); });
    return state;
  }

  /** Normalize k to the shortest equivalent turn, e.g. +11 of 12 -> -1. */
  function shortest(puzzle, cid, k) {
    var m = puzzle.circles[cid].slots.length;
    k = mod(k, m);
    return k > m / 2 ? k - m : k;
  }

  /**
   * Push a move onto a move list, merging it with an earlier move on the same
   * circle when only commuting moves sit between them. Returns a new list.
   */
  function pushReduced(puzzle, list, mv) {
    var out = list.slice();
    for (var i = out.length - 1; i >= 0; i--) {
      var prev = out[i];
      if (prev.c === mv.c) {
        var k = shortest(puzzle, mv.c, prev.k + mv.k);
        if (k === 0) out.splice(i, 1);
        else out[i] = { c: mv.c, k: k };
        return out;
      }
      if (!puzzle.commute[prev.c][mv.c]) break;
    }
    out.push({ c: mv.c, k: shortest(puzzle, mv.c, mv.k) });
    return out;
  }

  function reduceMoves(puzzle, moves) {
    return moves.reduce(function (acc, mv) { return pushReduced(puzzle, acc, mv); }, []);
  }

  function isSolved(puzzle, state) {
    return puzzle.faces.every(function (f) {
      var c = state[f.slots[0]];
      return f.slots.every(function (s) { return state[s] === c; });
    });
  }

  /** Number of points not matching the most common color of their face (0 when solved). */
  function misplaced(puzzle, state) {
    var total = 0;
    puzzle.faces.forEach(function (f) {
      var counts = {}, best = 0;
      f.slots.forEach(function (s) {
        counts[state[s]] = (counts[state[s]] || 0) + 1;
        if (counts[state[s]] > best) best = counts[state[s]];
      });
      total += f.slots.length - best;
    });
    return total;
  }

  // ---------- randomness ----------

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Deterministic scramble of `length` irreducible moves.
   * step: turn sizes are multiples of this many slots (rings count = a cube quarter turn).
   */
  function scramble(puzzle, length, seedString, step) {
    var rand = mulberry32(hashString(seedString));
    step = step || 1;
    var moves = [];
    var guard = 0;
    while (moves.length < length && guard++ < 1000) {
      var c = Math.floor(rand() * puzzle.circles.length);
      var m = puzzle.circles[c].slots.length;
      var options = [];
      for (var k = step; k < m; k += step) options.push(k);
      var k2 = shortest(puzzle, c, options[Math.floor(rand() * options.length)]);
      var next = pushReduced(puzzle, moves, { c: c, k: k2 });
      if (next.length === moves.length + 1) moves = next;
    }
    var state = applyMoves(puzzle, puzzle.solvedState.slice(), moves);
    return { moves: moves, state: state };
  }

  // ---------- hints ----------

  /**
   * Best next move. Tries a short exhaustive search for an actual solution first,
   * otherwise unwinds the known history (scramble + player moves).
   * history: every move applied since the solved state, in order.
   */
  function hint(puzzle, state, history, opts) {
    opts = opts || {};
    if (isSolved(puzzle, state)) return null;
    var plan = reduceMoves(puzzle, history);
    var fallback = null;
    if (plan.length) {
      var last = plan[plan.length - 1];
      fallback = { c: last.c, k: shortest(puzzle, last.c, -last.k), remaining: plan.length };
    }
    var budget = opts.nodeBudget || 400000;
    var maxDepth = Math.min(opts.maxDepth || 4, plan.length ? plan.length - 1 : 4);
    var found = searchSolution(puzzle, state, maxDepth, budget);
    if (found && found.length) {
      return { c: found[0].c, k: found[0].k, remaining: found.length };
    }
    return fallback;
  }

  // Iterative-deepening DFS for a solution of at most maxDepth moves.
  function searchSolution(puzzle, state, maxDepth, budget) {
    var nodes = 0;
    var path = [];
    var moveList = [];
    puzzle.circles.forEach(function (c) {
      for (var k = 1; k < c.slots.length; k++) moveList.push({ c: c.id, k: shortest(puzzle, c.id, k) });
    });
    function dfs(s, depth, lastC) {
      if (isSolved(puzzle, s)) return true;
      if (depth === 0) return false;
      for (var i = 0; i < moveList.length; i++) {
        var mv = moveList[i];
        if (mv.c === lastC) continue;
        // canonical order for commuting neighbours
        if (lastC >= 0 && puzzle.commute[lastC][mv.c] && mv.c < lastC) continue;
        if (++nodes > budget) return false;
        path.push(mv);
        if (dfs(applyMove(puzzle, s, mv.c, mv.k), depth - 1, mv.c)) return true;
        path.pop();
      }
      return false;
    }
    for (var d = 1; d <= maxDepth; d++) {
      path = [];
      if (dfs(state, d, -1)) return path;
      if (nodes > budget) break;
    }
    return null;
  }

  // ---------- daily schedule ----------

  /** Layout presets, keyed by number of rings. Add new ones here. */
  var LAYOUTS = {
    1: { centers: 3, radii: [1.75] },
    2: { centers: 3, radii: [1.25, 1.8] },
    3: { centers: 3, radii: [1.15, 1.53, 1.91] }
  };

  /**
   * Difficulty by weekday (0 = Sunday), easy Monday -> hardest Sunday.
   * rings: layout preset; moves: scramble length; step: turn size in slots
   * (null = one quarter turn, i.e. the number of rings).
   */
  var SCHEDULE = {
    1: { label: 'Easy', rings: 2, moves: 2 },
    2: { label: 'Easy', rings: 2, moves: 3 },
    3: { label: 'Medium', rings: 2, moves: 4 },
    4: { label: 'Medium', rings: 3, moves: 3 },
    5: { label: 'Hard', rings: 3, moves: 4 },
    6: { label: 'Hard', rings: 3, moves: 5 },
    0: { label: 'Expert', rings: 3, moves: 6 }
  };

  /** dateStr: 'YYYY-MM-DD' (local date). */
  function dailyPuzzle(dateStr) {
    var parts = dateStr.split('-').map(Number);
    var weekday = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    var cfg = SCHEDULE[weekday];
    var def = LAYOUTS[cfg.rings];
    var puzzle = buildPuzzle(def);
    // Reject scrambles that happen to land solved or that have a noticeably shorter solution.
    var s, attempt = 0;
    do {
      s = scramble(puzzle, cfg.moves, 'venn:' + dateStr + (attempt ? ':' + attempt : ''), cfg.step || cfg.rings);
      attempt++;
    } while (attempt < 50 && (isSolved(puzzle, s.state) ||
      searchSolution(puzzle, s.state, Math.min(cfg.moves - 1, 2), 200000)));
    return { date: dateStr, weekday: weekday, config: cfg, puzzle: puzzle, scramble: s.moves, start: s.state };
  }

  var api = {
    buildPuzzle: buildPuzzle,
    applyMove: applyMove,
    applyMoves: applyMoves,
    shortest: shortest,
    pushReduced: pushReduced,
    reduceMoves: reduceMoves,
    isSolved: isSolved,
    misplaced: misplaced,
    scramble: scramble,
    hint: hint,
    searchSolution: searchSolution,
    dailyPuzzle: dailyPuzzle,
    hashString: hashString,
    mulberry32: mulberry32,
    LAYOUTS: LAYOUTS,
    SCHEDULE: SCHEDULE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VennEngine = api;
})(typeof self !== 'undefined' ? self : this);
