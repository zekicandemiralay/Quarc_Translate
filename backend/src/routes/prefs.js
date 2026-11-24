const express = require('express');
const { badRequest } = require('../errors');

// One table of what a preference is and how it is checked, so adding one is a
// single line (and a column in db.js) instead of another block of if-statements.
const LANG = /^[a-z]{2,3}$/;
const isLang = (v) => typeof v === 'string' && LANG.test(v);

const SPEC = {
  source_lang: { default: 'auto', check: (v) => v === 'auto' || isLang(v), hint: '"auto" or a language code' },
  target_lang: { default: 'en', check: isLang, hint: 'a language code' },
  theme: { default: 'auto', check: (v) => ['auto', 'light', 'dark'].includes(v), hint: 'auto, light or dark' },
  language: { default: 'en', check: (v) => ['en', 'tr'].includes(v), hint: 'en or tr' },
  font_size: { default: 'm', check: (v) => ['s', 'm', 'l', 'xl'].includes(v), hint: 's, m, l or xl' },
  live: { default: 1, check: (v) => typeof v === 'boolean' || v === 0 || v === 1, store: (v) => (v ? 1 : 0), out: (v) => v !== 0, hint: 'true or false' },
  save_history: { default: 1, check: (v) => typeof v === 'boolean' || v === 0 || v === 1, store: (v) => (v ? 1 : 0), out: (v) => v !== 0, hint: 'true or false' },
  recent_langs: {
    default: '[]',
    check: (v) => Array.isArray(v) && v.length <= 12 && v.every(isLang),
    store: (v) => JSON.stringify([...new Set(v)]),
    out: (v) => {
      try {
        return JSON.parse(v);
      } catch {
        return [];
      }
    },
    hint: 'a list of up to 12 language codes',
  },
};

const KEYS = Object.keys(SPEC);

function shape(row, userId) {
  const out = { user_id: userId };
  for (const key of KEYS) {
    const raw = row && row[key] !== undefined && row[key] !== null ? row[key] : SPEC[key].default;
    out[key] = SPEC[key].out ? SPEC[key].out(raw) : raw;
  }
  return out;
}

function createPrefsRoutes({ db }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(shape(db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id), req.user.id));
  });

  router.put('/', (req, res) => {
    const body = req.body || {};
    const patch = {};
    for (const key of KEYS) {
      if (body[key] === undefined) continue;
      if (!SPEC[key].check(body[key])) throw badRequest('invalid_pref', `${key} must be ${SPEC[key].hint}`);
      patch[key] = SPEC[key].store ? SPEC[key].store(body[key]) : body[key];
    }

    const current = db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id) || {};
    const merged = { user_id: req.user.id };
    for (const key of KEYS) merged[key] = patch[key] ?? current[key] ?? SPEC[key].default;

    db.prepare(
      `INSERT INTO prefs (user_id, ${KEYS.join(', ')}, updated_at)
       VALUES (@user_id, ${KEYS.map((k) => `@${k}`).join(', ')}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(user_id) DO UPDATE SET ${KEYS.map((k) => `${k} = @${k}`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).run(merged);

    res.json(shape(db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id), req.user.id));
  });

  return router;
}

module.exports = { createPrefsRoutes, SPEC };
