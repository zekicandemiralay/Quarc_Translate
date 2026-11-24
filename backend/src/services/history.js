// History and favourites. All the rules about what counts as "the same
// translation" live here so the translate route (old apps save automatically)
// and the history route (new apps save when you stop typing) behave the same.

const { v4: uuidv4 } = require('uuid');
const { dedupeKey, likePattern } = require('./text');

// A half-typed sentence ("H", "He", "Hel"…) that is replaced by the finished one
// within this window is dropped instead of being kept as separate history.
const TRAIL_WINDOW_MS = 30 * 1000;

const iso = (date) => date.toISOString();

function rowOut(row) {
  if (!row) return null;
  const { dedupe_key, ...rest } = row; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * Stores a translation for a user.
 *  - the same text between the same languages again → updates the existing entry
 *    (so a favourite stays a favourite and the entry moves to the top);
 *  - a prefix/extension of what was typed seconds ago → replaces that entry;
 *  - otherwise a new entry.
 * Returns the stored row.
 */
function saveTranslation(db, userId, entry, { now = () => new Date(), limit = 5000 } = {}) {
  const sourceText = entry.sourceText;
  const key = dedupeKey(sourceText);
  const stamp = iso(now());

  return db.transaction(() => {
    const same = db
      .prepare(
        `SELECT * FROM translations
          WHERE user_id = ? AND source_lang = ? AND target_lang = ? AND dedupe_key = ?
          ORDER BY updated_at DESC LIMIT 1`
      )
      .get(userId, entry.sourceLang, entry.targetLang, key);

    if (same) {
      db.prepare(
        `UPDATE translations SET translated_text = ?, detected_lang = ?, source_text = ?, updated_at = ? WHERE id = ?`
      ).run(entry.translatedText, entry.detectedLang ?? null, sourceText, stamp, same.id);
      return rowOut(db.prepare('SELECT * FROM translations WHERE id = ?').get(same.id));
    }

    // Collapse the typing trail.
    const since = iso(new Date(now().getTime() - TRAIL_WINDOW_MS));
    const recent = db
      .prepare(
        `SELECT id, dedupe_key FROM translations
          WHERE user_id = ? AND source_lang = ? AND target_lang = ? AND is_favorite = 0 AND updated_at >= ?
          ORDER BY updated_at DESC LIMIT 8`
      )
      .all(userId, entry.sourceLang, entry.targetLang, since);
    const drop = db.prepare('DELETE FROM translations WHERE id = ?');
    for (const old of recent) {
      if (old.dedupe_key && (key.startsWith(old.dedupe_key) || old.dedupe_key.startsWith(key))) drop.run(old.id);
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO translations
         (id, user_id, source_lang, detected_lang, target_lang, source_text, translated_text, dedupe_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, entry.sourceLang, entry.detectedLang ?? null, entry.targetLang, sourceText, entry.translatedText, key, stamp, stamp);

    prune(db, userId, limit);
    return rowOut(db.prepare('SELECT * FROM translations WHERE id = ?').get(id));
  })();
}

/** Keeps a user's history bounded: the oldest non-favourites go first. */
function prune(db, userId, limit) {
  const { c } = db.prepare('SELECT COUNT(*) c FROM translations WHERE user_id = ?').get(userId);
  if (c <= limit) return;
  db.prepare(
    `DELETE FROM translations WHERE id IN (
       SELECT id FROM translations WHERE user_id = ? AND is_favorite = 0
        ORDER BY updated_at ASC LIMIT ?)`
  ).run(userId, c - limit);
}

function listHistory(db, userId, { limit = 50, offset = 0, favorite = false, q = '' } = {}) {
  const where = ['user_id = ?'];
  const args = [userId];
  if (favorite) where.push('is_favorite = 1');
  if (q) {
    where.push("(source_text LIKE ? ESCAPE '\\' OR translated_text LIKE ? ESCAPE '\\')");
    const pattern = likePattern(q);
    args.push(pattern, pattern);
  }
  return db
    .prepare(`SELECT * FROM translations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
    .map(rowOut);
}

function getEntry(db, userId, id) {
  return rowOut(db.prepare('SELECT * FROM translations WHERE id = ? AND user_id = ?').get(id, userId));
}

function setFavorite(db, userId, id, favorite) {
  const result = db
    .prepare('UPDATE translations SET is_favorite = ? WHERE id = ? AND user_id = ?')
    .run(favorite ? 1 : 0, id, userId);
  return result.changes > 0;
}

function removeEntry(db, userId, id) {
  return db.prepare('DELETE FROM translations WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function clearHistory(db, userId, { keepFavorites }) {
  const sql = keepFavorites
    ? 'DELETE FROM translations WHERE user_id = ? AND is_favorite = 0'
    : 'DELETE FROM translations WHERE user_id = ?';
  return db.prepare(sql).run(userId).changes;
}

function exportAll(db, userId) {
  return db
    .prepare('SELECT * FROM translations WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map(rowOut);
}

module.exports = { saveTranslation, listHistory, getEntry, setFavorite, removeEntry, clearHistory, exportAll };
