# ThemeReader — Open-Source Improvement & Roadmap Guide

This document outlines key technical improvements, architectural refactorings, performance optimizations, and open-source contribution guidelines for **ThemeReader**.

---

## 1. Codebase Refactoring & Architecture Improvements

### A. Storage & Browser API Abstraction Wrapper
- **Current State**: Code calls `chrome.storage.local.get` and `chrome.storage.local.set` directly with callback syntax across `popup.js`, `options.js`, and `content.js`.
- **Recommendation**: Create a unified `storage-manager.js` utility using Promises/`async-await`.
- **Benefits**:
  - Enables seamless cross-browser support (Firefox `browser.storage` vs Chrome `chrome.storage`).
  - Eliminates nested callback pyramids.
  - Simplifies unit testing by allowing easy mocking of the storage layer.

### B. Modularization & Namespace Management
- **Current State**: Scripts use global variables or immediate IIFE wrappers (`(function() { ... })()`).
- **Recommendation**:
  - Structuring scripts cleanly into ES modules or maintaining distinct namespaces (`ThemeParser`, `ColorUtils`, `SyntaxEngine`).
  - Moving site profiles into a standalone configuration file (`site-profiles.js`).

### C. Theme Parsing & Inheritance (`include` field support)
- **Current State**: `theme-parser.js` notes a known limitation: themes using VS Code's `"include"` property (to extend base themes) cannot resolve inherited colors.
- **Recommendation**:
  - Add fallback resolution logic for standard base themes (`vs`, `vs-dark`, `hc-black`).
  - Allow uploading multiple base files or resolving `include` directives recursively.

---

## 2. Performance & DOM Optimizations

### A. Lazy / Virtualized Code Block Recoloring (Shiki Pass)
- **Current State**: `remapInlineColoredCodeBlocks` in `content.js` scans all `pre, code` elements synchronously on `DOMContentLoaded` and `window.load`.
- **Issue**: On massive documentation pages containing dozens of code snippets, running `querySelectorAll` and computed style reads synchronously can trigger layout thrashing.
- **Recommendation**:
  - Implement an `IntersectionObserver` to recolor inline code blocks only when they enter or approach the viewport.
  - Use `requestIdleCallback` to chunk DOM processing across animation frames.

### B. Dynamic Content & Single Page Application (SPA) Support
- **Current State**: ThemeReader recolors the page at load time and listens for stylesheet additions in `<head>`. SPA client-side navigations (e.g. Next.js/Gatsby page transitions) that render new DOM nodes without updating `<head>` may miss inline code block recoloring.
- **Recommendation**:
  - Add a lightweight `MutationObserver` targeted at main content containers (`#root`, `main`) with debouncing (e.g., 250ms) to recolor newly appended code blocks dynamically.

---

## 3. UI/UX & Feature Enhancements

### A. TODO: Sidebar & Navbar Theming with Top-Down Cascade
- **Decision**: The **Top-Down Cascade** method has been chosen as the primary anti-artifact and layout theme cascade strategy.
- **Key Finding**: Among the three tested approaches (*Make parents transparent*, *Match parent to child*, and *Top-down cascade*), Top-Down Cascade was the **only method that successfully converted hardcoded black sidebar layouts into the custom theme/wallpaper background**.
- **Next Steps (Sidebars & Navbars)**:
  - When implementing dynamic blur / glassmorphism and translucent panels for sidebars (`#secondary`, `aside`, navigation drawers):
    - Use the Top-Down Cascade logic to strip solid opaque intermediate wrappers so the underlying backdrop image/tint shows through.
    - Apply `backdrop-filter: blur(...)` and subtle translucent background overlays (`rgba(..., 0.3)`) directly to the outer container or leaf card clusters.
    - Ensure leaf cards, buttons, and text contrast are preserved.

### B. Accessibility & WCAG Contrast Safety Checker
- **Feature Idea**: Automatically verify readability ratio between `fg` (foreground) and `bg` (background) using WCAG 2.1 contrast math ($(\text{L1} + 0.05) / (\text{L2} + 0.05)$).
- **Behavior**: If a user-uploaded VS Code theme yields a contrast ratio below `4.5:1` (WCAG AA minimum for standard text), automatically adjust text brightness or display a warning in the Settings tab.

### B. Customizable Overlay Opacity for Combo & Image Modes
- **Current State**: Combo mode uses a fixed opacity of `0.55` (`hexToRgba(bg, 0.55)`).
- **Recommendation**: Add an opacity slider control (e.g., `20%` to `80%`) in the Settings tab so users can fine-tune background image visibility vs text readability.

### C. Domain-Specific Theme Assignment
- **Feature Idea**: Allow users to assign different themes to different websites (e.g., Dracula for MDN, Tokyo Night for GitHub, Solarized Light for StackOverflow).

### D. Direct VS Code Marketplace / GitHub Import
- **Feature Idea**: Allow users to paste a GitHub theme URL or VS Code Marketplace extension ID to fetch and install theme JSON automatically via fetch API.

---

## 4. Open-Source Readiness Checklist

Before publishing ThemeReader as an open-source repository on GitHub:

- [ ] **Add an Open-Source License**: Add an explicit `LICENSE` file (e.g., **MIT License**) to the repository root.
- [ ] **Add Contribution Guidelines (`CONTRIBUTING.md`)**: Explain how to set up the developer environment, load unpacked extension, test changes, and submit Pull Requests.
- [ ] **Add Community Health Files**: Add `CODE_OF_CONDUCT.md` and GitHub Issue/PR templates (`.github/ISSUE_TEMPLATE/`).
- [ ] **Setup Unit Testing**: Add a test runner (Jest or Vitest) to test `theme-parser.js` and color mapping functions automatically.
- [ ] **Setup CI/CD Workflows**: Add GitHub Actions (`.github/workflows/ci.yml`) to run tests and package extension `.zip` releases on tag pushes.

---

## 5. Automated Test Plan Examples

### Unit Test for `theme-parser.js` (Jest / Vitest)
```js
import { parseVSCodeTheme, parseLenientJson } from './theme-parser.js';

test('parseLenientJson parses JSONC with comments and trailing commas', () => {
  const jsonc = `{
    // Comment line
    "name": "Test Theme",
    "colors": {
      "editor.background": "#121212", // inline comment
    },
  }`;
  const result = parseLenientJson(jsonc);
  expect(result.name).toBe("Test Theme");
  expect(result.colors["editor.background"]).toBe("#121212");
});

test('parseVSCodeTheme maps token scopes correctly', () => {
  const mockTheme = {
    colors: { "editor.background": "#000000", "editor.foreground": "#ffffff" },
    tokenColors: [
      { scope: ["keyword"], settings: { foreground: "#ff0000" } }
    ]
  };
  const parsed = parseVSCodeTheme(mockTheme);
  expect(parsed.bg).toBe("#000000");
  expect(parsed.keyword).toBe("#ff0000");
});
```
