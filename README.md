# Quarc Translate

A self-hosted translation app for your Quarc account — the same account as Quarc
Music, Notes, Weather and the rest. Type, paste or share text into it, and it
translates as you type, between 56 languages, on **your own server**: free,
keyless, no quota, and your text never leaves your machine.

**What it does**

- **Live translation** that keeps your layout — paragraphs, blank lines, bullet
  lists, indentation — and long texts arrive piece by piece
- **Language detection** that is hard to fool (writing system first, then
  letters unique to a language, then statistics) with a "Looks like Turkish —
  translate from Turkish?" hint when you picked the wrong source, and an
  automatic target switch when the text is already in your target language
- **Emails, links and `@handles` are never mangled** (a translation model will
  happily turn `support@example.com` into `Destek@example.com`; this one can't)
- **"Did you mean…"** for typos in the major languages, and for **Turkish typed without
  ç ğ ı ö ş ü** (`bugun hava cok guzel` → `bugün hava çok güzel`) — one tap to accept, never automatic
- **Alternative translations**: tap any sentence of the result to see the model's other
  candidates and swap just that sentence
- **Listen** to either side with the device's own voices, **copy**, **share**, **star**
- **History and saved translations** per account: search, day groups, export
  (JSON / CSV), a "don't keep my history" switch
- **Android**: appears in the **Share** sheet and as **Translate** in the
  text-selection menu of any app; also a PWA share target
- English and Turkish interface; language names shown in your language
  ("Almanca" and "Deutsch" both find German)
- Android APK with in-app updates and Quarc Store sign-in, desktop apps
  (Windows/macOS/Linux) and PWA — [Releases](https://github.com/zekicandemiralay/Quarc_Translate/releases/latest)

---

## How translation works

Three tiers, picked automatically per language pair (`translate-engine/routes.py`):

| Tier | Used for | Speed | RAM |
|---|---|---|---|
| **Dedicated model** — one trained for exactly that pair ([Helsinki OPUS-MT](https://huggingface.co/Helsinki-NLP)) | Turkish, German, French, Spanish, Italian, Greek, Czech, Finnish, Hungarian, Indonesian, Slovak, Hebrew **↔ English**; English → Portuguese, Arabic, Dutch, Catalan, Lithuanian, Albanian; Polish, Swedish, Danish, Thai, Estonian, Latvian, Icelandic → English | ~0.3 s a sentence | 0.1–0.3 GB |
| **Through English** — two dedicated models chained | any pair where both halves are dedicated, e.g. German → Turkish = German → English → Turkish | ~0.6 s | 0.2–0.6 GB |
| **NLLB-200** (1.3B, [facebook](https://huggingface.co/facebook/nllb-200-distilled-1.3B)) | everything else — ~200 languages' worth | ~1.2 s a sentence | ~1.5 GB |

Everything runs through [CTranslate2](https://github.com/OpenNMT/CTranslate2) at
int8, on the CPU. Models are downloaded the first time a language is used (the
app shows the progress) and kept on a Docker volume.

### Model quality — what was measured

The old engine sent everything except Turkish↔English to NLLB-**600M**. Measured on
this hardware (8 test sentences per language):

- NLLB-1.3B is clearly better than 600M (more natural phrasing, fewer grammar slips).
- A dedicated model matches or beats NLLB-1.3B on the pairs above while being
  **~10× faster** (0.9 s against 10.1 s for 8 sentences, EN→TR) and using a fifth of the RAM.
- Translating through English with two dedicated models was as good as NLLB's direct route.
- Not every dedicated model is good: `opus-mt-ru-en` (66.9 vs 80.3 chrF on the round
  trip), the zh/ja models, `tc-big-en-ko` (unusable without a target tag), hi, vi, uk,
  ro and az all scored below NLLB, so **those stay on NLLB**. A dedicated model is
  only used for a direction where its round trip is within 2 chrF points of NLLB's.
  `translate-engine/tools/pin_models.py` lists the accepted pairs and why.

This is a regression guard on 8 sentences, not a benchmark. Honest expectation:
Turkish ↔ English and the major European languages are very good; long literary or
idiomatic text, slang and rare languages are where it falls short of Google/DeepL.

Things the engine does that a bare model doesn't (all in `translate-engine/`):

- takes the text apart (lines → sentences, aware of abbreviations like "Dr." and
  ordinals like "3. Mai"), translates only the sentences, and puts the exact layout back
- replaces URLs/emails/`@handles`/`` `code` `` with placeholders the model copies
  verbatim (`QZ0` survived 8/8 round trips; `[[0]]`, `<0>`, `{0}` were eaten), and
  redoes any sentence whose placeholder got lost
- translates ALL CAPS as a normal sentence and shouts the result back (Turkish `i/İ` aware)
- repetition penalty on NLLB (it otherwise echoes "Thank you so much! Thank you!"),
  clean-up of its spaced punctuation (`How are you ?`)
- never mutates the shared tokenizer (requests run in parallel)

---

## "Did you mean…" and alternative translations

**Suggestions** (`translate-engine/suggest.py`, `spelling.py`, `turkish.py`) run next to the
translation and never delay it. The chip under the text box shows the corrected text with the
changed words marked; **nothing changes unless the person taps Use**. Switch off per account in Settings.

| What | How |
|---|---|
| Turkish without `ç ğ ı ö ş ü` | Zemberek's deasciifier (context-aware: `ise gitmem` → `işe gitmem`, `hava güzel ise` stays) — add-only: it may add a letter, never remove one |
| Typos and missing accents (en de fr es it pt nl sv pl ca cs fi ru uk no) | Candidates one/two keyboard slips away, looked up in word-frequency lists; weighted by how likely the slip is (missing letter, swap, doubled letter ≫ random key) |
| Turkish typos | Same idea against Zemberek's root lexicon + the attested forms, with vowel harmony and strict inflection rules, so `evlerimizdekilerden` is not a typo |
| Language left on "Detect" | Text with no Turkish letters that becomes real Turkish words once restored is Turkish whatever the statistical detector says (it calls `bugun hava cok guzel` Dutch). Otherwise the word lists vote when detection is unsure |

**Precision first** — a wrong "correction" is worse than a missed typo, so it never touches capitalised words
(names), acronyms, camelCase, words with digits/underscores/apostrophes, URLs/emails, or anything under 3
letters; and it stays silent when two candidates are about equally likely (`thn` → then/than).

Measured with `translate-engine/tools/eval_suggest.py` (1,666 correct words in 8 languages, 49 Turkish sentences
with the letters stripped, ~400 injected keyboard typos):

| | Result |
|---|---|
| **Correct words wrongly changed** | **0 of 1,666** |
| Turkish letters restored | 386/386 words, 49/49 sentences exact; offered 49/49 with the language on "Detect" |
| Other languages' text mistaken for ASCII-Turkish | 0 of 146 sentences (as written, and lower-cased with accents stripped) |
| Typos fixed | en 92%, nl 88%, es 87%, it 85%, de 82%, fr 77%, pt 69%, **tr 53%** |
| Typos "fixed" to the wrong word | 0–3 per language; Turkish 7 of 64 offered |

Honest limits: Turkish typo recall is the weak spot (agglutination makes "is this a word?" hard without the 180 MB
Zemberek analyzer, which was measured and rejected as too heavy for this box); very short garbled words are left
alone; common misspellings that web text also contains (`recieve`) are only caught if the slip is unmistakable;
words the lists don't know are never "corrected" if capitalised. It is a regression guard on my own test sets,
not a benchmark. Data: [wordfreq](https://github.com/rspeer/wordfreq) (CC BY-SA 4.0) and Zemberek (Apache-2.0).
Cost: ~35 MB for Turkish, ~15–30 MB per language word list (4 kept in RAM, `SPELL_MAX_DICTS`), ~180 MB in the image.

**Alternative translations** — the engine returns every translation cut into sentences (`segments` + `units`).
Tapping a sentence asks `POST /api/translate/alternatives`: the model's beam-search n-best for that one sentence,
cleaned like a normal translation (links kept, capitals restored), near-duplicates removed, the shown one marked.
Picking one swaps just that sentence and updates the history entry. On a route through English only the last
step varies. Answers are remembered, so reopening a sentence is instant.

---

## Part 1 — Server setup

### Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A machine that stays on, running [Tailscale](https://tailscale.com) with HTTPS certificates enabled
- The shared `quarc-auth` service running (it lives in `Quarc_Store/auth` — every Quarc app logs in through it)
- **Disk**: ~2 GB for the engine image, then 0.1–0.3 GB per dedicated pair and 1.4 GB for the general model, on the `translate_models` volume
- **RAM**: ~2.6 GB for models by default (`MODEL_RAM_MB`), within a 4.5 GB container ceiling (`ENGINE_MEM_LIMIT`).
  On a small machine set `NLLB_MODEL=600M` and `MODEL_RAM_MB=1200`.

### Steps

```bash
git clone https://github.com/zekicandemiralay/Quarc_Translate.git
cd Quarc_Translate
cp .env.example .env            # then set JWT_SECRET = the value quarc-auth uses
docker exec quarc-auth printenv JWT_SECRET      # to read it
docker network create quarcnet-shared           # once per server; harmless if it exists
bash deploy.sh
bash check.sh
```

`deploy.sh` builds the engine (slow the first time: PyTorch is needed once to
convert models), the backend and the web app. The app works at once; the first
translation of a new language pair waits for its pack (the app shows a progress
notice). The packs in `PREPARE_ON_START` (Turkish ↔ English and English ↔ German by
default) are fetched in the background right after start, so the first minute is
the only slow one. Watch it with `docker compose logs -f translate-engine`.

The app is at `https://quarcnet0.tail84500c.ts.net:4003`.

### Updating

```bash
git pull
bash deploy.sh            # or: bash deploy.sh backend | frontend | engine
```

Order matters when a release changes the API: **redeploy the server before
releasing a new app build** (old apps keep working against a newer server, not the
reverse). The server stays compatible with apps from before the v2 rewrite
(`POST /api/translate` still saves history unless told not to).

The database upgrades itself on start (versioned migrations; nothing is lost).

### Backup and restore

```bash
bash backup.sh                      # ./backup_YYYYMMDD_HHMMSS/ : a consistent snapshot + .env
bash restore.sh ./backup_2026...    # on the new server
```

Only history, favourites and preferences are backed up. Language packs re-download.

### Ports

| App | Frontend | Backend |
|---|---|---|
| Quarc Music | 4000 | 3001 |
| quarc-auth | — | 3002 |
| Quarc Notes | 4001 | 3003 |
| Quarc Weather | 4002 | 3004 |
| **Quarc Translate** | **4003** | **3005** |

The engine (`translate-engine`, port 5000) is internal only.

### Configuration

All optional except `JWT_SECRET`. Full comments in [.env.example](.env.example).

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | — | Must equal quarc-auth's. Requests fail with a clear "misconfigured" error if it is a placeholder |
| `MODEL_RAM_MB` | `2600` | RAM the loaded models may use together; least recently used are unloaded |
| `ENGINE_MEM_LIMIT` | `4500m` | Ceiling for the engine container: it can restart, it can't starve the other apps |
| `NLLB_MODEL` | `1.3B` | General model: `1.3B` (better) or `600M` (lighter) |
| `PIVOT` | `auto` | Chain two dedicated models through English; `off` = always NLLB |
| `PREPARE_ON_START` | `tr:en,en:tr,en:de,de:en` | Pairs fetched in the background after start (replaces `WARM_PAIR`) |
| `TRANSLATE_THREADS` / `TRANSLATE_CONCURRENCY` | `4` / `2` | CPU threads per translation / translations at once |
| `SUGGEST` | `on` | `off` disables "Did you mean…" for everyone |
| `SPELL_LANGS` | `tr,en,de,fr,es,it,pt,nl,sv,pl,ca,cs,fi,ru,uk,no` | Languages that get typo suggestions |
| `SPELL_MAX_DICTS` / `SPELL_TOP_WORDS` | `4` / `150000` | Word lists kept in RAM at once / words kept per language |
| `ENGINE_TIMEOUT` | `45000` | ms to wait for one engine answer |
| `ALLOWED_ORIGINS` | *(none)* | Extra web origins allowed to use the API with the login cookie |

---

## Part 2 — Users

See **[README_Users.md](README_Users.md)**.

---

## Part 3 — Development

```
translate-engine/   Python (FastAPI + CTranslate2): the translation engine
backend/            Node (Express + SQLite): accounts' history, favourites, preferences; talks to the engine
frontend/           React + Vite + Tailwind: the web app (also bundled into the Android app)
mobile/             Capacitor Android wrapper   (+ IncomingTextPlugin: share sheet, selection menu)
desktop/            Tauri wrapper that opens the hosted web app
```

Architecture notes, gotchas and conventions: **[CLAUDE.md](CLAUDE.md)**.

### Tests

```bash
cd backend && npm install && npm test                 # 70: API, history rules, migration, CORS, rate limit, suggestions, alternatives…
cd frontend && npm install && npm test                # 69: chunking (+ fuzz), translator retries, i18n parity…
cd translate-engine && pip install -r requirements.txt pytest httpx && python -m pytest tests   # 151, no models needed
# with the REAL models (downloads ~2 GB through the production code path, ~3 min):
QUARC_REAL_MODELS=1 QUARC_REAL_MODELS_DIR=/some/dir python -m pytest tests/test_real_models.py -v
```

### Adding or changing models

1. Edit `PAIRS` in `translate-engine/tools/pin_models.py` (only directions that beat or match NLLB — see above).
2. `python tools/pin_models.py > model_pins.py` — pins every model to an exact Hugging Face revision.
3. Run the real-model tests, then `bash deploy.sh engine`.

### Building the desktop and mobile apps

- **Desktop:** [desktop/BUILD.md](desktop/BUILD.md) — a Tauri wrapper around the hosted app.
- **Android:** `mobile/` is a Capacitor project. `logo.png` / `mobile/resources/icon.png` are exports of
  `QuarcNet/logos/translate.svg`; regenerate platform icons with `npm run icons` (in `mobile/`) and
  `npx tauri icon logo.png` (in `desktop/`).

### Releasing

```bash
git tag v1.0.6
git push origin v1.0.6
```

`.github/workflows/desktop-release.yml` builds Windows/macOS/Linux and the signed Android APK and
publishes them. Required secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD` (key alias `quarc-translate`).
