# Tinty — Codebase Architecture & Structure Guide

This document provides a comprehensive technical overview of the **Tinty** Chrome Extension codebase. It explains how the extension is organized, how data flows between components, where settings and custom themes are stored, and what every function in the project does.

---

## 1. High-Level Architecture

Tinty is built as a **Manifest V3 Chrome Extension** using standard Web APIs (HTML5, CSS3, Vanilla JS). It requires **no build step, transpiler, or external dependencies**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Chrome Extension                              │
│                                                                         │
│  ┌───────────────────────┐                 ┌─────────────────────────┐  │
│  │   Popup (popup.js)    │                 │   Options Page          │  │
│  │  - Quick Theme Switch │                 │   (options.js)          │  │
│  │  - Enable/Disable     │                 │  - Upload Theme JSON    │  │
│  │  - Disable per Site   │                 │  - Upload BG Image      │  │
│  └───────────┬───────────┘                 │  - Create Combos        │  │
│              │                             │  - Manage Saved Library │  │
│              │                             └────────────┬────────────┘  │
│              └───────────────┐ ┌────────────────────────┘               │
│                              ▼ ▼                                        │
│                 ┌───────────────────────────┐                           │
│                 │   chrome.storage.local    │                           │
│                 │  - theme (active object)  │                           │
│                 │  - enabled (boolean)      │                           │
│                 │  - disabledSites (array)  │                           │
│                 │  - customThemes (array)   │                           │
│                 │  - customImages (array)   │                           │
│                 │  - customCombos (array)   │                           │
│                 └─────────────┬─────────────┘                           │
│                               │                                         │
└───────────────────────────────┼─────────────────────────────────────────┘
                                │ (storage.onChanged event)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Target Web Page (Tab)                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Content Script (content.js)                   │  │
│  │                                                                   │  │
│  │  1. Injects Page CSS (<style id="vstr-injected-style">)           │  │
│  │  2. Applies Site Profiles (CSS Vars for Shadow DOM / MDN)         │  │
│  │  3. Remaps Class-Based Highlighters (Prism, highlight.js, etc.)   │  │
│  │  4. Runs Inline Shiki Pass (Hue-distance HSL matching on <code>)   │  │
│  │  5. Guards CSS Cascade order with MutationObserver on <head>      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory & File Map

```
vscode-theme-reader/
├── manifest.json          # Manifest V3 extension configuration & permissions
├── content.js             # Content script injected into webpages to apply styles
├── theme-parser.js        # Parser converting VS Code theme JSON/JSONC to color objects
├── builtin-themes.js      # Map of 10 pre-bundled popular VS Code themes
├── popup.html             # HTML layout for the quick toolbar popup
├── popup.js               # Logic for toolbar popup (toggle, theme picker)
├── popup.css              # Styles for the toolbar popup interface
├── options.html           # HTML layout for the full Settings tab page
├── options.js             # Logic for theme upload, image upload, combos, & library management
├── options.css            # Styles for the Settings tab page
├── README.md              # Project documentation & usage guide
├── STRUCTURE.md           # Technical codebase structure & function reference (this file)
└── IMPROVEMENTS.md        # Technical recommendations, roadmap & contribution guide
```

---

## 3. Data Storage & Persistence Model

### Storage Engine
Tinty uses `chrome.storage.local` to store configuration and user assets.

> **Note on Permissions**: The extension requests `unlimitedStorage` in `manifest.json`. This overrides Chrome's default 5MB quota per extension, allowing users to save multiple custom background images (encoded as Base64 Data URLs) without encountering storage write errors.

### Schema & Keys

| Storage Key | Type | Description | Default Value |
|---|---|---|---|
| `enabled` | `boolean` | Global master toggle for theme recoloring. | `true` |
| `disabledSites` | `Array<string>` | List of hostnames (e.g., `["github.com", "google.com"]`) where extension is disabled. | `[]` |
| `theme` | `Object` | The currently active theme object (Built-in, VS Code, Image, or Combo). | Dracula theme object |
| `customThemes` | `Array<Object>` | User-uploaded parsed VS Code themes. | `[]` |
| `customImages` | `Array<Object>` | User-uploaded background images with `dataUrl`. | `[]` |
| `customCombos` | `Array<Object>` | Background image + VS Code theme combinations. | `[]` |

### Theme Object Schemas

