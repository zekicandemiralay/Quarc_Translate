const { loadConfig } = require('./config');
const { initDb, closeDb } = require('./db');
const { createEngineClient } = require('./services/engine');
const { createApp } = require('./app');

const config = loadConfig();
const db = initDb();
const engine = createEngineClient({
  baseUrl: config.engineUrl,
  timeoutMs: config.engineTimeoutMs,
  concurrency: config.engineConcurrency,
});
const app = createApp({ config, db, engine });

const server = app.listen(config.port, () => {
  console.log(`Quarc Translate backend listening on :${config.port} (engine: ${config.engineUrl})`);
  console.log(
    `CORS: own origin, the app wrappers${config.allowedOrigins.length ? `, ${config.allowedOrigins.join(', ')}` : ''}`
  );
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  app.stop();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
