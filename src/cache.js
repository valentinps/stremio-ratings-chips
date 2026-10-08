// Small in-memory TTL cache with LRU eviction and in-flight request de-duplication.
// Stremio requests meta and streams for the same title at the same time, so concurrent
// callers share one upstream request.

class Cache {
  constructor({ max = 5000 } = {}) {
    this.max = max;
    this.map = new Map();      // key -> { value, expires }
    this.pending = new Map();  // key -> Promise
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  // `loader` resolves to { value, ttl }; a ttl of 0 means "don't cache".
  async wrap(key, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.pending.has(key)) return this.pending.get(key);

    const promise = (async () => {
      try {
        const { value, ttl } = await loader();
        if (ttl > 0) this.set(key, value, ttl);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }
}

module.exports = { Cache };
