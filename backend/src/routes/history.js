const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const favoriteOnly = req.query.favorite === 'true';
  const db = getDb();

  const rows = favoriteOnly
    ? db
        .prepare('SELECT * FROM translations WHERE user_id = ? AND is_favorite = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(req.user.id, limit, offset)
    : db
        .prepare('SELECT * FROM translations WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(req.user.id, limit, offset);

  res.json(rows);
});

router.patch('/:id/favorite', (req, res) => {
  const db = getDb();
  const id = req.params.id;
  
  // Validate id is a valid UUID format
  if (!id || typeof id !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid translation ID format' });
  }
  
  const row = db.prepare('SELECT id FROM translations WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const favorite = req.body?.favorite !== undefined ? (req.body.favorite ? 1 : 0) : 0;
  db.prepare('UPDATE translations SET is_favorite = ? WHERE id = ?').run(favorite, id);
  res.json({ id, is_favorite: Boolean(favorite) });
});

router.delete('/:id', (req, res) => {
  const id = req.params.id;
  
  // Validate id is a valid UUID format
  if (!id || typeof id !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid translation ID format' });
  }
  
  const result = getDb().prepare('DELETE FROM translations WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// DELETE /api/history           — clears everything
// DELETE /api/history?keepFavorites=true — clears everything except starred entries
router.delete('/', (req, res) => {
  const db = getDb();
  if (req.query.keepFavorites === 'true') {
    db.prepare('DELETE FROM translations WHERE user_id = ? AND is_favorite = 0').run(req.user.id);
  } else {
    db.prepare('DELETE FROM translations WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;
