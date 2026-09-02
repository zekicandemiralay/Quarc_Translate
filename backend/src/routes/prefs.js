const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const DEFAULTS = {
  source_lang: 'auto',
  target_lang: 'en',
  theme: 'auto',
  language: 'en',
};

const ALLOWED = {
  theme: ['auto', 'light', 'dark'],
  language: ['en', 'tr'],
};

router.get('/', (req, res) => {
  const row = getDb().prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id);
  res.json(row ? { ...DEFAULTS, ...row } : { user_id: req.user.id, ...DEFAULTS });
});

router.put('/', (req, res) => {
  const patch = {};
  for (const [key, values] of Object.entries(ALLOWED)) {
    const incoming = req.body?.[key];
    if (incoming === undefined) continue;
    if (!values.includes(incoming)) {
      return res.status(400).json({ error: `${key} must be one of: ${values.join(', ')}` });
    }
    patch[key] = incoming;
  }

  // source_lang/target_lang are free-form codes (plus 'auto' for source),
  // validated client-side against the live LibreTranslate language list —
  // the server just stores whatever the picker sent so new language packs
  // work without a server change.
  if (typeof req.body?.source_lang === 'string' && req.body.source_lang.trim()) {
    patch.source_lang = req.body.source_lang.trim();
  }
  if (typeof req.body?.target_lang === 'string' && req.body.target_lang.trim()) {
    patch.target_lang = req.body.target_lang.trim();
  }

  const db = getDb();
  const current = db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id) || DEFAULTS;
  const merged = { ...DEFAULTS, ...current, ...patch, user_id: req.user.id };

  db.prepare(
    `INSERT INTO prefs (user_id, source_lang, target_lang, theme, language, updated_at)
     VALUES (@user_id, @source_lang, @target_lang, @theme, @language, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       source_lang = @source_lang, target_lang = @target_lang,
       theme = @theme, language = @language, updated_at = datetime('now')`
  ).run(merged);

  res.json(db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id));
});

module.exports = router;
