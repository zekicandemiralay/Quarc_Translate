// The language list comes from the engine (it is the one that knows which
// models exist). Cached for an hour; if the engine is down the last good list
// keeps the app usable instead of failing every language picker.

const { LruCache, singleFlight } = require('./cache');

function createLanguages(engine, ttlMs = 60 * 60 * 1000) {
  const cache = new LruCache(1, ttlMs);
  const flight = singleFlight();
  let lastGood = null;

  async function list() {
    const hit = cache.get('list');
    if (hit) return hit;
    try {
      const fresh = await flight('list', () => engine.languages());
      cache.set('list', fresh);
      lastGood = fresh;
      return fresh;
    } catch (err) {
      if (lastGood) return lastGood;
      throw err;
    }
  }

  async function codes() {
    return new Set((await list()).map((l) => l.code));
  }

  return { list, codes };
}

module.exports = { createLanguages };
