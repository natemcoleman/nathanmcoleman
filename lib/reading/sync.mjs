/*
 * Sync for the reading tracker (/reading/). No accounts: each person's lists live under a
 * long random sync code that the page makes. Anyone with the code can read and change the lists,
 * so the code is the password. Redis stores only a SHA-256 hash of it.
 *
 * Keys:
 *   reading:l:<sha256(code)>  -> JSON { rev, saved, data }   (kept 2 years after the last save)
 *   reading:rl:<name>         -> counter                      (rate limits)
 *
 * API (all JSON):
 *   GET    /api/reading?code=C          -> 200 { rev, saved, data } | 404 { error: 'not_found' }
 *   PUT    /api/reading  { code, data, base, force? }
 *          base = the rev this browser last saw (null for a first upload).
 *          -> 200 { rev, saved } | 409 { error: 'conflict', rev, saved, data } when someone saved since base
 *   DELETE /api/reading?code=C          -> 200 { deleted: true|false }
 */
import { json } from '../venn/scores.mjs';

export const MAX_BYTES = 512 * 1024;
const KEEP_SECONDS = 60 * 60 * 24 * 365 * 2;
const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function normalizeCode(code) {
  return String(code || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}
export function validCode(code) {
  return typeof code === 'string' && code.length >= 16 && code.length <= 64 && CODE_RE.test(code);
}
async function keyFor(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return 'reading:l:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function underLimit(db, name, max, seconds) {
  const key = 'reading:rl:' + name;
  const [n] = await db.run([['INCR', key]]);
  if (Number(n) === 1) await db.run([['EXPIRE', key, seconds]]);
  return Number(n) <= max;
}
async function load(db, key) {
  const [raw] = await db.run([['GET', key]]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function handleReadingRequest(req, db, { now = () => Date.now() } = {}) {
  const url = new URL(req.url);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

  if (req.method === 'GET' || req.method === 'DELETE') {
    const code = normalizeCode(url.searchParams.get('code'));
    if (!validCode(code)) return json(400, { error: 'bad_code' });
    if (!(await underLimit(db, 'r:' + ip, 600, 3600))) return json(429, { error: 'Too many requests, try again later' });
    const key = await keyFor(code);
    if (req.method === 'DELETE') {
      const [n] = await db.run([['DEL', key]]);
      return json(200, { deleted: Number(n) > 0 });
    }
    const rec = await load(db, key);
    return rec ? json(200, rec) : json(404, { error: 'not_found' });
  }

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json(413, { error: 'Your lists are too large to sync' });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: 'bad_json' }); }
    const code = normalizeCode(body && body.code);
    if (!validCode(code)) return json(400, { error: 'bad_code' });
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.books)) return json(400, { error: 'bad_data' });
    if (!(await underLimit(db, 'w:' + ip, 600, 3600))) return json(429, { error: 'Too many saves, try again later' });
    const key = await keyFor(code);
    const cur = await load(db, key);
    const base = body.base === undefined ? null : body.base;
    if (cur && !body.force && base !== cur.rev) return json(409, { error: 'conflict', ...cur });
    const rec = { rev: (cur ? Number(cur.rev) || 0 : 0) + 1, saved: now(), data };
    await db.run([['SET', key, JSON.stringify(rec), 'EX', KEEP_SECONDS]]);
    return json(200, { rev: rec.rev, saved: rec.saved });
  }

  return json(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT, DELETE' });
}
