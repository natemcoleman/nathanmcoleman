// A tiny in-memory imitation of Upstash Redis's REST API (/pipeline), for tests and local runs.
export function fakeUpstash() {
  const kv = new Map(), hashes = new Map(), lists = new Map();
  const log = [];
  function run(cmd) {
    const [op, ...a] = cmd;
    log.push(cmd);
    switch (op) {
      case 'SET': {
        const nx = a.includes('NX');
        if (nx && kv.has(a[0])) return null;
        kv.set(a[0], String(a[1])); return 'OK';
      }
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
      case 'EXPIRE': return 1;
      case 'HINCRBY': {
        const h = hashes.get(a[0]) || new Map(); hashes.set(a[0], h);
        const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], String(v)); return v;
      }
      case 'HGETALL': { const h = hashes.get(a[0]); return h ? [...h.entries()].flat() : []; }
      case 'LPUSH': { const l = lists.get(a[0]) || []; lists.set(a[0], l); l.unshift(a[1]); return l.length; }
      case 'LTRIM': { const l = lists.get(a[0]) || []; lists.set(a[0], l.slice(a[1], a[2] + 1)); return 'OK'; }
      case 'LRANGE': return (lists.get(a[0]) || []).slice(a[1], a[2] + 1);
      default: throw new Error('fake upstash: unsupported ' + op);
    }
  }
  async function fetchImpl(url, init) {
    if (!String(url).endsWith('/pipeline')) throw new Error('only /pipeline is used');
    if (init.headers.Authorization !== 'Bearer test-token') return new Response('{"error":"WRONGPASS"}', { status: 401 });
    const cmds = JSON.parse(init.body);
    return new Response(JSON.stringify(cmds.map((c) => ({ result: run(c) }))), { status: 200 });
  }
  return { fetchImpl, log, kv, hashes, lists };
}
