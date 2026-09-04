# Quarc Translate

A self-hosted translation app for your Quarc account — the same account as
Quarc Music, Notes, and Weather. Type or paste text, pick a source and target
language (or let it auto-detect), and get a live translation as you type.

**Features:**
- Live translation as you type, debounced so it doesn't hammer the engine on
  every keystroke
- Auto-detect source language, with a one-tap swap between source and target
- Per-account history — every translation is saved to your account, so it's
  there on every device you log in from
- Favorites — star any translation to keep it even after clearing history
- Default source/target languages, theme, and app language, all per-account
- English and Turkish interface
- Android APK with in-app updates, desktop app (Windows/macOS/Linux), and PWA
  support — install from [Releases](https://github.com/zekicandemiralay/Quarc_Translate/releases/latest)
  or just use the browser

**Translation engine:** [LibreTranslate](https://libretranslate.com), self-hosted
as its own container (`translate-engine` in `docker-compose.yml`). Free, keyless,
open source, and your text never leaves your own server — no Google/DeepL API
key to pay for or manage, same "no external account needed" philosophy as
Weather using Open-Meteo instead of a paid weather API.

---

## Part 1 — Server Setup

For the person who owns and runs the server.

### Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A machine that stays on, running [Tailscale](https://tailscale.com)
- Tailscale HTTPS Certificates enabled in the admin console
- The shared `quarc-auth` service already running (it lives in the Quarc_Notes repo
  under `auth/` — see that README). Every Quarc app depends on it for login.
- A few GB of free disk for the LibreTranslate language models (downloaded once,
  on first start, into a Docker volume)

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/zekicandemiralay/Quarc_Translate.git
cd Quarc_Translate
```

---

### Step 2 — Configure your environment

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to **exactly the same value** already used by
`quarc-auth` and every other Quarc app. That shared secret is the whole
mechanism behind one-account-everywhere: this app never sees a password, it
just verifies the token `quarc-auth` issued.

Get the current value from the running auth container:

```bash
docker exec quarc-auth printenv JWT_SECRET
```

Optionally set `LT_LOAD_ONLY` to trim which languages the translation engine
downloads (smaller image, faster first start). See the comment in `.env.example`.

---

### Step 3 — Make sure the shared network exists

```bash
docker network create quarcnet-shared   # once per server; harmless if it already exists
```

Without it the frontend container can't resolve `quarc-auth` and every login fails.

---

### Step 4 — Start the server

```bash
bash deploy.sh
```

The first start downloads LibreTranslate's language models — this can take a
few minutes depending on how many languages `LT_LOAD_ONLY` includes. Watch
progress with `docker compose logs -f translate-engine`. Every start after
that is fast, since the models persist in the `translate_models` volume.

---

### Step 5 — Access the app

```
https://quarcnet0.tail84500c.ts.net:4003
```

Log in with your existing Quarc account. There's no separate registration and no
admin setup — if you can log into Quarc Music, you can log in here.

---

### Step 6 — Verify

```bash
bash check.sh
```

This checks containers, the shared network, that your `JWT_SECRET` actually
matches `quarc-auth`'s, the TLS certificate, the database, every API endpoint,
and that the backend can reach the translation engine.

---

### Updating

```bash
git pull
bash deploy.sh
```

The database is stored in a Docker volume and survives rebuilds.

---

### Backup and restore

```bash
bash backup.sh                      # creates ./backup_YYYYMMDD_HHMMSS/
bash restore.sh ./backup_2026...    # on the new server
```

Only history/favorites/preferences are backed up — the LibreTranslate language
models redownload automatically on first start from `LT_LOAD_ONLY`, so there's
nothing else worth preserving.

---

### Ports

| App | Frontend | Backend |
|---|---|---|
| Quarc Music | 4000 | 3001 |
| quarc-auth | — | 3002 |
| Quarc Notes | 4001 | 3003 |
| Quarc Weather | 4002 | 3004 |
| **Quarc Translate** | **4003** | **3005** |

The translation engine (`translate-engine`, LibreTranslate) is internal-only —
it isn't published to the host, only `backend` talks to it.

---

### Configuration reference

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | *(insecure default)* | Must match `quarc-auth` exactly — this is what makes the shared login work |
| `LT_LOAD_ONLY` | a broad default list | Comma-separated LibreTranslate language codes to download |

---

## Part 2 — User Setup

See **[README_Users.md](README_Users.md)**.

**Short version:** Users need Tailscale installed and connected, then either open
`https://quarcnet0.tail84500c.ts.net:4003` in a browser, install the Android APK,
or install the desktop app. They log in with the same account they already use
for Quarc Music.

---

## Building the desktop and mobile apps

- **Desktop (Windows/macOS/Linux):** see [desktop/BUILD.md](desktop/BUILD.md) — a
  Tauri wrapper around the same web app.
- **Mobile (Android):** the `mobile/` folder is a Capacitor project pointing at
  the same server. `logo.png` / `mobile/resources/icon.png` are the real mark
  (from `QuarcNet/logos/bg_removed/`) but only 360×360 — regenerate platform
  icons with `npx @capacitor/assets generate` (mobile) and `npx tauri icon`
  (desktop) any time; for crisper large icons, source a higher-resolution
  export first.

## Releasing new app builds

Tag a version and push it — the workflow builds and publishes everything:

```bash
git tag v1.0.1
git push origin v1.0.1
```

`.github/workflows/desktop-release.yml` builds the Windows/macOS/Linux installers
and the signed Android APK, then publishes them to a GitHub Release. The apps
check that release for updates and install in place.

Required repository secrets: `KEYSTORE_BASE64` and `KEYSTORE_PASSWORD` for APK
signing. Reuse the same keystore approach as Quarc Music and Quarc Notes — but
note the key alias here is `quarc-translate`.
