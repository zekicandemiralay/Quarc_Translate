// Tiny in-memory TTL cache. LibreTranslate's language list barely ever
// changes, so there's no reason for every client on every page load to hit
// the engine container for it.

const store = new Map();

function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Wraps an async producer so concurrent callers for the same key share one
// upstream request instead of stampeding.
const inflight = new Map();

async function through(key, ttlMs, produce) {
  const cached = get(key);
  if (cached) return cached;

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await produce();
      set(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

module.exports = { get, set, through };
