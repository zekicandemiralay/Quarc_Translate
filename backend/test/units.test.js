const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, charCount, dedupeKey, likePattern } = require('../src/services/text');
const { LruCache, singleFlight } = require('../src/services/cache');
const { createGate, createEngineClient } = require('../src/services/engine');
const { createRateLimit } = require('../src/middleware/rateLimit');
const { originAllowed } = require('../src/middleware/cors');

describe('text', () => {
  test('cleanText keeps structure, drops junk, normalises', () => {
    assert.equal(cleanText('a\r\nb\rc\n\nd\te'), 'a\nb\nc\n\nd\te');
    assert.equal(cleanText('x\u0000\u0001\u001Fy\u007F\u0085z'), 'xyz');
    assert.equal(cleanText('zero​width‮bidi﻿'), 'zerowidthbidi');
    assert.equal(cleanText('é'), 'é', 'NFC');
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(42), '');
  });

  test('charCount counts characters', () => {
    assert.equal(charCount('héllo'), 5);
    assert.equal(charCount('😀😀'), 2);
    assert.equal(charCount('日本語'), 3);
  });

  test('dedupeKey ignores case and spacing, keeps Turkish letters distinct', () => {
    assert.equal(dedupeKey('  Hello   World\n'), 'hello world');
    assert.notEqual(dedupeKey('ışık'), dedupeKey('isik'));
  });

  test('likePattern escapes wildcards', () => {
    assert.equal(likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
  });
});

describe('caches', () => {
  test('LruCache evicts the least recently used', () => {
    const c = new LruCache(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('a'), 1);
    assert.equal(c.size, 2);
  });

  test('LruCache expires entries', async () => {
    const c = new LruCache(5, 20);
    c.set('a', 1);
    assert.equal(c.get('a'), 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(c.get('a'), undefined);
  });

  test('singleFlight shares a running call and forgets it afterwards, including on failure', async () => {
    const flight = singleFlight();
    let runs = 0;
    const slow = () => new Promise((r) => setTimeout(() => r(++runs), 20));
    const [a, b] = await Promise.all([flight('k', slow), flight('k', slow)]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    await assert.rejects(flight('k', () => Promise.reject(new Error('boom'))), /boom/);
    assert.equal(await flight('k', slow), 2);
  });
});

describe('engine client', () => {
  test('gate runs at most N at once, in order, and hands slots over without gaps', async () => {
    const run = createGate(2);
    let active = 0;
    let peak = 0;
    const order = [];
    const task = (id) => async () => {
      active++;
      peak = Math.max(peak, active);
      order.push(id);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return id;
    };
    const out = await Promise.all([1, 2, 3, 4, 5, 6].map((id) => run(task(id))));
    assert.deepEqual(out, [1, 2, 3, 4, 5, 6]);
    assert.equal(peak, 2);
    assert.deepEqual(order, [1, 2, 3, 4, 5, 6]);
  });

  test('gate: a queued caller that gives up leaves the queue; a full queue says busy', async () => {
    const run = createGate(1, 1);
    const hold = run(() => new Promise((r) => setTimeout(r, 40)));
    const controller = new AbortController();
    const queued = run(async () => 'never', controller.signal);
    await assert.rejects(run(async () => 'overflow'), (e) => e.code === 'busy');
    controller.abort();
    await assert.rejects(queued);
    await hold;
    assert.equal(await run(async () => 'ok'), 'ok');
  });

  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  test('maps engine answers to errors the app understands', async () => {
    const client = (fetchImpl) => createEngineClient({ baseUrl: 'http://engine', fetchImpl });
    const call = (fetchImpl) => client(fetchImpl).translate({ text: 'x', source: 'en', target: 'tr' });

    await assert.rejects(
      call(reply(503, { detail: { code: 'model_preparing', message: 'Preparing', stage: 'downloading', pct: 37, pair: 'en-tr', retryAfter: 5 } })),
      (e) => e.status === 503 && e.code === 'model_preparing' && e.details.stage === 'downloading' && e.details.pct === 37 && e.details.retryAfter === 5
    );
    await assert.rejects(call(reply(422, { detail: [{ msg: 'bad' }] })), (e) => e.status === 400);
    await assert.rejects(call(reply(400, { detail: { code: 'unsupported_language', message: 'nope' } })), (e) => e.code === 'unsupported_language');
    await assert.rejects(call(reply(500, { detail: 'kaput' })), (e) => e.status === 502);
    await assert.rejects(
      call(async () => {
        throw new TypeError('fetch failed');
      }),
      (e) => e.status === 502 && e.code === 'engine_unavailable'
    );
    await assert.rejects(
      call(async () => {
        const err = new Error('timeout');
        err.name = 'TimeoutError';
        throw err;
      }),
      (e) => e.status === 504 && e.code === 'engine_timeout'
    );
  });

  test('sends the text to the right place', async () => {
    let seen;
    const c = createEngineClient({
      baseUrl: 'http://engine:5000/',
      fetchImpl: async (url, init) => {
        seen = { url, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ translatedText: 'ok' }), { status: 200 });
      },
    });
    await c.translate({ text: 'a\nb', source: 'auto', target: 'tr' });
    assert.equal(seen.url, 'http://engine:5000/translate');
    assert.deepEqual(seen.body, { q: 'a\nb', source: 'auto', target: 'tr' });
  });
});

describe('rate limit', () => {
  test('refills over time', () => {
    let t = 0;
    const limit = createRateLimit({ limit: 2, windowMs: 1000, now: () => t });
    const hit = () => {
      let error = null;
      limit({ user: { id: 'u' }, ip: '1' }, { set() {} }, (e) => (error = e || null));
      return error;
    };
    assert.equal(hit(), null);
    assert.equal(hit(), null);
    assert.equal(hit()?.status, 429);
    t += 600; // 1.2 tokens back
    assert.equal(hit(), null);
    assert.equal(hit()?.status, 429);
    limit.stop();
  });
});

describe('cors origins', () => {
  const req = (origin, host = 'quarcnet0.tail1.ts.net', extra = {}) => ({
    get: (h) => ({ Origin: origin, Host: host, ...extra })[h],
  });
  test('allows own host on any port, wrappers and listed origins', () => {
    assert.equal(originAllowed(req(undefined), []), true);
    assert.equal(originAllowed(req('https://quarcnet0.tail1.ts.net:4003'), []), true);
    assert.equal(originAllowed(req('https://localhost'), []), true);
    assert.equal(originAllowed(req('capacitor://localhost'), []), true);
    assert.equal(originAllowed(req('https://x.example'), ['https://x.example']), true);
  });
  test('refuses everything else, including look-alike hosts and garbage', () => {
    assert.equal(originAllowed(req('https://evil.example'), []), false);
    assert.equal(originAllowed(req('https://quarcnet0.tail1.ts.net.evil.example'), []), false);
    assert.equal(originAllowed(req('null'), []), false);
    assert.equal(originAllowed(req('not a url'), []), false);
  });
  test('uses X-Forwarded-Host behind the proxy', () => {
    assert.equal(originAllowed(req('https://app.example:4003', 'backend:3005', { 'X-Forwarded-Host': 'app.example:4003' }), []), true);
  });
});
