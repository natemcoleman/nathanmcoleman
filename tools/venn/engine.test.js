// Run with: node --test tools/venn/engine.test.js
const test = require('node:test');
const assert = require('node:assert');
const E = require('../../static/venn/engine.js');

function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

test('layouts produce cube-like counts', () => {
  for (const [rings, def] of Object.entries(E.LAYOUTS)) {
    const N = Number(rings);
    const p = E.buildPuzzle(def);
    assert.strictEqual(p.slots.length, 6 * N * N, 'slots for ' + N);
    assert.strictEqual(p.faces.length, 6);
    p.faces.forEach((f) => assert.strictEqual(f.slots.length, N * N));
    p.circles.forEach((c) => assert.strictEqual(c.slots.length, 4 * N));
    p.slots.forEach((s) => assert.strictEqual(s.circles.length, 2));
    assert.ok(E.isSolved(p, p.solvedState));
  }
});

test('a move and its inverse cancel; full turn is identity', () => {
  const p = E.buildPuzzle(E.LAYOUTS[3]);
  p.circles.forEach((c) => {
    for (let k = 1; k < c.slots.length; k++) {
      const s = E.applyMove(p, p.solvedState, c.id, k);
      assert.deepStrictEqual(E.applyMove(p, s, c.id, -k), p.solvedState);
    }
    assert.deepStrictEqual(E.applyMove(p, p.solvedState, c.id, c.slots.length), p.solvedState);
  });
});

test('move reduction merges across commuting moves', () => {
  const p = E.buildPuzzle(E.LAYOUTS[2]);
  // circles 0 and 1 share a center (concentric) so they commute
  assert.ok(p.commute[0][1]);
  const r = E.reduceMoves(p, [{ c: 0, k: 2 }, { c: 1, k: 1 }, { c: 0, k: -2 }]);
  assert.deepStrictEqual(r, [{ c: 1, k: 1 }]);
});

function loadSolution(ds) {
  const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../static/venn/solutions.json'), 'utf8'));
  return data.puzzles[ds].s.map(([c, k]) => ({ c, k }));
}

test('daily puzzles are deterministic and scrambled', () => {
  const start = new Date(2026, 9, 14);
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dateStr(d);
    const a = E.dailyPuzzle(ds), b = E.dailyPuzzle(ds);
    assert.deepStrictEqual(a.start, b.start);
    assert.strictEqual(a.scramble.length, a.config.moves);
    assert.ok(!E.isSolved(a.puzzle, a.start), ds + ' should start scrambled');
  }
});

test('following hints from the start solves in the fewest possible moves', () => {
  const start = new Date(2026, 9, 14);
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dateStr(d);
    const day = E.dailyPuzzle(ds);
    const solution = loadSolution(ds);
    let state = day.start, stack = [];
    while (!E.isSolved(day.puzzle, state)) {
      const h = E.hint(day.puzzle, state, { stack, scramble: day.scramble, solution });
      assert.ok(h, 'hint available');
      state = E.applyMove(day.puzzle, state, h.c, h.k);
      stack.push({ c: h.c, k: h.k });
      assert.ok(stack.length <= solution.length, ds + ': hints took more than the shortest ' + solution.length);
    }
    assert.strictEqual(stack.length, solution.length, ds);
  }
});

test('hints recover after the player wanders off', () => {
  for (const ds of ['2026-10-17', '2026-10-18', '2026-10-21']) {
    const day = E.dailyPuzzle(ds);
    const p = day.puzzle;
    const solution = loadSolution(ds);
    let state = day.start, stack = [];
    const wander = [{ c: 2, k: 1 }, { c: 5, k: -2 }, { c: 4, k: 3 }];
    wander.forEach((m) => { state = E.applyMove(p, state, m.c, m.k); stack.push(m); });
    let steps = 0;
    while (!E.isSolved(p, state)) {
      const h = E.hint(p, state, { stack, scramble: day.scramble, solution });
      state = E.applyMove(p, state, h.c, h.k);
      stack.push({ c: h.c, k: h.k });
      assert.ok(++steps <= solution.length + wander.length, ds);
    }
  }
});

