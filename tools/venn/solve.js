#!/usr/bin/env node
/*
 * Precomputes the shortest solution for every daily Venn puzzle and writes
 * static/venn/solutions.json, which the game uses for "Watch solution".
 *
 *   node tools/venn/solve.js [firstDate] [lastDate]
 *
 * Results are merged into the existing file (dates in the range are replaced).
 *
 * Re-run this whenever LAYOUTS, SCHEDULES or the scramble code in engine.js
 * changes, or to extend the date range.
 *
 * Method: meet-in-the-middle breadth-first search. One move = turning one
 * circle by any number of steps (exactly what a player does with one drag).
 * "Solved" means every face is a single color, in any arrangement of colors,
 * so states are compared by which points share a color, not by the colors
 * themselves. That makes every solved state the same search goal.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../../static/venn/engine.js');

const BACK_DEPTH = 3;   // searched once per layout, from the goal
const FWD_DEPTH = 3;    // searched per puzzle, from its start
// Together they find any solution up to BACK_DEPTH + FWD_DEPTH moves, which
// covers every scramble length in the schedule.

function canonicalKey(state) {
  const map = new Map();
  let out = '';
  for (let i = 0; i < state.length; i++) {
    let v = map.get(state[i]);
    if (v === undefined) { v = map.size; map.set(state[i], v); }
    out += String.fromCharCode(48 + v);
  }
  return out;
}
function fromKey(key) {
  const a = new Array(key.length);
  for (let i = 0; i < key.length; i++) a[i] = key.charCodeAt(i) - 48;
  return a;
}

function allMoves(puzzle) {
  const moves = [];
  puzzle.circles.forEach((c) => {
    for (let k = 1; k < c.slots.length; k++) moves.push({ c: c.id, k: E.shortest(puzzle, c.id, k) });
  });
  return moves;
}

// BFS layers: Map key -> { d, parent, c, k } (parent key and the move that led here)
function bfs(puzzle, startState, depth, moves) {
  const startKey = canonicalKey(startState);
  const seen = new Map([[startKey, { d: 0, parent: null }]]);
  const layers = [[startKey]];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const key of layers[d - 1]) {
      const s = fromKey(key);
      const last = seen.get(key).c;
      for (const mv of moves) {
        if (mv.c === last) continue; // merging with the previous turn is never shorter
        const nk = canonicalKey(E.applyMove(puzzle, s, mv.c, mv.k));
        if (!seen.has(nk)) { seen.set(nk, { d: d, parent: key, c: mv.c, k: mv.k }); next.push(nk); }
      }
    }
    layers.push(next);
  }
  return { seen, layers };
}

function pathTo(seen, key) {
  const out = [];
  let node = seen.get(key);
  while (node.parent !== null) { out.push({ c: node.c, k: node.k }); key = node.parent; node = seen.get(key); }
  return out.reverse(); // moves from the BFS root to `key`
}

const backCache = new Map();
function backwardTable(puzzle, layoutId, moves) {
  if (!backCache.has(layoutId)) {
    const t0 = Date.now();
    backCache.set(layoutId, bfs(puzzle, puzzle.solvedState, BACK_DEPTH, moves).seen);
    console.error(`  goal table for layout ${layoutId}: ${backCache.get(layoutId).size} states in ${Date.now() - t0} ms`);
  }
  return backCache.get(layoutId);
}

function solveOptimal(puzzle, layoutId, start) {
  const moves = allMoves(puzzle);
  const back = backwardTable(puzzle, layoutId, moves);
  const startKey = canonicalKey(start);
  const fwd = new Map([[startKey, { d: 0, parent: null }]]);
  let layer = [startKey];
  for (let f = 0; f <= FWD_DEPTH; f++) {
    if (f > 0) {
      const next = [];
      for (const key of layer) {
        const s = fromKey(key);
        const last = fwd.get(key).c;
        for (const mv of moves) {
          if (mv.c === last) continue;
          const nk = canonicalKey(E.applyMove(puzzle, s, mv.c, mv.k));
          if (!fwd.has(nk)) { fwd.set(nk, { d: f, parent: key, c: mv.c, k: mv.k }); next.push(nk); }
        }
      }
      layer = next;
    }
    // Every solution of length <= f + BACK_DEPTH meets this layer or an earlier one,
    // so the first layer with any meeting point holds an optimal solution.
    let best = null;
    for (const key of layer) {
      const b = back.get(key);
      if (b && (!best || b.d < best.b)) best = { key, b: b.d };
    }
    if (best) {
      const first = pathTo(fwd, best.key);
      // goal -> meeting point, undone in reverse order
      const second = pathTo(back, best.key).reverse().map((m) => ({ c: m.c, k: E.shortest(puzzle, m.c, -m.k) }));
      return first.concat(second);
    }
  }
  return null;
}

function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function main() {
  const first = process.argv[2] || '2026-10-14';
  const last = process.argv[3] || '2028-12-31';
  const file = path.join(__dirname, '../../static/venn/solutions.json');
  // Merge into the existing file so a short date range can be added without redoing everything.
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { puzzles: {} };
  const out = { generated: new Date().toISOString(), first, last, puzzles: prev.puzzles || {} };
  const p = first.split('-').map(Number);
  const t0 = Date.now();
  for (let d = new Date(p[0], p[1] - 1, p[2]); dateStr(d) <= last; d.setDate(d.getDate() + 1)) {
    const ds = dateStr(d);
    const day = E.dailyPuzzle(ds);
    const sol = solveOptimal(day.puzzle, day.layout, day.start);
    if (!sol) throw new Error('No solution found within ' + (BACK_DEPTH + FWD_DEPTH) + ' moves for ' + ds);
    const end = E.applyMoves(day.puzzle, day.start.slice(), sol);
    if (!E.isSolved(day.puzzle, end)) throw new Error('Solution check failed for ' + ds);
    if (sol.length > day.scramble.length) throw new Error('Solution longer than scramble for ' + ds);
    out.puzzles[ds] = { h: E.hashString(day.start.join(',')), s: sol.map((m) => [m.c, m.k]) };
    if (d.getDate() === 1) console.error(ds, 'done', Math.round((Date.now() - t0) / 1000) + 's');
  }
  const dates = Object.keys(out.puzzles).sort();
  out.first = dates[0];
  out.last = dates[dates.length - 1];
  fs.writeFileSync(file, JSON.stringify(out));
  console.error('wrote', Object.keys(out.puzzles).length, 'solutions to', file);
}

module.exports = { solveOptimal, canonicalKey };
if (require.main === module) main();
