<div align="center">

# 🎨 Tinty

### *Tint your web, your way.*

**Browse documentation, blogs, and the internet in your favorite VS Code theme and wallpapers.**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-orange.svg)](#)
[![Works on](https://img.shields.io/badge/Browsers-Chrome%20%7C%20Brave%20%7C%20Edge%20%7C%20Opera-purple.svg)](#)

<br />

<!-- Hero Preview Image -->
<p align="center">
  <img src="assets/screenshots/hero-preview.png" alt="Tinty Hero Preview" width="850" />
</p>

</div>

---

## ✨ Features

* **🎨 Import Any VS Code Theme** — Drag & drop your favorite `.json` or `.vsix` theme file and read technical blogs, docs, and forums with authentic syntax highlighting and editor tones.
* **🖼️ Use Any Image as Background** — Turn any desktop wallpaper into an ambient browsing backdrop powered by an isolated hardware-accelerated layer with zero scroll lag.
* **🔮 Mix & Combine (Combo Mode)** — Layer your theme's code highlights and dark surface cards over a translucent wallpaper tint for the ultimate aesthetic setup.

---

## 📸 Showcase

<div align="center">

### 📖 Read your docs in your favorite themes
*Deep syntax token mapping and surface hierarchy across documentation and technical blogs.*
<br />
<img src="assets/screenshots/docs-demo.png" alt="Documentation Demo" width="800" />

<br /><br />

### 🎬 Sleek ambient themes on standard sites
*Browse media, feeds, and everyday applications like YouTube styled in your personalized theme.*
<br />
<img src="assets/screenshots/youtube-demo.png" alt="YouTube Demo" width="800" />

<br /><br />

### ⚡ Clean & distraction-free (Without wallpaper)
*For purists who want pure VS Code dark palettes without background images on GitHub and code repositories.*
<br />
<img src="assets/screenshots/github-demo.png" alt="GitHub Clean Demo" width="800" />

</div>

---

## 🚀 Installation Guide

Tinty is 100% free, open-source, and runs on all modern Chromium browsers (**Google Chrome, Brave, Microsoft Edge, Opera, Vivaldi**).

> [!IMPORTANT]
> **Save the folder in a permanent location!**
> Do **NOT** install directly from a temporary `Downloads/` or `Desktop/` trash folder. Move the extracted folder to a permanent path like `~/Documents/extensions/tinty` or `C:\tools\tinty\`. If the folder is moved or deleted, your browser will automatically disable and remove the extension.

### Step-by-Step Instructions

1. **Download the Extension**:
   * Click the green **Code → Download ZIP** button above (or download `tinty-v0.7.0.zip` from [Releases](https://github.com/Marmik-001/Tinty/releases)).
   * Extract the ZIP file and move the folder to a permanent location on your computer.

2. **Open the Extensions Page in Your Browser**:
   * **Chrome**: `chrome://extensions`
   * **Brave**: `brave://extensions`
   * **Edge**: `edge://extensions`

3. **Enable Developer Mode**:
   * Toggle the **Developer mode** switch in the top-right corner of the extensions page.

4. **Load the Extension**:
   * Click **Load unpacked** (top-left).
   * Select the unzipped folder containing `manifest.json`.

5. **Pin to Toolbar**:
   * Click the puzzle icon 🧩 in your browser toolbar and pin **Tinty** for quick one-click access!

<p align="center">
  <img src="assets/screenshots/install-guide.gif" alt="Installation Walkthrough" width="700" />
</p>

---

## ⚡ Quick Start: How to Export Your VS Code Theme

You can export and use whatever theme you are currently rocking in VS Code in less than 30 seconds:

<p align="center">
  <img src="assets/screenshots/vs-code-theme-generator.png" alt="VS Code Theme Generator Command" width="700" />
</p>

### Step-by-Step Theme Export:
1. In VS Code, open the Command Palette with **`Ctrl + Shift + P`** (or **`Cmd + Shift + P`** on macOS).
2. Search and click on:
   ```
   Developer: Generate Color Theme From Current Settings
   ```
3. Clicking this generates a new JSON theme file with all your active colors, workbench styles, and syntax tokens.
4. Save / store this file on your computer (e.g. `my-theme.json`) with **`Ctrl + S`** (or **`Cmd + S`**).
5. Open your browser, click **Tinty → Settings**, upload your `my-theme.json` file under **Add a VS Code theme**, and hit **Save theme**!

### Alternative: Use Built-in Presets
Don't have VS Code handy? Tinty comes bundled with **10 classic community presets**:
* Dracula, One Dark, Monokai, Nord, Gruvbox Dark, Night Owl, Tokyo Night, Catppuccin Mocha, Solarized Dark & Solarized Light.

---

## 🛠️ Developer Guide & Architecture

Tinty is built with pure, modern web standards — **zero dependencies, zero bundlers, and zero build steps**:

```
tinty/
├── manifest.json          # Manifest V3 extension configuration
├── content.js             # High-performance page recleaning & theme engine
├── theme-parser.js        # VS Code theme JSON parser & syntax token mapper
├── builtin-themes.js      # Bundled popular theme presets
├── popup.html / .js / .css# Quick toolbar toggle & theme switcher
├── options.html / .js / .css# Full library manager & offscreen canvas compressor
├── assets/                # Screenshots, banners, and preview assets
└── KNOWN_ISSUES.md        # Architecture decisions, benchmarks & solutions
```

### Key Technical Highlights:
* **Hardware-Accelerated Backdrop Layer**: Wallpapers render on an isolated `#vstr-backdrop-layer` directly on `document.documentElement`, keeping GPU compositor tile scrolling at 60–120 FPS.
* **Layout Thrashing Elimination**: The dynamic DOM observer uses two-phase batching (all `getComputedStyle` reads happen in Phase 1 before any inline style writes in Phase 2) scheduled via `requestIdleCallback`.
* **Client-Side Offscreen Compression**: Large 4K/8K images are downscaled to 1080p and compressed to WebP (quality 0.85) via an offscreen HTML5 canvas before storing in `chrome.storage.local`.
* **Privacy by Design**: Stored 100% locally on your machine. Zero telemetry, zero analytics, zero external network requests.

### Local Development:
1. Clone the repository:
   ```bash
   git clone https://github.com/Marmik-001/Tinty.git
   ```
2. Make your edits in `content.js`, `popup.js`, or `options.js`.
3. Go to `chrome://extensions` and click the refresh 🔄 icon on the Tinty card. Changes reflect instantly!

---

## 🤝 Contributing

Contributions, feedback, and issue reports are very welcome!
1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'feat: add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