#### Built-in & Uploaded VS Code Theme Object:
```json
{
  "id": "c1a2b3c4",          // Generated unique ID (or key for built-in)
  "type": "vscode",           // "builtin" or "vscode"
  "name": "Dracula",          // Display name
  "bg": "#282a36",            // Page background color
  "fg": "#f8f8f2",            // Page text color
  "link": "#8be9fd",          // Link color
  "accent": "#ff79c6",        // Heading & accent color
  "codeBg": "#21222c",        // Code block background color
  "border": "#44475a",        // Border & table rule color
  "comment": "#6272a4",       // Syntax: Comment token color
  "keyword": "#ff79c6",       // Syntax: Keyword token color
  "string": "#50fa7b",        // Syntax: String token color
  "function": "#50fa7b",      // Syntax: Function token color
  "number": "#ffb86c",        // Syntax: Number token color
  "class": "#8be9fd",         // Syntax: Class/Type token color
  "tag": "#ff79c6",           // Syntax: HTML/XML Tag token color
  "variable": "#f8f8f2"       // Syntax: Variable token color
}
```

#### Image Theme Object:
```json
{
  "id": "c5d6e7f8",
  "type": "image",
  "name": "Wallpaper Name",
  "dataUrl": "data:image/png;base64,...",
  "fg": "#f0f0f0",
  "link": "#8ab4f8"
}
```

#### Combo Theme Object:
Contains all theme color properties from a VS Code theme plus:
```json
{
  "type": "combo",
  "dataUrl": "data:image/jpeg;base64,..."
}
```

---

## 4. Deep-Dive Function & Module Reference

### A. `theme-parser.js`

Provides utility functions to parse VS Code theme JSON/JSONC files and map editor colors into page and syntax token roles.

- **`stripJsonComments(text: string): string`**
  Scans theme text character-by-character to remove `//` single-line comments and `/* ... */` multi-line comments. Uses state flags (`inString`, `inLineComment`, `inBlockComment`, `escapeNext`) to safely preserve `//` inside string literals (such as schema URLs `$schema: "vscode://..."`).
- **`stripTrailingCommas(text: string): string`**
  Uses regular expressions to remove illegal trailing commas before closing braces `}` or brackets `]`.
- **`parseLenientJson(text: string): any`**
  Safe wrapper around `JSON.parse`. Attempts strict `JSON.parse` first for speed, falling back to comment and comma stripping if a syntax error occurs.
- **`shadeColor(hex: string, percent: number): string`**
  Lightens or darkens a hexadecimal color string by a percentage. Used to generate fallbacks for borders and code backgrounds when theme definitions lack explicit values.
- **`findTokenColor(tokenColors: Array, wantedScopes: Array<string>): string | null`**
  Searches a VS Code `tokenColors` array for rules matching any of the specified TextMate/VS Code syntax scope strings (e.g., `comment`, `keyword`, `entity.name.function`) and returns the foreground color hex.
- **`parseVSCodeTheme(themeJson: Object): Object`**
  Main parser entry point. Reads standard VS Code `colors` (`editor.background`, `editor.foreground`, `textLink.foreground`, etc.) and queries `tokenColors` using `SCOPES` definitions. Returns a normalized theme object ready for `chrome.storage.local`.

---

### B. `content.js`

Executed on target web pages. Responsible for generating and injecting dynamic CSS, handling site-specific design tokens (Shadow DOM boundaries), and running the inline Shiki highlighter pass.

- **`escapeForCss(url: string): string`**
  Sanitizes Base64 Data URLs for safe insertion into CSS `url(...)` declarations by escaping double quotes.
- **`buildSiteProfileCSS(theme: Object): string`**
  Checks `SITE_PROFILES` for hostname matches (e.g., `developer.mozilla.org`). Generates CSS root overrides (`:root, html { --color-background-primary: ... !important; }`) to propagate theme colors through CSS custom properties into Shadow DOM components.
- **`buildSyntaxCSS(t: Object): string`**
  Constructs static CSS rules for popular class-based syntax highlighters:
  - **highlight.js** (`.hljs-keyword`, `.hljs-string`, `.hljs-title`, etc.)
  - **Prism.js** (`.token.keyword`, `.token.string`, `.token.function`, etc.)
  - **CodeMirror** (`.cm-keyword`, `.cm-string`, `.cm-def`, etc.)
  - **GitHub Primer** (`.pl-k`, `.pl-s`, `.pl-en`, etc.)
  - **Shiki container backgrounds** (`pre.shiki`)
- **`hexToRgba(hex: string, alpha: number): string`**
  Converts hex colors to `rgba(...)` format to enable translucent background overlays in combo mode.
- **`buildCSS(theme: Object): string`**
  Assembles the complete injected stylesheet combining site profile CSS, background CSS (flat background, image background, or combo translucent background), text/link/heading/table rules, and syntax highlighting CSS.
- **`parseCssColor(str: string): Array<number> | null`**
  Parses hex (`#rrggbb`) or RGB/RGBA (`rgb(r, g, b)`) strings returned by computed styles into `[r, g, b]` arrays.
- **`rgbToHsl([r, g, b]: Array<number>): { h, s, l }`**
  Converts RGB values to HSL (Hue, Saturation, Lightness) format for color distance comparisons.
- **`hueDistance(a: number, b: number): number`**
  Calculates the shortest angular distance (0–180 degrees) between two hue values on the color wheel.
