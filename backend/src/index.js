const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const translateRoutes = require('./routes/translate');
const historyRoutes = require('./routes/history');
const prefsRoutes = require('./routes/prefs');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quarc-translate-backend' }));

app.use('/api/translate', requireAuth, translateRoutes);
app.use('/api/history', requireAuth, historyRoutes);
app.use('/api/prefs', requireAuth, prefsRoutes);

initDb();

app.listen(PORT, () => {
  console.log(`Quarc Translate backend listening on :${PORT}`);
});
