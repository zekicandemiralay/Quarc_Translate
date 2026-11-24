const express = require('express');
const { badRequest } = require('../errors');
const { cleanText, charCount } = require('../services/text');
const { saveTranslation } = require('../services/history');
const { LruCache, singleFlight } = require('../services/cache');

// A detection that disagrees with the language the user picked is only worth a
// "did you mean…?" hint when the engine is quite sure and there is enough text.
const HINT_MIN_CONFIDENCE = 0.9;
const HINT_MIN_CHARS = 12;

function createTranslateRoutes({ engine, db, config, languages }) {
  const router = express.Router();
  const memo = new LruCache(config.cacheEntries);
  const flight = singleFlight();

  const wantsSave = (userId) => {
    const row = db.prepare('SELECT save_history FROM prefs WHERE user_id = ?').get(userId);
    return row ? row.save_history !== 0 : true;
  };

  router.get('/languages', async (_req, res) => {
    res.json(await languages.list());
  });

  router.get('/status', async (_req, res) => {
    res.json(await engine.health());
  });

  router.get('/models', async (_req, res) => {
    res.json(await engine.models());
  });

  // Asks the engine to download/convert the models for a language pair in the
  // background, so choosing a new language doesn't make the first translation wait.
  router.post('/prepare', async (req, res) => {
    const { source, target } = req.body || {};
    if (typeof target !== 'string' || !target) throw badRequest('invalid_target', 'target language is required');
    if (source === 'auto' || source === target) return res.json({ queued: [] });
    const known = await languages.codes();
    if (!known.has(source) || !known.has(target)) throw badRequest('unsupported_language', 'Unsupported language');
    res.json(await engine.prepare([[source, target]]));
  });

  // "Did you mean…": Turkish typed without Turkish letters, typos, missing accents. A suggestion is a
  // convenience, never a failure: if the engine can't answer, the answer is simply "nothing to suggest".
  const suggestions = new LruCache(config.cacheEntries);
  router.post('/suggest', async (req, res) => {
    const { source = 'auto' } = req.body || {};
    const text = cleanText(req.body?.text);
    const none = { language: null, suggestion: null };
    if (typeof req.body?.text !== 'string') throw badRequest('invalid_text', 'text is required and must be a string');
    if (text.trim().length < 3) return res.json(none);
    if (charCount(text) > config.maxChars) throw badRequest('text_too_long', `text must be ${config.maxChars} characters or fewer`, { maxLength: config.maxChars });
    if (typeof source !== 'string') throw badRequest('invalid_source', 'source must be a language code or "auto"');
    if (source !== 'auto' && !(await languages.codes()).has(source)) throw badRequest('unsupported_language', `Unsupported source language: ${source}`);

    const key = `${source}\u0000${text}`;
    const hit = suggestions.get(key);
    if (hit) return res.json(hit);
    try {
      const result = await flight(`s:${key}`, () => engine.suggest({ text, source }));
      suggestions.set(key, result);
      return res.json(result);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return res.json(none); // engine down, slow or still loading: no suggestion, no error
    }
  });

  // Other translations of ONE sentence — what the app shows when you tap a sentence of the result.
  const alternatives = new LruCache(config.cacheEntries);
  router.post('/alternatives', async (req, res) => {
    const { source = 'auto', target } = req.body || {};
    const text = cleanText(req.body?.text);
    if (typeof req.body?.text !== 'string' || !text.trim()) throw badRequest('empty_text', 'text is required');
    if (charCount(text) > 600) throw badRequest('text_too_long', 'Alternatives are for one sentence (600 characters or fewer)', { maxLength: 600 });
    if (typeof target !== 'string' || !target || target === 'auto') throw badRequest('invalid_target', 'target language is required');
    if (typeof source !== 'string' || !source) throw badRequest('invalid_source', 'source must be a language code or "auto"');
    const known = await languages.codes();
    if (source !== 'auto' && !known.has(source)) throw badRequest('unsupported_language', `Unsupported source language: ${source}`);
    if (!known.has(target)) throw badRequest('unsupported_language', `Unsupported target language: ${target}`);
    if (source !== 'auto' && source === target) return res.json({ alternatives: [] });

    const key = `${source}\u0000${target}\u0000${text}`;
    const hit = alternatives.get(key);
    if (hit) return res.json(hit);
    const result = await flight(`a:${key}`, () => engine.alternatives({ text, source, target }));
    alternatives.set(key, result);
    res.json(result);
  });

  router.post('/detect', async (req, res) => {
    const text = cleanText(req.body?.text);
    if (!text.trim()) throw badRequest('empty_text', 'text is required');
    res.json(await engine.detect(text.slice(0, 2000)));
  });

  router.post('/', async (req, res) => {
    const { source = 'auto', target } = req.body || {};
    const text = cleanText(req.body?.text);

    if (typeof req.body?.text !== 'string') throw badRequest('invalid_text', 'text is required and must be a string');
    if (!text.trim()) throw badRequest('empty_text', 'text cannot be empty');
    const length = charCount(text);
    if (length > config.maxChars) {
      throw badRequest('text_too_long', `text must be ${config.maxChars} characters or fewer`, { maxLength: config.maxChars });
    }
    if (typeof target !== 'string' || !target || target === 'auto') throw badRequest('invalid_target', 'target language is required');
    if (typeof source !== 'string' || !source) throw badRequest('invalid_source', 'source must be a language code or "auto"');

    const known = await languages.codes();
    if (source !== 'auto' && !known.has(source)) throw badRequest('unsupported_language', `Unsupported source language: ${source}`);
    if (!known.has(target)) throw badRequest('unsupported_language', `Unsupported target language: ${target}`);

    // Old apps save automatically; new ones ask for save:false and save when
    // you stop typing (POST /api/history). Either way "don't keep history" wins.
    const save = req.body?.save !== false && wantsSave(req.user.id);

    let out;
    if (source !== 'auto' && source === target) {
      out = { translatedText: text, detectedLang: null, confidence: null, cached: false, hint: null, sameLanguage: true };
    } else {
      const key = `${source}\u0000${target}\u0000${text}`;
      let result = memo.get(key);
      const cached = !!result;
      if (!result) {
        // Several people (or one fast typist) asking for the same text share one engine call.
        // The caller's abort signal is deliberately not passed to a shared call.
        result = await flight(key, () => engine.translate({ text, source, target }));
        memo.set(key, result);
      }

      const detected = result.detectedLanguage?.language || null;
      const confidence = result.detectedLanguage?.confidence ?? null;
      const sameLanguage = source === 'auto' && detected === target;
      let hint = null;
      if (source !== 'auto' && detected && detected !== source && confidence >= HINT_MIN_CONFIDENCE && length >= HINT_MIN_CHARS) {
        hint = { language: detected, confidence };
      }
      out = {
        translatedText: sameLanguage ? text : result.translatedText || '',
        detectedLang: source === 'auto' ? detected : null,
        confidence: source === 'auto' ? confidence : null,
        cached,
        hint,
        sameLanguage,
        route: result.route || null,
        // The translation cut into tappable sentences (see the engine): lets the app offer alternatives.
        segments: sameLanguage ? null : result.segments || null,
        units: sameLanguage ? null : result.units || null,
      };
    }

    let id = null;
    if (save && !out.sameLanguage && out.translatedText) {
      try {
        const row = saveTranslation(
          db,
          req.user.id,
          { sourceLang: source, targetLang: target, detectedLang: out.detectedLang, sourceText: text, translatedText: out.translatedText },
          { limit: config.historyLimit }
        );
        id = row.id;
      } catch (err) {
        console.error('history save failed:', err.message);
      }
    }

    res.json({ id, ...out, sourceLang: source, targetLang: target });
  });

  return router;
}

module.exports = { createTranslateRoutes };
