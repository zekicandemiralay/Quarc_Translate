// Talks to the self-hosted translation engine (see docker-compose.yml, service
// `translate-engine`) — free, keyless, and never leaves your own server, same
// philosophy as Weather using Open-Meteo instead of a paid API. It keeps
// LibreTranslate's HTTP shape, which is why swapping the models behind it
// needed no changes here.
const cache = require('./cache');

const BASE_URL = () => process.env.LIBRETRANSLATE_URL || 'http://translate-engine:5000';
const ENGINE_TIMEOUT = parseInt(process.env.ENGINE_TIMEOUT || '30000', 10); // 30 seconds default

async function listLanguages() {
  return cache.through('languages', 60 * 60 * 1000, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ENGINE_TIMEOUT);
    try {
      const res = await fetch(`${BASE_URL()}/languages`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`Engine /languages responded ${res.status}`);
      return res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  });
}

async function translate({ q, source, target }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENGINE_TIMEOUT);
  try {
    const res = await fetch(`${BASE_URL()}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, source, target, format: 'text' }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Engine /translate responded ${res.status}`);
    }
    // { translatedText, detectedLanguage?: { confidence, language } } — the
    // detectedLanguage field is only present when `source` was 'auto'.
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

module.exports = { listLanguages, translate };
