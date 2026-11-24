const jwt = require('jsonwebtoken');
const { ApiError } = require('../errors');

const PLACEHOLDERS = new Set(['insecure-default-change-in-production', 'change-this-to-a-long-random-string']);

/**
 * Verifies the login cookie quarc-auth issued (same JWT_SECRET in every Quarc
 * app — that is the whole shared-login mechanism). Reads the secret on every
 * request so a misconfigured server answers 500 with a clear reason instead of
 * crashing at start-up.
 */
function createAuth(getSecret) {
  return function requireAuth(req, _res, next) {
    const token = req.cookies?.token;
    if (!token) return next(new ApiError(401, 'unauthenticated', 'Not authenticated'));

    const secret = getSecret();
    if (!secret || PLACEHOLDERS.has(secret)) {
      return next(new ApiError(500, 'misconfigured', 'JWT_SECRET is not configured. Set it to the value quarc-auth uses.'));
    }
    try {
      req.user = jwt.verify(token, secret);
      if (!req.user?.id) throw new Error('token has no user id');
      next();
    } catch (err) {
      next(new ApiError(401, 'session_expired', 'Session expired', { detail: err.message }));
    }
  };
}

module.exports = { createAuth };
