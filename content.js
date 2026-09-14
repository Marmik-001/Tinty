/**
 * @file content.js
 * @description ThemeReader content script injected into every web page (`<all_urls>`).
 *
 * 4-Layer Recolor Pipeline:
 * 1. Document & App-Shell CSS: Injects a `<style id="vstr-injected-style">` element setting
 *    background, text, link, heading, and code-block colors on html/body and common wrapper 
 *    elements (#root, #app, #__next, etc.).
 * 2. Site Profiles: Redefines site-specific CSS custom properties (design tokens) at `:root` 
 *    for sites like MDN (developer.mozilla.org) to reach components sealed inside Shadow DOM.
 * 3. Class-Based Syntax Highlighting: Remaps class names from Prism.js, highlight.js, CodeMirror,
 *    and GitHub Primer to VS Code theme syntax colors via static CSS rules.
 * 4. Inline-Styled Syntax Highlighting (Shiki Pass): Scans `<pre>`/`<code>` blocks with inline
 *    `style="color:#hex"` attributes. Converts colors to HSL and maps each token to the nearest
 *    theme role color based on hue-distance calculation.
 *
 * Cascade Resilience:
 * Uses a MutationObserver on `<head>` to ensure ThemeReader's `<style>` tag remains the last
 * child in `<head>`, overriding dynamic CSS-in-JS or late-loaded external stylesheets.
 */

