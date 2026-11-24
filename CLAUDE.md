# Quarc Translate — notes for whoever works on this next

Part of the QuarcNet suite (see `../` and the Quarc Store repo for the suite-wide conventions: shared login
`quarc-auth`, Store SSO kit, ports, release flow). This file is about this app.

## What it is

Self-hosted translation: web app + Android (Capacitor) + desktop (Tauri, opens the hosted URL). Port 4003,
package `com.quarc.translate`. Login = shared `quarc-auth` cookie (same `JWT_SECRET` everywhere). The
text never leaves the server: the engine runs the models itself.

## Architecture (v2, rewritten 2026-11)

```
browser/APK ──nginx(443,:4003)──> backend (Express+SQLite, :3005) ──> translate-engine (FastAPI, :5000, internal)
                   └─ /api/auth/* ──> quarc-auth
```

### translate-engine/ (Python 3.11, CTranslate2 int8, CPU)

| File | Job |
|---|---|
| `service.py` / `app.py` | HTTP (`/translate /detect /languages /models /models/prepare /health`). `app.py` is just `create_app()` for uvicorn. |
| `pipeline.py` | `Engine.translate()`: detect → plan → lines/sentences → protect → run model(s) → restore → relayout. `run_model` is the only code touching CTranslate2 (injectable for tests). |
| `routes.py` + `model_pins.py` | Which model serves which pair: dedicated → pivot through English (both halves dedicated) → NLLB. `model_pins.py` is **generated** (`tools/pin_models.py`), pins every model to an exact HF revision. |
| `store.py` | `ModelStore`: per-model load locks, LRU by RAM budget, in-use models never evicted, serialized priority download queue, failure cool-down, corrupt model → deleted and re-fetched. |
| `provision.py` | Download/convert into `<key>.tmp`, marker file `quarc.json` written last, atomic rename. NLLB = prebuilt CT2 files (no PyTorch, no RAM spike); Marian = convert (PyTorch imported only here). |
| `textproc.py` | Pure text logic: lines/bullets, sentence split (abbreviations, ordinals), `QZ0` placeholders for URLs/emails/@/`code`, ALL CAPS (Turkish i/İ), tidy. |
| `detect.py` | script → unique letters → py3langid among what's left; confidence reduced for short text. |
| `languages.py` | The 56-language registry (+ NLLB FLORES codes, scripts, rtl). Adding a language = one row. |

A model that is still downloading is **never** a hang or crash: the engine answers
`503 {detail:{code:"model_preparing", stage, pct, pair, retryAfter}}`; the backend relays it (same fields); the app shows
`EngineNotice` and retries (`lib/translator.js`).

### backend/ (Node 20, Express, better-sqlite3 12)

`app.js` builds the app from injected `{config, db, engine}` (tests use a fake engine + `:memory:` DB).
`services/engine.js` = the only place that knows the engine's HTTP shape; maps failures to `ApiError(status, code, …)`.
Every error leaves as `{error, code, …details}`; the app reacts to `code`. `db.js` has **versioned migrations**
(`PRAGMA user_version`) — never edit a shipped step, add one. `middleware/cors.js` is an allow-list (own host any port,
Android/desktop wrappers, `ALLOWED_ORIGINS`) — the suite's other apps still reflect every origin with credentials.

API compatibility with apps from before v2: `POST /api/translate` saves history unless `save:false` (new apps pass it and
call `POST /api/history` when you stop typing); `PATCH /api/history/:id/favorite` and the old response fields stay.
"Typing trail" collapse in `services/history.js` cleans the "H","He","Hel" entries old apps produce.

### frontend/ (React 18, Vite, Tailwind, zustand, i18next, lucide-react)

`lib/translator.js` (chunking via `lib/segments.js`, per-chunk cache, 2 parallel requests, waits out `model_preparing`,
retries) has no React in it and is unit-tested directly. `pages/Translate/Translate.jsx` reads the latest state through
`latest` ref — keep it that way (async callbacks must not see stale state). The Store SSO kit files
(`components/RequiredUpdateGate, StoreLoginButton, StorePromo, UpdateBanner`, `lib/storeSso.js`, `lib/updateCheck.js`,
`store/authStore.js`, `updateStore.js`) are copies from `Quarc_Store/sso-kit` — don't restyle/fork them.
No third-party requests (no web fonts, no CDN): the app also runs offline-first.

