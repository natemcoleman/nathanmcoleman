// Run with: npm run test:venn   (or node --test tools/venn/scores.test.mjs)
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import E from '../../static/venn/engine.js';
import { validateSubmission, handleRequest, isCurrentDate, validateFeedback } from '../../lib/venn/scores.mjs';
import { redisDb } from '../../lib/venn/redis.mjs';
import { fakeUpstash } from './fake-upstash.mjs';

const DATE = '2026-10-17';
const NOW = new Date('2026-10-17T15:00:00Z');
const solutions = JSON.parse(fs.readFileSync(new URL('../../static/venn/solutions.json', import.meta.url)));
const shortest = solutions.puzzles[DATE].s;

function setup() {
  const fake = fakeUpstash();
  const db = redisDb({ url: 'https://fake.upstash.io/', token: 'test-token', fetchImpl: fake.fetchImpl });
  return { fake, db };
}
function req(method, query = '', body, ip = '1.2.3.4') {
  return new Request('https://example.com/api/venn' + query, {
    method, headers: { 'x-forwarded-for': ip }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}
const call = (db, r, extra = {}) => handleRequest(r, db, { now: NOW, ...extra });

test('accepts a real solve and scores moves plus 2 per hint', () => {
  const sub = validateSubmission({ date: DATE, playerId: 'player-0001', stack: shortest, hints: 1 }, NOW);
  assert.ok(sub.ok, sub.error);
  assert.strictEqual(sub.moves, shortest.length + E.HINT_COST);
});

test('which-circle hints (peeks) count 1 each; older clients without peeks still work', () => {
  const a = validateSubmission({ date: DATE, playerId: 'player-0001', stack: shortest, hints: 1, peeks: 2 }, NOW);
  assert.strictEqual(a.moves, shortest.length + E.HINT_COST + 2 * E.PEEK_COST);
  const b = validateSubmission({ date: DATE, playerId: 'player-0001', stack: shortest, hints: 0 }, NOW);
  assert.strictEqual(b.moves, shortest.length);
  assert.strictEqual(validateSubmission({ date: DATE, playerId: 'player-0001', stack: shortest, hints: 0, peeks: -1 }, NOW).ok, false);
});

test('rejects unsolved moves and junk', () => {
  const bad = [
    { date: DATE, playerId: 'player-0001', stack: shortest.slice(0, -1), hints: 0 },
    { date: DATE, playerId: 'player-0001', stack: [[0, 0]], hints: 0 },
    { date: DATE, playerId: 'player-0001', stack: [[99, 1]], hints: 0 },
    { date: DATE, playerId: 'x', stack: shortest, hints: 0 },
    { date: DATE, playerId: 'player-0001', stack: shortest, hints: -1 },
    { date: '2026-10-20', playerId: 'player-0001', stack: shortest, hints: 0 },
    { date: '2026-02-30', playerId: 'player-0001', stack: shortest, hints: 0 },
    null,
  ];
  bad.forEach((b) => assert.strictEqual(validateSubmission(b, NOW).ok, false, JSON.stringify(b)));
  assert.ok(isCurrentDate('2026-10-16', NOW) && isCurrentDate('2026-10-18', NOW) && !isCurrentDate('2026-10-15', NOW));
});

test('scores: submit, duplicate, counts (through the Redis REST adapter)', async () => {
  const { db, fake } = setup();
  const mk = (id, hints, extra = 0) => {
    const stack = [];
    for (let i = 0; i < extra; i++) stack.push([i % 3, 1], [i % 3, -1]);
    return { date: DATE, playerId: id, stack: stack.concat(shortest), hints };
  };
  let r = await call(db, req('POST', '', mk('player-aaaa', 0)));
  assert.strictEqual(r.status, 200);
  let b = await r.json();
  assert.strictEqual(b.accepted, true);
  assert.deepStrictEqual(b.stats.counts, { [shortest.length]: 1 });
  await call(db, req('POST', '', mk('player-bbbb', 1, 1)));
  r = await call(db, req('POST', '', mk('player-aaaa', 3)));
  b = await r.json();
  assert.strictEqual(b.accepted, false);
  assert.strictEqual(b.moves, shortest.length, 'first score of the day stands');
  const other = shortest.length + 2 + E.HINT_COST;
  assert.deepStrictEqual(b.stats, { date: DATE, players: 2, counts: { [shortest.length]: 1, [other]: 1 } });
  r = await call(db, req('GET', '?date=' + DATE));
  assert.deepStrictEqual((await r.json()).stats.counts, { [shortest.length]: 1, [other]: 1 });
  assert.ok(fake.log.some((c) => c[0] === 'SET' && c.includes('NX')), 'uses SET NX');
});

test('scores: bad requests', async () => {
  const { db } = setup();
  assert.strictEqual((await call(db, req('POST', '', { date: DATE, playerId: 'player-0002', stack: [[0, 1]], hints: 0 }))).status, 400);
  assert.strictEqual((await call(db, req('POST', '', '{not json'))).status, 400);
  assert.strictEqual((await call(db, req('PUT', ''))).status, 405);
  assert.strictEqual((await call(db, req('GET', '?date=2031-01-01'))).status, 400);
});

test('feedback: stored, rate limited, readable only with the admin key', async () => {
  const { db } = setup();
  assert.strictEqual(validateFeedback({ message: '  ' }).ok, false);
  assert.strictEqual(validateFeedback({ message: 'hi', email: 'nope' }).ok, false);
  for (let i = 0; i < 5; i++) {
    const r = await call(db, req('POST', '?op=feedback', { message: 'Love it ' + i, email: 'a@b.co', puzzle: 'Venn #4' }));
    assert.strictEqual(r.status, 200);
  }
  assert.strictEqual((await call(db, req('POST', '?op=feedback', { message: 'sixth' }))).status, 429);
  assert.strictEqual((await call(db, req('POST', '?op=feedback', { message: 'other ip' }, '9.9.9.9'))).status, 200);
  assert.strictEqual((await call(db, req('GET', '?op=feedback&key=wrong'), { adminKey: 'secret' })).status, 403);
  assert.strictEqual((await call(db, req('GET', '?op=feedback&key=x'))).status, 403, 'no admin key configured = no access');
  const r = await call(db, req('GET', '?op=feedback&key=secret'), { adminKey: 'secret' });
  const list = (await r.json()).feedback;
  assert.strictEqual(list.length, 6);
  assert.strictEqual(list[0].message, 'other ip');
  assert.strictEqual(list[1].email, 'a@b.co');
  // honeypot: pretend success, store nothing
  await call(db, req('POST', '?op=feedback', { message: 'spam', website: 'x' }, '7.7.7.7'));
  assert.strictEqual((await (await call(db, req('GET', '?op=feedback&key=secret'), { adminKey: 'secret' })).json()).feedback.length, 6);
});

test('the Vercel function: 503 until storage is connected, then works', async () => {
  const mod = await import('../../api/venn.mjs');
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.strictEqual((await mod.default.fetch(req('GET', '?date=2026-10-13'))).status, 503);
  const fake = fakeUpstash();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake.fetchImpl;
  process.env.KV_REST_API_URL = 'https://fake.upstash.io';
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    const r = await mod.default.fetch(req('GET', '?date=2026-10-13'));
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual((await r.json()).stats, { date: '2026-10-13', players: 0, counts: {} });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  }
});

test('finds the Upstash connection under any of the usual names', async () => {
  const { findRedisConfig, storageEnvNames } = await import('../../lib/venn/redis.mjs');
  assert.strictEqual(findRedisConfig({}), null);
  assert.deepStrictEqual(findRedisConfig({ KV_REST_API_URL: 'https://a.upstash.io', KV_REST_API_TOKEN: 't1' }),
    { url: 'https://a.upstash.io', token: 't1', source: 'KV_REST_API_URL' });
  assert.strictEqual(findRedisConfig({ UPSTASH_REDIS_REST_URL: 'https://b.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't2' }).token, 't2');
  assert.strictEqual(findRedisConfig({ STORAGE_KV_REST_API_URL: 'https://c.upstash.io', STORAGE_KV_REST_API_TOKEN: 't3' }).url, 'https://c.upstash.io');
  const fromUrl = findRedisConfig({ REDIS_URL: 'rediss://default:abc%3D@fine-cat-123.upstash.io:6379' });
  assert.deepStrictEqual(fromUrl, { url: 'https://fine-cat-123.upstash.io', token: 'abc=', source: 'REDIS_URL' });
  assert.strictEqual(findRedisConfig({ REDIS_URL: 'redis://default:pw@redis-cloud.example.com:6379' }), null, 'only Upstash hosts');
  assert.deepStrictEqual(storageEnvNames({ KV_URL: 'x', PATH: 'y', MY_REDIS_URL: 'z' }), ['KV_URL', 'MY_REDIS_URL']);
});
