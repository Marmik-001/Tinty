# Tinty — Known Issues & Dangerous Changes

This document tracks known bugs, fragile areas, and changes that have been **proven to break** the extension. Read this before making any modifications.

---

## ⚠️ DANGER ZONE: Changes That Broke the Extension

The following changes were attempted and **completely broke theme rendering** (no themes displayed at all after reload). They have been reverted and should NOT be re-attempted without extreme caution.

### What Was Changed (and broke everything)

1. **Modified `content.js` → `buildCSS()` function**
   - Added extra CSS selectors for intermediate `<div>` containers
   - Added `background-color: transparent !important` rules to broad selectors like `div, section, article, nav, header, footer`
   - Added wildcard/deep CSS resets

2. **Modified `content.js` → Selector expansions**
   - Expanded `APP_ROOT_SELECTOR` with additional generic wrapper selectors
   - Added catch-all CSS rules targeting nested containers

3. **Modified `popup.js` → Theme application logic**
   - Changed how theme objects were passed/stored to `chrome.storage.local`

### Why It Broke

- **CSS `!important` cascade conflicts**: Adding broad `background-color: transparent !important` to containers like `div` stripped away essential layout backgrounds that sites rely on for structural visibility (cards, navbars, modals, dropdowns). This made entire page sections collapse or disappear.

- **`chrome.storage.local` quota / serialization**: Modifications to how themes were stored could cause silent `chrome.runtime.lastError` failures. The extension checks `chrome.runtime.lastError` in `content.js:534` — if the settings read fails, nothing renders.

- **Content Security Policy (CSP) interactions**: Some changes introduced syntax or patterns that interacted badly with strict CSP on certain sites, causing the entire content script to abort silently.

- **IIFE scope leaks**: `content.js` runs inside an IIFE `(function() { ... })()`. Any changes that accidentally referenced `undefined` variables or broke the function closure caused the entire script to fail silently — no errors in console, just no theme applied.

### Golden Rule
> **If themes stop showing after ANY code change:**
> 1. The content script is likely throwing a silent error inside the IIFE
> 2. Check `chrome://extensions` → Details → "Errors" panel for the extension
> 3. Open DevTools on any webpage → Console → Filter by extension ID errors
> 4. The most common cause is a JS syntax/runtime error that kills the entire IIFE before `loadAndApply()` runs

---

## 🐛 Known Issue: Light-Themed Websites

### The Problem

Tinty works well on sites that already have a dark or neutral background. But on **light-themed websites** (white/light backgrounds), the extension creates **invisible text**: light-colored theme text (`color: #d4d4d4`) rendered on top of the site's own white backgrounds.

### Root Cause

The `buildCSS()` function in `content.js` only overrides `background-color` on these elements:

```
html, body, #root, #app, #__next, #__nuxt, #___gatsby, main, #main, #content, .main-content
```

But modern websites have **dozens of intermediate containers** with their own `background-color: white` (or light variants) set by CSS frameworks (Tailwind, Bootstrap, custom stylesheets):

```
<div class="bg-white rounded-lg shadow-md p-6">    ← Has its own white bg
  <article class="prose">                            ← May have its own bg
    <div class="card-body">                          ← Has its own white bg
      <p>This text is now light-on-light = INVISIBLE</p>
    </div>
  </article>
</div>
```

The extension changes `<p>` text to light color via `!important`, but doesn't touch the `<div class="bg-white">` background → **light text on white background**.

### Why This Is Hard to Fix

| Approach | Risk Level | Problem |
|---|---|---|
| `* { background-color: ${bg} !important }` | 🔴 EXTREME | Destroys images, gradients, shadows, borders, icons, buttons, everything. Sites become unusable. |
| `div, section, article { background: ${bg} !important }` | 🔴 HIGH | Breaks card layouts, modals, dropdowns, nav menus. Already proven to break the extension. |
| `div { background: transparent !important }` | 🔴 HIGH | Strips layout structure. Cards/sections collapse. |
| Selective targeting via computed styles | 🟡 MEDIUM | Requires scanning every visible element, very expensive, and risks breaking interactive elements. |

### Proposed Safe Approaches (Ideas)

#### Idea 1: "Smart Background Override" — Detect & Override Only Light Backgrounds

