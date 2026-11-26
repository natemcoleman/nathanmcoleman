// Run with: npm run test:reading   (or node --test tools/reading/sync.test.mjs)
import test from 'node:test';
import assert from 'node:assert';
import { handleReadingRequest, normalizeCode, validCode, MAX_BYTES } from '../../lib/reading/sync.mjs';
import { redisDb } from '../../lib/venn/redis.mjs';
import { fakeUpstash } from '../venn/fake-upstash.mjs';

const CODE = 'river-falcon-7q2m-k9xd';
const data = { books: [{ id: 'b1', title: 'The Wager' }], days: [], genres: [] };

function setup() {
  const fake = fakeUpstash();
  const db = redisDb({ url: 'https://fake.upstash.io/', token: 'test-token', fetchImpl: fake.fetchImpl });
  let t = 1000;
  const call = (method, query = '', body, ip = '1.2.3.4') => handleReadingRequest(new Request('https://example.com/api/reading' + query, {
    method, headers: { 'x-forwarded-for': ip }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  }), db, { now: () => ++t });
  return { fake, call };
}

test('codes are normalized and checked', () => {
  assert.strictEqual(normalizeCode('  River Falcon-7Q2M-K9XD '), 'river-falcon-7q2m-k9xd');
  assert.ok(validCode(CODE));
  assert.ok(!validCode('short-code'));
  assert.ok(!validCode('has/slash-and-more-text'));
});

test('a first save then a load returns the same lists', async () => {
  const { call } = setup();
  assert.strictEqual((await call('GET', '?code=' + CODE)).status, 404);
  const put = await call('PUT', '', { code: CODE, data, base: null });
  assert.strictEqual(put.status, 200);
  assert.strictEqual((await put.json()).rev, 1);
  const got = await (await call('GET', '?code=' + CODE.toUpperCase())).json();
  assert.deepStrictEqual(got.data, data);
  assert.strictEqual(got.rev, 1);
});

test('a save from a stale browser is refused with the newer lists, unless forced', async () => {
  const { call } = setup();
  await call('PUT', '', { code: CODE, data, base: null });
  const newer = { ...data, books: [...data.books, { id: 'b2', title: 'Dr. Space' }] };
  assert.strictEqual((await call('PUT', '', { code: CODE, data: newer, base: 1 })).status, 200);
  const stale = await call('PUT', '', { code: CODE, data, base: 1 });
  assert.strictEqual(stale.status, 409);
  const body = await stale.json();
  assert.strictEqual(body.rev, 2);
  assert.strictEqual(body.data.books.length, 2);
  const forced = await call('PUT', '', { code: CODE, data, base: 1, force: true });
  assert.strictEqual((await forced.json()).rev, 3);
});

test('only a hash of the code is stored', async () => {
  const { call, fake } = setup();
  await call('PUT', '', { code: CODE, data, base: null });
  const keys = [...fake.kv.keys()].filter((k) => k.startsWith('reading:l:'));
  assert.strictEqual(keys.length, 1);
  assert.ok(!keys[0].includes(CODE));
});

test('bad input is refused', async () => {
  const { call } = setup();
  assert.strictEqual((await call('PUT', '', { code: 'short', data })).status, 400);
  assert.strictEqual((await call('PUT', '', { code: CODE, data: { nope: 1 } })).status, 400);
  assert.strictEqual((await call('PUT', '', 'not json')).status, 400);
  assert.strictEqual((await call('PUT', '', { code: CODE, data: { books: [], pad: 'x'.repeat(MAX_BYTES) } })).status, 413);
  assert.strictEqual((await call('POST', '', {})).status, 405);
});

test('delete removes the lists', async () => {
  const { call } = setup();
  await call('PUT', '', { code: CODE, data, base: null });
  assert.deepStrictEqual(await (await call('DELETE', '?code=' + CODE)).json(), { deleted: true });
  assert.strictEqual((await call('GET', '?code=' + CODE)).status, 404);
});

test('reads are rate limited per address', async () => {
  const { call } = setup();
  let last;
  for (let i = 0; i < 601; i++) last = await call('GET', '?code=' + CODE, undefined, '9.9.9.9');
  assert.strictEqual(last.status, 429);
  assert.strictEqual((await call('GET', '?code=' + CODE, undefined, '8.8.8.8')).status, 404);
});
