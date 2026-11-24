const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ApiError } = require('./helpers');

describe('translate API', () => {
  let t;
  before(async () => {
    t = await startApp();
  });
  after(() => t.close());

  const post = (body, opts) => t.api('/api/translate', { method: 'POST', body, ...opts });

  test('requires a login', async () => {
    const r = await post({ text: 'hi', target: 'tr' }, { as: null });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'unauthenticated');
  });

  test('rejects a forged token', async () => {
    const r = await t.api('/api/history', { as: null, headers: { Cookie: 'token=not-a-jwt' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'session_expired');
  });

  test('KEEPS line breaks and tabs (the old version flattened every paragraph)', async () => {
    t.engine.calls.translate.length = 0;
    const text = 'Dear Mr. Yilmaz,\n\nThank you for your email.\n\t- first\n\t- second\r\nBest,\nAnna';
    const r = await post({ text, source: 'en', target: 'tr', save: false });
    assert.equal(r.status, 200);
    const sent = t.engine.calls.translate.at(-1).text;
    assert.equal(sent, 'Dear Mr. Yilmaz,\n\nThank you for your email.\n\t- first\n\t- second\nBest,\nAnna');
    assert.ok(r.body.translatedText.includes('\n\n'), 'the answer keeps the paragraph break');
  });

  test('strips control characters and invisible marks but nothing visible', async () => {
    t.engine.calls.translate.length = 0;
    await post({ text: 'a\u0000b\u0007c​d﻿e ğüşiöç 日本語 😀', source: 'en', target: 'tr', save: false });
    assert.equal(t.engine.calls.translate.at(-1).text, 'abcde ğüşiöç 日本語 😀');
  });

  test('validates input with a code the app can act on', async () => {
    const cases = [
      [{ text: '', target: 'tr' }, 'empty_text'],
      [{ text: '   \n ', target: 'tr' }, 'empty_text'],
      [{ text: 5, target: 'tr' }, 'invalid_text'],
      [{ text: 'hi' }, 'invalid_target'],
      [{ text: 'hi', target: 'auto' }, 'invalid_target'],
      [{ text: 'hi', target: 'xx' }, 'unsupported_language'],
      [{ text: 'hi', source: 'xx', target: 'tr' }, 'unsupported_language'],
      [{ text: 'x'.repeat(5001), target: 'tr' }, 'text_too_long'],
    ];
    for (const [body, code] of cases) {
      const r = await post(body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(r.body.code, code);
    }
  });

  test('counts characters, not UTF-16 units (5000 emoji are allowed)', async () => {
    const r = await post({ text: '😀'.repeat(5000), source: 'en', target: 'tr', save: false });
    assert.equal(r.status, 200);
  });

  test('same language both sides never calls the engine', async () => {
    t.engine.calls.translate.length = 0;
    const r = await post({ text: 'Merhaba', source: 'tr', target: 'tr' });
    assert.equal(r.status, 200);
    assert.equal(r.body.translatedText, 'Merhaba');
    assert.equal(t.engine.calls.translate.length, 0);
  });

  test('auto-detect reports the language; detected == target returns the text untouched', async () => {
    const r = await post({ text: 'Günaydın efendim, nasılsınız?', source: 'auto', target: 'en', save: false });
    assert.equal(r.body.detectedLang, 'tr');
    assert.match(r.body.translatedText, /^\[en\]/);

    const same = await post({ text: 'Günaydın efendim, nasılsınız?', source: 'auto', target: 'tr', save: false });
    assert.equal(same.body.sameLanguage, true);
    assert.equal(same.body.translatedText, 'Günaydın efendim, nasılsınız?');
    assert.equal(same.body.id, null);
  });

  test('hints when the chosen source looks wrong (only when sure and long enough)', async () => {
    const wrong = await post({ text: 'Günaydın efendim, nasılsınız?', source: 'de', target: 'en', save: false });
    assert.deepEqual(wrong.body.hint, { language: 'tr', confidence: 0.97 });
    const short = await post({ text: 'ğ', source: 'de', target: 'en', save: false });
    assert.equal(short.body.hint, null);
    const right = await post({ text: 'Günaydın efendim, nasılsınız?', source: 'tr', target: 'en', save: false });
    assert.equal(right.body.hint, null);
  });

  test('remembers a translation in memory and says so', async () => {
    t.engine.calls.translate.length = 0;
    const body = { text: 'A sentence only this test uses.', source: 'en', target: 'fr', save: false };
    const first = await post(body);
    const second = await post(body);
    assert.equal(first.body.cached, false);
    assert.equal(second.body.cached, true);
    assert.equal(t.engine.calls.translate.length, 1);
    assert.equal(second.body.translatedText, first.body.translatedText);
  });

  test('identical simultaneous requests share one engine call', async () => {
    t.engine.calls.translate.length = 0;
    t.engine.delayMs = 80;
    const body = { text: 'Share the work between callers.', source: 'en', target: 'de', save: false };
    const results = await Promise.all([post(body), post(body), post(body)]);
    t.engine.delayMs = 0;
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(t.engine.calls.translate.length, 1);
  });

  test('a model that is still downloading is a 503 the app can wait out', async () => {
    t.engine.onTranslate = () => {
      throw new ApiError(503, 'model_preparing', 'Preparing the English to Turkish model', { stage: 'converting', retryAfter: 4, pair: 'en-tr' });
    };
    const r = await post({ text: 'Model not ready yet', source: 'en', target: 'es', save: false });
    t.engine.onTranslate = null;
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'model_preparing');
    assert.equal(r.body.stage, 'converting');
    assert.equal(r.body.retryAfter, 4);
  });

  test('engine down → 502, engine slow → 504, never a hung request', async () => {
    t.engine.onTranslate = () => {
      throw new ApiError(502, 'engine_unavailable', 'The translation engine is unavailable right now');
    };
    let r = await post({ text: 'engine down', source: 'en', target: 'es', save: false });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'engine_unavailable');
    t.engine.onTranslate = () => {
      throw new ApiError(504, 'engine_timeout', 'too slow');
    };
    r = await post({ text: 'engine slow', source: 'en', target: 'es', save: false });
    assert.equal(r.status, 504);
    t.engine.onTranslate = null;
  });

  test('malformed JSON is a clean 400', async () => {
    const res = await t.api('/api/translate', { method: 'POST', raw: true, headers: { 'Content-Type': 'application/json' } });
    assert.ok([400, 200].includes(res.status)); // empty body → validation error, not a crash
    const bad = await fetch(`${t.base}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${t.tokenFor('u1')}` },
      body: '{"text": ',
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'invalid_json');
  });

  describe('history saving', () => {
    test('older apps (no save flag) are still saved automatically and get an id', async () => {
      const r = await post({ text: 'Save me please, legacy client', source: 'en', target: 'de' }, { as: 'legacy' });
      assert.ok(r.body.id);
      const list = await t.api('/api/history', { as: 'legacy' });
      assert.equal(list.body.length, 1);
      assert.equal(list.body[0].source_text, 'Save me please, legacy client');
    });

    test('save:false leaves no trace', async () => {
      await post({ text: 'Do not keep this one', source: 'en', target: 'de', save: false }, { as: 'quiet' });
      const list = await t.api('/api/history', { as: 'quiet' });
      assert.equal(list.body.length, 0);
    });

    test('"save history" switched off wins even for apps that ask to save', async () => {
      await t.api('/api/prefs', { method: 'PUT', body: { save_history: false }, as: 'private' });
      const r = await post({ text: 'Private text nobody keeps', source: 'en', target: 'de' }, { as: 'private' });
      assert.equal(r.body.id, null);
      assert.equal((await t.api('/api/history', { as: 'private' })).body.length, 0);
    });

    test('a half-typed sentence is replaced, not piled up (old apps save every pause)', async () => {
      for (const text of ['How are', 'How are you', 'How are you doing today?']) {
        await post({ text, source: 'en', target: 'tr' }, { as: 'typist' });
      }
      const list = await t.api('/api/history', { as: 'typist' });
      assert.equal(list.body.length, 1);
      assert.equal(list.body[0].source_text, 'How are you doing today?');
    });
  });

  describe('engine passthrough', () => {
    test('languages, status, models', async () => {
      const langs = await t.api('/api/translate/languages');
      assert.equal(langs.status, 200);
      assert.ok(langs.body.find((l) => l.code === 'tr'));
      assert.equal((await t.api('/api/translate/status')).body.ok, true);
      assert.equal((await t.api('/api/translate/models')).status, 200);
    });

    test('prepare queues a pair, ignores auto and same-language', async () => {
      t.engine.calls.prepare.length = 0;
      await t.api('/api/translate/prepare', { method: 'POST', body: { source: 'en', target: 'de' } });
      await t.api('/api/translate/prepare', { method: 'POST', body: { source: 'auto', target: 'de' } });
      await t.api('/api/translate/prepare', { method: 'POST', body: { source: 'de', target: 'de' } });
      assert.deepEqual(t.engine.calls.prepare, [[['en', 'de']]]);
      const bad = await t.api('/api/translate/prepare', { method: 'POST', body: { source: 'en', target: 'zz' } });
      assert.equal(bad.status, 400);
    });
  });
});

