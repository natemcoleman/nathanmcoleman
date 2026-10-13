/*
 * Venn server logic (anonymous global results + feedback), independent of hosting.
 * api/venn.mjs connects it to Vercel and Upstash Redis; tests use lib/venn/memory.mjs.
 *
 * A `db` provides:
 *   claim(date, playerId, moves) -> { claimed: bool, moves }   first score per player per day wins
 *   counts(date)                 -> { "7": 12, ... }           players per move count
 *   rateLimit(key, max, seconds) -> bool                       true if under the limit
 *   addFeedback(entry), listFeedback(n)
 */
import E from '../../static/venn/engine.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_BODY = 20000;
const MAX_TURNS = 400;
const MAX_HINTS = 200;

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function dayIndex(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function isRealDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** A puzzle date that is "today" somewhere on Earth (local dates run UTC-12 to UTC+14). */
export function isCurrentDate(date, now = new Date()) {
  if (!isRealDate(date) || date < E.SCHEDULES[0].from) return false;
  return Math.abs(dayIndex(date) - Math.floor(now.getTime() / 86400000)) <= 1;
}

/** Checks a submission by replaying it. Returns { ok:false, error } or { ok:true, date, playerId, hints, moves }. */
export function validateSubmission(body, now = new Date()) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a JSON object' };
  const { date, playerId, stack, hints } = body;
  if (!isCurrentDate(date, now)) return { ok: false, error: 'Not a current puzzle date' };
  if (typeof playerId !== 'string' || !ID_RE.test(playerId)) return { ok: false, error: 'Bad player id' };
  if (!Number.isInteger(hints) || hints < 0 || hints > MAX_HINTS) return { ok: false, error: 'Bad hint count' };
  if (!Array.isArray(stack) || stack.length < 1 || stack.length > MAX_TURNS) return { ok: false, error: 'Bad move list' };

  const day = E.dailyPuzzle(date);
  const { puzzle } = day;
  let state = day.start.slice();
  for (const mv of stack) {
    if (!Array.isArray(mv) || mv.length !== 2) return { ok: false, error: 'Bad move' };
    const [c, k] = mv;
    if (!Number.isInteger(c) || c < 0 || c >= puzzle.circles.length) return { ok: false, error: 'Bad move' };
    const m = puzzle.circles[c].slots.length;
    if (!Number.isInteger(k) || k === 0 || Math.abs(k) >= m) return { ok: false, error: 'Bad move' };
    state = E.applyMove(puzzle, state, c, k);
  }
  if (!E.isSolved(puzzle, state)) return { ok: false, error: 'Those moves do not solve the puzzle' };
  return { ok: true, date, playerId, hints, moves: E.moveScore(stack, hints) };
}

export async function dayStats(db, date) {
  const raw = await db.counts(date);
  const counts = {};
  let players = 0;
  for (const [k, v] of Object.entries(raw || {})) {
    const moves = Number(k), n = Number(v);
    if (Number.isInteger(moves) && moves > 0 && Number.isInteger(n) && n > 0) {
      counts[moves] = n;
      players += n;
    }
  }
  return { date, players, counts };
}

export async function recordScore(db, sub) {
  const res = await db.claim(sub.date, sub.playerId, sub.moves);
  return {
    accepted: res.claimed,
    duplicate: !res.claimed,
    moves: res.moves,
    stats: await dayStats(db, sub.date),
  };
}

export function validateFeedback(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a JSON object' };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const puzzle = typeof body.puzzle === 'string' ? body.puzzle.trim() : '';
  if (!message || message.length > 2000) return { ok: false, error: 'Message must be 1 to 2000 characters' };
  if (email.length > 200 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { ok: false, error: 'Bad email' };
  if (puzzle.length > 120) return { ok: false, error: 'Bad puzzle' };
  if (body.website) return { ok: false, spam: true }; // honeypot field filled by bots
  return { ok: true, entry: { message, email, puzzle } };
}

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return { error: json(413, { error: 'Too large' }) };
  try { return { body: JSON.parse(text) }; } catch { return { error: json(400, { error: 'Invalid JSON' }) }; }
}

/**
 * HTTP entry point for /api/venn
 *   GET  ?date=YYYY-MM-DD          counts for a day
 *   POST { date, playerId, stack, hints }   submit a solve
 *   POST ?op=feedback { message, email, puzzle }
 *   GET  ?op=feedback&key=ADMIN_KEY          latest feedback (if an admin key is configured)
 */
export async function handleRequest(req, db, opts = {}) {
  const now = opts.now || new Date();
  const url = new URL(req.url);
  const op = url.searchParams.get('op') || 'scores';
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  try {
    if (op === 'feedback') {
      if (req.method === 'GET') {
        if (!opts.adminKey || url.searchParams.get('key') !== opts.adminKey) return json(403, { error: 'Forbidden' });
        return json(200, { feedback: await db.listFeedback(100) });
      }
      if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
      const { body, error } = await readJson(req);
      if (error) return error;
      const fb = validateFeedback(body);
      if (fb.spam) return json(200, { ok: true });
      if (!fb.ok) return json(400, { error: fb.error });
      if (!(await db.rateLimit(`fb:${ip}`, 5, 3600))) return json(429, { error: 'Too many messages, try again later' });
      await db.addFeedback({ ...fb.entry, at: now.toISOString() });
      return json(200, { ok: true });
    }

    if (req.method === 'GET') {
      const date = url.searchParams.get('date') || '';
      if (!isRealDate(date) || date < E.SCHEDULES[0].from || dayIndex(date) > Math.floor(now.getTime() / 86400000) + 1) {
        return json(400, { error: 'Bad date' });
      }
      return json(200, { stats: await dayStats(db, date) }, { 'Cache-Control': 'public, max-age=0, s-maxage=20' });
    }
    if (req.method === 'POST') {
      const { body, error } = await readJson(req);
      if (error) return error;
      const sub = validateSubmission(body, now);
      if (!sub.ok) return json(400, { error: sub.error });
      if (!(await db.rateLimit(`score:${ip}`, 60, 3600))) return json(429, { error: 'Too many submissions' });
      return json(200, await recordScore(db, sub));
    }
    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
  } catch (err) {
    console.error('venn api error', err);
    return json(500, { error: 'Server error' });
  }
}
