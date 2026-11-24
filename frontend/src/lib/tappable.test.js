import { describe, expect, it } from 'vitest';
import { replaceUnit, textOf, isTappable, tappableCount, sameRendering } from './tappable';
import { describeSuggestion, stillApplies } from './suggestion';
import { createTranslator } from './translator';

const segments = [
  { t: '- ', u: null },
  { t: 'Günaydın.', u: '0:0' },
  { t: ' ', u: null },
  { t: 'Nasılsın?', u: '0:1' },
  { t: '\n', u: null },
  { t: 'https://x.org', u: '0:2' },
];
const units = {
  '0:0': { src: 'Good morning.', out: 'Günaydın.', alt: true },
  '0:1': { src: 'How are you?', out: 'Nasılsın?', alt: true },
  '0:2': { src: 'https://x.org', out: 'https://x.org', alt: false },
};

describe('tappable sentences', () => {
  it('rebuilds the text from the pieces', () => {
    expect(textOf(segments)).toBe('- Günaydın. Nasılsın?\nhttps://x.org');
  });

  it('only real sentences are tappable (not layout, not a bare link)', () => {
    expect(segments.filter((s) => isTappable(s, units)).map((s) => s.t)).toEqual(['Günaydın.', 'Nasılsın?']);
    expect(tappableCount(segments, units)).toBe(2);
    expect(tappableCount(null, null)).toBe(0);
  });

  it('swaps one sentence and leaves the layout and the other sentences alone', () => {
    const out = replaceUnit(segments, units, '0:1', 'Nasılsınız?');
    expect(out.text).toBe('- Günaydın. Nasılsınız?\nhttps://x.org');
    expect(out.units['0:1'].out).toBe('Nasılsınız?');
    expect(out.units['0:1'].src).toBe('How are you?');
    expect(out.units['0:0']).toBe(units['0:0']);
  });

  it('does not modify what it was given', () => {
    replaceUnit(segments, units, '0:0', 'Merhaba.');
    expect(segments[1].t).toBe('Günaydın.');
    expect(units['0:0'].out).toBe('Günaydın.');
  });

  it('recognises the shown translation among alternatives, ignoring case, spacing and punctuation', () => {
    expect(sameRendering('Günaydın.', 'günaydın')).toBe(true);
    expect(sameRendering('Merhaba!', ' merhaba ')).toBe(true);
    expect(sameRendering('Günaydın', 'Merhaba')).toBe(false);
  });
});

describe('suggestion display', () => {
  const short = { text: 'bugün çok güzel', segments: [{ t: 'bugün', changed: true }, { t: ' ', changed: false }, { t: 'çok', changed: true }], changes: [{ from: 'bugun', to: 'bugün' }], count: 2 };

  it('shows a short text corrected in full, with the changed words marked', () => {
    expect(describeSuggestion(short)).toEqual({ mode: 'text', pieces: short.segments });
  });

  it('summarises a long text as its first changes and how many more there are', () => {
    const changes = Array.from({ length: 4 }, (_, i) => ({ from: `a${i}`, to: `b${i}` }));
    const long = { text: 'x'.repeat(300), segments: [], changes, count: 9 };
    expect(describeSuggestion(long)).toEqual({ mode: 'changes', shown: changes, more: 5 });
  });

  it('only applies to the text it was made for, and until dismissed', () => {
    const s = { ...short, forText: 'bugun cok guzel', dismissed: false };
    expect(stillApplies(s, 'bugun cok guzel')).toBe(true);
    expect(stillApplies(s, 'bugun cok guzel ve')).toBe(false); // the person kept typing
    expect(stillApplies({ ...s, dismissed: true }, 'bugun cok guzel')).toBe(false);
    expect(stillApplies(null, 'x')).toBe(false);
  });
});

describe('translator keeps the sentences tappable across chunks', () => {
  const fakeApi = () => ({
    async translateRequest({ text, target }) {
      const out = `[${target}]${text}`;
      return { translatedText: out, segments: [{ t: out, u: 0 }], units: [{ src: text, out, alt: true }] };
    },
    async detectRequest() {
      return { language: 'en', confidence: 0.9 };
    },
  });
  const instant = async () => {};

  it('gives every chunk its own sentence ids and keeps the separators as layout', async () => {
    const t = createTranslator({ api: fakeApi(), sleep: instant, chunkLimit: 30 });
    const text = 'First paragraph is here.\nSecond paragraph is here.';
    const res = await t.run({ text, source: 'en', target: 'tr' });
    expect(textOf(res.segments)).toBe(res.text);
    expect(res.segments.filter((s) => s.u !== null).map((s) => s.u)).toEqual(['0:0', '1:0']);
    expect(res.units['1:0'].src).toBe('Second paragraph is here.');
    expect(res.segments.find((s) => s.t === '\n')?.u).toBeNull();
  });

  it('has no segments when the server sent none (an older server) or the text was already in the target language', async () => {
    const old = { ...fakeApi(), translateRequest: async ({ text }) => ({ translatedText: `x${text}` }) };
    const res = await createTranslator({ api: old, sleep: instant }).run({ text: 'Hello', source: 'en', target: 'tr' });
    expect(res.segments).toBeNull();
    expect(res.text).toBe('xHello');

    const same = await createTranslator({ api: fakeApi(), sleep: instant }).run({ text: 'Merhaba', source: 'tr', target: 'tr' });
    expect(same.segments).toBeNull();
  });
});
