#!/usr/bin/env bash
# ============================================================
#  Quarc Translate — Health Check
#    bash check.sh
#
#  Verifies containers, the shared auth wiring, SSL, the database,
#  and reachability to the self-hosted translation engine.
#
#  Run this on the server (Linux). Under Git Bash on Windows, MSYS rewrites
#  container-absolute paths such as /app/data into C:/Program Files/Git/app/data,
#  so the database and endpoint checks report false negatives there.
# ============================================================

set -uo pipefail

# Validate Docker is available
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker is not installed or not in PATH"
  exit 1
fi

HOST="${QUARC_HOST:-quarcnet0.tail84500c.ts.net}"
PORT="${QUARC_PORT:-4003}"
BASE="https://$HOST:$PORT"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  [ OK ]  $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL]  $1"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN]  $1"; WARN=$((WARN+1)); }

# Helper function to check if a command exists
command_exists() {
  command -v "$1" &> /dev/null
}

echo ""
echo "Quarc Translate — health check"
echo "==============================="

# --- Containers ---------------------------------------------------------
echo ""
echo "Containers"
for svc in backend translate-engine frontend; do
  id=$(docker ps -q --filter "label=com.docker.compose.service=$svc" | head -1) || true
  if [ -n "$id" ]; then
    status=$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null) || status="unknown"
    if [ "$status" = "running" ]; then 
      ok "$svc is running"
    else 
      bad "$svc is $status"
    fi
  else
    bad "$svc container not found"
  fi
done

# quarc-auth lives in the Quarc_Notes repo but every app depends on it.
if docker ps --format '{{.Names}}' | grep -q '^quarc-auth$'; then
  ok "quarc-auth is running (shared login)"
else
  bad "quarc-auth not running — logins will fail. Start it from Quarc_Notes/auth."
fi

# --- Shared network -----------------------------------------------------
echo ""
echo "Networking"
if docker network ls --format '{{.Name}}' | grep -q '^quarcnet-shared$'; then
  ok "quarcnet-shared network exists"
else
  bad "quarcnet-shared missing — run: docker network create quarcnet-shared"
fi

FRONTEND=$(docker ps -q --filter "label=com.docker.compose.service=frontend" | head -1)
if [ -n "$FRONTEND" ]; then
  if docker exec "$FRONTEND" sh -c 'getent hosts quarc-auth >/dev/null 2>&1'; then
    ok "frontend can resolve quarc-auth"
  else
    bad "frontend cannot resolve quarc-auth — check the quarcnet-shared network"
  fi
fi

# --- JWT secret consistency --------------------------------------------
echo ""
echo "Shared login"
if [ -f .env ]; then
  MY_SECRET=$(grep -E '^JWT_SECRET=' .env | cut -d= -f2- | tr -d '\n' | xargs) || true
  if [ -z "$MY_SECRET" ]; then
    bad "JWT_SECRET is unset in .env"
  elif [[ "$MY_SECRET" == "change-this-to-a-long-random-string" || "$MY_SECRET" == "insecure-default-change-in-production" ]]; then
    bad "JWT_SECRET is still the placeholder value"
  else
    ok "JWT_SECRET is set"
    
    # Check if quarc-auth container is running
    AUTH_CONTAINER=$(docker ps -q --filter "name=^quarc-auth$" | head -1) || true
    if [ -n "$AUTH_CONTAINER" ]; then
      AUTH_SECRET=$(docker exec "$AUTH_CONTAINER" printenv JWT_SECRET 2>/dev/null) || true
      if [ -n "$AUTH_SECRET" ]; then
        if [ "$AUTH_SECRET" = "$MY_SECRET" ]; then
          ok "JWT_SECRET matches quarc-auth (sessions will validate)"
        else
          bad "JWT_SECRET differs from quarc-auth — logins will be rejected"
        fi
      else
        warn "couldn't read quarc-auth's JWT_SECRET to compare"
      fi
    else
      warn "quarc-auth container not running — cannot verify JWT_SECRET match"
    fi
  fi
else
  bad ".env not found — copy .env.example to .env"
fi

