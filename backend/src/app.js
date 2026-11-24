// Builds the Express app. Dependencies (database, engine client, config) are
// passed in so tests can run the whole API against a throwaway database and a
// fake engine, with no containers.

const express = require('express');
const cookieParser = require('cookie-parser');
const { createCors } = require('./middleware/cors');
const { createAuth } = require('./middleware/auth');
const { createRateLimit } = require('./middleware/rateLimit');
const { createTranslateRoutes } = require('./routes/translate');
const { createHistoryRoutes } = require('./routes/history');
const { createPrefsRoutes } = require('./routes/prefs');
const { createLanguages } = require('./services/languages');
const { ApiError, errorBody } = require('./errors');

function createApp({ config, db, engine }) {
  const app = express();
  app.set('trust proxy', 1); // behind the nginx of this app's frontend container
  app.disable('x-powered-by');

  app.use(createCors(config.allowedOrigins));
  app.use(express.json({ limit: '256kb' })); // 5000 chars is ~20 KB even in UTF-8 worst case
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    let database = 'connected';
    try {
      db.prepare('SELECT 1').get();
    } catch {
      database = 'disconnected';
    }
    // The engine being slow or down must not make the backend look dead (it would
    // be restarted for nothing) — it is reported, not enforced.
    let engineState = 'unknown';
    try {
      const h = await engine.health();
      engineState = h.ok ? 'up' : 'degraded';
    } catch {
      engineState = 'down';
    }
    res.status(database === 'connected' ? 200 : 503).json({
      ok: database === 'connected',
      service: 'quarc-translate-backend',
      database,
      engine: engineState,
      timestamp: new Date().toISOString(),
    });
  });

  const requireAuth = createAuth(() => config.jwtSecret);
  const translateLimit = createRateLimit({ limit: config.rateLimit });
  const generalLimit = createRateLimit({ limit: 300, keyOf: (req) => `g:${req.user?.id || req.ip}` });
  const languages = createLanguages(engine);

  // express 4 does not forward rejected promises from async handlers; wrap once here.
  const wrap = (router) => {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const l of layer.route.stack) {
        const fn = l.handle;
        if (fn.length <= 3) l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
      }
    }
    return router;
  };

  app.use(
    '/api/translate',
    requireAuth,
    generalLimit,
    // translating and asking for alternatives are the same CPU work: both count against the translate limit
    (req, res, next) => (req.method === 'POST' && (req.path === '/' || req.path === '/alternatives') ? translateLimit(req, res, next) : next()),
    wrap(createTranslateRoutes({ engine, db, config, languages }))
  );
  app.use('/api/history', requireAuth, generalLimit, wrap(createHistoryRoutes({ db, config })));
  app.use('/api/prefs', requireAuth, generalLimit, wrap(createPrefsRoutes({ db })));

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'not_found', 'Not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new ApiError(400, 'invalid_json', 'Request body is not valid JSON');
    if (err.type === 'entity.too.large') err = new ApiError(413, 'too_large', 'Request is too large');
    if (!(err instanceof ApiError)) {
      if (err.name === 'AbortError' || req.aborted) return; // the client went away
      console.error(`${req.method} ${req.originalUrl}:`, err);
      err = new ApiError(500, 'internal', 'Internal server error');
    }
    res.status(err.status).json(errorBody(err));
  });

  app.stop = () => {
    translateLimit.stop();
    generalLimit.stop();
  };
  return app;
}

module.exports = { createApp };
