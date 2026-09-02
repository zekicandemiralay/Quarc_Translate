# Quarc Translate — User Guide

Translation for your Quarc account. Your history and favorites are saved to
your account, so they're the same on your phone, your laptop, and any browser
you log into.

---

## Before anything else: Tailscale

Quarc Translate runs on a private server, not the public internet. You need
[Tailscale](https://tailscale.com/download) installed and connected, signed in
with the account you were invited on. Nothing below works without it.

---

## Choose how to use it

| Device | Best option |
|---|---|
| Android phone | Install the APK |
| iPhone / iPad | Open in Safari, Add to Home Screen |
| Windows / Mac / Linux | Install the desktop app, or just use a browser |
| Any browser | `https://quarcnet0.tail84500c.ts.net:4003` |

---

## Android

1. Download **Quarc-Translate-Android.apk** from
   [Releases](https://github.com/zekicandemiralay/Quarc_Translate/releases/latest)
2. Tap it. Android will ask you to allow installs from your browser or file
   manager — allow it, then tap Install.
3. Open the app and log in.

Updates: check any time from **Settings → Check for updates**.

---

## iPhone / iPad

There's no separate iOS app. Open
`https://quarcnet0.tail84500c.ts.net:4003` in **Safari**, tap the Share button,
then **Add to Home Screen**. It runs full-screen like a normal app.

---

## Windows / macOS / Linux

Download the installer for your platform from
[Releases](https://github.com/zekicandemiralay/Quarc_Translate/releases/latest):

| Platform | File |
|---|---|
| Windows | `*_x64-setup.exe` |
| macOS (M1/M2/M3) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Linux | `*_amd64.deb` or `*_amd64.AppImage` |

**macOS:** the app isn't signed with an Apple developer certificate, so the first
launch needs a right-click → **Open** instead of a double-click.

Or skip the install entirely and use the URL in any browser — same app.

---

## Logging in

Use the **same username and password as Quarc Music, Notes, and Weather**. It's
one account across all of them. If you've never had an account, tap **Sign up**
on the login screen.

---

## Using it

**Translate** — pick a source language (or leave it on **Detect language**) and
a target language, then type or paste text on the left. The translation appears
on the right a moment after you stop typing.

**Swap** — tap **⇄** between the two language pickers to swap source and target
— if the source was set to auto-detect, it swaps in whatever language was
actually detected.

**Copy** — tap **Copy** under the translated text to copy it to your clipboard.

**Save a translation** — tap the star (☆) under the translated text to favorite
it. Favorites survive a "Clear history".

**History** — every translation you make is saved automatically. Open the
**History** tab to browse, filter to just favorites, tap any entry to load it
back into the translator, or delete entries you don't want.

**Default languages, theme, app language** — **Settings** (⚙). These save to
your account, so they apply on every device you use.

---

## Troubleshooting

**"Not authenticated" or it keeps bouncing to login** — check Tailscale is
connected. The session cookie is fine; the server just isn't reachable.

**Translation fails / "Translation engine is unavailable right now"** — the
server's translation engine may still be downloading language models after a
fresh install (can take a few minutes the very first time), or it's briefly
restarting. Try again in a minute; if it persists, tell whoever runs the server.

**Nothing loads at all** — confirm Tailscale is connected and try
`https://quarcnet0.tail84500c.ts.net:4003` in a browser. If the browser works but
the app doesn't, reinstall the app.

**A language I want isn't in the list** — the server only loads a subset of
LibreTranslate's supported languages to keep startup fast. Ask whoever runs the
server to add it to `LT_LOAD_ONLY` in `.env` and restart.
