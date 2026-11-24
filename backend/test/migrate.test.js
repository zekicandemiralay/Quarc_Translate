const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createDb, SCHEMA_VERSION } = require('../src/db');

// The database exactly as v1.0.x created it — the thing a real server has on disk.
function makeV1(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE translations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_lang TEXT NOT NULL, detected_lang TEXT,
      target_lang TEXT NOT NULL, source_text TEXT NOT NULL, translated_text TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE INDEX idx_translations_user ON translations(user_id, created_at);
    CREATE INDEX idx_translations_favorite ON translations(user_id, is_favorite);
    CREATE TABLE prefs (
      user_id TEXT PRIMARY KEY, source_lang TEXT NOT NULL DEFAULT 'auto', target_lang TEXT NOT NULL DEFAULT 'en',
      theme TEXT NOT NULL DEFAULT 'auto', language TEXT NOT NULL DEFAULT 'en', updated_at TEXT DEFAULT (datetime('now')));
  `);
  const ins = db.prepare('INSERT INTO translations (id, user_id, source_lang, target_lang, source_text, translated_text, is_favorite, created_at) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('11111111-1111-1111-1111-111111111111', 'zeki', 'tr', 'en', '  Merhaba   DÜNYA ', 'Hello world', 1, '2026-10-01 09:30:00');
  ins.run('22222222-2222-2222-2222-222222222222', 'zeki', 'en', 'tr', 'Thanks', 'Teşekkürler', 0, '2026-10-02 18:45:10');
  db.prepare("INSERT INTO prefs (user_id, source_lang, target_lang, theme, language, updated_at) VALUES ('zeki','tr','en','dark','tr','2026-10-03 08:00:00')").run();
  db.close();
}

test('an existing v1 server database is upgraded in place without losing anything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-translate-'));
  const file = path.join(dir, 'translate.db');
  try {
    makeV1(file);

    const db = createDb(file);
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);

    const rows = db.prepare('SELECT * FROM translations ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].is_favorite, 1, 'favourites survive');
    assert.equal(rows[0].translated_text, 'Hello world');
    assert.equal(rows[0].created_at, '2026-10-01T09:30:00Z', 'timestamps become real ISO-8601 UTC');
    assert.equal(rows[0].updated_at, rows[0].created_at);
    assert.equal(rows[0].dedupe_key, 'merhaba dünya', 'existing rows get a duplicate-detection key');
    assert.equal(new Date(rows[1].created_at).toISOString(), '2026-10-02T18:45:10.000Z');

    const prefs = db.prepare('SELECT * FROM prefs').get();
    assert.equal(prefs.theme, 'dark');
    assert.equal(prefs.language, 'tr');
    assert.equal(prefs.live, 1);
    assert.equal(prefs.save_history, 1);
    assert.equal(prefs.font_size, 'm');
    assert.equal(prefs.recent_langs, '[]');
    assert.equal(prefs.updated_at, '2026-10-03T08:00:00Z');
    db.close();

    // Opening it again changes nothing (migrations are one-way and run once).
    const again = createDb(file);
    assert.equal(again.prepare('SELECT COUNT(*) c FROM translations').get().c, 2);
    assert.equal(again.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a brand-new database gets the full schema', () => {
  const db = createDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(translations)').all().map((c) => c.name);
  for (const c of ['id', 'user_id', 'source_text', 'translated_text', 'is_favorite', 'created_at', 'updated_at', 'dedupe_key']) {
    assert.ok(cols.includes(c), `translations.${c}`);
  }
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  db.close();
});
