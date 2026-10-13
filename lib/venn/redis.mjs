/*
 * Venn storage on Upstash Redis, using its REST API (plain fetch, no packages).
 *
 * Keys:
 *   venn:p:<date>:<playerId>  -> moves     (SET NX, kept 30 days: one score per player per day)
 *   venn:c:<date>             -> hash { moves: players }
 *   venn:rl:<name>            -> counter   (rate limits)
 *   venn:feedback             -> list of JSON messages (newest first, last 2000 kept)
 */
export function redisFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return redisDb({ url, token });
}

export function redisDb({ url, token, fetchImpl = (...a) => fetch(...a) }) {
  const base = url.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function pipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, { method: 'POST', headers, body: JSON.stringify(commands) });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
    const out = await res.json();
    return out.map((r) => {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      return r.result;
    });
  }

  function hashToObject(result) {
    if (!result) return {};
    if (Array.isArray(result)) {
      const obj = {};
      for (let i = 0; i + 1 < result.length; i += 2) obj[result[i]] = result[i + 1];
      return obj;
    }
    return result; // some clients return an object already
  }

  return {
    async claim(date, playerId, moves) {
      const key = `venn:p:${date}:${playerId}`;
      const [set] = await pipeline([['SET', key, String(moves), 'NX', 'EX', 60 * 60 * 24 * 30]]);
      if (set === 'OK') {
        await pipeline([['HINCRBY', `venn:c:${date}`, String(moves), 1]]);
        return { claimed: true, moves };
      }
      const [existing] = await pipeline([['GET', key]]);
      const n = Number(existing);
      return { claimed: false, moves: Number.isInteger(n) && n > 0 ? n : moves };
    },
    async counts(date) {
      const [h] = await pipeline([['HGETALL', `venn:c:${date}`]]);
      return hashToObject(h);
    },
    async rateLimit(name, max, seconds) {
      const key = `venn:rl:${name}`;
      const [count] = await pipeline([['INCR', key]]);
      if (Number(count) === 1) await pipeline([['EXPIRE', key, seconds]]);
      return Number(count) <= max;
    },
    async addFeedback(entry) {
      await pipeline([['LPUSH', 'venn:feedback', JSON.stringify(entry)], ['LTRIM', 'venn:feedback', 0, 1999]]);
    },
    async listFeedback(n) {
      const [items] = await pipeline([['LRANGE', 'venn:feedback', 0, n - 1]]);
      return (items || []).map((s) => { try { return JSON.parse(s); } catch { return { message: String(s) }; } });
    },
  };
}