Instead of blindly applying backgrounds, detect elements that have a computed `background-color` in the light range (lightness > 0.7 in HSL) and override only those:

```js
function overrideLightBackgrounds(theme) {
  const allElements = document.querySelectorAll('div, section, article, aside, nav, header, footer, main');
  allElements.forEach(el => {
    const computed = getComputedStyle(el).backgroundColor;
    const rgb = parseCssColor(computed);
    if (!rgb) return;
    const hsl = rgbToHsl(rgb);
    // Only override backgrounds that are "light" (lightness > 70%)
    if (hsl.l > 0.7) {
      el.style.setProperty('background-color', theme.bg, 'important');
    }
  });
}
```

**Pros**: Surgical — only fixes the problem elements.  
**Cons**: Performance cost on large pages. Doesn't handle dynamically added elements. Might miss some elements or over-aggressively darken cards that are intentionally lighter.

**Risk**: 🟡 MEDIUM — needs performance optimization (IntersectionObserver, debouncing) and a restoration mechanism.

#### Idea 2: CSS `:where()` Deep Background Reset with Low Specificity

Use a `:where()` wrapper so the override has **zero specificity** and won't fight with framework styles:

```css
:where(div, section, article, aside, nav, header, footer, figure, details, dialog, form, fieldset) {
  background-color: ${bg};
}
```

**Pros**: Low specificity means site-specific styles that explicitly set colors will still win. Only catches elements using browser defaults.  
**Cons**: On light-themed sites, the framework CSS (`bg-white`) has higher specificity and will STILL win. This basically does nothing for the exact problem case.

**Risk**: 🟢 LOW — but likely ineffective for the target problem.

#### Idea 3: Light Theme Detection + Global Invert Strategy

Detect if the page is light-themed by sampling `document.body` or `<html>` computed background color. If light, apply a broader background override:

```js
function isPageLightThemed() {
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const rgb = parseCssColor(bodyBg);
  if (!rgb) return false;
  const hsl = rgbToHsl(rgb);
  return hsl.l > 0.6; // Body background is light
}
```

Then conditionally add more aggressive CSS only for light-themed pages:

```css
/* Only injected on light-themed pages */
div, section, article, aside, nav, header, footer, figure {
  background-color: ${bg} !important;
}
```

**Pros**: Targeted — only applies aggressive fix on pages that need it.  
**Cons**: Aggressive override may break layouts (same risk as before, just conditional). Needs a user toggle/escape hatch.

**Risk**: 🟡 MEDIUM-HIGH — best combined with a user toggle ("Force dark backgrounds on light sites").

#### Idea 4: User Toggle — "Force Dark Backgrounds" Setting

Add a simple toggle in the popup or settings page:
- **OFF (default)**: Extension works exactly as it does now — safe but may look bad on light sites.
- **ON**: Extension injects additional aggressive background overrides for intermediate containers.

This puts the user in control and makes it opt-in for sites where they want the nuclear option.

**Risk**: 🟢 LOW — no behavioral change by default, purely additive.

### Recommended Path Forward

**Start with Idea 4 (User Toggle)** combined with **Idea 1 (Smart Background Override)**:
1. Add a "Force Dark Backgrounds" toggle to the popup
2. When enabled, scan for light-background elements and override them
3. Use a MutationObserver to handle dynamically added elements
4. Keep it OFF by default so existing behavior is unaffected

---

## 🐛 Known Issue: YouTube Ambient Mode Background Bleed

### The Problem
When playing a video on YouTube, approximately 2–4 seconds into playback, a dark/black background layer bleeds directly below the video player, clashing with custom themes or wallpaper backgrounds.

### Root Cause
1. **Ambient Mode ("Cinematics") Engine**: YouTube waits ~3 seconds for the video decoder to stabilize, then dynamically activates `[cinematics-enabled]` and mounts `#cinematics` / `#cinematics-container` / `#cinematics-full-bleed-container` with an active WebGL/canvas ambient glow.
2. **Bottom Vignette Mask**: To prevent the ambient glow from illuminating the entire page, YouTube overlays a hardcoded 200px dark gradient mask (`#cinematics::after` / `#cinematics-container::after`) fading into `#0f0f0f` / `#000000`.
3. **Player & App Wrappers**: `<ytd-app>`, `<ytd-page-manager>`, `#full-bleed-container`, and `.player-container-background` hold native `#0f0f0f` / `#000000` backgrounds.
4. **Cascade Interaction**: When the video playback triggers DOM mutations ~3s in, the top-down cascade pass clears intermediate wrappers (`#primary`, `#below`), which exposes the dark ambient mask and player backdrop cutting off beneath the player.

