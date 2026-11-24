const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { dedupeKey } = require('./services/text');

let db = null;

function open(dbPath) {
  const file = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'translate.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new Database(file);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  return handle;
}

function getDb() {
  if (!db) db = open();
  return db;
}

const columnsOf = (handle, table) => handle.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Schema history. `PRAGMA user_version` records how many of these have run, so
// an install from any earlier release is brought forward in place and nobody's
// history or favourites are touched. Never edit a step that has shipped — add one.
const MIGRATIONS = [
  // 1 — the original schema (v1.0.x). IF NOT EXISTS: existing installs already have it.
  (handle) => {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS translations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        detected_lang TEXT,
        target_lang TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_translations_user ON translations(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_translations_favorite ON translations(user_id, is_favorite);

      CREATE TABLE IF NOT EXISTS prefs (
        user_id TEXT PRIMARY KEY,
        source_lang TEXT NOT NULL DEFAULT 'auto',
        target_lang TEXT NOT NULL DEFAULT 'en',
        theme TEXT NOT NULL DEFAULT 'auto',
        language TEXT NOT NULL DEFAULT 'en',
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  },

  // 2 — v2 engine/app: real timestamps, duplicate detection, more preferences.
  (handle) => {
    const t = columnsOf(handle, 'translations');
    if (!t.includes('updated_at')) handle.exec('ALTER TABLE translations ADD COLUMN updated_at TEXT');
    if (!t.includes('dedupe_key')) handle.exec('ALTER TABLE translations ADD COLUMN dedupe_key TEXT');

    // The old timestamps ("2026-11-20 08:15:00", UTC but with no zone) were read by
    // the browser as local time, so History showed the wrong hour. Make them ISO-8601 UTC.
    handle.exec(`
      UPDATE translations SET created_at = replace(created_at, ' ', 'T') || 'Z'
        WHERE created_at IS NOT NULL AND created_at NOT LIKE '%T%';
      UPDATE translations SET updated_at = created_at WHERE updated_at IS NULL;
      UPDATE prefs SET updated_at = replace(updated_at, ' ', 'T') || 'Z'
        WHERE updated_at IS NOT NULL AND updated_at NOT LIKE '%T%';
    `);

    const rows = handle.prepare('SELECT id, source_text FROM translations WHERE dedupe_key IS NULL').all();
    const setKey = handle.prepare('UPDATE translations SET dedupe_key = ? WHERE id = ?');
    for (const row of rows) setKey.run(dedupeKey(row.source_text), row.id);

    handle.exec(`
      DROP INDEX IF EXISTS idx_translations_user;
      CREATE INDEX IF NOT EXISTS idx_translations_recent ON translations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_translations_dedupe ON translations(user_id, source_lang, target_lang, dedupe_key);
    `);

    const p = columnsOf(handle, 'prefs');
    if (!p.includes('live')) handle.exec('ALTER TABLE prefs ADD COLUMN live INTEGER NOT NULL DEFAULT 1');
    if (!p.includes('save_history')) handle.exec('ALTER TABLE prefs ADD COLUMN save_history INTEGER NOT NULL DEFAULT 1');
    if (!p.includes('font_size')) handle.exec("ALTER TABLE prefs ADD COLUMN font_size TEXT NOT NULL DEFAULT 'm'");
    if (!p.includes('recent_langs')) handle.exec("ALTER TABLE prefs ADD COLUMN recent_langs TEXT NOT NULL DEFAULT '[]'");
  },

  // 3 — "Did you mean…" suggestions can be switched off.
  (handle) => {
    if (!columnsOf(handle, 'prefs').includes('suggestions')) handle.exec('ALTER TABLE prefs ADD COLUMN suggestions INTEGER NOT NULL DEFAULT 1');
  },
];

function migrate(handle) {
  const current = handle.pragma('user_version', { simple: true });
  for (let step = current; step < MIGRATIONS.length; step++) {
    handle.transaction(() => {
      MIGRATIONS[step](handle);
      handle.pragma(`user_version = ${step + 1}`);
    })();
  }
}

function initDb() {
  const handle = getDb();
  migrate(handle);
  return handle;
}

/** A private database (tests): same schema, own file or memory. */
function createDb(dbPath = ':memory:') {
  const handle = open(dbPath);
  migrate(handle);
  return handle;
}

function closeDb() {
  if (db) db.close();
  db = null;
}

module.exports = { getDb, initDb, createDb, closeDb, SCHEMA_VERSION: MIGRATIONS.length };
