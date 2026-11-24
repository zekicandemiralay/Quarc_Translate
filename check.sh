#!/usr/bin/env bash
# ============================================================
#  Quarc Translate — Health Check
#    bash check.sh
#
#  Verifies containers, the shared auth wiring, SSL, the database, and the
#  self-hosted translation engine: which language packs are ready, memory and
#  disk headroom, and a real translation end to end.
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

# quarc-auth lives in the Quarc_Store repo but every app depends on it.
if docker ps --format '{{.Names}}' | grep -q '^quarc-auth$'; then
  ok "quarc-auth is running (shared login)"
else
  bad "quarc-auth not running — logins will fail. Start it from Quarc_Store: bash deploy.sh auth"
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
  # One script, run inside the backend container (it can reach the engine by name).
  # It prints "KEY value" lines that are turned into OK/WARN/FAIL below.
  ENGINE_REPORT=$(docker exec -i "$BACKEND" node - 2>/dev/null <<'JS'
const base = 'http://translate-engine:5000';
const get = async (p) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
(async () => {
  try {
    const h = await get('/health');
    const langs = await get('/languages');
    console.log('LANGS', langs.length);
    console.log('VERSION', h.version);
    console.log('RAM', h.ramUsedMb + '/' + h.ramBudgetMb);
    console.log('LOADED', (h.loaded || []).length);
    console.log('READY', (h.ready || []).length);
    console.log('PREPARING', (h.preparing || []).map((m) => m.key + ':' + m.state + (m.pct != null ? ':' + m.pct + '%' : '')).join(',') || '-');
    console.log('FAILED', (h.failed || []).map((m) => m.key + ': ' + m.error).join(' | ') || '-');
  } catch (e) { console.log('DOWN', e.message); return; }
  // A real translation, if the Turkish pack is already there (this never forces a download).
  try {
    const r = await fetch(base + '/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'Thank you very much.', source: 'en', target: 'tr' }), signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (r.ok) console.log('TRANSLATE_OK', JSON.stringify(j.translatedText), (j.route && j.route.ms) + 'ms');
    else if (r.status === 503) console.log('TRANSLATE_WAIT', j.detail && j.detail.stage);
    else console.log('TRANSLATE_FAIL', r.status, JSON.stringify(j.detail || j));
  } catch (e) { console.log('TRANSLATE_FAIL', e.message); }
})();
JS
) || true

  if echo "$ENGINE_REPORT" | grep -q '^LANGS'; then
    ok "engine answers ($(echo "$ENGINE_REPORT" | awk '/^LANGS/{print $2}') languages, v$(echo "$ENGINE_REPORT" | awk '/^VERSION/{print $2}'))"
    ok "language packs on disk: $(echo "$ENGINE_REPORT" | awk '/^READY/{print $2}'), in memory: $(echo "$ENGINE_REPORT" | awk '/^LOADED/{print $2}')"
    echo "         memory used by models: $(echo "$ENGINE_REPORT" | awk '/^RAM/{print $2}') MB"

    PREP=$(echo "$ENGINE_REPORT" | sed -n 's/^PREPARING //p')
    if [ "$PREP" != "-" ] && [ -n "$PREP" ]; then
      warn "still downloading: $PREP (normal after a fresh install — docker compose logs -f translate-engine)"
    fi
    FAILED=$(echo "$ENGINE_REPORT" | sed -n 's/^FAILED //p')
    if [ "$FAILED" != "-" ] && [ -n "$FAILED" ]; then
      bad "a language pack failed: $FAILED"
    fi

    case "$(echo "$ENGINE_REPORT" | grep '^TRANSLATE_' | head -1)" in
      TRANSLATE_OK*)   ok "test translation: $(echo "$ENGINE_REPORT" | sed -n 's/^TRANSLATE_OK //p')" ;;
      TRANSLATE_WAIT*) warn "English->Turkish pack not ready yet ($(echo "$ENGINE_REPORT" | sed -n 's/^TRANSLATE_WAIT //p')) — run this again in a few minutes" ;;
      *)               bad "test translation failed: $(echo "$ENGINE_REPORT" | sed -n 's/^TRANSLATE_FAIL //p')" ;;
    esac
  else
    bad "backend cannot reach translate-engine ($(echo "$ENGINE_REPORT" | sed -n 's/^DOWN //p')) — docker compose logs translate-engine"
  fi

  # Room for language packs, and signs the engine ran out of memory.
  ENGINE=$(docker ps -q --filter "label=com.docker.compose.service=translate-engine" | head -1)
  if [ -n "$ENGINE" ]; then
    FREE_MB=$(docker exec "$ENGINE" df -Pm /models 2>/dev/null | awk 'NR==2{print $4}')
    if [ -n "$FREE_MB" ]; then
      if [ "$FREE_MB" -lt 1500 ]; then
        bad "only ${FREE_MB} MB free for language packs (each takes 0.1–1.4 GB)"
      elif [ "$FREE_MB" -lt 4000 ]; then
        warn "${FREE_MB} MB free for language packs — getting low"
      else
        ok "${FREE_MB} MB free for language packs"
      fi
    fi
    OOM=$(docker inspect -f '{{.State.OOMKilled}}' "$ENGINE" 2>/dev/null || echo false)
    RESTARTS=$(docker inspect -f '{{.RestartCount}}' "$ENGINE" 2>/dev/null || echo 0)
    if [ "$OOM" = "true" ]; then
      bad "the engine was killed for using too much memory — lower MODEL_RAM_MB or raise ENGINE_MEM_LIMIT in .env"
    elif [ "${RESTARTS:-0}" -gt 3 ]; then
      warn "the engine has restarted $RESTARTS times — docker compose logs translate-engine"
    fi
  fi
  if command_exists free; then
    AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
    if [ -n "$AVAIL_MB" ] && [ "$AVAIL_MB" -lt 1200 ]; then
      warn "only ${AVAIL_MB} MB of RAM available on this machine"
    fi
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
