const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const engine = require('../services/engine');

const MAX_CHARS = 5000;

router.get('/languages', async (_req, res) => {
  try {
    res.json(await engine.listLanguages());
  } catch (err) {
    res.status(502).json({ error: 'Translation engine unavailable', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { text, source = 'auto', target } = req.body || {};

  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_CHARS) return res.status(400).json({ error: `text must be ${MAX_CHARS} characters or fewer` });
  if (!target) return res.status(400).json({ error: 'target is required' });

  // Same concrete language on both sides — nothing to call the engine for.
  if (source !== 'auto' && source === target) {
    return res.json({ id: null, translatedText: text, detectedLang: null, sourceLang: source, targetLang: target });
  }

  let result;
  try {
    result = await engine.translate({ q: text, source, target });
  } catch (err) {
    return res.status(502).json({ error: 'Translation failed', detail: err.message });
  }

  const detectedLang = result.detectedLanguage?.language || null;
  const id = uuidv4();

  getDb()
    .prepare(
      `INSERT INTO translations (id, user_id, source_lang, detected_lang, target_lang, source_text, translated_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(id, req.user.id, source, detectedLang, target, text, result.translatedText);

  res.json({
    id,
    translatedText: result.translatedText,
    detectedLang,
    sourceLang: source,
    targetLang: target,
  });
});

module.exports = router;
