// Per-user token bucket. Live translation fires a request each time typing
// pauses, so a normal person stays far below the limit; a runaway script or a
// buggy client is slowed down before it can pin the engine's CPUs.

const { ApiError } = require('../errors');

function createRateLimit({ limit, windowMs = 10000, keyOf = (req) => req.user?.id || req.ip, now = Date.now }) {
  const buckets = new Map();
  const refillPerMs = limit / windowMs;

  // Forget buckets that have refilled completely, so the map can't grow forever.
  const sweep = setInterval(() => {
    const t = now();
    for (const [key, b] of buckets) if (t - b.at > windowMs * 2) buckets.delete(key);
  }, windowMs * 3);
  sweep.unref?.();

  const middleware = (req, res, next) => {
    const key = keyOf(req);
    const t = now();
    const b = buckets.get(key) || { tokens: limit, at: t };
    b.tokens = Math.min(limit, b.tokens + (t - b.at) * refillPerMs);
    b.at = t;
    if (b.tokens < 1) {
      buckets.set(key, b);
      const retryAfter = Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000));
      res.set('Retry-After', String(retryAfter));
      return next(new ApiError(429, 'rate_limited', 'Too many requests — slow down a little', { retryAfter }));
    }
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
  middleware.stop = () => clearInterval(sweep);
  return middleware;
}

module.exports = { createRateLimit };
