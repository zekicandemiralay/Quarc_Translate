// Every environment variable the backend reads, parsed once, in one place.
// Functions (not constants) so tests can change process.env between apps.

const int = (name, fallback) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

function loadConfig() {
  return {
    port: int('PORT', 3005),
    dbPath: process.env.DB_PATH || null, // null → db.js picks backend/data/translate.db
    jwtSecret: process.env.JWT_SECRET || '',
    // LIBRETRANSLATE_URL is the old name (the engine kept LibreTranslate's HTTP
    // shape when it replaced it); still honoured so an old .env keeps working.
    engineUrl: (process.env.ENGINE_URL || process.env.LIBRETRANSLATE_URL || 'http://translate-engine:5000').replace(/\/+$/, ''),
    // One request to the engine. Long texts are translated in several
    // requests by the client, so this only has to cover ~1000 characters.
    engineTimeoutMs: int('ENGINE_TIMEOUT', 45000),
    // Hard cap per request (characters). The app itself splits longer texts.
    maxChars: int('MAX_CHARS', 5000),
    // Translations remembered in memory so retyping the same thing is instant.
    cacheEntries: int('CACHE_ENTRIES', 2000),
    // Translate requests per user per 10 seconds (live typing stays far below).
    rateLimit: int('RATE_LIMIT', 60),
    // Comma-separated extra origins allowed to call the API with the login cookie.
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // How many translations may be inside the engine at the same time.
    engineConcurrency: int('ENGINE_CONCURRENCY', 3),
    // Largest history a user keeps; the oldest non-favourites are dropped past it.
    historyLimit: int('HISTORY_LIMIT', 5000),
  };
}

module.exports = { loadConfig };
