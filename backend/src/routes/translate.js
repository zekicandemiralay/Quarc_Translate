const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const engine = require('../services/engine');

const MAX_CHARS = 5000;

// Sanitize text to prevent potential issues
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  // Remove null bytes and other control characters that could cause issues
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

router.get('/languages', async (_req, res) => {
  try {
    res.json(await engine.listLanguages());
  } catch (err) {
    res.status(502).json({ error: 'Translation engine unavailable', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const { text, source = 'auto', target } = req.body || {};

  // Input validation
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required and must be a string' });
  }
  
  const sanitizedText = sanitizeText(text);
  
  if (!sanitizedText.trim()) {
    return res.status(400).json({ error: 'text cannot be empty or whitespace only' });
  }
  
  if (sanitizedText.length > MAX_CHARS) {
    return res.status(400).json({ 
      error: `text must be ${MAX_CHARS} characters or fewer`,
      maxLength: MAX_CHARS
    });
  }
  
  if (!target || typeof target !== 'string' || !target.trim()) {
    return res.status(400).json({ error: 'target language is required' });
  }
  
  // Validate source if provided
  if (source !== 'auto' && (!source || typeof source !== 'string' || !source.trim())) {
    return res.status(400).json({ error: 'source language must be a valid code or "auto"' });
  }

  // Same concrete language on both sides — nothing to call the engine for.
  if (source !== 'auto' && source === target) {
    return res.json({ 
      id: null, 
      translatedText: sanitizedText, 
      detectedLang: null, 
      sourceLang: source, 
      targetLang: target 
    });
  }

  let result;
  try {
    result = await engine.translate({ q: sanitizedText, source, target });
  } catch (err) {
    return res.status(502).json({ error: 'Translation failed', detail: err.message });
  }

  const detectedLang = result.detectedLanguage?.language || null;
  const translatedText = result.translatedText || '';
  const id = uuidv4();

  // Sanitize the translated text as well before storing
  const sanitizedTranslated = sanitizeText(translatedText);

  try {
    getDb()
      .prepare(
        `INSERT INTO translations (id, user_id, source_lang, detected_lang, target_lang, source_text, translated_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(id, req.user.id, source, detectedLang, target, sanitizedText, sanitizedTranslated);
  } catch (dbErr) {
    // Log database error but still return the translation
    console.error('Database error:', dbErr);
    // Return success but without the id (translation won't be saved in history)
    return res.json({
      id: null,
      translatedText: sanitizedTranslated,
      detectedLang,
      sourceLang: source,
      targetLang: target,
      warning: 'Translation saved failed'
    });
  }

  res.json({
    id,
    translatedText: sanitizedTranslated,
    detectedLang,
    sourceLang: source,
    targetLang: target,
  });
});

module.exports = router;