- **`buildRoleTable(theme: Object): Array<{ role, color, hsl }>`**
  Creates an array of theme token roles with pre-calculated HSL values to optimize inline color matching.
- **`nearestRoleColor(originalHsl: Object, roleTable: Array, fallback: string): string`**
  Finds the theme token color whose hue closest matches the original token's hue.
- **`remapInlineColoredCodeBlocks(theme: Object)`**
  Performs a bounded DOM scan over `<pre>` and `<code>` elements. Reassigns inline `style="color:..."` attributes in Shiki-styled code blocks to the nearest theme token color based on hue and saturation logic. Caches original colors in `data-vstr-orig-color`.
- **`restoreInlineColoredCodeBlocks()`**
  Reverts inline code block recoloring when Tinty is disabled, restoring saved original colors from `data-vstr-orig-color`.
- **`keepStyleTagLast()`**
  Ensures `<style id="vstr-injected-style">` remains the last child in `<head>` so its rules take cascade precedence over dynamic page stylesheets.
- **`ensureHeadObserver()`**
  Instantiates a `MutationObserver` on `<head>` to detect newly added `<style>` or `<link>` tags and re-trigger `keepStyleTagLast()`.
- **`applySettings(settings: Object)`**
  Main execution handler for the content script. Reads settings, checks domain disable status, injects or removes the style tag, and invokes the inline highlighter pass.
- **`loadAndApply()`**
  Fetches settings from `chrome.storage.local` and triggers `applySettings`.

---

### C. `popup.js`

Controls the popup interface opened from the browser toolbar action.

- **`setStatus(msg: string, isError: boolean)`**
  Updates status text and styling in the popup footer.
- **`getActiveTabHostname(callback: Function)`**
  Uses `chrome.tabs.query` to get the URL of the active tab and extract its hostname.
- **`optionEl(value: string, label: string): HTMLOptionElement`**
  Helper function to create `<option>` elements for the theme dropdown.
- **`populateSelect(customThemes, customImages, customCombos, selectedValue)`**
  Fills `<select id="themeSelect">` with built-in dark/light themes and user-saved custom items.
- **`saveTheme(theme: Object, statusMsg: string)`**
  Updates `chrome.storage.local` with the chosen active theme object and refreshes the UI.
- **`saveDisabledSitesOnly()`**
  Saves updates to the `disabledSites` array when the user toggles site exclusion.
- **`loadSettings()`**
  Loads active settings and custom theme libraries from `chrome.storage.local` to initialize popup controls.

---

### D. `options.js`

Controls the full Settings tab (`options.html`) where users upload, create, and manage custom themes.

- **`safeSet(items: Object, onSuccess: Function, onError: Function)`**
  Wrapper for `chrome.storage.local.set` that explicitly checks `chrome.runtime.lastError` to catch quota or storage errors.
- **`populateComboThemeSelect()`**
  Populates the theme selection dropdown in the Background + Theme Combo creator card.
- **`setStatus(el: HTMLElement, msg: string, kind: string)`**
  Displays success or error feedback messages on setting cards.
- **`uid(): string`**
  Generates a random, unique alphanumeric ID for custom themes and uploaded assets.
- **`renderSavedList()`**
  Queries `chrome.storage.local` and builds the interactive list of saved custom themes, images, and combos with color swatches, Apply buttons, and Delete buttons.

---

### E. `builtin-themes.js`

Contains the static `BUILTIN_THEMES` dictionary providing full color schemes for 10 bundled themes:
1. **Dracula**
2. **One Dark**
3. **Monokai**
4. **Solarized Dark**
5. **Solarized Light**
6. **Nord**
7. **Gruvbox Dark**
8. **Night Owl**
9. **Tokyo Night**
10. **Catppuccin Mocha**

---

## 5. Recolor Execution Strategy (4-Layer Pipeline)

1. **Layer 1: Document & Wrapper Base Styles**
   Injects global CSS targeting `html`, `body`, and common SPA app-shell containers (`#root`, `#app`, `#__next`, `main`, etc.) to enforce theme backgrounds, text colors, links, headings, and code block backgrounds.
2. **Layer 2: Site Profiles (Shadow DOM Boundary)**
   Redefines site-specific CSS custom properties (`--color-background-primary`, etc.) at the `:root` level for sites like MDN. These CSS variables naturally penetrate Shadow DOM boundaries where normal CSS selectors fail.
3. **Layer 3: Class-Based Syntax Highlighters**
   Applies static CSS rules remapping class names from **highlight.js**, **Prism.js**, **CodeMirror**, and **GitHub Primer** to theme token colors.
4. **Layer 4: Inline-Styled Syntax Highlighters (Shiki Pass)**
   Performs a bounded DOM scan over code blocks. Converts original inline RGB/Hex colors to HSL and maps them to theme syntax roles based on minimum hue distance.