test('hints work without the solutions file (scramble fallback)', () => {
  const day = E.dailyPuzzle('2026-10-18');
  let state = day.start, stack = [];
  while (!E.isSolved(day.puzzle, state)) {
    const h = E.hint(day.puzzle, state, { stack, scramble: day.scramble });
    state = E.applyMove(day.puzzle, state, h.c, h.k);
    stack.push({ c: h.c, k: h.k });
    assert.ok(stack.length <= day.scramble.length);
  }
});

test('short-range solver is exact', () => {
  const p = E.buildPuzzle(E.LAYOUTS[3]);
  // A 3-move scramble that has no shorter solution must come back as exactly 3 moves.
  const day = E.dailyPuzzle('2026-10-15');
  const sol = E.solveShort(day.puzzle, day.start);
  assert.strictEqual(sol.length, loadSolution('2026-10-15').length);
  assert.deepStrictEqual(E.solveShort(p, p.solvedState), []);
});

test('schedules are well formed', () => {
  let prev = '';
  E.SCHEDULES.forEach((era) => {
    assert.match(era.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(era.from > prev, 'schedules must be in date order');
    prev = era.from;
    for (let wd = 0; wd < 7; wd++) {
      const cfg = era.days[wd];
      assert.ok(cfg, era.from + ' is missing weekday ' + wd);
      assert.ok(E.LAYOUTS[cfg.layout], 'unknown layout ' + cfg.layout);
      assert.ok(cfg.moves >= 1 && cfg.moves <= 6, 'solve.js finds solutions up to 6 moves');
    }
  });
});

// ---- precomputed shortest solutions (static/venn/solutions.json) ----
const fs = require('fs');
const path = require('path');
const solFile = path.join(__dirname, '../../static/venn/solutions.json');

// Plain depth-limited search, independent of the solver: is there a solution in <= depth moves?
function existsWithin(p, state, depth, lastC) {
  if (E.isSolved(p, state)) return true;
  if (depth === 0) return false;
  for (const c of p.circles) {
    if (c.id === lastC) continue;
    for (let k = 1; k < c.slots.length; k++) {
      if (existsWithin(p, E.applyMove(p, state, c.id, k), depth - 1, c.id)) return true;
    }
  }
  return false;
}

test('solutions file covers every day through the next year and every solution works', () => {
  const data = JSON.parse(fs.readFileSync(solFile, 'utf8'));
  const start = new Date(2026, 9, 14);
  const end = new Date(); end.setDate(end.getDate() + 365);
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = dateStr(d);
    const entry = data.puzzles[ds];
    assert.ok(entry, 'missing solution for ' + ds + ' (run node tools/venn/solve.js)');
    const day = E.dailyPuzzle(ds);
    assert.strictEqual(entry.h, E.hashString(day.start.join(',')),
      ds + ' changed. If this date is in the past, a schedule or layout was edited instead of added; otherwise re-run solve.js');
    const moves = entry.s.map(([c, k]) => ({ c, k }));
    assert.ok(E.isSolved(day.puzzle, E.applyMoves(day.puzzle, day.start.slice(), moves)), 'solution fails for ' + ds);
    assert.ok(moves.length <= day.scramble.length);
    count++;
  }
  assert.ok(count >= 365, "expected at least a year of solutions");
});

test('solutions are the shortest possible (independent brute force check)', () => {
  const data = JSON.parse(fs.readFileSync(solFile, 'utf8'));
  const start = new Date(2026, 9, 14);
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dateStr(d);
    const day = E.dailyPuzzle(ds);
    const len = data.puzzles[ds].s.length;
    // 2-ring boards: check every shorter length; 3-ring boards: check up to 3 moves.
    const limit = day.rings === 2 ? len - 1 : Math.min(len - 1, 3);
    assert.ok(!existsWithin(day.puzzle, day.start, limit, -1), ds + ' has a solution shorter than ' + len);
  }
});

test('a new schedule only affects dates from its start', () => {
  const before = E.dailyPuzzle('2030-03-03').start;
  E.SCHEDULES.push({ from: '2030-03-04', days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { label: 'Test', layout: 1, moves: 2 }])) });
  try {
    assert.deepStrictEqual(E.dailyPuzzle('2030-03-03').start, before);
    assert.strictEqual(E.configFor('2030-03-04').label, 'Test');
    assert.strictEqual(E.dailyPuzzle('2030-03-04').rings, 1);
  } finally {
    E.SCHEDULES.pop();
  }
});
