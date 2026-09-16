const jwt = require('jsonwebtoken');

const SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'insecure-default-change-in-production' || secret === 'change-this-to-a-long-random-string') {
    throw new Error('JWT_SECRET is not configured. Set it to a long random string that matches quarc-auth.');
  }
  return secret;
};

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET());
    next();
  } catch (err) {
    res.status(401).json({ error: 'Session expired', detail: err.message });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
