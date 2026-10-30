/**
 * @file content.js
 * @description Tinty content script injected into every web page (`<all_urls>`).
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
 * Uses a MutationObserver on `<head>` to ensure Tinty's `<style>` tag remains the last
 * child in `<head>`, overriding dynamic CSS-in-JS or late-loaded external stylesheets.
 */

(function () {
  /** @type {string} ID of the injected extension stylesheet element. */
  const STYLE_ID = "vstr-injected-style";

  /** @type {string} ID of the hardware-accelerated fixed wallpaper backdrop element. */
  const BACKDROP_ID = "vstr-backdrop-layer";

  /** @type {string} DOM attribute used to cache an element's original inline color before recoloring. */
  const ORIG_ATTR = "data-vstr-orig-color";

  /** @type {string} DOM attribute marking elements whose background was force-darkened. */
  const DARK_BG_ATTR = "data-vstr-forced-bg";

  /** @type {string} DOM attribute caching original text color before contrast-aware recoloring. */
  const TEXT_ORIG_ATTR = "data-vstr-orig-text";

  /** @type {string} DOM attribute marking elements modified by corner fix strategies. */
  const CORNER_FIX_ATTR = 'data-vstr-corner-fix';

  /** @type {string} DOM attribute marking elements recolored by Option 1 Luminance Check. */
  const LUMINANCE_FIX_ATTR = 'data-vstr-lum-fix';

  /** @type {string} Element ID for Option 2 Scoped CSS stylesheet. */
  const SCOPED_CSS_FIX_ID = 'vstr-lightmode-scoped-css';

  /** @type {string} DOM attribute marking elements modified by Option 3 Adaptive Surface Mapping. */
  const ADAPTIVE_SURFACE_ATTR = 'data-vstr-adaptive-surface';

  /** @type {string} CSS selector for text-bearing elements to scan during contrast recoloring. */
  const TEXT_SELECTOR = 'p, li, span, h1, h2, h3, h4, h5, h6, a, td, th, label, blockquote, dt, dd, figcaption, summary, strong, em, b, i, small, mark, del, ins, sub, sup, div, font';

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
    {
      match: (host) => host.includes("youtube.com"),
      vars: (t) => ({
        "--yt-spec-base-background": (t.type === "image" || t.type === "combo") ? "transparent" : (t.bg || "#1e1e1e"),
        "--yt-spec-general-background-a": (t.type === "image" || t.type === "combo") ? "transparent" : (t.bg || "#1e1e1e"),
        "--yt-spec-general-background-b": (t.type === "image" || t.type === "combo") ? "transparent" : (t.bg || "#1e1e1e"),
      }),
      rules: (t) => `
        /* YouTube: Ensure main app views allow theme backdrop to show */
        ytd-app,
        ytd-page-manager,
        #page-manager,
        ytd-watch-flexy,
        ytd-watch-grid {
          background: transparent !important;
          background-color: transparent !important;
        }

        /* YouTube: Neutralize all ambient mode (cinematics) containers and vignette masks */
        #cinematics-full-bleed-container,
        #cinematics,
        #cinematics-container,
        ytd-cinematics,
        .player-container-background {
          background: transparent !important;
          background-color: transparent !important;
        }

        #cinematics::after,
        #cinematics-container::after,
        #cinematics-full-bleed-container::after,
        ytd-cinematics::after,
        [id*="cinematics"]::after,
        [id*="cinematics"] > *::after {
          background: transparent !important;
          background-image: none !important;
          display: none !important;
        }

        /* YouTube: Remove black background bleed under player wrappers in all views */
        #player,
        #ytd-player,
        #player-container,
        #player-container-outer,
        #player-container-inner,
        #full-bleed-container,
        #player-full-bleed-container,
        #player-theater-container,
        ytd-player {
          background: transparent !important;
          background-color: transparent !important;
        }

        /* YouTube: Keep primary column directly under video transparent so theme shows */
        #primary,
        #primary-inner,
        #below,
        ytd-watch-metadata,
        #above-the-fold {
          background: transparent !important;
          background-color: transparent !important;
        }
      `,
    },
    {
      match: (host) => host.includes("claude.ai"),
      vars: (t) => ({
        "--bg-000": (t.type === "image" || t.type === "combo") ? "transparent" : t.bg,
        "--bg-100": (t.type === "image" || t.type === "combo") ? "transparent" : t.bg,
        "--bg-200": (t.type === "image" || t.type === "combo") ? "transparent" : t.codeBg,
        "--text-000": t.fg,
        "--text-100": t.fg,
        "--text-200": t.comment || t.fg,
      }),
      rules: (t) => `
        /* claude.ai: neutralize scroll gradient mask floating above chat input box */
        div[class*="bg-gradient-to-t"],
        div[class*="from-bg-"],
        div[class*="from-black"],
        div[class*="from-stone-"],
        div[class*="from-gray-"],
        div[style*="linear-gradient"],
        div[class*="pointer-events-none"][class*="absolute"][class*="bottom-full"],
        div[class*="sticky"]::before,
        div[class*="sticky"]::after,
        div[class*="fixed"]::before,
        div[class*="fixed"]::after {
          background: transparent !important;
          background-image: none !important;
        }

        /* claude.ai: ensure sticky bottom chat input wrapper doesn't render an opaque black slab */
        div[class*="sticky"][class*="bottom-0"],
        div[class*="fixed"][class*="bottom-0"],
        footer[class*="bottom-0"] {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
        }

        /* claude.ai: keep the input box card distinct and readable */
        fieldset,
        form[class*="relative"] > div,
        [data-testid="chat-input"] {
          background-color: ${(t.type === "image" || t.type === "combo") ? "rgba(30, 30, 30, 0.75)" : (t.codeBg || "#2d2d2d")} !important;
        }
      `,
    },
    {
      match: (host) => host.includes("mail.google.com"),
      rules: (t) => {
        const fg = t.fg || (t.type === "image" ? "#f0f0f0" : "#d4d4d4");
        const link = t.link || (t.type === "image" ? "#8ab4f8" : "#4daafc");
        const codeBg = (t.type === "image" || t.type === "combo") ? "rgba(30, 30, 30, 0.75)" : (t.codeBg || "#252526");
        return `
          /* Gmail: Ensure email message body content is always crisp and readable */
          .a3s,
          .a3s div,
          .a3s p,
          .a3s span,
          .a3s font,
          .a3s td,
          .a3s th,
          .a3s li,
          .a3s b,
          .a3s strong,
          .a3s em,
          .a3s i,
          .a3s u,
          .a3s blockquote,
          .gmail_quote,
          .gmail_default,
          .gmail_attr {
            color: ${fg} !important;
          }

          /* Gmail: Ensure links inside message bodies have high-contrast theme link color */
          .a3s a,
          .a3s a:visited,
          .a3s a * {
            color: ${link} !important;
          }

          /* Gmail: Neutralize white message body wrappers so theme background/card shows */
          .ii.gt,
          .a3s {
            background-color: transparent !important;
          }

          /* Gmail: Ensure compose / edit message body is readable */
          div[aria-label="Message Body"],
          div[role="textbox"][g_editable="true"],
          .Am.Al.editable {
            color: ${fg} !important;
            background-color: ${codeBg} !important;
          }
        `;
      },
    },
  ];

  /**
   * Constructs CSS custom property declarations and site-specific rules for matching site profiles.
   *
   * @param {Object} theme - Active theme object.
   * @returns {string} CSS rule string.
   */
  function buildSiteProfileCSS(theme) {
    const profile = SITE_PROFILES.find((p) => p.match(location.hostname));
    if (!profile) return "";
    let css = "";
    if (profile.vars) {
      const vars = profile.vars(theme);
      const decls = Object.entries(vars)
        .map(([name, value]) => `${name}: ${value} !important;`)
        .join(" ");
      css += `:root, html { ${decls} }\n`;
    }
    if (profile.rules) {
      css += profile.rules(theme) + "\n";
    }
    return css;
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
        ${buildSiteProfileCSS(theme)}
        #${BACKDROP_ID} {
          position: fixed !important;
          inset: 0 !important;
          background: url("${escapeForCss(theme.dataUrl)}") center / cover no-repeat !important;
          z-index: -2147483648 !important;
          pointer-events: none !important;
          will-change: transform !important;
        }
        html, ${APP_ROOT_SELECTOR} {
          background: transparent !important;
          background-color: transparent !important;
        }
        body {
          background: transparent !important;
          background-color: rgba(0, 0, 0, 0.55) !important;
        }
        body, p, li, span, article, section, main, header, footer,
        aside, td, th, label, blockquote, font, h1, h2, h3, h4, h5, h6 {
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

    // Background styling: Combo mode uses translucent theme background overlay over the fixed backdrop; normal mode uses solid bg.
    const backgroundCSS =
      theme.type === "combo"
        ? `
          #${BACKDROP_ID} {
            position: fixed !important;
            inset: 0 !important;
            background: url("${escapeForCss(theme.dataUrl)}") center / cover no-repeat !important;
            z-index: -2147483648 !important;
            pointer-events: none !important;
            will-change: transform !important;
          }
          html, ${APP_ROOT_SELECTOR} {
            background: transparent !important;
            background-color: transparent !important;
          }
          body {
            background: transparent !important;
            background-color: ${hexToRgba(bg, 0.55)} !important;
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
      aside, td, th, label, blockquote, font {
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

  // --- Universal Color Resolver (Canvas-based) ---

  /** @type {HTMLCanvasElement|null} Reusable 1x1 canvas for color resolution. */
  var _resolveCanvas = null;
  /** @type {CanvasRenderingContext2D|null} Reusable canvas context. */
  var _resolveCtx = null;
  /** @type {Object} Cache of resolved color strings → RGB arrays. */
  var _resolveCache = {};

  /**
   * Resolves ANY CSS color string (including lab(), oklch(), color(), hsl(), etc.)
   * into an [r, g, b] array by rendering it to a 1×1 Canvas and reading the pixel.
   * Results are cached for performance.
   *
   * Falls through to parseCssColor first for speed on simple hex/rgb values.
   *
   * @param {string} colorStr - Any valid CSS color string.
   * @returns {Array<number>|null} [r, g, b] array (0-255) or null if invalid/transparent.
   */
  function resolveColor(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') return null;

    // Fast path: try standard parser first
    var fast = parseCssColor(colorStr);
    if (fast) return fast;

    // Check cache
    if (colorStr in _resolveCache) return _resolveCache[colorStr];

    // Canvas fallback: renders the color and reads the pixel
    try {
      if (!_resolveCanvas) {
        _resolveCanvas = document.createElement('canvas');
        _resolveCanvas.width = 1;
        _resolveCanvas.height = 1;
        _resolveCtx = _resolveCanvas.getContext('2d', { willReadFrequently: true });
      }
      // Reset to known opaque state
      _resolveCtx.clearRect(0, 0, 1, 1);
      _resolveCtx.fillStyle = '#000';
      _resolveCtx.fillStyle = colorStr;
      _resolveCtx.fillRect(0, 0, 1, 1);
      var data = _resolveCtx.getImageData(0, 0, 1, 1).data;
      // Alpha 0 = transparent / invalid color
      if (data[3] === 0) {
        _resolveCache[colorStr] = null;
        return null;
      }
      var result = [data[0], data[1], data[2]];
      _resolveCache[colorStr] = result;
      return result;
    } catch (e) {
      _resolveCache[colorStr] = null;
      return null;
    }
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
   * Reverts inline code block recoloring when Tinty is disabled or turned off,
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

      var rgb = resolveColor(computed);
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
   * @param {Object} [theme] - Optional active theme definition object for root canvas fallback.
   * @returns {Array<number>|null} RGB array of the effective background, or null.
   */
  function getEffectiveBackground(el, theme) {
    var current = el;
    var maxDepth = 60; // Deep enough for modern complex SPAs (Gmail, Slack, Jira)
    while (current && current !== document.documentElement && maxDepth-- > 0) {
      try {
        var bg = getComputedStyle(current).backgroundColor;
      } catch (e) {
        break;
      }
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        var rgb = resolveColor(bg);
        if (rgb) return rgb;
      }
      current = current.parentElement;
    }

    // Check document.body background
    if (document.body) {
      try {
        var bodyBg = getComputedStyle(document.body).backgroundColor;
        if (bodyBg && bodyBg !== 'transparent' && bodyBg !== 'rgba(0, 0, 0, 0)') {
          var bRgb = resolveColor(bodyBg);
          if (bRgb) return bRgb;
        }
      } catch (e) {}
    }

    // Theme-grounded fallback when all ancestors are transparent (e.g. over dark wallpaper)
    if (theme) {
      if (theme.type === 'image') {
        return [30, 30, 30];
      }
      if (theme.bg) {
        var tRgb = resolveColor(theme.bg);
        if (tRgb) return tRgb;
      }
    }

    return [30, 30, 30];
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
    var defaultFg = (theme && theme.fg) || (theme && theme.type === "image" ? "#f0f0f0" : "#d4d4d4");
    var fgAdded = false;

    for (var i = 0; i < names.length; i++) {
      var hex = theme[names[i]];
      if (!hex) continue;
      var rgb = parseCssColor(hex);
      if (!rgb) continue;
      if (names[i] === 'fg') fgAdded = true;
      palette.push({ name: names[i], color: hex, rgb: rgb, hsl: rgbToHsl(rgb) });
    }

    if (!fgAdded) {
      var fgRgb = parseCssColor(defaultFg);
      if (fgRgb) {
        palette.unshift({ name: 'fg', color: defaultFg, rgb: fgRgb, hsl: rgbToHsl(fgRgb) });
      }
    }

    return palette;
  }

  /**
   * Finds the best readable color from the theme palette for text on a given background.
   * Tries theme.fg first (most common), then palette colors by contrast ratio,
   * then falls back to near-black or near-white based on background luminance.
   *
   * @param {Array<number>} bgRgb - Effective background color RGB.
   * @param {Array<Object>} palette - Theme color palette from buildFullPalette().
   * @returns {string} Best readable color hex string.
   */
  function findBestContrastColor(bgRgb, palette) {
    // Try theme.fg first (preferred primary text color)
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].name === 'fg' && contrastRatio(palette[i].rgb, bgRgb) >= 4.5) {
        return palette[i].color;
      }
    }

    // Try all palette colors, pick the one with highest contrast
    var best = null;
    var bestRatio = 0;
    for (var j = 0; j < palette.length; j++) {
      var ratio = contrastRatio(palette[j].rgb, bgRgb);
      if (ratio >= 4.5 && ratio > bestRatio) {
        best = palette[j].color;
        bestRatio = ratio;
      }
    }
    if (best) return best;

    // No palette color works — luminance-based fallback (guaranteed readable)
    var bgLum = relativeLuminance(bgRgb);
    return bgLum > 0.4 ? '#111111' : '#f0f0f0';
  }

  /**
   * Scans text elements and ensures each has sufficient contrast against its
   * effective background. Only intervenes on elements where contrast is actually
   * bad — leaves everything else untouched.
   *
   * Batches all computed style reads in Phase 1 before applying any inline style writes in Phase 2
   * to eliminate forced synchronous layout thrashing during dynamic DOM updates.
   *
   * @param {Object} theme - Active theme definition object.
   * @param {Element|Document} [rootNode] - Optional subtree root to scope query (defaults to document).
   */
  function recolorTextForContrast(theme, rootNode) {
    if (!theme) return;

    var target = rootNode || document;
    var elements;
    try {
      elements = target.querySelectorAll ? target.querySelectorAll(TEXT_SELECTOR) : [];
      if (target.matches && target.matches(TEXT_SELECTOR)) {
        elements = [target, ...elements];
      }
    } catch (e) {
      return;
    }

    var palette = buildFullPalette(theme);
    var colorCache = {};
    var toRecolor = [];

    // --- Phase 1: Batched Reads ---
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
      var hasDirectText = false;
      for (var n = 0; n < el.childNodes.length; n++) {
        if (el.childNodes[n].nodeType === 3 && el.childNodes[n].textContent.trim()) {
          hasDirectText = true;
          break;
        }
      }
      if (!hasDirectText) return;

      // Read CURRENT text color (whatever it is right now — original or themed)
      var currentColorStr;
      try {
        currentColorStr = getComputedStyle(el).color;
      } catch (e) {
        return;
      }
      if (!currentColorStr) return;

      var currentRgb = resolveColor(currentColorStr);
      if (!currentRgb) return;

      // Get effective background this text sits on (post-override)
      var bgRgb = getEffectiveBackground(el, theme);
      if (!bgRgb) return;

      // If current contrast is already good, leave it alone
      if (contrastRatio(currentRgb, bgRgb) >= 4.5) return;

      // Find best color with good contrast against this background
      var cacheKey = bgRgb.join(',');
      if (!(cacheKey in colorCache)) {
        colorCache[cacheKey] = findBestContrastColor(bgRgb, palette);
      }

      toRecolor.push({
        el: el,
        orig: currentColorStr,
        newColor: colorCache[cacheKey]
      });
    });

    // --- Phase 2: Batched Writes (Zero Layout Thrashing) ---
    toRecolor.forEach(function (item) {
      if (!item.el.hasAttribute(TEXT_ORIG_ATTR)) {
        item.el.setAttribute(TEXT_ORIG_ATTR, item.orig);
      }
      item.el.style.setProperty('color', item.newColor, 'important');
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

  // ============================================================================
  // [LEGACY / EXPERIMENTAL] Option 1: Contrast-Aware Luminance Check
  // Evaluates effective parent background luminance dynamically and sets dark
  // text when containers are light. Kept for reference and testing.
  // ============================================================================

  /**
   * [LEGACY / EXPERIMENTAL] Option 1: Contrast-Aware Luminance Check.
   * Walks text elements and evaluates their effective background.
   * If the effective background is light (relative luminance > 0.4), overrides the text color
   * with a readable dark tone (#111827 for normal text, #0969da for links, #0f172a for headings).
   *
   * Batches all computed style reads in Phase 1 before applying any inline style writes in Phase 2
   * to eliminate forced synchronous layout thrashing during dynamic DOM updates.
   *
   * @param {Object} theme - Active theme definition object.
   * @param {Element|Document} [rootNode] - Optional subtree root to scope query (defaults to document).
   */
  function applyLuminanceFix(theme, rootNode) {
    if (!theme) return;

    var target = rootNode || document;
    var elements;
    try {
      elements = target.querySelectorAll ? target.querySelectorAll(TEXT_SELECTOR) : [];
      if (target.matches && target.matches(TEXT_SELECTOR)) {
        elements = [target, ...elements];
      }
    } catch (e) {
      return;
    }

    var toUpdate = [];

    // --- Phase 1: Batched Reads ---
    elements.forEach(function (el) {
      // Skip code blocks (handled by syntax highlighting)
      try {
        if (el.closest('pre, code')) return;
      } catch (e) {
        return;
      }

      // Skip icons or aria-hidden elements
      if (el.getAttribute('role') === 'img' || el.getAttribute('aria-hidden') === 'true') return;

      // Check if element has direct text content
      var hasDirectText = false;
      for (var n = 0; n < el.childNodes.length; n++) {
        if (el.childNodes[n].nodeType === 3 && el.childNodes[n].textContent.trim()) {
          hasDirectText = true;
          break;
        }
      }
      if (!hasDirectText) return;

      var bgRgb = getEffectiveBackground(el, theme);
      if (!bgRgb) return;

      var lum = relativeLuminance(bgRgb);

      if (lum > 0.4) {
        var isLink = el.tagName === 'A' || el.closest('a');
        var isHeading = /^H[1-6]$/i.test(el.tagName);
        var targetColor = isLink ? '#0969da' : (isHeading ? '#0f172a' : '#111827');
        toUpdate.push({ el: el, action: 'set', color: targetColor });
      } else if (el.hasAttribute(LUMINANCE_FIX_ATTR)) {
        toUpdate.push({ el: el, action: 'restore' });
      }
    });

    // --- Phase 2: Batched Writes (Zero Layout Thrashing) ---
    toUpdate.forEach(function (item) {
      var el = item.el;
      if (item.action === 'set') {
        if (!el.hasAttribute(LUMINANCE_FIX_ATTR)) {
          var prevInline = el.style.getPropertyValue('color');
          var prevPrio = el.style.getPropertyPriority('color');
          el.setAttribute(LUMINANCE_FIX_ATTR, (prevPrio ? '!important:' : '') + (prevInline || '__NONE__'));
        }
        el.style.setProperty('color', item.color, 'important');
      } else if (item.action === 'restore') {
        var saved = el.getAttribute(LUMINANCE_FIX_ATTR);
        if (saved && saved !== '__NONE__') {
          if (saved.startsWith('!important:')) {
            el.style.setProperty('color', saved.slice(11), 'important');
          } else {
            el.style.setProperty('color', saved);
          }
        } else {
          el.style.removeProperty('color');
        }
        el.removeAttribute(LUMINANCE_FIX_ATTR);
      }
    });
  }

  /**
   * Restores original text colors for elements modified by Option 1 Luminance Check.
   */
  function restoreLuminanceFix() {
    var marked;
    try {
      marked = document.querySelectorAll('[' + LUMINANCE_FIX_ATTR + ']');
    } catch (e) {
      return;
    }
    marked.forEach(function (el) {
      var saved = el.getAttribute(LUMINANCE_FIX_ATTR);
      if (saved && saved !== '__NONE__') {
        if (saved.startsWith('!important:')) {
          el.style.setProperty('color', saved.slice(11), 'important');
        } else {
          el.style.setProperty('color', saved);
        }
      } else {
        el.style.removeProperty('color');
      }
      el.removeAttribute(LUMINANCE_FIX_ATTR);
    });
  }

  // ============================================================================
  // [LEGACY / EXPERIMENTAL] Option 2: Scoped CSS & Dark Scheme (Pure CSS)
  // Injects declarative color-scheme: dark and high-specificity selectors.
  // ============================================================================

  /**
   * [LEGACY / EXPERIMENTAL] Option 2: Scoped CSS & Dark Scheme.
   * Injects declarative CSS rules with :root { color-scheme: dark !important; } and scopes
   * text colors inside explicit light/white containers so they remain readable dark text.
   *
   * @param {Object} theme - Active theme definition object.
   */
  function applyScopedCssFix(theme) {
    var existing = document.getElementById(SCOPED_CSS_FIX_ID);
    if (existing) existing.remove();

    var linkColor = '#0969da';
    var textColor = '#111827';
    var headingColor = '#0f172a';

    var css = `
      /* Option 2: Declarative color-scheme switch for modern sites */
      :root, html {
        color-scheme: dark !important;
      }

      /* Explicit light/white surface classes and inline background attributes */
      [class*="bg-white"], [class*="bg-light"], [class*="card-white"],
      [class*="bg-gray-50"], [class*="bg-gray-100"], [class*="bg-neutral-50"],
      [class*="bg-slate-50"], [class*="bg-slate-100"], [class*="bg-zinc-50"], [class*="bg-zinc-100"],
      [style*="background: rgb(255"], [style*="background: #fff"], [style*="background: white"],
      [style*="background-color: rgb(255"], [style*="background-color: #fff"], [style*="background-color: white"],
      [style*="background-color: rgb(250"], [style*="background-color: rgb(24"],
      .c-docs-page, .theme-doc-markdown, .article-content, .markdown-body.light {
        color: ${textColor} !important;
      }

      /* Descendant text inside light containers */
      [class*="bg-white"] p, [class*="bg-white"] li, [class*="bg-white"] span, [class*="bg-white"] div,
      [class*="bg-white"] td, [class*="bg-white"] th, [class*="bg-white"] label,
      [class*="bg-light"] p, [class*="bg-light"] li, [class*="bg-light"] span, [class*="bg-light"] div,
      [style*="background: rgb(255"] p, [style*="background: rgb(255"] span, [style*="background: rgb(255"] li,
      [style*="background-color: rgb(255"] p, [style*="background-color: rgb(255"] span, [style*="background-color: rgb(255"] li,
      [style*="background: #fff"] p, [style*="background: #fff"] span, [style*="background: #fff"] li,
      [style*="background-color: #fff"] p, [style*="background-color: #fff"] span, [style*="background-color: #fff"] li,
      [style*="background: white"] p, [style*="background: white"] span, [style*="background: white"] li,
      [style*="background-color: white"] p, [style*="background-color: white"] span, [style*="background-color: white"] li {
        color: ${textColor} !important;
      }

      [class*="bg-white"] h1, [class*="bg-white"] h2, [class*="bg-white"] h3,
      [class*="bg-white"] h4, [class*="bg-white"] h5, [class*="bg-white"] h6,
      [style*="background-color: rgb(255"] h1, [style*="background-color: rgb(255"] h2, [style*="background-color: rgb(255"] h3 {
        color: ${headingColor} !important;
      }

      [class*="bg-white"] a, [class*="bg-light"] a,
      [style*="background-color: rgb(255"] a, [style*="background-color: #fff"] a, [style*="background-color: white"] a {
        color: ${linkColor} !important;
      }
    `;

    var style = document.createElement('style');
    style.id = SCOPED_CSS_FIX_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Restores original state by removing the Option 2 Scoped CSS stylesheet.
   */
  function restoreScopedCssFix() {
    var existing = document.getElementById(SCOPED_CSS_FIX_ID);
    if (existing) existing.remove();
  }

  // ============================================================================
  // [DEFAULT] Primary Light-Page Strategy: Adaptive Surface Mapping
  // Identifies light containers and maps them into layered VS Code dark surfaces
  // (card/widget elevation, borders, and base background) while preserving hierarchy.
  // ============================================================================

  /**
   * [DEFAULT] Adaptive Surface Mapping.
   * Maps light containers into layered VS Code dark surfaces (base editor background,
   * card/widget surface, and borders) instead of flattening all containers.
   *
   * Batches all computed style reads in Phase 1 before applying any inline style writes in Phase 2
   * to eliminate forced synchronous layout thrashing during dynamic DOM updates.
   *
   * @param {Object} theme - Active theme definition object.
   * @param {Element|Document} [rootNode] - Optional subtree root to scope query (defaults to document).
   */
  function applyAdaptiveSurfaceMapping(theme, rootNode) {
    if (!theme) return;

    var target = rootNode || document;
    var containers;
    try {
      containers = target.querySelectorAll ? target.querySelectorAll(CONTAINER_SELECTOR) : [];
      if (target.matches && target.matches(CONTAINER_SELECTOR)) {
        containers = [target, ...containers];
      }
    } catch (e) {
      return;
    }

    var baseBg = theme.bg || '#1e1e1e';
    var cardBg = theme.codeBg || '#252526';
    var borderColor = theme.border || '#3c3c3c';
    var isImageOrCombo = theme.type === 'image' || theme.type === 'combo';

    var toUpdate = [];

    // --- Phase 1: Batched Reads ---
    containers.forEach(function (el) {
      if (el.hasAttribute(ADAPTIVE_SURFACE_ATTR)) return;
      if (el === document.body || el === document.documentElement) return;

      var computed;
      try {
        computed = getComputedStyle(el);
      } catch (e) {
        return;
      }

      var bg = computed.backgroundColor;
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return;

      var rgb = resolveColor(bg);
      if (!rgb) return;

      var hsl = rgbToHsl(rgb);
      if (hsl.l > 0.65) {
        var radius = parseFloat(computed.borderRadius) || 0;
        var hasShadow = computed.boxShadow && computed.boxShadow !== 'none';
        var hasBorder = parseFloat(computed.borderWidth) || 0;
        var isCard = radius > 2 || hasShadow || hasBorder > 0 ||
          el.matches('.card, [class*="card"], [class*="panel"], [class*="dialog"], [class*="modal"], [class*="dropdown"], [class*="popup"], table, tr, td, th, aside, nav, article');

        var prevBg = el.style.getPropertyValue('background-color');
        var prevBorder = el.style.getPropertyValue('border-color');

        var newBg;
        var newBorder = null;

        if (isImageOrCombo) {
          if (isCard) {
            newBg = 'rgba(30, 30, 30, 0.75)';
            if (hasBorder > 0) newBorder = borderColor;
          } else {
            newBg = 'transparent';
          }
        } else {
          if (isCard) {
            newBg = cardBg;
            if (hasBorder > 0) newBorder = borderColor;
          } else {
            newBg = baseBg;
          }
        }

        toUpdate.push({
          el: el,
          prevBg: prevBg,
          prevBorder: prevBorder,
          newBg: newBg,
          newBorder: newBorder
        });
      }
    });

    // --- Phase 2: Batched Writes (Zero Layout Thrashing) ---
    toUpdate.forEach(function (item) {
      item.el.setAttribute(ADAPTIVE_SURFACE_ATTR, JSON.stringify({
        bg: item.prevBg,
        border: item.prevBorder
      }));
      item.el.style.setProperty('background-color', item.newBg, 'important');
      if (item.newBorder) {
        item.el.style.setProperty('border-color', item.newBorder, 'important');
      }
    });
  }

  /**
   * Restores original backgrounds and borders modified by Option 3 Adaptive Surface Mapping.
   */
  function restoreAdaptiveSurfaces() {
    var marked;
    try {
      marked = document.querySelectorAll('[' + ADAPTIVE_SURFACE_ATTR + ']');
    } catch (e) {
      return;
    }
    marked.forEach(function (el) {
      try {
        var data = JSON.parse(el.getAttribute(ADAPTIVE_SURFACE_ATTR) || '{}');
        if (data.bg) {
          el.style.setProperty('background-color', data.bg);
        } else {
          el.style.removeProperty('background-color');
        }
        if (data.border) {
          el.style.setProperty('border-color', data.border);
        } else {
          el.style.removeProperty('border-color');
        }
      } catch (e) {
        el.style.removeProperty('background-color');
        el.style.removeProperty('border-color');
      }
      el.removeAttribute(ADAPTIVE_SURFACE_ATTR);
    });
  }

  // --- Top-Down Cascade Anti-Artifact Pass ---

  /** @type {string} CSS selector for container elements to scan for intermediate wrappers. */
  const CORNER_ELEMENT_SELECTOR = 'div, section, article, aside, nav, header, footer, main, figure, details, form, fieldset, ul, ol, li, button, pre, code, table, tr, td, th';

  /**
   * Helper to mark an element with CORNER_FIX_ATTR and set its background color.
   * Records previous state so restoration is exact and doesn't clobber force-dark overrides.
   *
   * @param {HTMLElement} el - Element to modify.
   * @param {string} newBg - New background-color value.
   * @param {string} [priority] - CSS priority ('important' or '').
   */
  function applyCornerFixBg(el, newBg, priority) {
    if (!el || el.hasAttribute(CORNER_FIX_ATTR)) return;

    var prevInline = el.style.getPropertyValue('background-color');
    var prevPrio = el.style.getPropertyPriority('background-color');

    // Store restoration info:
    // If element was already darkened by overrideLightBackgrounds, mark '__DARK_BG__'
    // Otherwise store the inline style (with priority prefix) or '__NONE__'
    if (el.hasAttribute(DARK_BG_ATTR)) {
      el.setAttribute(CORNER_FIX_ATTR, '__DARK_BG__');
    } else if (prevInline) {
      el.setAttribute(CORNER_FIX_ATTR, (prevPrio ? '!important:' : '') + prevInline);
    } else {
      el.setAttribute(CORNER_FIX_ATTR, '__NONE__');
    }

    el.style.setProperty('background-color', newBg, priority || '');
  }

  // ============================================================================
  // [DEFAULT] Primary Anti-Artifact Strategy: Top-Down Cascade
  // Scans containers and sets intermediate layout wrapper divs to transparent,
  // preventing dark-mode corner clipping and revealing wallpapers/sidebars.
  // ============================================================================

  /**
   * [DEFAULT] Top-Down Cascade Anti-Artifact Strategy.
   * Scans container elements and identifies intermediate wrapper elements that have
   * child elements, no direct text content, and no border-radius. Sets their background
   * to transparent so only innermost content containers/cards retain solid backgrounds.
   *
   * Batches all computed style reads in Phase 1 before applying any inline style writes in Phase 2
   * to eliminate forced synchronous layout thrashing during dynamic DOM updates.
   *
   * @param {Object} theme - Active theme definition object.
   * @param {Element|Document} [rootNode] - Optional subtree root to scope query (defaults to document).
   */
  function cornerFixCascade(theme, rootNode) {
    if (!theme) return;

    var target = rootNode || document;
    var elements;
    try {
      elements = target.querySelectorAll ? target.querySelectorAll(CORNER_ELEMENT_SELECTOR) : [];
      if (target.matches && target.matches(CORNER_ELEMENT_SELECTOR)) {
        elements = [target, ...elements];
      }
    } catch (e) {
      return;
    }

    var toFix = [];

    // --- Phase 1: Batched Reads ---
    elements.forEach(function (el) {
      if (el.hasAttribute(CORNER_FIX_ATTR)) return;
      if (el === document.body || el === document.documentElement) return;

      var bg;
      try {
        bg = getComputedStyle(el).backgroundColor;
      } catch (e) {
        return;
      }
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return;

      // Keep solid background if element has direct text content
      var hasDirectText = false;
      for (var n = 0; n < el.childNodes.length; n++) {
        if (el.childNodes[n].nodeType === 3 && el.childNodes[n].textContent.trim()) {
          hasDirectText = true;
          break;
        }
      }
      if (hasDirectText) return;

      // Keep solid background if element has border-radius
      var br;
      try {
        br = getComputedStyle(el).borderRadius;
      } catch (e) {
        return;
      }
      if (br && br !== '0px' && br !== '0' && br !== '' && br !== '0px 0px 0px 0px') return;

      // Only modify wrapper elements that contain child elements
      if (!el.children || el.children.length === 0) return;

      toFix.push(el);
    });

    // --- Phase 2: Batched Writes (Zero Layout Thrashing) ---
    toFix.forEach(function (el) {
      applyCornerFixBg(el, 'transparent', 'important');
    });
  }

  /**
   * Restores original backgrounds on all elements modified by top-down cascade pass.
   *
   * @param {Object} [theme] - Active theme definition object to restore dark bg overrides.
   */
  function restoreCornerFixes(theme) {
    var marked;
    try {
      marked = document.querySelectorAll('[' + CORNER_FIX_ATTR + ']');
    } catch (e) {
      return;
    }
    marked.forEach(function (el) {
      var state = el.getAttribute(CORNER_FIX_ATTR);
      if (state === '__DARK_BG__') {
        var darkBg = (theme && (theme.type === 'combo' || theme.type === 'image')) ? 'transparent' : (theme ? theme.bg : '');
        if (darkBg) {
          el.style.setProperty('background-color', darkBg, 'important');
        } else {
          el.style.removeProperty('background-color');
        }
      } else if (state === '__NONE__') {
        el.style.removeProperty('background-color');
      } else if (state && state.startsWith('!important:')) {
        el.style.setProperty('background-color', state.slice(11), 'important');
      } else if (state) {
        el.style.setProperty('background-color', state);
      } else {
        el.style.removeProperty('background-color');
      }
      el.removeAttribute(CORNER_FIX_ATTR);
    });
  }

  /** @type {MutationObserver|null} Observer for dynamically added elements when force-dark or cascade fix is on. */
  var bodyObserver = null;
  /** @type {number|null} Active debounce timeout id for body observer. */
  var bodyObserverDebounceTimer = null;
  /** @type {number|null} Active requestIdleCallback handle for body observer. */
  var bodyObserverIdleHandle = null;

  /**
   * Starts an optimized MutationObserver on document.body to handle dynamically added subtrees.
   * Scopes style calculations strictly to mutation.addedNodes and batches DOM reads before writes,
   * completely eliminating layout thrashing and frame drops during scrolling and dynamic loading.
   *
   * @param {Object} theme - Active theme definition object.
   * @param {string} lightModeFix - Active light mode readability fix mode ('none', 'luminance', 'scoped-css', 'adaptive').
   * @param {boolean} enableCascade - Whether top-down cascade fix is enabled.
   */
  function startBodyObserver(theme, lightModeFix, enableCascade) {
    stopBodyObserver();
    if (!document.body) return;

    var pendingAddedNodes = new Set();

    function processAddedNodes() {
      bodyObserverIdleHandle = null;
      if (pendingAddedNodes.size === 0) return;

      var nodesToProcess = Array.from(pendingAddedNodes);
      pendingAddedNodes.clear();

      for (var i = 0; i < nodesToProcess.length; i++) {
        var node = nodesToProcess[i];
        if (!node.isConnected) continue;

        if (lightModeFix === 'luminance') {
          applyLuminanceFix(theme, node);
        } else if (lightModeFix === 'scoped-css') {
          // Handled declaratively by injected CSS stylesheet
        } else if (lightModeFix !== 'none') {
          applyAdaptiveSurfaceMapping(theme, node);
          recolorTextForContrast(theme, node);
        }

        if (enableCascade) {
          cornerFixCascade(theme, node);
        }
      }
    }

    bodyObserver = new MutationObserver(function (mutations) {
      var hasNewNodes = false;

      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          // Process only element subtrees, ignoring text, comments, and extension-created elements
          if (
            node.nodeType === 1 &&
            node.id !== STYLE_ID &&
            node.id !== BACKDROP_ID &&
            node.id !== SCOPED_CSS_FIX_ID
          ) {
            pendingAddedNodes.add(node);
            hasNewNodes = true;
          }
        }
      }

      if (!hasNewNodes) return;

      // Debounce and defer work to browser idle periods to prevent scroll jank
      if (bodyObserverDebounceTimer) clearTimeout(bodyObserverDebounceTimer);
      if (bodyObserverIdleHandle && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(bodyObserverIdleHandle);
        bodyObserverIdleHandle = null;
      }

      bodyObserverDebounceTimer = setTimeout(function () {
        bodyObserverDebounceTimer = null;
        if (typeof requestIdleCallback === 'function') {
          bodyObserverIdleHandle = requestIdleCallback(processAddedNodes, { timeout: 200 });
        } else {
          processAddedNodes();
        }
      }, 150);
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Stops the body MutationObserver if active and cancels pending idle/debounce callbacks.
   */
  function stopBodyObserver() {
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (bodyObserverDebounceTimer) {
      clearTimeout(bodyObserverDebounceTimer);
      bodyObserverDebounceTimer = null;
    }
    if (bodyObserverIdleHandle && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(bodyObserverIdleHandle);
      bodyObserverIdleHandle = null;
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

  // --- Hardware-Accelerated Wallpaper Backdrop Layer ---

  /**
   * Ensures the hardware-accelerated fixed wallpaper backdrop element exists
   * directly on document.documentElement, outside framework reconciliation trees.
   *
   * @param {Object} theme - Active theme definition object.
   */
  function ensureBackdropLayer(theme) {
    if (!theme || (theme.type !== "image" && theme.type !== "combo") || !theme.dataUrl) {
      removeBackdropLayer();
      return;
    }

    const root = document.documentElement;
    if (!root) return;

    let backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.setAttribute("aria-hidden", "true");
      if (root.firstChild) {
        root.insertBefore(backdrop, root.firstChild);
      } else {
        root.appendChild(backdrop);
      }
    }
  }

  /**
   * Removes the fixed wallpaper backdrop element from document.documentElement if present.
   */
  function removeBackdropLayer() {
    const backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) backdrop.remove();
  }

  /**
   * Applies or removes Tinty styling based on stored configuration settings.
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
      removeBackdropLayer();
      restoreInlineColoredCodeBlocks();
      restoreLuminanceFix();
      restoreScopedCssFix();
      restoreAdaptiveSurfaces();
      restoreForcedDarkBackgrounds();
      restoreRecoloredText();
      restoreCornerFixes(settings ? settings.theme : null);
      stopBodyObserver();
      return;
    }

    ensureBackdropLayer(settings.theme);

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCSS(settings.theme);
    (document.head || document.documentElement).appendChild(style);
    ensureHeadObserver();

    remapInlineColoredCodeBlocks(settings.theme);

    // Clean up any previously applied light-page readability fixes
    restoreLuminanceFix();
    restoreScopedCssFix();
    restoreAdaptiveSurfaces();
    restoreForcedDarkBackgrounds();
    restoreRecoloredText();

    // Primary Light Page Strategy: Adaptive Surface Mapping with contrast recoloring (Default)
    // Legacy / experimental options ('luminance', 'scoped-css') are retained for backwards compatibility or testing.
    var lightModeFix = settings.lightModeFix || "adaptive";

    if (lightModeFix === "luminance") {
      applyLuminanceFix(settings.theme);
    } else if (lightModeFix === "scoped-css") {
      applyScopedCssFix(settings.theme);
    } else if (lightModeFix !== "none") {
      // Default: Adaptive Surface Mapping with contrast-aware text recoloring
      applyAdaptiveSurfaceMapping(settings.theme);
      recolorTextForContrast(settings.theme);
    }

    // Primary Anti-Artifact Strategy: Top-Down Cascade (Default)
    const enableCascade = settings.cascadeFix !== false;
    restoreCornerFixes(settings.theme);
    if (enableCascade) {
      cornerFixCascade(settings.theme);
    }

    // Keep body observer active for dynamic DOM changes
    if (lightModeFix !== "none" || enableCascade) {
      startBodyObserver(settings.theme, lightModeFix, enableCascade);
    } else {
      stopBodyObserver();
    }
  }

  /**
   * Reads settings from `chrome.storage.local` and invokes `applySettings()`.
   */
  function loadAndApply() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(["enabled", "disabledSites", "theme", "forceDarkBg", "cascadeFix", "lightModeFix"], (settings) => {
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
