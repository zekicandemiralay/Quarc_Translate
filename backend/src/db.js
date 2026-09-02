const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'translate.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    -- One row per translation a user has made. user_id comes from the shared
    -- quarc-auth JWT, so history follows the account across every device.
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
}

module.exports = { getDb, initDb };