(function () {
  /** @type {string} ID of the injected extension stylesheet element. */
  const STYLE_ID = "vstr-injected-style";

  /** @type {string} DOM attribute used to cache an element's original inline color before recoloring. */
  const ORIG_ATTR = "data-vstr-orig-color";

  /** @type {string} DOM attribute marking elements whose background was force-darkened. */
  const DARK_BG_ATTR = "data-vstr-forced-bg";

  /** @type {string} DOM attribute caching original text color before contrast-aware recoloring. */
  const TEXT_ORIG_ATTR = "data-vstr-orig-text";

  /** @type {string} CSS selector for text-bearing elements to scan during contrast recoloring. */
  const TEXT_SELECTOR = 'p, li, span, h1, h2, h3, h4, h5, h6, a, td, th, label, blockquote, dt, dd, figcaption, summary, strong, em, b, i, small, mark, del, ins, sub, sup';

  /**
   * Sanitizes a Base64 data URL for safe inclusion in CSS `url("...")` rules.
   *
   * @param {string} url - Raw data URL or image path.
   * @returns {string} Sanitized URL string without double quotes.
   */
  function escapeForCss(url) {
    if (!url) return "";
    return url.replace(/"/g, "");
  }

  /**
   * Registry of site-specific CSS custom property (design token) mapping rules.
   * EnablesThemeReader to style components behind Shadow DOM boundaries (e.g. MDN).
   *
   * @type {Array<{match: function(string): boolean, vars: function(Object): Object}>}
   */
  const SITE_PROFILES = [
    {
      match: (host) => host === "developer.mozilla.org",
      vars: (t) => ({
        "--color-background-page": t.bg,
        "--color-background-primary": t.bg,
        "--color-background-secondary": t.codeBg,
        "--color-text-primary": t.fg,
        "--color-text-secondary": t.comment,
        "--color-link-normal": t.link,
        "--color-border-primary": t.border,
      }),
    },
  ];

  /**
   * Constructs CSS custom property declarations for matching site profiles.
   *
   * @param {Object} theme - Active theme object.
   * @returns {string} CSS rule string (e.g. `:root, html { --var: #val !important; }`).
   */
  function buildSiteProfileCSS(theme) {
    const profile = SITE_PROFILES.find((p) => p.match(location.hostname));
    if (!profile) return "";
    const vars = profile.vars(theme);
    const decls = Object.entries(vars)
      .map(([name, value]) => `${name}: ${value} !important;`)
      .join(" ");
    return `:root, html { ${decls} }`;
  }

  /**
   * CSS selector matching class names used by known class-based highlighters.
   * Used to skip these blocks during the inline Shiki pass to prevent rule conflicts.
   * @type {string}
   */
  const KNOWN_HIGHLIGHTER_SELECTOR =
    '.hljs, [class*="hljs-"], [class^="token"], [class*=" token"], .CodeMirror, [class*="cm-"], .pl-c, .pl-k, .pl-s, .pl-en, .pl-c1, .pl-smi, .pl-ent';

  /**
   * CSS selector matching common SPA root wrapper elements.
   * @type {string}
   */
  const APP_ROOT_SELECTOR =
    "#root, #app, #__next, #__nuxt, #___gatsby, main, #main, #content, .main-content";

  /**
   * Builds static CSS rules mapping popular syntax highlighter classes to theme syntax colors.
   *
   * @param {Object} t - Active theme object containing token colors.
   * @returns {string} CSS string for highlight.js, Prism, CodeMirror, and GitHub Primer.
   */
  function buildSyntaxCSS(t) {
    const comment = t.comment || t.fg;
    const keyword = t.keyword || t.accent || t.link;
    const string = t.string || t.fg;
    const fn = t.function || t.link;
    const number = t.number || t.accent || t.link;
    const cls = t.class || t.accent || t.link;
    const tag = t.tag || keyword;
    const variable = t.variable || t.fg;

    return `
      /* --- highlight.js --- */
      .hljs { background: ${t.codeBg} !important; color: ${t.fg} !important; }
      .hljs-comment, .hljs-quote { color: ${comment} !important; font-style: italic; }
      .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-subst { color: ${keyword} !important; }
      .hljs-string, .hljs-doctag, .hljs-regexp { color: ${string} !important; }
      .hljs-title, .hljs-title.function_, .hljs-built_in { color: ${fn} !important; }
      .hljs-number { color: ${number} !important; }
      .hljs-type, .hljs-class .hljs-title, .hljs-title.class_ { color: ${cls} !important; }
      .hljs-name, .hljs-tag { color: ${tag} !important; }
      .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable { color: ${variable} !important; }
      .hljs-symbol, .hljs-bullet, .hljs-link { color: ${string} !important; }

      /* --- Prism.js --- */
      pre[class*="language-"], code[class*="language-"] {
        background: ${t.codeBg} !important;
        color: ${t.fg} !important;
      }
      .token.comment, .token.prolog, .token.doctype, .token.cdata { color: ${comment} !important; font-style: italic; }
      .token.keyword, .token.selector, .token.atrule { color: ${keyword} !important; }
      .token.string, .token.char, .token.attr-value { color: ${string} !important; }
      .token.function, .token.function-variable { color: ${fn} !important; }
      .token.number, .token.boolean { color: ${number} !important; }
      .token.class-name, .token.builtin { color: ${cls} !important; }
      .token.tag { color: ${tag} !important; }
      .token.attr-name, .token.variable, .token.property { color: ${variable} !important; }
      .token.operator, .token.punctuation { color: ${t.fg} !important; }

      /* --- CodeMirror (interactive playgrounds, docs sites) --- */
      .CodeMirror { background: ${t.codeBg} !important; color: ${t.fg} !important; }
      .cm-comment { color: ${comment} !important; }
      .cm-keyword { color: ${keyword} !important; }
      .cm-string, .cm-string-2 { color: ${string} !important; }
      .cm-def, .cm-variable-2 { color: ${fn} !important; }
      .cm-number { color: ${number} !important; }
      .cm-type { color: ${cls} !important; }
      .cm-tag { color: ${tag} !important; }
      .cm-attribute, .cm-variable { color: ${variable} !important; }

      /* --- GitHub's own highlighter (Primer) --- */
      .pl-c { color: ${comment} !important; }
      .pl-k { color: ${keyword} !important; }
      .pl-s, .pl-pds { color: ${string} !important; }
      .pl-en { color: ${fn} !important; }
      .pl-c1, .pl-v { color: ${number} !important; }
      .pl-smi { color: ${variable} !important; }
      .pl-ent { color: ${tag} !important; }

      /* --- Shiki wrapper background --- */
      pre.shiki, pre[class*="shiki"], [data-rehype-pretty-code-fragment] pre {
        background-color: ${t.codeBg} !important;
      }
    `;
  }

  /**
   * Converts a 3 or 6-digit hex color into an RGBA string.
   *
   * @param {string} hex - Hex color string (e.g. "#1e1e1e").
   * @param {number} alpha - Alpha transparency value between 0 and 1.
   * @returns {string} RGBA formatted string (e.g. "rgba(30, 30, 30, 0.55)").
   */
  function hexToRgba(hex, alpha) {
    const h = (hex || "#000000").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const num = parseInt(full, 16) || 0;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Constructs the main stylesheet string based on theme mode (builtin/vscode, image, or combo).
   *
   * @param {Object} theme - Active theme definition object.
   * @returns {string} Complete CSS stylesheet content.
   */
  function buildCSS(theme) {
    if (!theme) return "";

    // Plain background image mode (no syntax theme attached)
    if (theme.type === "image") {
      const fg = theme.fg || "#f0f0f0";
      const link = theme.link || "#8ab4f8";
      return `
        html, body, ${APP_ROOT_SELECTOR} {
          background-image: url("${escapeForCss(theme.dataUrl)}") !important;
          background-size: cover !important;
          background-attachment: fixed !important;
          background-position: center center !important;
          background-repeat: no-repeat !important;
        }
        body {
          background-color: rgba(0,0,0,0.55) !important;
          background-blend-mode: darken !important;
        }
        body, p, li, span, article, section, main, header, footer,
        aside, td, th, label, blockquote, h1, h2, h3, h4, h5, h6 {
          color: ${fg} !important;
        }
        a, a:visited { color: ${link} !important; }
      `;
    }

    const bg = theme.bg || "#1e1e1e";
    const fg = theme.fg || "#d4d4d4";
    const link = theme.link || "#4daafc";
    const accent = theme.accent || link;
    const codeBg = theme.codeBg || "#2d2d2d";
    const border = theme.border || "#3c3c3c";

    // Background styling: Combo mode uses translucent theme background overlay; normal mode uses solid bg.
    const backgroundCSS =
      theme.type === "combo"
        ? `
          html, body, ${APP_ROOT_SELECTOR} {
            background-image: url("${escapeForCss(theme.dataUrl)}") !important;
            background-size: cover !important;
            background-attachment: fixed !important;
            background-position: center center !important;
            background-repeat: no-repeat !important;
          }
          body {
            background-color: ${hexToRgba(bg, 0.55)} !important;
            background-blend-mode: darken !important;
          }
        `
        : `
          html, body, ${APP_ROOT_SELECTOR} {
            background-color: ${bg} !important;
          }
        `;

    const pageCSS = `
      ${buildSiteProfileCSS(theme)}
      ${backgroundCSS}
      body, p, li, span, article, section, main, header, footer,
      aside, td, th, label, blockquote {
        color: ${fg} !important;
      }
      h1, h2, h3, h4, h5, h6 {
        color: ${accent} !important;
      }
      a, a:visited {
        color: ${link} !important;
      }
      code, pre {
        background-color: ${codeBg} !important;
        color: ${fg} !important;
      }
      hr, table, th, td {
        border-color: ${border} !important;
      }
    `;

    return pageCSS + buildSyntaxCSS(theme);
  }

  // --- Inline-Styled (Shiki) Highlighter Pass ---

  /**
   * Parses hex (#rrggbb) or RGB/RGBA CSS color strings into numerical RGB components.
   *
   * @param {string} str - Raw CSS color string from `element.style.color`.
   * @returns {Array<number>|null} `[r, g, b]` array (0-255) or null if unparseable.
   */
  function parseCssColor(str) {
    if (!str) return null;
    str = str.trim();
    let m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const num = parseInt(h, 16);
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }
    m = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    return null;
  }

  /**
   * Converts RGB (0-255) values into HSL (Hue, Saturation, Lightness).
   *
   * @param {Array<number>} rgb - `[r, g, b]` array.
   * @returns {{h: number, s: number, l: number}} HSL object (h: 0-360, s: 0-1, l: 0-1).
   */
  function rgbToHsl([r, g, b]) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r:
          h = 60 * (((g - b) / d) % 6);
          break;
        case g:
          h = 60 * ((b - r) / d + 2);
          break;
        case b:
          h = 60 * ((r - g) / d + 4);
          break;
      }
      if (h < 0) h += 360;
    }
    return { h, s, l };
  }

  /**
   * Calculates the shortest angular difference (0-180 degrees) between two hue values.
   *
   * @param {number} a - First hue angle in degrees.
   * @param {number} b - Second hue angle in degrees.
   * @returns {number} Angular distance in degrees.
   */
  function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /**
   * Pre-calculates HSL values for all syntax token roles in the active theme.
   *
   * @param {Object} theme - Active theme definition object.
   * @returns {Array<{role: string, color: string, hsl: {h: number, s: number, l: number}}>} Role lookup table.
   */
  function buildRoleTable(theme) {
    const roleNames = ["keyword", "string", "function", "number", "class", "tag", "variable"];
    const table = [];
    roleNames.forEach((name) => {
      const hex = theme[name];
      if (!hex) return;
      const rgb = parseCssColor(hex);
      if (!rgb) return;
      table.push({ role: name, color: hex, hsl: rgbToHsl(rgb) });
    });
    return table;
  }

  /**
   * Finds the theme syntax token color whose hue closest matches an original color's HSL hue.
   *
   * @param {{h: number, s: number, l: number}} originalHsl - Original token's HSL.
   * @param {Array<Object>} roleTable - Pre-calculated role table from `buildRoleTable()`.
   * @param {string} fallback - Fallback hex color if role table is empty.
   * @returns {string} Nearest theme token color hex.
   */
  function nearestRoleColor(originalHsl, roleTable, fallback) {
    if (roleTable.length === 0) return fallback;
    let best = roleTable[0];
    let bestDist = Infinity;
    for (const entry of roleTable) {
      const dist = hueDistance(originalHsl.h, entry.hsl.h);
      if (dist < bestDist) {
        bestDist = dist;
        best = entry;
      }
    }
    return best.color;
  }

  /**
   * Scans `<pre>` and `<code>` elements for inline `style="color:..."` syntax tokens (Shiki-style).
   * Maps each original color to the closest theme role color using hue-distance matching.
   *
   * @param {Object} theme - Active theme definition object.
   */
  function remapInlineColoredCodeBlocks(theme) {
    if (!theme || theme.type === "image") return;

    const roleTable = buildRoleTable(theme);
    const commentColor = theme.comment || theme.fg;
    if (roleTable.length === 0 && !commentColor) return;

    let blocks;
    try {
      blocks = document.querySelectorAll("pre, code");
    } catch (e) {
      return;
    }

    blocks.forEach((block) => {
      // Skip blocks managed by class-based highlighters (Prism, highlight.js, etc.)
      if (
        block.matches(KNOWN_HIGHLIGHTER_SELECTOR) ||
        block.closest(KNOWN_HIGHLIGHTER_SELECTOR) ||
        block.querySelector(KNOWN_HIGHLIGHTER_SELECTOR)
      ) {
        return;
      }

      const coloredEls = block.querySelectorAll('[style*="color"]');
      if (coloredEls.length === 0) return;

      // Cache color mappings per original color string within this block
      const colorMap = new Map();

      coloredEls.forEach((el) => {
        let original = el.getAttribute(ORIG_ATTR);
        if (!original) {
          original = el.style.color;
          if (!original) return;
          el.setAttribute(ORIG_ATTR, original);
        }

        if (!colorMap.has(original)) {
          const rgb = parseCssColor(original);
          if (!rgb) {
            colorMap.set(original, theme.fg);
          } else {
            const hsl = rgbToHsl(rgb);
            if (hsl.s < 0.12) {
              // Low saturation: route mid-tone grays to theme comment color; extreme grays to default text color.
              colorMap.set(
                original,
                hsl.l > 0.25 && hsl.l < 0.75 ? commentColor : theme.fg
              );
            } else {
              colorMap.set(original, nearestRoleColor(hsl, roleTable, theme.fg));
            }
          }
        }
        el.style.setProperty("color", colorMap.get(original), "important");
      });
    });
  }

  /**
   * Reverts inline code block recoloring when ThemeReader is disabled or turned off,
   * restoring original color attributes stored in `data-vstr-orig-color`.
   */
  function restoreInlineColoredCodeBlocks() {
    let marked;
    try {
      marked = document.querySelectorAll("[" + ORIG_ATTR + "]");
    } catch (e) {
      return;
    }
    marked.forEach((el) => {
      const original = el.getAttribute(ORIG_ATTR);
      if (original) el.style.setProperty("color", original);
      el.removeAttribute(ORIG_ATTR);
    });
  }

  // --- Force Dark Background Override (for light-themed websites) ---

  /** @type {string} CSS selector for elements to scan for light backgrounds. */
  const CONTAINER_SELECTOR = 'div, section, article, aside, nav, header, footer, main, figure, details, form, fieldset, dl, ul, ol, button, span, a, input, select, textarea, table, tr, td, th, thead, tbody, tfoot, label';

  /**
   * Scans visible container elements for light backgrounds and overrides them
   * with the active theme's background color. Only elements with computed
   * background lightness > 0.7 (HSL) are affected.
   *
   * @param {Object} theme - Active theme definition object.
   */
  function overrideLightBackgrounds(theme) {
    if (!theme || !theme.bg) return;

    let containers;
    try {
      containers = document.querySelectorAll(CONTAINER_SELECTOR);
    } catch (e) {
      return;
    }

    containers.forEach(function (el) {
      // Skip elements already processed
      if (el.hasAttribute(DARK_BG_ATTR)) return;

      var computed;
      try {
        computed = getComputedStyle(el).backgroundColor;
      } catch (e) {
        return;
      }
      if (!computed || computed === 'transparent' || computed === 'rgba(0, 0, 0, 0)') return;

      var rgb = parseCssColor(computed);
      if (!rgb) return;

      var hsl = rgbToHsl(rgb);
      // Override backgrounds that are "light" (lightness > 65%).
      // This catches white, off-white, light grays, and lightly-tinted backgrounds
      // that would cause invisible text with dark-theme light foreground colors.
      if (hsl.l > 0.65) {
        // Store original so we can restore it later
        el.setAttribute(DARK_BG_ATTR, computed);
        // For combo/image themes, use transparent so background image shows through
        if (theme.type === 'combo' || theme.type === 'image') {
          el.style.setProperty('background-color', 'transparent', 'important');
        } else {
          el.style.setProperty('background-color', theme.bg, 'important');
        }
      }
    });
  }

  /**
   * Restores original backgrounds on all elements that were force-darkened,
   * removing the override attribute.
   */
  function restoreForcedDarkBackgrounds() {
    var marked;
    try {
      marked = document.querySelectorAll('[' + DARK_BG_ATTR + ']');
    } catch (e) {
      return;
    }
    marked.forEach(function (el) {
      var original = el.getAttribute(DARK_BG_ATTR);
      if (original) {
        el.style.setProperty('background-color', original);
      } else {
        el.style.removeProperty('background-color');
      }
      el.removeAttribute(DARK_BG_ATTR);
    });
  }

  // --- WCAG Contrast Utilities ---

  /**
   * Linearizes a single sRGB channel value (0-255) for luminance calculation.
   *
   * @param {number} c - sRGB channel value (0-255).
   * @returns {number} Linearized channel value.
   */
  function linearize(c) {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /**
   * Calculates WCAG 2.1 relative luminance from RGB values.
   *
   * @param {Array<number>} rgb - [r, g, b] array (0-255).
   * @returns {number} Relative luminance (0-1).
   */
  function relativeLuminance(rgb) {
    return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
  }

  /**
   * Calculates WCAG 2.1 contrast ratio between two RGB colors.
   * Result is always >= 1. WCAG AA requires >= 4.5 for normal text.
   *
   * @param {Array<number>} rgb1 - First color [r, g, b].
   * @param {Array<number>} rgb2 - Second color [r, g, b].
   * @returns {number} Contrast ratio (1 to 21).
   */
  function contrastRatio(rgb1, rgb2) {
    var l1 = relativeLuminance(rgb1);
    var l2 = relativeLuminance(rgb2);
    var lighter = Math.max(l1, l2);
    var darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Walks up the DOM tree from an element to find the first ancestor with
   * a non-transparent computed background color.
   *
   * @param {Element} el - Starting element.
   * @returns {Array<number>|null} RGB array of the effective background, or null.
   */
  function getEffectiveBackground(el) {
    var current = el;
    var maxDepth = 20; // Safety limit
    while (current && maxDepth-- > 0) {
      try {
        var bg = getComputedStyle(current).backgroundColor;
      } catch (e) {
        return null;
      }
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        var rgb = parseCssColor(bg);
        if (rgb) return rgb;
      }
      current = current.parentElement;
    }
    // Fallback: assume white if we can't determine
    return [255, 255, 255];
  }

  /**
   * Builds a full palette table of all theme colors for text mapping.
   * Includes fg, link, accent, comment, and all syntax token colors.
   *
   * @param {Object} theme - Active theme definition object.
   * @returns {Array<{name: string, color: string, rgb: Array<number>}>} Color palette.
   */
  function buildFullPalette(theme) {
    var names = ['fg', 'link', 'accent', 'comment', 'keyword', 'string', 'function', 'number', 'class', 'tag', 'variable'];
    var palette = [];
    for (var i = 0; i < names.length; i++) {
      var hex = theme[names[i]];
      if (!hex) continue;
      var rgb = parseCssColor(hex);
      if (!rgb) continue;
      palette.push({ name: names[i], color: hex, rgb: rgb, hsl: rgbToHsl(rgb) });
    }
    return palette;
  }

  /**
   * Finds the best theme color for a text element by:
   * 1. Finding the closest theme palette color to the original text color (hue distance)
   * 2. Checking WCAG contrast ratio against the element's effective background
   * 3. If contrast is insufficient (<4.5:1), trying alternatives sorted by hue distance
   * 4. As a last resort, using theme.fg (guaranteed readable on theme.bg)
   *
   * @param {Array<number>} originalRgb - Original text color RGB.
   * @param {Array<number>} bgRgb - Effective background color RGB.
   * @param {Array<Object>} palette - Theme color palette from buildFullPalette().
   * @param {string} fallback - Fallback color (theme.fg).
   * @returns {string} Best theme color hex string.
   */
  function findContrastSafeColor(originalRgb, bgRgb, palette, fallback) {
    if (palette.length === 0) return fallback;

    var originalHsl = rgbToHsl(originalRgb);

    // Sort palette entries by hue distance from original color
    var sorted = palette.slice().sort(function (a, b) {
      return hueDistance(originalHsl.h, a.hsl.h) - hueDistance(originalHsl.h, b.hsl.h);
    });

    // Try each candidate in order of closeness, pick first with sufficient contrast
    for (var i = 0; i < sorted.length; i++) {
      if (contrastRatio(sorted[i].rgb, bgRgb) >= 4.5) {
        return sorted[i].color;
      }
    }

    // No palette color has sufficient contrast against this background.
    // Use luminance-based fallback: dark text on light bg, light text on dark bg.
    var bgLum = relativeLuminance(bgRgb);
    if (bgLum > 0.4) {
      // Light background → use dark text (near-black)
      return '#111111';
    } else {
      // Dark background → use theme.fg or near-white
      return fallback;
    }
  }

  /**
   * Scans text elements and recolors them using contrast-aware theme color mapping.
   * For each element:
   * 1. Reads the original (computed) text color
   * 2. Determines the effective background color (walking up ancestors)
   * 3. Maps to the closest theme color that passes WCAG AA contrast (4.5:1)
   *
   * @param {Object} theme - Active theme definition object.
   */
  function recolorTextForContrast(theme) {
    if (!theme) return;

    var palette = buildFullPalette(theme);
    var fallback = theme.fg || '#d4d4d4';

    var elements;
    try {
      elements = document.querySelectorAll(TEXT_SELECTOR);
    } catch (e) {
      return;
    }

    // Cache: map original computed color → best theme color per background
    // Key: "originalColor|bgColor"
    var colorCache = {};

    elements.forEach(function (el) {
      // Skip code blocks (handled by Shiki/class-based passes)
      try {
        if (el.closest('pre, code')) return;
      } catch (e) {
        return;
      }

      // Skip icon/decorative elements (role="img" spans, aria icons, etc.)
      if (el.getAttribute('role') === 'img') return;
      if (el.getAttribute('aria-hidden') === 'true') return;

      // Skip elements with no direct text content (icon wrapper spans, badge containers)
      // These use CSS ::before/::after or background-image for their visuals
      var hasDirectText = false;
      for (var n = 0; n < el.childNodes.length; n++) {
        if (el.childNodes[n].nodeType === 3 && el.childNodes[n].textContent.trim()) {
          hasDirectText = true;
          break;
        }
      }
      if (!hasDirectText) return;

      // Read original text color (before our override)
      var original = el.getAttribute(TEXT_ORIG_ATTR);
      if (!original) {
        try {
          original = getComputedStyle(el).color;
        } catch (e) {
          return;
        }
        if (!original) return;
        el.setAttribute(TEXT_ORIG_ATTR, original);
      }

      var originalRgb = parseCssColor(original);
      if (!originalRgb) return;

      // Get effective background this text sits on
      var bgRgb = getEffectiveBackground(el);
      if (!bgRgb) return;

      // Check cache
      var cacheKey = original + '|' + bgRgb.join(',');
      if (!(cacheKey in colorCache)) {
        colorCache[cacheKey] = findContrastSafeColor(originalRgb, bgRgb, palette, fallback);
      }

      el.style.setProperty('color', colorCache[cacheKey], 'important');
    });
  }

  /**
   * Restores original text colors on all elements recolored by the contrast pass.
   */
  function restoreRecoloredText() {
    var marked;
    try {
      marked = document.querySelectorAll('[' + TEXT_ORIG_ATTR + ']');
    } catch (e) {
      return;
    }
    marked.forEach(function (el) {
      var original = el.getAttribute(TEXT_ORIG_ATTR);
      if (original) {
        el.style.setProperty('color', original);
      } else {
        el.style.removeProperty('color');
      }
      el.removeAttribute(TEXT_ORIG_ATTR);
    });
  }

  /** @type {MutationObserver|null} Observer for dynamically added elements when force-dark is on. */
  var bodyObserver = null;

  /**
   * Starts a MutationObserver on document.body to force-darken backgrounds
   * on dynamically added container elements (e.g. SPA page transitions, modals).
   *
   * @param {Object} theme - Active theme definition object.
   */
  function startBodyObserver(theme) {
    stopBodyObserver();
    if (!document.body) return;

    var debounceTimer = null;
    bodyObserver = new MutationObserver(function () {
      // Debounce to avoid thrashing on rapid DOM changes
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        overrideLightBackgrounds(theme);
        recolorTextForContrast(theme);
      }, 150);
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Stops the body MutationObserver if active.
   */
  function stopBodyObserver() {
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
  }

  // --- Cascade Resilience Mechanism ---

  /** @type {MutationObserver|null} Observer instance watching `<head>` for added stylesheets. */
  let headObserver = null;

  /**
   * Ensures `<style id="vstr-injected-style">` remains the last child in `<head>`
   * so its CSS rules maintain cascade precedence over dynamic page stylesheets.
   */
  function keepStyleTagLast() {
    const style = document.getElementById(STYLE_ID);
    if (!style || !document.head) return;
    if (document.head.lastElementChild !== style) {
      document.head.appendChild(style);
    }
  }

  /**
   * Instantiates a MutationObserver on `<head>` to detect newly appended `<style>` or `<link>` elements.
   */
  function ensureHeadObserver() {
    if (headObserver || !document.head) return;
    headObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id === STYLE_ID) continue;
          if (node.tagName === "STYLE" || node.tagName === "LINK") {
            keepStyleTagLast();
            return;
          }
        }
      }
    });
    headObserver.observe(document.head, { childList: true });
  }

  /**
   * Applies or removes ThemeReader styling based on stored configuration settings.
   *
   * @param {Object} settings - Configuration loaded from `chrome.storage.local`.
   */
  function applySettings(settings) {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();

    const shouldApply =
      settings &&
      settings.enabled !== false &&
      settings.theme &&
      !(settings.disabledSites && settings.disabledSites.includes(location.hostname));

    if (!shouldApply) {
      restoreInlineColoredCodeBlocks();
      restoreForcedDarkBackgrounds();
      restoreRecoloredText();
      stopBodyObserver();
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCSS(settings.theme);
    (document.head || document.documentElement).appendChild(style);
    ensureHeadObserver();

    remapInlineColoredCodeBlocks(settings.theme);

    // Force dark backgrounds on light-themed sites (opt-in)
    if (settings.forceDarkBg) {
      overrideLightBackgrounds(settings.theme);
      recolorTextForContrast(settings.theme);
      startBodyObserver(settings.theme);
    } else {
      restoreForcedDarkBackgrounds();
      restoreRecoloredText();
      stopBodyObserver();
    }
  }

  /**
   * Reads settings from `chrome.storage.local` and invokes `applySettings()`.
   */
  function loadAndApply() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(["enabled", "disabledSites", "theme", "forceDarkBg"], (settings) => {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) return;
        applySettings(settings);
      });
    } catch (e) {
      // Catch context invalidation error when extension reloads
    }
  }

  // --- Initial Execution Lifecycles ---
  loadAndApply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAndApply, { once: true });
  }
  window.addEventListener("load", loadAndApply, { once: true });

  // --- Live Settings Sync Listener ---
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") loadAndApply();
      });
    }
  } catch (e) {}
})();
