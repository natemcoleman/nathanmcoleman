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

test('daily puzzles are deterministic, scrambled, and solvable by following hints', () => {
  const start = new Date(2026, 9, 14);
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dateStr(d);
    const a = E.dailyPuzzle(ds), b = E.dailyPuzzle(ds);
    assert.deepStrictEqual(a.start, b.start);
    assert.strictEqual(a.scramble.length, a.config.moves);
    assert.ok(!E.isSolved(a.puzzle, a.start), ds + ' should start scrambled');

    let state = a.start, history = a.scramble.slice(), steps = 0;
    while (!E.isSolved(a.puzzle, state)) {
      const h = E.hint(a.puzzle, state, history, { nodeBudget: 50000 });
      assert.ok(h, 'hint available');
      state = E.applyMove(a.puzzle, state, h.c, h.k);
      history.push({ c: h.c, k: h.k });
      assert.ok(++steps <= a.config.moves, ds + ' solved within scramble length');
    }
  }
});

test('hints still work after the player wanders off', () => {
  const day = E.dailyPuzzle('2026-10-18');
  const p = day.puzzle;
  let state = day.start, history = day.scramble.slice();
  const wander = [{ c: 2, k: 1 }, { c: 5, k: -2 }, { c: 7, k: 3 }];
  wander.forEach((m) => { state = E.applyMove(p, state, m.c, m.k); history.push(m); });
  let steps = 0;
  while (!E.isSolved(p, state)) {
    const h = E.hint(p, state, history, { nodeBudget: 50000 });
    state = E.applyMove(p, state, h.c, h.k);
    history.push({ c: h.c, k: h.k });
    assert.ok(++steps <= day.scramble.length + wander.length);
  }
});
