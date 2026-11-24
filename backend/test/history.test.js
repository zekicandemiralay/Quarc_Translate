const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { createDb } = require('../src/db');
const history = require('../src/services/history');

const entry = (over = {}) => ({
  source_lang: 'en',
  target_lang: 'tr',
  detected_lang: null,
  source_text: 'Good morning',
  translated_text: 'Günaydın',
  ...over,
});

describe('history API', () => {
  let t;
  before(async () => {
    t = await startApp();
  });
  after(() => t.close());

  const save = (body, as = 'u1') => t.api('/api/history', { method: 'POST', body, as });
  const list = (query = '', as = 'u1') => t.api(`/api/history${query}`, { as });

  test('saves, lists newest first, returns ISO timestamps', async () => {
    const a = await save(entry({ source_text: 'one', translated_text: 'bir' }));
    assert.equal(a.status, 201);
    assert.match(a.body.updated_at, /^\d{4}-\d\d-\d\dT.*Z$/);
    await save(entry({ source_text: 'two', translated_text: 'iki' }));
    const rows = (await list()).body;
    assert.deepEqual(rows.map((r) => r.source_text), ['two', 'one']);
    assert.equal(rows[0].dedupe_key, undefined, 'internal columns are not leaked');
  });

  test('the same text again updates the entry instead of duplicating it, and keeps the star', async () => {
    const first = await save(entry({ source_text: 'Thank you', translated_text: 'Teşekkürler' }), 'dupe');
    await t.api(`/api/history/${first.body.id}/favorite`, { method: 'PATCH', body: { favorite: true }, as: 'dupe' });
    const again = await save(entry({ source_text: '  thank   YOU ', translated_text: 'Teşekkür ederim' }), 'dupe');
    assert.equal(again.body.id, first.body.id);
    const rows = (await list('', 'dupe')).body;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].translated_text, 'Teşekkür ederim');
    assert.equal(rows[0].is_favorite, 1);
  });

  test('different language pair is a different entry', async () => {
    await save(entry({ source_text: 'Hello', target_lang: 'tr' }), 'pairs');
    await save(entry({ source_text: 'Hello', target_lang: 'de', translated_text: 'Hallo' }), 'pairs');
    assert.equal((await list('', 'pairs')).body.length, 2);
  });

  test('can star while saving', async () => {
    const r = await save({ ...entry({ source_text: 'starred on save' }), favorite: true }, 'star');
    assert.equal(r.body.is_favorite, 1);
  });

  test('search is literal (% and _ are not wildcards) and covers both sides', async () => {
    await save(entry({ source_text: '100% sure', translated_text: 'yüzde yüz emin' }), 'search');
    await save(entry({ source_text: 'snake_case name', translated_text: 'yılan adı' }), 'search');
    await save(entry({ source_text: 'plain', translated_text: 'sade' }), 'search');
    assert.deepEqual((await list('?q=%25', 'search')).body.map((r) => r.source_text), ['100% sure']);
    assert.deepEqual((await list('?q=_', 'search')).body.map((r) => r.source_text), ['snake_case name']);
    assert.deepEqual((await list('?q=yılan', 'search')).body.map((r) => r.source_text), ['snake_case name']);
    assert.equal((await list('?q=nothing-matches', 'search')).body.length, 0);
  });

  test('favourites filter, paging, and clamped limits', async () => {
    for (let i = 0; i < 7; i++) await save(entry({ source_text: `page item ${i}`, translated_text: `x${i}` }), 'paging');
    const all = (await list('?limit=3', 'paging')).body;
    const next = (await list('?limit=3&offset=3', 'paging')).body;
    assert.equal(all.length, 3);
    assert.equal(next.length, 3);
    assert.ok(!all.some((a) => next.some((b) => b.id === a.id)));
    assert.equal((await list('?limit=99999', 'paging')).body.length, 7);
    await t.api(`/api/history/${all[0].id}/favorite`, { method: 'PATCH', body: { favorite: true }, as: 'paging' });
    assert.equal((await list('?favorite=true', 'paging')).body.length, 1);
  });

  test('delete one, clear keeping favourites, clear everything', async () => {
    const a = await save(entry({ source_text: 'del a' }), 'del');
    const b = await save(entry({ source_text: 'del b' }), 'del');
    await save(entry({ source_text: 'del c' }), 'del');
    await t.api(`/api/history/${b.body.id}/favorite`, { method: 'PATCH', body: { favorite: true }, as: 'del' });
    assert.equal((await t.api(`/api/history/${a.body.id}`, { method: 'DELETE', as: 'del' })).status, 200);
    assert.equal((await t.api(`/api/history/${a.body.id}`, { method: 'DELETE', as: 'del' })).status, 404);
    await t.api('/api/history?keepFavorites=true', { method: 'DELETE', as: 'del' });
    assert.deepEqual((await list('', 'del')).body.map((r) => r.source_text), ['del b']);
    await t.api('/api/history', { method: 'DELETE', as: 'del' });
    assert.equal((await list('', 'del')).body.length, 0);
  });

  test('nobody can see, star or delete another account\'s entries', async () => {
    const mine = await save(entry({ source_text: 'private note' }), 'alice');
    assert.equal((await list('', 'bob')).body.length, 0);
    assert.equal((await t.api(`/api/history/${mine.body.id}/favorite`, { method: 'PATCH', body: { favorite: true }, as: 'bob' })).status, 404);
    assert.equal((await t.api(`/api/history/${mine.body.id}`, { method: 'DELETE', as: 'bob' })).status, 404);
    assert.equal((await list('', 'alice')).body.length, 1);
    await t.api('/api/history', { method: 'DELETE', as: 'bob' });
    assert.equal((await list('', 'alice')).body.length, 1, 'bob clearing his history does not touch alice\'s');
  });

  test('refuses bad ids and bad bodies', async () => {
    assert.equal((await t.api('/api/history/not-a-uuid', { method: 'DELETE' })).body.code, 'invalid_id');
    assert.equal((await save(entry({ source_text: '  ' }))).body.code, 'empty_text');
    assert.equal((await save(entry({ target_lang: 'Turkish' }))).body.code, 'invalid_language');
    assert.equal((await save(entry({ target_lang: 'auto' }))).status, 400);
    assert.equal((await save({ ...entry(), source_lang: 'auto' })).status, 201, 'auto is a valid SOURCE');
  });

  test('export as JSON and as CSV (spreadsheet formulas are defused)', async () => {
    await save(entry({ source_text: '=HYPERLINK("http://x")', translated_text: 'say "hi", twice' }), 'export');
    await save(entry({ source_text: 'plain', translated_text: 'düz' }), 'export');
    const json = await t.api('/api/history/export', { as: 'export' });
    assert.equal(json.body.length, 2);
    const csv = await t.api('/api/history/export?format=csv', { as: 'export' });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    // Response.text() strips a UTF-8 BOM, so look at the raw bytes: Excel needs it to read Turkish letters.
    const bytes = Buffer.from(await (await t.api('/api/history/export?format=csv', { as: 'export', raw: true })).arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(csv.text.startsWith('"date"'));
    assert.ok(csv.text.includes('"\'=HYPERLINK(""http://x"")"'), 'leading = is neutralised');
    assert.ok(csv.text.includes('"say ""hi"", twice"'), 'quotes are escaped');
  });
});