### mobile/ (Capacitor 6)

`IncomingTextPlugin.java` (JS name `IncomingText`): `ACTION_SEND text/plain` + `ACTION_PROCESS_TEXT`; web side is
`lib/incoming.js` (also parses `?text=` for the PWA share target). Compile-verified; **not verified on a device**.

## Decisions worth knowing (with the measurements behind them)

- NLLB-1.3B over 600M; dedicated models wherever they match NLLB (round-trip chrF within 2 points, 8 sentences/language,
  see `tools/pin_models.py` for the accepted list and what was rejected: ru, zh, ja, ko, hi, vi, uk, ro, az, ur…). ~10× faster.
- Placeholders must be letters+digit (`QZ0`). `[[0]]`, `<0>`, `{0}`, `§0§` were all stripped by the models.
- NLLB: `repetition_penalty=1.2` (fixes "Thank you so much! Thank you!"), `clean_up_tokenization_spaces=True`, and never set
  `tokenizer.src_lang` (shared state, requests run in parallel) — `_encode` builds the token list by hand.
- NLLB is downloaded **prebuilt** (OpenNMT's CT2 int8). Converting `facebook/nllb-…` needs 2.5–5.5 GB of RAM on the box that
  also runs 8 other apps. `ENGINE_MEM_LIMIT` (4500m) caps the container.
- Live translation no longer saves each pause: the app saves after 2.5 s idle / copy / listen / star.

## Testing

```
backend$  npm test                         # 59
frontend$ npm test                         # 59
engine$   python -m pytest tests           # 99 (no models)
engine$   QUARC_REAL_MODELS=1 QUARC_REAL_MODELS_DIR=<dir> python -m pytest tests/test_real_models.py -v   # 10, real models, ~3 min + ~2 GB
```

Browser end-to-end (the recipe that was used): quarc-auth from `Quarc_Store/auth`, the backend, a real engine on a
`MODEL_DIR`, `vite preview` with `VITE_AUTH_PROXY_TARGET`/`VITE_API_PROXY_TARGET`, then playwright-core + Edge
(`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`). Use ports other than 3902/4173 — the owner runs their
own copies. Not in the repo (needs Edge); the scenarios were: sign-up, live translate, no history spam, layout/emails/caps,
detect + same-language flip + wrong-language hint + swap, star/saved/search/delete/use-again, settings (live off, private,
Turkish UI, text size, packs), long text, first-use download banner, phone layout, expired session.

## Gotchas

- **Windows + Python multiprocessing**: some library spawns child processes that re-import your script; lab scripts need an
  `if __name__ == "__main__":` guard or conversions race each other. (Linux/Docker uses fork — not an issue there.)
- ctranslate2 4.5.0 imports `pkg_resources` → `setuptools<81` is pinned in `requirements.txt`.
- `low_cpu_mem_usage` in the converter needs `accelerate`; we don't use it (the Marian models are small).
- Local Android build: `JAVA_HOME` = Android Studio's `jbr`, Gradle 8.5 in the wrapper (8.2.1 can't run on JDK 21), and
  **`local.properties` must use forward slashes** (`sdk.dir=C\:/Users/…`) — backslashes are Java escapes and produce
  "Invalid file path". Never commit the wrapper change.
- nginx: an `add_header` inside a `location` silently drops the server-level security headers; use `expires` for cache rules.
- Backend CORS compares the `Origin`'s hostname with `X-Forwarded-Host`/`Host` (nginx must send `$http_host`).
- Proton Drive sync can revert edits and create `*(# Name clash …#)*` copies: after edits, `git status`/`git diff`; commit
  with explicit paths.
- Deploy order: server first, then release app builds (old apps work against a newer server, not the reverse).
- Store promo window for this app is versions `< 1.0.12` (`sso-kit` `STORE_PROMO_UNTIL`); a minor bump ends it early.

## Not done / ideas

Document translation (txt/srt/docx), camera/OCR, speech input (needs a native plugin on Android WebView), a glossary
("always translate X as Y" — placeholders can't enforce target words), a word-level dictionary view, optional cloud engine
for the very hardest text (would send text off-server: the owner's call).
