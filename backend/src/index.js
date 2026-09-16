const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb, getDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const translateRoutes = require('./routes/translate');
const historyRoutes = require('./routes/history');
const prefsRoutes = require('./routes/prefs');

const app = express();
const PORT = process.env.PORT || 3005;

// Configure CORS with specific origin validation
// Allows credentials for JWT cookies
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., curl, Postman)
    if (!origin) return callback(null, true);
    
    // In production, validate against expected origins
    // For Tailscale, this would typically be your Tailnet HTTPS domain
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',') : [];
    
    // If no specific origins configured, allow all (development mode)
    // This should be tightened in production
    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  try {
    // Check database connectivity
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({ 
      ok: true, 
      service: 'quarc-translate-backend',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({ 
      ok: false, 
      service: 'quarc-translate-backend',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use('/api/translate', requireAuth, translateRoutes);
app.use('/api/history', requireAuth, historyRoutes);
app.use('/api/prefs', requireAuth, prefsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

initDb();

app.listen(PORT, () => {
  console.log(`Quarc Translate backend listening on :${PORT}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Allowed origins: ${process.env.ALLOWED_ORIGINS || 'all (insecure in production)'}`);
});
