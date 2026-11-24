import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { createTranslator } from './translator';

/** A fake server that "translates" by wrapping text in [target]…, and records every request. */
function fakeApi(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    detections: [],
    async translateRequest({ text, source, target, signal }) {
      calls.push({ text, source, target });
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (overrides.translate) return overrides.translate({ text, source, target, n: calls.length });
      return { translatedText: `[${target}]${text}`, detectedLang: source === 'auto' ? 'en' : null, confidence: source === 'auto' ? 0.99 : null, hint: null, route: { models: ['m'] } };
    },
    async detectRequest(text) {
      api.detections.push(text);
      return overrides.detect ? overrides.detect(text) : { language: 'de', confidence: 0.95 };
    },
  };
  return api;
}

const instant = async () => {};
const make = (api, extra = {}) => createTranslator({ api, sleep: instant, chunkLimit: 40, ...extra });
const para = (n) => `Paragraph number ${n} is here.`; // 27 chars: one per chunk with a limit of 40

describe('translator', () => {
  it('translates a short text with one request', async () => {
    const api = fakeApi();
    const out = await make(api).run({ text: 'Hello', source: 'en', target: 'tr' });
    expect(api.calls).toEqual([{ text: 'Hello', source: 'en', target: 'tr' }]);
    expect(out.text).toBe('[tr]Hello');
    expect(out.cached).toBe(false);
  });

  it('returns nothing, and asks nothing, for blank text', async () => {
    const api = fakeApi();
    expect((await make(api).run({ text: '  \n ', source: 'auto', target: 'tr' })).text).toBe('');
    expect(api.calls).toHaveLength(0);
  });

  it('keeps the layout of a long text: chunk order, line breaks, blank lines', async () => {
    const api = fakeApi();
    const text = [para(1), para(2), '', para(3)].join('\n');
    const out = await make(api).run({ text, source: 'en', target: 'tr' });
    expect(out.text).toBe([`[tr]${para(1)}`, `[tr]${para(2)}`, '', `[tr]${para(3)}`].join('\n'));
    expect(api.calls.map((c) => c.text)).not.toContain('');
  });

  it('runs at most two requests at once and still returns them in order', async () => {
    let active = 0;
    let peak = 0;
    const api = fakeApi({
      translate: async ({ text, target }) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5 + (text.includes('1') ? 20 : 0)));
        active--;
        return { translatedText: `[${target}]${text}` };
      },
    });
    const text = [1, 2, 3, 4, 5, 6].map(para).join('\n');
    const out = await make(api).run({ text, source: 'en', target: 'tr' });
    expect(peak).toBe(2);
    expect(out.text.split('\n').map((l) => l.replace('[tr]', ''))).toEqual([1, 2, 3, 4, 5, 6].map(para));
  });

  it('reports progress as the finished leading part of the text', async () => {
    const api = fakeApi({
      translate: async ({ text, target }) => {
        if (text.includes('1')) await new Promise((r) => setTimeout(r, 30)); // first chunk is the slowest
        return { translatedText: `[${target}]${text}` };
      },
    });
    const seen = [];
    await make(api).run({ text: [1, 2, 3].map(para).join('\n'), source: 'en', target: 'tr', onProgress: (p) => seen.push(p.text) });
    // chunks 2 and 3 finish first, but nothing is shown until chunk 1 is there: the text never has holes
    expect(seen[0]).toBe(`[tr]${para(1)}\n[tr]${para(2)}\n[tr]${para(3)}`.slice(0, seen[0].length));
    expect(seen.every((s) => s.startsWith(`[tr]${para(1)}`) || s === '')).toBe(true);
    expect(seen.at(-1)).toBe(`[tr]${para(1)}\n[tr]${para(2)}\n[tr]${para(3)}`);
  });

  describe('memory', () => {
    it('asks for nothing twice', async () => {
      const api = fakeApi();
      const t = make(api);
      const text = [1, 2, 3].map(para).join('\n');
      await t.run({ text, source: 'en', target: 'tr' });
      const before = api.calls.length;
      const again = await t.run({ text, source: 'en', target: 'tr' });
      expect(api.calls.length).toBe(before);
      expect(again.cached).toBe(true);
    });

    it('re-translates only the paragraph that was edited', async () => {
      const api = fakeApi();
      const t = make(api);
      await t.run({ text: [1, 2, 3].map(para).join('\n'), source: 'en', target: 'tr' });
      api.calls.length = 0;
      await t.run({ text: [para(1), 'Paragraph two was EDITED.', para(3)].join('\n'), source: 'en', target: 'tr' });
      expect(api.calls.map((c) => c.text)).toEqual(['Paragraph two was EDITED.']);
    });

    it('does not mix up languages', async () => {
      const api = fakeApi();
      const t = make(api);
      await t.run({ text: 'Hello', source: 'en', target: 'tr' });
      await t.run({ text: 'Hello', source: 'en', target: 'de' });
      expect(api.calls).toHaveLength(2);
    });

    it('is bounded', async () => {
      const api = fakeApi();
      const t = make(api, { cacheSize: 3 });
      for (let i = 0; i < 10; i++) await t.run({ text: `text ${i}`, source: 'en', target: 'tr' });
      expect(t.size).toBe(3);
    });

    it('does not remember an empty answer', async () => {
      const api = fakeApi({ translate: async () => ({ translatedText: '' }) });
      const t = make(api);
      await t.run({ text: 'Hello', source: 'en', target: 'tr' });
      await t.run({ text: 'Hello', source: 'en', target: 'tr' });
      expect(api.calls).toHaveLength(2);
    });
  });

  describe('auto-detect', () => {
    it('lets the server detect when the text is a single chunk', async () => {
      const api = fakeApi();
      const out = await make(api).run({ text: 'Hello', source: 'auto', target: 'tr' });
      expect(api.detections).toHaveLength(0);
      expect(api.calls[0].source).toBe('auto');
      expect(out.detected).toBe('en');
    });

    it('detects once for a long text, then translates every chunk from that language', async () => {
      const api = fakeApi();
      const out = await make(api).run({ text: [1, 2, 3].map(para).join('\n'), source: 'auto', target: 'tr' });
      expect(api.detections).toHaveLength(1);
      expect(api.calls.every((c) => c.source === 'de')).toBe(true);
      expect(out.detected).toBe('de');
    });

    it('keeps "auto" per chunk when the detection is not confident', async () => {
      const api = fakeApi({ detect: () => ({ language: 'en', confidence: 0.1 }) });
      await make(api).run({ text: [1, 2].map(para).join('\n'), source: 'auto', target: 'tr' });
      expect(api.calls.every((c) => c.source === 'auto')).toBe(true);
    });

    it('survives a failing detection call', async () => {
      const api = fakeApi({ detect: () => { throw new ApiError('boom', { status: 500, code: 'internal' }); } });
      const out = await make(api).run({ text: [1, 2].map(para).join('\n'), source: 'auto', target: 'tr' });
      expect(out.text).toContain('[tr]');
    });

    it('returns text that is already in the target language untouched (long text: no translate calls)', async () => {
      const api = fakeApi({ detect: () => ({ language: 'tr', confidence: 0.99 }) });
      const text = [1, 2].map(para).join('\n');
      const out = await make(api).run({ text, source: 'auto', target: 'tr' });
      expect(out).toMatchObject({ sameLanguage: true, text, detected: 'tr' });
      expect(api.calls).toHaveLength(0);
    });

    it('flags same-language for a single chunk from the server answer', async () => {
      const api = fakeApi({ translate: async () => ({ translatedText: 'ignored', detectedLang: 'tr', confidence: 0.97 }) });
      const out = await make(api).run({ text: 'Merhaba dünya', source: 'auto', target: 'tr' });
      expect(out.sameLanguage).toBe(true);
      expect(out.text).toBe('Merhaba dünya');
    });

    it('does not claim "same language" on a shaky detection', async () => {
      const api = fakeApi({ translate: async () => ({ translatedText: 'Hotel', detectedLang: 'tr', confidence: 0.3 }) });
      expect((await make(api).run({ text: 'Hotel', source: 'auto', target: 'tr' })).sameLanguage).toBe(false);
    });

    it('passes the "did you mean" hint through when a language was chosen by hand', async () => {
      const api = fakeApi({ translate: async () => ({ translatedText: 'x', hint: { language: 'tr', confidence: 0.95 } }) });
      expect((await make(api).run({ text: 'Merhaba dünya nasılsın', source: 'de', target: 'en' })).hint).toEqual({ language: 'tr', confidence: 0.95 });
    });
  });

  describe('failures', () => {
    it('waits out a language pack that is still downloading, telling the caller', async () => {
      let n = 0;
      const api = fakeApi({
        translate: ({ text, target }) => {
          if (++n < 4) throw new ApiError('preparing', { status: 503, code: 'model_preparing', details: { stage: 'downloading', pct: n * 20, pair: 'en-tr', retryAfter: 3 } });
          return { translatedText: `[${target}]${text}` };
        },
      });
      const notices = [];
      const sleeps = [];
      const t = createTranslator({ api, sleep: async (ms) => sleeps.push(ms) });
      const out = await t.run({ text: 'Hello', source: 'en', target: 'tr', onPreparing: (p) => notices.push(p) });
      expect(out.text).toBe('[tr]Hello');
      expect(api.calls).toHaveLength(4);
      expect(notices.slice(0, 3).map((p) => p.pct)).toEqual([20, 40, 60]);
      expect(notices.at(-1)).toBeNull();
      expect(sleeps.every((ms) => ms >= 1500 && ms <= 8000)).toBe(true);
    });

    it('gives up on a download that takes absurdly long', async () => {
      let clock = 0;
      const api = fakeApi({ translate: () => { throw new ApiError('preparing', { status: 503, code: 'model_preparing', details: { stage: 'queued' } }); } });
      const t = createTranslator({ api, sleep: async () => { clock += 8 * 60 * 1000; }, now: () => clock });
      await expect(t.run({ text: 'Hello', source: 'en', target: 'tr' })).rejects.toMatchObject({ code: 'model_preparing' });
      expect(api.calls.length).toBeLessThan(10);
    });

    it('retries a dropped connection twice, then reports it', async () => {
      const api = fakeApi({ translate: () => { throw new ApiError('offline', { code: 'network' }); } });
      await expect(make(api).run({ text: 'Hello', source: 'en', target: 'tr' })).rejects.toMatchObject({ code: 'network' });
      expect(api.calls).toHaveLength(3);
    });

    it('recovers when the retry works', async () => {
      const api = fakeApi({ translate: ({ n, text }) => { if (n === 1) throw new ApiError('x', { status: 502, code: 'engine_unavailable' }); return { translatedText: `ok ${text}` }; } });
      expect((await make(api).run({ text: 'Hi', source: 'en', target: 'tr' })).text).toBe('ok Hi');
    });

    it('retries "too many requests" after the time the server asked for', async () => {
      const sleeps = [];
      const api = fakeApi({ translate: ({ n, text }) => { if (n < 3) throw new ApiError('slow down', { status: 429, code: 'rate_limited', details: { retryAfter: 4 } }); return { translatedText: text }; } });
      const t = createTranslator({ api, sleep: async (ms) => sleeps.push(ms) });
      await t.run({ text: 'Hi', source: 'en', target: 'tr' });
      expect(sleeps).toEqual([4000, 4000]);
    });

    it.each([
      ['model_failed', 502],
      ['unsupported_language', 400],
      ['empty_text', 400],
      ['unauthenticated', 401],
    ])('does not retry %s', async (code, status) => {
      const api = fakeApi({ translate: () => { throw new ApiError('no', { status, code }); } });
      await expect(make(api).run({ text: 'Hi', source: 'en', target: 'tr' })).rejects.toMatchObject({ code });
      expect(api.calls).toHaveLength(1);
    });

    it('stops quietly when cancelled, and starts no more chunks', async () => {
      const controller = new AbortController();
      const api = fakeApi({
        translate: async ({ text, target }) => {
          await new Promise((r) => setTimeout(r, 10));
          if (text.includes('2')) controller.abort();
          return { translatedText: `[${target}]${text}` };
        },
      });
      const t = make(api);
      await expect(t.run({ text: [1, 2, 3, 4, 5, 6].map(para).join('\n'), source: 'en', target: 'tr', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(api.calls.length).toBeLessThan(6);
    });

    it('a cancelled wait for a download ends at once', async () => {
      const controller = new AbortController();
      const api = fakeApi({ translate: () => { throw new ApiError('p', { status: 503, code: 'model_preparing', details: { stage: 'queued', retryAfter: 3 } }); } });
      const t = createTranslator({ api }); // real sleep
      const promise = t.run({ text: 'Hi', source: 'en', target: 'tr', signal: controller.signal });
      setTimeout(() => controller.abort(), 20);
      const started = Date.now();
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });
});

vi.setConfig({ testTimeout: 15000 });
