// Vercel Function: /api/reading
// Saves the reading tracker's lists under a private sync code, so they follow you across browsers.
// Logic: lib/reading/sync.mjs. Storage: the same Upstash Redis as Venn (lib/venn/redis.mjs).
import { json } from '../lib/venn/scores.mjs';
import { redisFromEnv } from '../lib/venn/redis.mjs';
import { handleReadingRequest } from '../lib/reading/sync.mjs';

export default {
  async fetch(request) {
    const db = redisFromEnv();
    if (!db) return json(503, { error: 'Storage is not connected yet' });
    return handleReadingRequest(request, db);
  },
};