describe('preferences', () => {
  let t;
  before(async () => {
    t = await startApp();
  });
  after(() => t.close());

  test('defaults', async () => {
    const r = await t.api('/api/prefs');
    assert.equal(r.status, 200);
    assert.deepEqual(
      { s: r.body.source_lang, t: r.body.target_lang, live: r.body.live, save: r.body.save_history, size: r.body.font_size, recent: r.body.recent_langs },
      { s: 'auto', t: 'en', live: true, save: true, size: 'm', recent: [] }
    );
  });

  test('patches merge, booleans and lists round-trip', async () => {
    await t.api('/api/prefs', { method: 'PUT', body: { target_lang: 'tr', live: false } });
    const r = await t.api('/api/prefs', { method: 'PUT', body: { recent_langs: ['tr', 'en', 'tr', 'de'], font_size: 'l' } });
    assert.equal(r.body.target_lang, 'tr');
    assert.equal(r.body.live, false);
    assert.equal(r.body.font_size, 'l');
    assert.deepEqual(r.body.recent_langs, ['tr', 'en', 'de']);
    assert.equal(r.body.save_history, true);
  });

  test('refuses nonsense with a message naming the field', async () => {
    for (const body of [{ theme: 'neon' }, { source_lang: 'English' }, { target_lang: 'auto' }, { recent_langs: 'tr' }, { live: 'yes' }, { language: 'de' }]) {
      const r = await t.api('/api/prefs', { method: 'PUT', body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.code, 'invalid_pref');
    }
  });

  test('are per account', async () => {
    await t.api('/api/prefs', { method: 'PUT', body: { theme: 'dark' }, as: 'a' });
    assert.equal((await t.api('/api/prefs', { as: 'b' })).body.theme, 'auto');
  });
});

describe('browser safety', () => {
  let t;
  before(async () => {
    t = await startApp({ config: { allowedOrigins: ['https://extra.example'] } });
  });
  after(() => t.close());

  const cors = (origin, path = '/api/history', method = 'GET') =>
    // fetch() cannot override Host, so use what nginx sends in production.
    t.api(path, { method, headers: { Origin: origin, 'X-Forwarded-Host': 'quarcnet0.tail1.ts.net:4003' }, body: method === 'POST' ? {} : undefined });

  test('the app\'s own origin, the Android/desktop wrappers and listed origins may read', async () => {
    for (const origin of ['https://quarcnet0.tail1.ts.net:4003', 'https://localhost', 'capacitor://localhost', 'https://extra.example']) {
      const r = await cors(origin);
      assert.equal(r.headers.get('access-control-allow-origin'), origin, origin);
      assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
    }
  });

  test('any other website gets no CORS headers, and cannot change data', async () => {
    const read = await cors('https://evil.example');
    assert.equal(read.headers.get('access-control-allow-origin'), null);
    const write = await cors('https://evil.example', '/api/translate', 'POST');
    assert.equal(write.status, 403);
    assert.equal(write.body.code, 'origin_not_allowed');
    const del = await cors('https://evil.example', '/api/history', 'DELETE');
    assert.equal(del.status, 403);
  });
});

describe('rate limiting', () => {
  test('slows a runaway client with Retry-After, per user', async () => {
    const t = await startApp({ config: { rateLimit: 3 } });
    try {
      const body = { text: 'Limited text', source: 'en', target: 'fr', save: false };
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await t.api('/api/translate', { method: 'POST', body })).status);
      assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
      assert.equal(codes[4], 429);
      const limited = await t.api('/api/translate', { method: 'POST', body });
      assert.equal(limited.body.code, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
      // someone else is unaffected
      assert.equal((await t.api('/api/translate', { method: 'POST', body, as: 'other' })).status, 200);
    } finally {
      await t.close();
    }
  });
});

describe('health', () => {
  test('answers without a login and reports the engine without depending on it', async () => {
    const t = await startApp();
    try {
      const up = await t.api('/api/health', { as: null });
      assert.equal(up.status, 200);
      assert.equal(up.body.engine, 'up');
      t.engine.health = async () => {
        throw new Error('down');
      };
      const down = await t.api('/api/health', { as: null });
      assert.equal(down.status, 200, 'a dead engine must not get the backend restarted');
      assert.equal(down.body.engine, 'down');
    } finally {
      await t.close();
    }
  });
});
