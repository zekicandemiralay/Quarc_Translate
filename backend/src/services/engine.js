// Talks to the self-hosted translation engine (see docker-compose.yml, service
// `translate-engine`) — free, keyless, and never leaves your own server, same
// philosophy as Weather using Open-Meteo instead of a paid API. It keeps
// LibreTranslate's HTTP shape, which is why swapping the models behind it
// needed no changes here.
const cache = require('./cache');

const BASE_URL = () => process.env.LIBRETRANSLATE_URL || 'http://translate-engine:5000';

async function listLanguages() {
  return cache.through('languages', 60 * 60 * 1000, async () => {
    const res = await fetch(`${BASE_URL()}/languages`);
    if (!res.ok) throw new Error(`Engine /languages responded ${res.status}`);
    return res.json();
  });
}

async function translate({ q, source, target }) {
  const res = await fetch(`${BASE_URL()}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, source, target, format: 'text' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Engine /translate responded ${res.status}`);
  }
  // { translatedText, detectedLanguage?: { confidence, language } } — the
  // detectedLanguage field is only present when `source` was 'auto'.
  return res.json();
}

module.exports = { listLanguages, translate };
