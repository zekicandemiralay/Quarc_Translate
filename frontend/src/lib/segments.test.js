import { describe, expect, it } from 'vitest';
import { CHUNK_LIMIT, joinChunks, splitForRequests } from './segments';

const rebuild = (text, limit) => {
  const chunks = splitForRequests(text, limit);
  return { chunks, back: joinChunks(chunks, chunks.map((c) => c.text)) };
};

describe('splitForRequests', () => {
  it('keeps a short text as one piece', () => {
    const { chunks } = rebuild('Hello world.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ text: 'Hello world.', sep: '', blank: false });
  });

  it('returns nothing for empty text', () => {
    expect(splitForRequests('')).toEqual([]);
  });

  it('groups lines while they fit and never loses a line break', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Line number ${i} with some words`).join('\n');
    const { chunks, back } = rebuild(text, 100);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.length <= 100)).toBe(true);
    expect(back).toBe(text);
  });

  it('keeps blank lines, indentation, trailing newlines and CRLF exactly', () => {
    for (const text of ['A\n\n\nB', 'A\n', '\nA', '  indented\n\tTabbed  \n', 'one\r\ntwo\r\n\r\nthree', '\n\n']) {
      expect(rebuild(text, 20).back).toBe(text);
    }
  });

  it('marks whitespace-only pieces as blank so they are not sent to the server', () => {
    const text = `A very long first line here${'\n'.repeat(40)}second`;
    const { chunks, back } = rebuild(text, 12);
    expect(chunks.some((c) => c.blank)).toBe(true);
    expect(chunks.filter((c) => !c.blank).every((c) => c.text.trim().length > 0)).toBe(true);
    expect(back).toBe(text);
  });

  it('merges a few blank lines into their neighbours instead of making pieces of them', () => {
    const { chunks } = rebuild('first\n\n\nsecond', 100);
    expect(chunks).toHaveLength(1);
  });

  it('cuts one very long line at sentence ends, not in the middle of words', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(60).trimEnd();
    const { chunks, back } = rebuild(text, 200);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.length <= 200)).toBe(true);
    expect(chunks.every((c) => c.text.startsWith('The quick') && c.text.endsWith('dog.'))).toBe(true);
    expect(back).toBe(text);
  });

  it('does not split on decimals or abbreviations glued to the next word', () => {
    const text = `Version 3.5.1 costs 4.99 dollars. ${'x'.repeat(30)}`;
    const { chunks } = rebuild(text, 40);
    expect(chunks[0].text).toBe('Version 3.5.1 costs 4.99 dollars.');
  });

  it('handles CJK sentences that have no spaces', () => {
    const text = '今日は晴れです。'.repeat(80);
    const { chunks, back } = rebuild(text, 60);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.length <= 60)).toBe(true);
    expect(back).toBe(text);
  });

  it('hard-cuts text that has no break at all', () => {
    const text = 'a'.repeat(1000);
    const { chunks, back } = rebuild(text, 300);
    expect(chunks.map((c) => c.text.length)).toEqual([300, 300, 300, 100]);
    expect(back).toBe(text);
  });

  it('keeps trailing spaces after the last sentence of a long line', () => {
    const text = `${'Short sentence here. '.repeat(30)}   `;
    expect(rebuild(text, 100).back).toBe(text);
  });

  it('uses a sensible default limit', () => {
    expect(CHUNK_LIMIT).toBeGreaterThanOrEqual(500);
    expect(CHUNK_LIMIT).toBeLessThanOrEqual(1500);
  });

  it('round-trips ANY text (randomised, 400 cases)', () => {
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pieces = ['word', 'Hello', 'a', 'Dr.', '3.5', '...', '. ', '! ', '? ', '\n', '\n\n', ' ', '  ', '\t', '。', '，', 'ğüş', '😀', 'x'.repeat(40)];
    for (let n = 0; n < 400; n++) {
      let text = '';
      const length = Math.floor(rand() * 60);
      for (let i = 0; i < length; i++) text += pieces[Math.floor(rand() * pieces.length)] + (rand() < 0.5 ? ' ' : '');
      const limit = 20 + Math.floor(rand() * 80);
      const chunks = splitForRequests(text, limit);
      expect(joinChunks(chunks, chunks.map((c) => c.text))).toBe(text);
      // a chunk is never longer than the limit unless it is a single unbreakable line... which we hard-cut too
      expect(chunks.every((c) => c.text.length <= limit || !/[ .!?。\n]/.test(c.text.slice(0, limit)))).toBe(true);
    }
  });
});
