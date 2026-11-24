#!/usr/bin/env bash
# ============================================================
#  Quarc Translate — Data Backup
#  Run from the project directory:
#    bash backup.sh
#
#  Creates: ./backup_YYYYMMDD_HHMMSS/
#    translate.db — translation history, favorites, and per-user preferences
#    .env         — all secrets and config
#
#  Note: downloaded translation models are NOT backed up — they redownload
#  automatically into the translate_models volume on first use. Only
#  history/favorites/prefs are irreplaceable.
# ============================================================
set -e

BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR ..."

BACKEND=$(docker ps -q --filter "label=com.docker.compose.service=backend" | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not running. Start it first: docker compose up -d backend"
  exit 1
fi

# translate.db runs in WAL mode, so copying the live file could miss recent writes
# or catch a half-written page. SQLite's online backup API writes a consistent
# snapshot while the app keeps running (same approach as the Quarc Store's nightly backup).
echo "  · Exporting translate.db (consistent online snapshot) ..."
docker exec "$BACKEND" node -e "require('/app/src/db').getDb().backup('/tmp/translate-backup.db').then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })"
docker cp "$BACKEND:/tmp/translate-backup.db" "$BACKUP_DIR/translate.db"
docker exec "$BACKEND" rm -f /tmp/translate-backup.db

echo "  · Copying .env ..."
cp .env "$BACKUP_DIR/.env"

DB_SIZE=$(du -sh "$BACKUP_DIR/translate.db" | awk '{print $1}')
ENTRY_COUNT=$(docker exec "$BACKEND" node -e "console.log(require('/app/src/db').getDb().prepare('SELECT COUNT(*) c FROM translations').get().c)" 2>/dev/null || echo "?")

echo ""
echo "Backup complete: $BACKUP_DIR"
echo "  translate.db : $DB_SIZE ($ENTRY_COUNT translations)"
echo ""
echo "Next: copy this folder to the new server."
echo "  scp -r $BACKUP_DIR user@new-server:~/Quarc_Translate/"