### User Workaround
In the YouTube video player, click the **Settings (gear icon ⚙️) → Ambient mode → Off**. Turning off Ambient Mode disables the cinematics container and vignette mask.

---

## 🐛 Known Issue: Claude.ai Chat Input Scroll Fade Overlay

### The Problem
When scrolling up in a chat on Claude.ai to read earlier conversation messages, an opaque dark/black layer appears across the width of the chat area above the input box, looking like a solid block covering the messages.

### Root Cause
Claude.ai's chat interface pins the prompt input using a sticky bottom container (`div[class*="sticky"][class*="bottom-0"]`) and attaches a fade-out gradient overlay (`bg-gradient-to-t from-bg-100 to-transparent` or inline `linear-gradient`) to soften message cutoffs. When at the bottom, no text is behind it. Once scrolled up, conversation text scrolls behind this full-width container, rendering an opaque dark slab across the custom theme background.

---

## ✅ Resolved Performance Optimizations

### 1. Scroll Repaint Lag (`background-attachment: fixed` → Fixed Backdrop Layer)
- **Status**: **RESOLVED** (Commit `8ba4796` & `70148e5`)
- **Fix**: Replaced `background-attachment: fixed` on `body` with an isolated hardware-accelerated `#vstr-backdrop-layer` attached directly to `document.documentElement` (`<html>`) styled with `position: fixed !important; inset: 0 !important; z-index: -2147483648 !important; pointer-events: none !important; will-change: transform !important;`. The viewport compositor retains GPU accelerated scrolling without repainting. Additionally, high-resolution imported wallpapers are automatically downscaled to 1920×1080 and compressed as WebP (0.85 quality) via offscreen canvas, dropping storage and decode overhead from ~10MB to ~200KB.

### 2. MutationObserver Layout Thrashing During Scrolling
- **Status**: **RESOLVED** (Commit `eb9c27d`)
- **Fix**:
  1. Scoped `bodyObserver` strictly to `mutation.addedNodes` rather than re-querying the entire document on every DOM update.
  2. Filtered out extension-injected elements (`#vstr-backdrop-layer`, style tags) to avoid self-triggered cycles.
  3. Implemented two-phase read/write batching across `recolorTextForContrast()`, `applyAdaptiveSurfaceMapping()`, `applyLuminanceFix()`, and `cornerFixCascade()`: all `getComputedStyle()` calls occur in Phase 1 before any inline styles or attributes are written in Phase 2.
  4. Scheduled DOM processing via `requestIdleCallback()` with debouncing so theme adjustments execute during browser idle time without impacting active scroll frames.
  5. Removed unnecessary `restoreCornerFixes()` calls from the observer loop.

---

## 📋 Other Known Limitations

| Issue | File | Description |
|---|---|---|
| YouTube Ambient Mode bleed | `content.js` | YouTube's cinematics ambient canvas vignette bleeds a dark mask ~3s into playback below the video player. Temporary workaround: toggle Ambient mode Off in player settings. |
| Claude.ai chat scroll mask | `content.js` | Sticky bottom chat container and gradient fade overlay render an opaque dark layer when scrolling up through chat history. |
| `include` field not resolved | `theme-parser.js` | VS Code themes using `"include": "./base-theme.json"` to inherit from a base theme cannot resolve the referenced file — only the top-level theme's own colors are used. |
| No SPA re-recoloring | `content.js` | Client-side navigations in SPAs (Next.js, Gatsby, Nuxt) that render new DOM without touching `<head>` won't get inline code blocks recolored. |
| Fixed combo opacity | `content.js:232` | Combo mode background overlay uses hardcoded `0.55` alpha. No user control. |
| No Firefox support | `manifest.json` | Extension uses Chrome-specific `chrome.*` APIs. Firefox requires `browser.*` with Promises. |
