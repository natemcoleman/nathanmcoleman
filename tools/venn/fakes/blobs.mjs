// In-memory stand-in for @netlify/blobs, used by tools/venn/scores.test.mjs.
const stores = new Map();

export class FakeStore {
  constructor() { this.data = new Map(); this.hideFromList = new Set(); }
  async get(key, opts = {}) {
    if (!this.data.has(key)) return null;
    const v = this.data.get(key);
    return opts.type === 'json' ? JSON.parse(v) : v;
  }
  async set(key, value, opts = {}) {
    if (opts.onlyIfNew && this.data.has(key)) return { modified: false };
    this.data.set(key, String(value));
    return { modified: true, etag: '"x"' };
  }
  async setJSON(key, value, opts = {}) { return this.set(key, JSON.stringify(value), opts); }
  async list({ prefix = '' } = {}) {
    const blobs = [...this.data.keys()]
      .filter((k) => k.startsWith(prefix) && !this.hideFromList.has(k))
      .map((key) => ({ key, etag: '"x"' }));
    return { blobs, directories: [] };
  }
}

export function getStore(opts) {
  const name = typeof opts === 'string' ? opts : opts.name;
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
}
