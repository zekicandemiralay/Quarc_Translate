import { describe, expect, it } from 'vitest';
import { matchesQuery, pushRecent, localizedName, sortedLanguages, speechTag } from './languages';
import { dayHeading, groupByDay } from './dates';
import { chunkForSpeech, pickVoice } from './speech';
import { textFromUrl } from './incoming';

const LANGS = [
  { code: 'en', name: 'English', nameEn: 'English' },
  { code: 'tr', name: 'Türkçe', nameEn: 'Turkish' },
  { code: 'de', name: 'Deutsch', nameEn: 'German' },
  { code: 'zh', name: '中文', nameEn: 'Chinese' },
  { code: 'ca', name: 'Català', nameEn: 'Catalan' },
  { code: 'cs', name: 'Čeština', nameEn: 'Czech' },
];

describe('language names', () => {
  it('names a language in the app language', () => {
    expect(localizedName(LANGS[2], 'en')).toBe('German');
    expect(localizedName(LANGS[2], 'tr')).toBe('Almanca');
    expect(localizedName(LANGS[1], 'tr')).toBe('Türkçe');
  });

  it('falls back to the server name for a code the browser does not know', () => {
    expect(localizedName({ code: 'zz', nameEn: 'Zzish', name: 'Zz' }, 'en')).toBe('Zzish');
  });

  it('sorts by the name the person sees, with the right alphabet', () => {
    const tr = sortedLanguages(LANGS, 'tr').map((l) => l.code);
    expect(tr.indexOf('de')).toBeLessThan(tr.indexOf('tr')); // Almanca … Türkçe
    expect(sortedLanguages(LANGS, 'en').map((l) => l.label)).toEqual(['Catalan', 'Chinese', 'Czech', 'English', 'German', 'Turkish']);
  });

  it('finds a language by any of its spellings, ignoring case and accents', () => {
    const l = sortedLanguages(LANGS, 'tr');
    const find = (q) => l.filter((x) => matchesQuery(x, q, 'tr')).map((x) => x.code);
    expect(find('alman')).toEqual(['de']); // Turkish name
    expect(find('deutsch')).toEqual(['de']); // its own name
    expect(find('german')).toEqual(['de']); // English name
    expect(find('turk')).toEqual(['tr']); // no ü typed
    expect(find('cestina')).toEqual(['cs']); // no č typed
    expect(find('ÇEŞ')).toEqual(['cs']);
    expect(find('')).toHaveLength(LANGS.length);
    expect(find('qqq')).toEqual([]);
  });

  it('remembers recent languages: newest first, no duplicates, bounded, never "auto"', () => {
    expect(pushRecent(['tr', 'en'], 'de')).toEqual(['de', 'tr', 'en']);
    expect(pushRecent(['tr', 'en', 'de'], 'en')).toEqual(['en', 'tr', 'de']);
    expect(pushRecent(['a', 'b', 'c', 'd', 'e', 'f'], 'g')).toEqual(['g', 'a', 'b', 'c', 'd', 'e']);
    expect(pushRecent(['tr'], 'auto')).toEqual(['tr']);
  });

  it('gives speech a regional tag where one is needed', () => {
    expect(speechTag('tr')).toBe('tr');
    expect(speechTag('zh')).toBe('zh-CN');
  });
});

describe('history dates', () => {
  const now = new Date(2026, 10, 24, 15, 0, 0); // 24 Nov 2026, local time

  it('says today and yesterday, else the date', () => {
    expect(dayHeading(new Date(2026, 10, 24, 1, 0).toISOString(), 'en', now)).toBe('today');
    expect(dayHeading(new Date(2026, 10, 23, 23, 59).toISOString(), 'en', now)).toBe('yesterday');
    expect(dayHeading(new Date(2026, 10, 20, 12).toISOString(), 'en', now)).toMatch(/Fri/);
    expect(dayHeading(new Date(2025, 5, 3, 12).toISOString(), 'en', now)).toMatch(/2025/);
    expect(dayHeading('garbage', 'en', now)).toBe('');
  });

  it('groups consecutive entries by day', () => {
    const e = (d, h) => ({ id: `${d}-${h}`, updated_at: new Date(2026, 10, d, h).toISOString() });
    const groups = groupByDay([e(24, 14), e(24, 9), e(23, 20), e(10, 8)], 'en', now);
    expect(groups.map((g) => [g.heading === 'today' || g.heading === 'yesterday' ? g.heading : 'older', g.entries.length])).toEqual([
      ['today', 2],
      ['yesterday', 1],
      ['older', 1],
    ]);
  });
});

describe('speech', () => {
  it('reads long text in sentence-sized pieces (Chrome stops long utterances)', () => {
    const text = 'First sentence is here. Second one follows! Is this the third?\n\nA new paragraph starts here.';
    // sentences are packed together while they fit, never cut mid-sentence, and a paragraph break always starts a new piece
    expect(chunkForSpeech(text, 40)).toEqual(['First sentence is here.', 'Second one follows! Is this the third?', 'A new paragraph starts here.']);
    expect(chunkForSpeech(text, 30)).toEqual(['First sentence is here.', 'Second one follows!', 'Is this the third?', 'A new paragraph starts here.']);
    const long = 'word '.repeat(200);
    expect(chunkForSpeech(long, 100).every((c) => c.length <= 100)).toBe(true);
    expect(chunkForSpeech('   \n  ')).toEqual([]);
  });

  it('prefers an exact, on-device voice', () => {
    const v = (lang, localService) => ({ lang, localService, name: `${lang}-${localService}` });
    const voices = [v('en-US', true), v('tr-TR', false), v('tr-TR', true), v('de-DE', true)];
    expect(pickVoice(voices, 'tr').name).toBe('tr-TR-true');
    expect(pickVoice(voices, 'ja')).toBeNull();
    expect(pickVoice([v('zh_CN', true)], 'zh').lang).toBe('zh_CN');
    expect(pickVoice([v('pt-BR', true)], 'pt').lang).toBe('pt-BR'); // a regional voice beats silence
  });
});

describe('text arriving from outside', () => {
  it('reads a share-target / link query', () => {
    expect(textFromUrl('?text=Hello%20there&to=tr')).toEqual({ text: 'Hello there', source: undefined, target: 'tr' });
    expect(textFromUrl('?q=Merhaba&from=tr&to=en')).toEqual({ text: 'Merhaba', source: 'tr', target: 'en' });
  });

  it('puts a shared page address after its title, once', () => {
    expect(textFromUrl('?text=Great%20article&url=https%3A%2F%2Fx.org%2Fa').text).toBe('Great article\nhttps://x.org/a');
    expect(textFromUrl('?text=https%3A%2F%2Fx.org%2Fa&url=https%3A%2F%2Fx.org%2Fa').text).toBe('https://x.org/a');
  });

  it('ignores an empty share and caps absurd input', () => {
    expect(textFromUrl('')).toBeNull();
    expect(textFromUrl('?text=%20%20')).toBeNull();
    expect(textFromUrl(`?text=${'a'.repeat(9000)}`).text).toHaveLength(5000);
  });
});
