// Vercel Function: /api/venn
// Anonymous global results and feedback for the Venn daily puzzle.
// Logic: lib/venn/scores.mjs. Storage: Upstash Redis (lib/venn/redis.mjs), connected through
// the Vercel Marketplace, which provides KV_REST_API_URL and KV_REST_API_TOKEN.
// Optional env var VENN_ADMIN_KEY lets you read feedback at /api/venn?op=feedback&key=<that key>.
import { handleRequest, json } from '../lib/venn/scores.mjs';
import { redisFromEnv } from '../lib/venn/redis.mjs';

export default {
  async fetch(request) {
    const db = redisFromEnv();
    if (!db) return json(503, { error: 'Storage is not connected yet' });
    return handleRequest(request, db, { adminKey: process.env.VENN_ADMIN_KEY || null });
  },
};
