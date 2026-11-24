# Quarc Translate — User Guide

Translation for your Quarc account, running on your own private server. What you
type is translated there — nothing is sent to Google, DeepL or anyone else — and
your history and favorites follow your account to every device.

---

## Before anything else: Tailscale

Quarc Translate runs on a private server, not the public internet. You need
[Tailscale](https://tailscale.com/download) installed and connected, signed in
with the account you were invited on. Nothing below works without it.

---

## Choose how to use it

| Device | Best option |
|---|---|
| Android phone / tablet | Install the APK (or get it from **Quarc Store**) |
| iPhone / iPad | Open in Safari, Add to Home Screen |
| Windows / Mac / Linux | Install the desktop app, or just use a browser |
| Any browser | `https://quarcnet0.tail84500c.ts.net:4003` |

### Android

1. Download **Quarc-Translate-Android.apk** from
   [Releases](https://github.com/zekicandemiralay/Quarc_Translate/releases/latest)
   (or install it from Quarc Store, which also keeps it updated).
2. Tap it and allow the install, then open the app and log in.

Updates: **Settings → Check for updates**.

### iPhone / iPad

There's no separate iOS app. Open the address in **Safari**, tap Share → **Add to Home Screen**.

### Windows / macOS / Linux

Download the installer from [Releases](https://github.com/zekicandemiralay/Quarc_Translate/releases/latest)
(`*_x64-setup.exe`, `*_aarch64.dmg` / `*_x64.dmg`, `*_amd64.deb` / `.AppImage`).
**macOS:** the first launch needs right-click → **Open** (the app isn't signed with an Apple certificate).

### Logging in

Use the **same username and password as Quarc Music, Notes and Weather** — one account for all of them.
New here? Tap **Sign up**. On Android you can also sign in through Quarc Store.

---

## Translating

**Pick the two languages** at the top — tap a language to open the list. You can
search it by its name in your own language *or* in its own ("Almanca", "German" and
"Deutsch" all find German). Recently used languages come first.

**Type or paste** on the left; the translation appears on the right as you type.
Paste with the **Paste** button, or the normal way.

| You want to | Do this |
|---|---|
| Not choose the source language | Pick **Detect language** — it shows what it found ("Turkish – detected") |
| Swap the languages | **⇄** — the translation becomes the new text |
| Hear it | The **speaker** under either box (uses your device's voices) |
| Copy / share it | **Copy**, **Share** under the translation |
| Keep it | The **star** — saved translations never get cleaned out |
| Translate only when you say so | Settings → **Translate as I type** off, then **Translate** or `Ctrl+Enter` |

It also helps you when something is off:

- **You chose the wrong source language** — "Looks like Turkish. *Translate from Turkish*" appears. One tap.
- **The text is already in your target language** — it switches the target to the language you use next, and tells you.
- **A typo, or Turkish typed without ç ğ ı ö ş ü** — a yellow *"Did you mean: bugün çok güzel?"* appears under your
  text with the changed words marked. Tap **Use** and the corrected text is translated; ignore it (or tap ✕) and
  nothing changes. It never touches names, links or capitalised words. You can switch it off in Settings.
- **The translation isn't quite what you meant** — **tap any sentence** of the translation. A sheet shows the
  original and the other ways the model could translate that sentence; tap one to swap just that sentence.
  (Copy any of them with the small copy button.)
- **Layout is kept**: paragraphs, blank lines, bullet lists. Email addresses and links are copied exactly, never translated.
- **Long text** is translated in parts — it appears as it goes, and you can keep editing.

### The first time you use a language

Each language pair needs a **language pack** on the server (100–300 MB; the general
one for rarer languages is 1.4 GB). The first translation of a new pair therefore
**takes a few minutes** — the app shows *"Preparing English → French"* with progress, and then
it just translates. After that it's instant, for everyone. Turkish ↔ English and
English ↔ German are prepared in advance.

*Settings → Your data → Language packs* shows what the server has.

---

## History and saved translations

A translation is kept when you **stop changing it for a couple of seconds**, or when
you copy, listen to or star it — not on every keystroke. **History** lists them by day:

- **Search** your translations (both what you wrote and what it said)
- **All / Saved** switch — Saved is just your starred ones
- Tap an entry (or ↻) to load it back into the translator
- Star, copy or delete from the list; the bin icon clears everything *except* what you starred
- **Settings → Your data → Export history** (web/desktop): a JSON or CSV (opens in Excel) file

**Private mode:** Settings → **Keep my history** off — nothing you translate is saved
(starring still keeps that one on purpose).

---

## On Android: translate from any app

Once the app is installed:

- **Select text in any app** (a web page, a message, a PDF) → in the menu that appears, tap **Translate** *(it may be under ⋮ "More")*.
- **Share → Quarc Translate** from a browser, a chat or a mail.

The text opens in Quarc Translate and is translated at once. Installed web app (PWA) on
Android Chrome appears in the Share sheet too.

---

## Settings

- **Languages** — the pair the app starts with
- **Translation** — live translation, suggest corrections, keep history, text size
- **Appearance** — light / dark / automatic, and the app's own language (English or Türkçe)
- Everything is saved on your **account**, so it's the same on every device

---

## Troubleshooting

**"Can't reach the server"** — Tailscale isn't connected (or the server is off). The session is fine; the server just isn't reachable.

**"Preparing…" for a long time** — a language pack is downloading on the server. The very first
one on a fresh install can take 5–10 minutes. If it says the pack *couldn't be installed*, tell
whoever runs the server (the message includes the reason, usually disk space or no internet on the server).

**"The translation engine isn't running right now"** — it's restarting; try again in a minute.

**Listen says no voice** — your device has no voice for that language. Android: Settings → System →
Languages → Text-to-speech → install the language's voice data.

**Paste button does nothing** — some browsers block reading the clipboard; long-press in the box and paste.

**A word or name was translated that shouldn't have been** — translation models are statistical, and
this one runs on a modest server. Names, slang and very idiomatic text are where it is weakest;
for names put them in quotes or retype the sentence.

**A language I want isn't in the list** — 56 languages are offered. Ask whoever runs the server if you need another.
