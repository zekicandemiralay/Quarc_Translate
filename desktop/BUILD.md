# Building the Quarc Translate desktop app

## Prerequisites (one-time setup)

1. **Rust** — https://rustup.rs
   Run the installer, restart your terminal.

2. **Node.js** — https://nodejs.org (v18 or newer)

3. **WebView2** — already installed on Windows 10/11.
   If missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## Generate icons (one-time)

`logo.png` in this folder is the real Quarc Translate mark (from
`QuarcNet/logos/bg_removed/`), but it's only 360×360 — smaller than the
1024×1024+ Tauri recommends for generating every icon size without upscaling
blur. It's fine to generate from as-is; for crisper large icons, re-export a
higher-resolution version from the original source art first. From the
`desktop/` folder, run:

```
npx tauri icon path\to\your-icon.png
```

This writes all required files into `src-tauri/icons/`.

## Build the installer

From the `desktop/` folder:

```
npm install
npm run build
```

The installer is written to:
```
src-tauri/target/release/bundle/nsis/Quarc Translate_1.0.0_x64-setup.exe
```

Hand this `.exe` to users. They run it once to install, then launch
"Quarc Translate" from their Start menu or desktop shortcut.

## Certificate requirement

Users must install and trust the server certificate **before** opening the app,
exactly as described in Quarc Music's README_Users.md (Windows section) — the same
Tailscale cert covers every Quarc app on this host. The desktop app uses WebView2,
which reads from the Windows certificate store, so installing the cert for
Edge/Chrome is sufficient.
