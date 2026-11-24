const express = require('express');
const { badRequest } = require('../errors');
const { cleanText, charCount } = require('../services/text');
const history = require('../services/history');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG = /^[a-z]{2,3}$/;

const clampInt = (value, fallback, min, max) => Math.min(Math.max(parseInt(value, 10) || fallback, min), max);

function validId(id) {
  if (!UUID.test(String(id))) throw badRequest('invalid_id', 'Invalid translation id');
  return id;
}

function csvCell(value) {
  const s = String(value ?? '');
  // A leading = + - @ makes spreadsheets run the cell as a formula; prefix a quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function createHistoryRoutes({ db, config }) {
  const router = express.Router();

  // GET /api/history?limit=&offset=&favorite=true&q=term
  router.get('/', (req, res) => {
    const q = typeof req.query.q === 'string' ? cleanText(req.query.q).trim().slice(0, 200) : '';
    res.json(
      history.listHistory(db, req.user.id, {
        limit: clampInt(req.query.limit, 50, 1, 200),
        offset: clampInt(req.query.offset, 0, 0, 1e9),
        favorite: req.query.favorite === 'true',
        q,
      })
    );
  });

  // The app saves a translation when you stop typing, copy it, listen to it or
  // star it — not on every keystroke.
  router.post('/', (req, res) => {
    const b = req.body || {};
    const sourceText = cleanText(b.source_text);
    const translatedText = cleanText(b.translated_text);
    if (!sourceText.trim() || !translatedText.trim()) throw badRequest('empty_text', 'source_text and translated_text are required');
    if (charCount(sourceText) > config.maxChars * 4 || charCount(translatedText) > config.maxChars * 6) {
      throw badRequest('text_too_long', 'Text is too long to save');
    }
    if (!LANG.test(b.target_lang || '') || !(b.source_lang === 'auto' || LANG.test(b.source_lang || ''))) {
      throw badRequest('invalid_language', 'Invalid language code');
    }
    const detected = b.detected_lang && LANG.test(b.detected_lang) ? b.detected_lang : null;

    const row = history.saveTranslation(
      db,
      req.user.id,
      { sourceLang: b.source_lang, targetLang: b.target_lang, detectedLang: detected, sourceText, translatedText },
      { limit: config.historyLimit }
    );
    if (b.favorite === true) history.setFavorite(db, req.user.id, row.id, true);
    res.status(201).json(history.getEntry(db, req.user.id, row.id));
  });

  router.get('/export', (req, res) => {
    const rows = history.exportAll(db, req.user.id);
    if (req.query.format === 'csv') {
      const header = ['date', 'from', 'to', 'favorite', 'source', 'translation'];
      const lines = rows.map((r) =>
        [r.updated_at, r.detected_lang || r.source_lang, r.target_lang, r.is_favorite ? 'yes' : '', r.source_text, r.translated_text]
          .map(csvCell)
          .join(',')
      );
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="quarc-translate-history.csv"');
      return res.send(`﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`);
    }
    res.set('Content-Disposition', 'attachment; filename="quarc-translate-history.json"');
    res.json(rows);
  });

  // Kept for apps released before the rewrite.
  router.patch('/:id/favorite', (req, res) => {
    const id = validId(req.params.id);
    const favorite = !!req.body?.favorite;
    if (!history.setFavorite(db, req.user.id, id, favorite)) return res.status(404).json({ error: 'Not found', code: 'not_found' });
    res.json({ id, is_favorite: favorite });
  });

  router.delete('/:id', (req, res) => {
    const id = validId(req.params.id);
    if (!history.removeEntry(db, req.user.id, id)) return res.status(404).json({ error: 'Not found', code: 'not_found' });
    res.json({ ok: true });
  });

  // DELETE /api/history                    — everything
  // DELETE /api/history?keepFavorites=true — everything except starred entries
  router.delete('/', (req, res) => {
    const removed = history.clearHistory(db, req.user.id, { keepFavorites: req.query.keepFavorites === 'true' });
    res.json({ ok: true, removed });
  });

  return router;
}

module.exports = { createHistoryRoutes };
