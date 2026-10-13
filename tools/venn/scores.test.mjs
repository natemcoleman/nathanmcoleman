// Run with: node --test tools/venn/scores.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import E from '../../static/venn/engine.js';
import { FakeStore } from './fakes/blobs.mjs';
import { validateSubmission, recordScore, handleRequest, isCurrentDate } from '../../netlify/venn/scores.mjs';

const DATE = '2026-10-17';
const NOW = new Date('2026-10-17T15:00:00Z');
const solutions = JSON.parse(fs.readFileSync(new URL('../../static/venn/solutions.json', import.meta.url)));
const shortest = solutions.puzzles[DATE].s; // [[c,k],...]

function stores() { return { players: new FakeStore(), scores: new FakeStore() }; }
function post(body) {
  return new Request('https://example.com/.netlify/functions/venn-scores', { method: 'POST', body: JSON.stringify(body) });
}

test('accepts a real solve and scores moves plus 2 per hint', () => {
  const sub = validateSubmission({ date: DATE, playerId: 'player-0001', stack: shortest, hints: 1 }, NOW);
  assert.ok(sub.ok, sub.error);
  assert.strictEqual(sub.moves, shortest.length + E.HINT_COST);
});

test('rejects moves that do not solve the puzzle, and junk input', () => {
  const bad = [
    { date: DATE, playerId: 'player-0001', stack: shortest.slice(0, -1), hints: 0 },
    { date: DATE, playerId: 'player-0001', stack: [[0, 0]], hints: 0 },
    { date: DATE, playerId: 'player-0001', stack: [[99, 1]], hints: 0 },
    { date: DATE, playerId: 'x', stack: shortest, hints: 0 },
    { date: DATE, playerId: 'player-0001', stack: shortest, hints: -1 },
    { date: '2026-10-20', playerId: 'player-0001', stack: shortest, hints: 0 }, // not today anywhere
    { date: '2026-02-30', playerId: 'player-0001', stack: shortest, hints: 0 },
    null,
  ];
  bad.forEach((b) => assert.strictEqual(validateSubmission(b, NOW).ok, false, JSON.stringify(b)));
});

test('accepts dates that are today somewhere on Earth', () => {
  assert.ok(isCurrentDate('2026-10-16', NOW));
  assert.ok(isCurrentDate('2026-10-18', NOW));
  assert.ok(!isCurrentDate('2026-10-15', NOW));
});

test('one score per player per day; counts include everyone', async () => {
  const s = stores();
  const a = await recordScore(s, { date: DATE, playerId: 'player-aaaa', moves: 5, hints: 0 });
  assert.strictEqual(a.accepted, true);
  await recordScore(s, { date: DATE, playerId: 'player-bbbb', moves: 7, hints: 1 });
  const again = await recordScore(s, { date: DATE, playerId: 'player-aaaa', moves: 3, hints: 0 });
  assert.strictEqual(again.accepted, false);
  assert.strictEqual(again.moves, 5, 'first score of the day stands');
  assert.deepStrictEqual(again.stats, { date: DATE, players: 2, counts: { 5: 1, 7: 1 } });
});

test("counts the player's own score even if the listing lags", async () => {
  const s = stores();
  await recordScore(s, { date: DATE, playerId: 'player-aaaa', moves: 5, hints: 0 });
  const origSet = s.scores.set.bind(s.scores);
  s.scores.set = async (key, v, o) => { s.scores.hideFromList.add(key); return origSet(key, v, o); };
  const r = await recordScore(s, { date: DATE, playerId: 'player-cccc', moves: 6, hints: 0 });
  assert.deepStrictEqual(r.stats.counts, { 5: 1, 6: 1 });
  assert.strictEqual(r.stats.players, 2);
});

test('HTTP: POST then GET', async () => {
  const s = stores();
  const r1 = await handleRequest(post({ date: DATE, playerId: 'player-0001', stack: shortest, hints: 0 }), s, NOW);
  assert.strictEqual(r1.status, 200);
  const b1 = await r1.json();
  assert.strictEqual(b1.accepted, true);
  assert.strictEqual(b1.stats.players, 1);
  const r2 = await handleRequest(new Request('https://example.com/x?date=' + DATE), s, NOW);
  assert.strictEqual(r2.status, 200);
  assert.deepStrictEqual((await r2.json()).stats.counts, { [shortest.length]: 1 });
  const r3 = await handleRequest(post({ date: DATE, playerId: 'player-0002', stack: [[0, 1]], hints: 0 }), s, NOW);
  assert.strictEqual(r3.status, 400);
  const r4 = await handleRequest(new Request('https://example.com/x', { method: 'PUT' }), s, NOW);
  assert.strictEqual(r4.status, 405);
  const r5 = await handleRequest(new Request('https://example.com/x', { method: 'POST', body: '{not json' }), s, NOW);
  assert.strictEqual(r5.status, 400);
});

test('the Netlify function file loads and uses Blobs stores', async () => {
  // fakes/register.mjs maps @netlify/blobs to the in-memory fake (see package.json script)
  const mod = await import('../../netlify/functions/venn-scores.mjs');
  const today = new Date().toISOString().slice(0, 10);
  const res = await mod.default(new Request('https://example.com/x?date=' + today));
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).stats.players, 0);
});