describe('history rules (service)', () => {
  const at = (ms) => () => new Date(ms);
  const base = Date.UTC(2026, 10, 24, 12, 0, 0);
  const row = (text, extra = {}) => ({ sourceLang: 'en', targetLang: 'tr', sourceText: text, translatedText: `t(${text})`, ...extra });

  test('typing "H","He","Hel"… within 30 s leaves one entry; the same later does not collapse', () => {
    const db = createDb(':memory:');
    ['H', 'He', 'Hel', 'Hell', 'Hello', 'Hello w', 'Hello world'].forEach((s, i) => history.saveTranslation(db, 'u', row(s), { now: at(base + i * 700) }));
    assert.deepEqual(history.listHistory(db, 'u').map((r) => r.source_text), ['Hello world']);

    history.saveTranslation(db, 'u', row('Hello world, again'), { now: at(base + 5 * 60 * 1000) });
    assert.equal(history.listHistory(db, 'u').length, 2, 'a minute later is a new translation, not typing');
  });

  test('a starred entry is never swallowed by the typing trail', () => {
    const db = createDb(':memory:');
    const first = history.saveTranslation(db, 'u', row('Good'), { now: at(base) });
    history.setFavorite(db, 'u', first.id, true);
    history.saveTranslation(db, 'u', row('Good morning'), { now: at(base + 1000) });
    assert.equal(history.listHistory(db, 'u').length, 2);
  });

  test('unrelated texts typed close together are both kept', () => {
    const db = createDb(':memory:');
    history.saveTranslation(db, 'u', row('Apple'), { now: at(base) });
    history.saveTranslation(db, 'u', row('Banana'), { now: at(base + 1000) });
    assert.equal(history.listHistory(db, 'u').length, 2);
  });

  test('history is bounded: oldest non-favourites go first, favourites stay', () => {
    const db = createDb(':memory:');
    const keep = history.saveTranslation(db, 'u', row('keep me'), { now: at(base), limit: 5 });
    history.setFavorite(db, 'u', keep.id, true);
    for (let i = 0; i < 10; i++) history.saveTranslation(db, 'u', row(`entry ${i}`), { now: at(base + (i + 1) * 120000), limit: 5 });
    const rows = history.listHistory(db, 'u', { limit: 200 });
    assert.equal(rows.length, 5);
    assert.ok(rows.some((r) => r.id === keep.id));
    assert.equal(rows[0].source_text, 'entry 9');
  });
});
