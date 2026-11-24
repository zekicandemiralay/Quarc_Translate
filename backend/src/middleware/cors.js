// Which web pages may call this API with the user's login cookie.
//
// The cookie is SameSite=None (the Android app's page lives on another origin
// than the server), so the browser sends it from ANY site. Reflecting every
// Origin back — what the app did before — would let a page the user happens to
// open read their translation history. So only these origins are allowed:
//   - the app's own origin (the page served by this server, any port: the
//     Quarc apps share one host name),
//   - the Android/desktop wrappers (https://localhost, capacitor://localhost, tauri…),
//   - anything listed in ALLOWED_ORIGINS.

const cors = require('cors');
const { ApiError } = require('../errors');

const WRAPPER_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

const hostnameOf = (hostHeader) => String(hostHeader || '').replace(/:\d+$/, '').toLowerCase();

function originAllowed(req, extraOrigins) {
  const origin = req.get('Origin');
  if (!origin) return true; // not a cross-origin browser request (curl, same-origin GET…)
  if (WRAPPER_ORIGINS.has(origin) || extraOrigins.includes(origin)) return true;
  try {
    const host = hostnameOf(req.get('X-Forwarded-Host') || req.get('Host'));
    return !!host && new URL(origin).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

function createCors(allowedOrigins = []) {
  const middleware = cors((req, callback) => {
    const allowed = originAllowed(req, allowedOrigins);
    callback(null, { origin: allowed ? true : false, credentials: true, maxAge: 600 });
  });

  return [
    // A disallowed origin gets no CORS headers (so it can't read anything), and
    // anything that changes data is refused outright rather than executed blind.
    (req, _res, next) => {
      if (!originAllowed(req, allowedOrigins) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next(new ApiError(403, 'origin_not_allowed', 'This origin is not allowed'));
      }
      next();
    },
    middleware,
  ];
}

module.exports = { createCors, originAllowed };
