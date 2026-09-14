# ThemeReader (v0.7.0)

> **Recolor the pages you read using your favorite VS Code theme, curated palettes, or custom background images.**

**ThemeReader** is a Manifest V3 browser extension for Chromium browsers (Chrome, Brave, Edge, Opera, Vivaldi) that recolors technical documentation, blogs, and articles with authentic VS Code theme colors and syntax highlighting.

Built with plain JavaScript, HTML5, and CSS3 — **no build step, no framework overhead, zero telemetry**.

---

## 🌟 Highlights & Features

- 🎨 **Use Any VS Code Theme**: Upload your own theme `.json` or `.jsonc` file (exported from VS Code, extensions, or GitHub).
- 📦 **10 Bundled Built-in Themes**: Dracula, One Dark, Monokai, Solarized (Dark/Light), Nord, Gruvbox Dark, Night Owl, Tokyo Night, and Catppuccin Mocha.
- 💻 **Authentic Code Syntax Highlighting**: Remaps class-based highlighters (*highlight.js*, *Prism.js*, *CodeMirror*, *GitHub Primer*) and runs a fast hue-matching pass for inline-styled code blocks (*Shiki*, *Astro*, *VitePress*, *Docusaurus 2+*).
- 🖼️ **Background Image & Combo Mode**: Layer page content over your desktop wallpaper or combine a theme's syntax colors with a translucent background image.
- ⚡ **Instant Live Updates**: Theme switches apply immediately across all open tabs without needing a page refresh.
- 🌐 **Shadow DOM & Design System Support**: Redefines CSS custom properties at `:root` for complex sites like MDN (`developer.mozilla.org`) to recolor custom elements sealed inside Shadow DOM boundaries.
- 🔒 **Privacy First & Offline**: All themes and settings are stored locally in your browser (`chrome.storage.local`). No external requests or data collection.

---

## 🚀 Installation (Developer Mode / Unpacked)

1. Download or clone this repository to your local machine.
2. Open your browser's extensions management page:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the `vscode-theme-reader` project directory.
5. Click the ThemeReader icon in your browser toolbar to open the popup.

---

## 📖 How to Use

### 1. Toolbar Popup (`popup.html`)
Click the toolbar icon for quick controls:
- **Global Toggle**: Turn ThemeReader on or off instantly.
- **Site Exclude**: Toggle "Disable on this site" for domain-specific exclusions.
- **Theme Selector**: Pick between Built-in Dark, Built-in Light, or your custom saved themes/images.
- **Settings Button**: Open the full Settings tab page to manage your library.

### 2. Settings Page (`options.html`)
Open Settings from the popup or extension management page to:
- **Add a VS Code Theme**: Upload a `.json` or `.jsonc` theme file and name it.
- **Add a Background Image**: Upload an image file for a customized wallpaper reader experience.
- **Create a Background + Theme Combo**: Combine a background image with a full VS Code theme (syntax highlighting + text colors layered over translucent background tint).
- **Manage Saved Library**: View swatches, apply themes, or delete saved items.

---

## ⚙️ How Code Block Recoloring Works

ThemeReader handles syntax highlighting on technical doc sites using a two-tiered approach:

1. **Class-Based Highlighters (highlight.js, Prism, CodeMirror, GitHub Primer)**:
   Remaps standard token CSS classes (`.hljs-keyword`, `.token.string`, `.cm-def`, `.pl-k`) to VS Code theme syntax colors via CSS rules. Zero runtime JS overhead.
2. **Inline-Styled Highlighters (Shiki, VitePress, Astro, Docusaurus 2+)**:
   Shiki bakes inline `style="color:#hex"` attributes into tokens at build time. ThemeReader runs a single, bounded JS pass on `<pre>` and `<code>` elements. It converts original inline colors to HSL and maps each color to the closest matching theme token role based on hue distance.

---

## 📁 Repository & Codebase Structure

For detailed architectural diagrams, function breakdowns, and storage schemas, please refer to **[STRUCTURE.md](file:///home/master/Desktop/vscode-theme-reader-v0.7.0/vscode-theme-reader/STRUCTURE.md)**.

```
vscode-theme-reader/
├── manifest.json          # Manifest V3 extension configuration
├── content.js             # Recolor content script injected into web pages
├── theme-parser.js        # VS Code theme JSON parser & color mapping logic
├── builtin-themes.js      # Bundled preset themes data
├── popup.html/.js/.css    # Toolbar popup interface
├── options.html/.js/.css  # Full-tab Settings & Theme Library management page
├── STRUCTURE.md           # Deep-dive architecture & function reference guide
└── IMPROVEMENTS.md        # Technical roadmap, performance tips & contribution guide
```

---

## 🛠️ Data Storage

All data is stored locally in `chrome.storage.local`. The extension requests `unlimitedStorage` in `manifest.json` to safely accommodate high-resolution Base64 background images without hitting Chrome's default 5MB storage limit.

For details on storage keys and schema objects, see **[STRUCTURE.md](file:///home/master/Desktop/vscode-theme-reader-v0.7.0/vscode-theme-reader/STRUCTURE.md#3-data-storage--persistence-model)**.

---

## 🤝 Contributing & Roadmap

Thinking of contributing or extending ThemeReader? Check out **[IMPROVEMENTS.md](file:///home/master/Desktop/vscode-theme-reader-v0.7.0/vscode-theme-reader/IMPROVEMENTS.md)** for:
- Open-source contribution guidelines & setup
- Planned features (Firefox port, Marketplace API import, Contrast checker)
- Performance & DOM optimization ideas

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.
