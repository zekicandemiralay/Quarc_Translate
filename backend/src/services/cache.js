// Small in-memory caches. Deliberately memory-only: a translation cache that
// wrote text to disk would keep what people typed even after they switched
// "save history" off.

/** Least-recently-used map with a size cap and optional per-entry lifetime. */
class LruCache {
  constructor(maxEntries, ttlMs = 0) {
    this.max = maxEntries;
    this.ttl = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.ttl && Date.now() > hit.expires) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // re-insert → most recently used
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.ttl ? Date.now() + this.ttl : 0 });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/**
 * Wraps an async producer so concurrent callers for the same key share one
 * upstream request instead of stampeding.
 */
function singleFlight() {
  const inflight = new Map();
  return (key, produce) => {
    if (inflight.has(key)) return inflight.get(key);
    const promise = Promise.resolve()
      .then(produce)
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}

module.exports = { LruCache, singleFlight };
