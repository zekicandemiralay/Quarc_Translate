// Test harness: the real Express app on a random port, an in-memory SQLite
// database, and a fake translation engine whose behaviour each test can steer.

const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const { ApiError } = require('../src/errors');

const SECRET = 'test-secret-that-is-long-enough-for-hs256';

const LANGUAGES = ['en', 'tr', 'de', 'fr', 'es', 'ar'].map((code) => ({ code, name: code, nameEn: code, rtl: code === 'ar' }));

function fakeEngine() {
  const calls = { translate: [], prepare: [], detect: [], suggest: [], alternatives: [] };
  const engine = {
    calls,
    // steer: set to a function (args) => result | throws
    onTranslate: null,
    delayMs: 0,
    async health() {
      return { ok: true, loaded: [] };
    },
    async languages() {
      return LANGUAGES;
    },
    async models() {
      return { models: [] };
    },
    async prepare(pairs) {
      calls.prepare.push(pairs);
      return { queued: pairs };
    },
    async detect(text) {
      calls.detect.push(text);
      return { language: 'en', confidence: 0.99, candidates: [] };
    },
    // steer: set to a function ({ text, source }) => result | throws
    onSuggest: null,
    async suggest({ text, source }) {
      calls.suggest.push({ text, source });
      if (engine.onSuggest) return engine.onSuggest({ text, source });
      return { language: source === 'auto' ? 'tr' : source, suggestion: null };
    },
    // steer: set to a function ({ text, source, target }) => result | throws
    onAlternatives: null,
    async alternatives({ text, source, target }) {
      calls.alternatives.push({ text, source, target });
      if (engine.onAlternatives) return engine.onAlternatives({ text, source, target });
      return { alternatives: [`[${target}] ${text}`, `(${target}) ${text}`] };
    },
    async translate({ text, source, target }) {
      calls.translate.push({ text, source, target });
      if (engine.delayMs) await new Promise((r) => setTimeout(r, engine.delayMs));
      if (engine.onTranslate) return engine.onTranslate({ text, source, target });
      const detected = /[ğışİ]/.test(text) ? 'tr' : 'en';
      const translated = `[${target}] ${text}`;
      return {
        translatedText: translated,
        segments: [{ t: translated, u: 0 }],
        units: [{ src: text, out: translated, alt: true }],
        detectedLanguage: { language: detected, confidence: 0.97 },
        route: { model: 'fake' },
      };
    },
  };
  return engine;
}

async function startApp(overrides = {}) {
  const config = { ...loadConfig(), jwtSecret: SECRET, rateLimit: 1000, ...overrides.config };
  const db = createDb(':memory:');
  const engine = overrides.engine || fakeEngine();
  const app = createApp({ config, db, engine });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const tokenFor = (id, extra = {}) => jwt.sign({ id, username: `user-${id}`, role: 'user', ...extra }, SECRET, { expiresIn: '1h' });

  /** fetch as a user. `as: null` sends no cookie. */
  async function api(path, { method = 'GET', body, as = 'u1', headers = {}, raw = false } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(as ? { Cookie: `token=${tokenFor(as)}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  async function close() {
    app.stop();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { app, db, engine, config, base, api, tokenFor, close };
}

module.exports = { startApp, fakeEngine, ApiError, SECRET, LANGUAGES };
