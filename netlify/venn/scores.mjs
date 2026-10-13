/*
 * Venn global results: accepts one anonymous score per player per day and
 * returns how many players finished in each number of moves.
 *
 * Storage (Netlify Blobs, passed in as `stores`):
 *   players: "<date>/<playerId>"              -> { moves, hints, at }   (one per player per day)
 *   scores:  "<date>/<moves, 4 digits>/<id>"  -> "1"                   (listing these gives the counts)
 *
 * Kept free of Netlify imports so it can be tested with in-memory stores
 * (tools/venn/scores.test.mjs). netlify/functions/venn-scores.mjs wires it up.
 */
import E from '../../static/venn/engine.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_BODY = 20000;
const MAX_TURNS = 400;
const MAX_HINTS = 200;

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function dayIndex(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function isRealDate(date) {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * A daily puzzle date that is "today" somewhere on Earth: within one day of the
 * server's UTC date (local dates range from UTC-12 to UTC+14).
 */
export function isCurrentDate(date, now = new Date()) {
  if (!isRealDate(date) || date < E.SCHEDULES[0].from) return false;
  const today = Math.floor(now.getTime() / 86400000);
  return Math.abs(dayIndex(date) - today) <= 1;
}

/** Checks a submission and replays it. Returns { ok, error } or { ok, date, playerId, moves, hints }. */
export function validateSubmission(body, now = new Date()) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a JSON object' };
  const { date, playerId, stack, hints } = body;
  if (typeof date !== 'string' || !isCurrentDate(date, now)) return { ok: false, error: 'Not a current puzzle date' };
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

/** Counts of players by move count for a date: { players, counts: { "7": 12, ... } }. */
export async function dayStats(stores, date) {
  const counts = {};
  const ids = new Set();
  let players = 0;
  const { blobs } = await stores.scores.list({ prefix: date + '/' });
  for (const { key } of blobs) {
    const parts = key.split('/');
    if (parts.length !== 3) continue;
    const moves = Number(parts[1]);
    if (!Number.isInteger(moves) || moves < 1) continue;
    counts[moves] = (counts[moves] || 0) + 1;
    ids.add(parts[2]);
    players++;
  }
  return { date, players, counts, ids };
}

function publicStats(stats) {
  return { date: stats.date, players: stats.players, counts: stats.counts };
}

/** Saves a validated score unless this player already has one for the day. */
export async function recordScore(stores, sub) {
  const playerKey = `${sub.date}/${sub.playerId}`;
  const existing = await stores.players.get(playerKey, { type: 'json' });
  let accepted = false;
  let moves = sub.moves;
  if (existing && Number.isInteger(existing.moves)) {
    moves = existing.moves; // first score of the day stands
  } else {
    const res = await stores.players.setJSON(playerKey, { moves: sub.moves, hints: sub.hints, at: Date.now() }, { onlyIfNew: true });
    if (res && res.modified === false) {
      const again = await stores.players.get(playerKey, { type: 'json' });
      if (again && Number.isInteger(again.moves)) moves = again.moves;
    } else {
      accepted = true;
      await stores.scores.set(`${sub.date}/${String(sub.moves).padStart(4, '0')}/${sub.playerId}`, '1');
    }
  }
  const stats = await dayStats(stores, sub.date);
  // Listings can lag behind a fresh write for a few seconds; count the player's own score if it is missing.
  if (!stats.ids.has(sub.playerId)) {
    stats.counts[moves] = (stats.counts[moves] || 0) + 1;
    stats.players++;
  }
  return { accepted, duplicate: !accepted, moves, stats: publicStats(stats) };
}

/** HTTP entry point: POST a score, or GET ?date=YYYY-MM-DD for the counts. */
export async function handleRequest(req, stores, now = new Date()) {
  try {
    if (req.method === 'GET') {
      const date = new URL(req.url).searchParams.get('date') || '';
      if (!isRealDate(date) || date < E.SCHEDULES[0].from || dayIndex(date) > Math.floor(now.getTime() / 86400000) + 1) {
        return json(400, { error: 'Bad date' });
      }
      const stats = await dayStats(stores, date);
      return json(200, { stats: publicStats(stats) }, { 'Cache-Control': 'public, max-age=30' });
    }
    if (req.method === 'POST') {
      const text = await req.text();
      if (text.length > MAX_BODY) return json(413, { error: 'Too large' });
      let body;
      try { body = JSON.parse(text); } catch { return json(400, { error: 'Invalid JSON' }); }
      const sub = validateSubmission(body, now);
      if (!sub.ok) return json(400, { error: sub.error });
      return json(200, await recordScore(stores, sub));
    }
    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
  } catch (err) {
    console.error('venn-scores error', err);
    return json(500, { error: 'Server error' });
  }
}