# --- SSL certificate ----------------------------------------------------
echo ""
echo "TLS"
EXPIRY=$(echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

if [ -n "$FRONTEND" ] && docker exec "$FRONTEND" test -f "/etc/nginx/ssl/$HOST.crt" 2>/dev/null; then
  if [ -n "$EXPIRY" ]; then
    ok "certificate mounted and readable by nginx (expires $EXPIRY)"
  else
    ok "certificate mounted and readable by nginx"
  fi
elif [ -n "$EXPIRY" ]; then
  ok "certificate is being served (expires $EXPIRY)"
elif [ -r "/var/lib/tailscale/certs/$HOST.crt" ]; then
  ok "Tailscale certificate present on host"
else
  warn "could not confirm the certificate — nginx may not be running. If the site serves HTTPS in a browser this is cosmetic; if not, run: sudo tailscale cert $HOST"
fi

# --- Database -----------------------------------------------------------
echo ""
echo "Database"
BACKEND=$(docker ps -q --filter "label=com.docker.compose.service=backend" | head -1) || true
if [ -n "$BACKEND" ]; then
  if docker exec "$BACKEND" test -f /app/data/translate.db 2>/dev/null; then
    # Use a temporary Node script file instead of inline to avoid escaping issues
    DB_CHECK_SCRIPT=$(mktemp /tmp/db_check_XXXXXX.js 2>/dev/null || echo "/tmp/db_check.js")
    cat > "$DB_CHECK_SCRIPT" << 'EOF'
const { getDb } = require('/app/src/db');
try {
  const db = getDb();
  const entries = db.prepare('SELECT COUNT(*) c FROM translations').get().c;
  const users = db.prepare('SELECT COUNT(DISTINCT user_id) c FROM translations').get().c;
  console.log(entries + " " + users);
} catch (e) {
  console.error("Database error:", e.message);
  process.exit(1);
}
EOF
    
    DB_OUTPUT=$(docker cp "$DB_CHECK_SCRIPT" "$BACKEND:/tmp/db_check.js" 2>/dev/null && \
               docker exec "$BACKEND" node /tmp/db_check.js 2>/dev/null) || true
    rm -f "$DB_CHECK_SCRIPT"
    
    if [ -n "$DB_OUTPUT" ]; then
      ENTRIES=$(echo "$DB_OUTPUT" | awk '{print $1}')
      USERS=$(echo "$DB_OUTPUT" | awk '{print $2}')
      ok "translate.db present — $ENTRIES translations across $USERS users"
    else
      warn "translate.db not accessible or empty"
    fi
  else
    warn "translate.db not created yet (normal before first login)"
  fi
else
  bad "backend container not running — cannot check database"
fi

# --- API ----------------------------------------------------------------
echo ""
echo "Endpoints"

# Check if curl is available
if ! command_exists curl; then
  warn "curl not available — skipping endpoint checks"
else
  health=$(curl -fsS --max-time 10 "$BASE/api/health" 2>/dev/null || true)
  if echo "$health" | grep -q 'quarc-translate-backend'; then
    ok "GET /api/health"
  else
    bad "GET /api/health did not respond correctly"
  fi

  # Unauthenticated calls must be rejected, not served.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/translate/languages" 2>/dev/null || echo "000")
  if [ "$code" = "401" ]; then
    ok "GET /api/translate/languages correctly requires auth (401)"
  else
    bad "GET /api/translate/languages returned $code, expected 401"
  fi

  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"username":"__nobody__","password":"__wrong__"}' 2>/dev/null || echo "000")
  if [ "$code" = "401" ]; then
    ok "POST /api/auth/login reaches quarc-auth (401 for bad credentials)"
  else
    bad "POST /api/auth/login returned $code, expected 401 — auth proxy may be misrouted"
  fi
fi

# --- Translation engine ---------------------------------------------------
echo ""
echo "Translation engine"
if [ -n "$BACKEND" ]; then
  # Create temporary Node script for checking languages
  LANG_CHECK_SCRIPT=$(mktemp /tmp/lang_check_XXXXXX.js 2>/dev/null || echo "/tmp/lang_check.js")
  cat > "$LANG_CHECK_SCRIPT" << 'EOF'
fetch('http://translate-engine:5000/languages')
  .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
  .then(langs => { console.log(langs.length); process.exit(0); })
  .catch(err => { console.error("Error:", err.message); process.exit(1); });
EOF
  
  if docker cp "$LANG_CHECK_SCRIPT" "$BACKEND:/tmp/lang_check.js" 2>/dev/null && \
     docker exec "$BACKEND" node /tmp/lang_check.js > /tmp/lt_langs 2>/dev/null; then
    LANG_COUNT=$(cat /tmp/lt_langs 2>/dev/null || echo "0")
    ok "backend can reach translate-engine ($LANG_COUNT languages available)"
    rm -f /tmp/lt_langs
  else
    bad "backend cannot reach translate-engine (check: docker compose logs translate-engine)"
  fi
  rm -f "$LANG_CHECK_SCRIPT"

  # Which models are actually resident. Empty right after a cold start is
  # normal — the first pair downloads and converts in the background.
  HEALTH_CHECK_SCRIPT=$(mktemp /tmp/health_check_XXXXXX.js 2>/dev/null || echo "/tmp/health_check.js")
  cat > "$HEALTH_CHECK_SCRIPT" << 'EOF'
fetch('http://translate-engine:5000/health')
  .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
  .then(h => { console.log((h.loaded || []).length); process.exit(0); })
  .catch(err => { console.error("Error:", err.message); process.exit(1); });
EOF
  
  LOADED=$(docker cp "$HEALTH_CHECK_SCRIPT" "$BACKEND:/tmp/health_check.js" 2>/dev/null && \
            docker exec "$BACKEND" node /tmp/health_check.js 2>/dev/null || echo "")
  rm -f "$HEALTH_CHECK_SCRIPT"
  
  if [ -n "$LOADED" ] && [ "$LOADED" != "0" ]; then
    ok "$LOADED translation model(s) loaded in memory"
  else
    warn "no translation model loaded yet — the first pair is still downloading/converting (docker compose logs -f translate-engine)"
  fi
else
  warn "backend container not running — cannot check translation engine"
fi

# --- Summary ------------------------------------------------------------
echo ""
echo "==============================="
echo "  $PASS passed, $FAIL failed, $WARN warnings"
echo ""
[ "$FAIL" -eq 0 ] || exit 1
