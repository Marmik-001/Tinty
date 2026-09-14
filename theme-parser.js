/**
 * @file theme-parser.js
 * @description Utility functions to parse VS Code theme JSON/JSONC files and map editor colors 
 * into page (background, text, links) and syntax token roles (keyword, string, comment, etc.).
 *
 * VS Code themes are designed for editor UIs (gutters, tabs, syntax tokens), so this module uses
 * heuristic mapping rules to adapt those colors for web pages and documentation sites.
 *
 * Known Limitation: Themes using VS Code's `include` property to inherit from a base theme are not
 * resolved here. Users should upload self-contained theme JSON files.
 */

/**
 * Character-by-character scanner that strips single-line (//) and multi-line (/* *\/) comments 
 * from JSONC text without corrupting URL strings (such as "$schema": "vscode://...").
 *
 * @param {string} text - Raw JSON string containing comments.
 * @returns {string} Clean JSON string with comments stripped out.
 */
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    // Inside a single-line comment: skip characters until newline
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    // Inside a block comment: skip characters until */
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    // Inside a string literal: handle escape sequences and string quotes
    if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    // String start detection
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    // Single-line comment start detection
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    // Multi-line comment start detection
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }
  return out;
}

/**
 * Removes illegal trailing commas before closing braces `}` or brackets `]`.
 *
 * @param {string} text - JSON string with potential trailing commas.
 * @returns {string} Sanitized JSON string.
 */
function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Safely parses JSON strings that may contain JSONC comments or trailing commas.
 * Tries standard strict `JSON.parse()` first for speed, falling back to sanitization
 * only if parsing fails.
 *
 * @param {string} text - Raw JSON string from a theme file.
 * @returns {Object} Parsed JavaScript object.
 * @throws {Error} If text cannot be parsed even after sanitization.
 */
function parseLenientJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
  }
}

/**
 * Lightens or darkens a 6-digit or 3-digit hex color by a given percentage.
 * Used to calculate dynamic fallbacks for borders and code backgrounds when missing in theme JSON.
 *
 * @param {string} hex - Hex color string (e.g. "#1e1e1e" or "#fff").
 * @param {number} percent - Positive percentage to lighten, negative to darken.
 * @returns {string} Adjusted hex color string (e.g. "#2a2a2a").
 */
function shadeColor(hex, percent) {
  try {
    let h = hex.replace("#", "");
    if (h.length === 3) {
      h = h.split("").map((c) => c + c).join("");
    }
    const num = parseInt(h.substring(0, 6), 16);
    let r = (num >> 16) + Math.round((percent / 100) * 255);
    let g = ((num >> 8) & 0x00ff) + Math.round((percent / 100) * 255);
    let b = (num & 0x0000ff) + Math.round((percent / 100) * 255);
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  } catch (e) {
    return hex;
  }
}

/**
 * Searches a VS Code theme `tokenColors` array for scope definitions matching target scope keywords.
 *
 * @param {Array<Object>} tokenColors - VS Code theme tokenColors array.
 * @param {Array<string>} wantedScopes - Scope substring rules (e.g. ["keyword", "storage.type"]).
 * @returns {string|null} Hex foreground color if found, or null if no rule matches.
 */
function findTokenColor(tokenColors, wantedScopes) {
  if (!Array.isArray(tokenColors)) return null;
  for (const rule of tokenColors) {
    if (!rule || !rule.settings || !rule.settings.foreground) continue;
    const scopeField = rule.scope;
    const scopes = Array.isArray(scopeField)
      ? scopeField
      : typeof scopeField === "string"
      ? scopeField.split(",").map((s) => s.trim())
      : [];
    if (scopes.some((s) => wantedScopes.some((w) => s.includes(w)))) {
      return rule.settings.foreground;
    }
  }
  return null;
}

/**
 * Scope mapping lookup table based on standard TextMate/VS Code grammar conventions.
 * @type {Object<string, Array<string>>}
 */
const SCOPES = {
  comment: ["comment"],
  keyword: ["keyword", "storage.type", "storage.modifier"],
  string: ["string.quoted", "string"],
  function: ["entity.name.function", "support.function"],
  number: ["constant.numeric", "constant.language"],
  class: ["entity.name.class", "entity.name.type", "support.class", "support.type"],
  tag: ["entity.name.tag"],
  variable: ["variable.other", "variable"],
};

/**
 * Converts a raw parsed VS Code theme object into a normalized ThemeReader theme structure.
 * Extracts workbench colors (`editor.background`, `editor.foreground`, `textLink.foreground`)
 * and maps syntax token scope colors.
 *
 * @param {Object} themeJson - Parsed JSON object from a VS Code theme file.
 * @returns {Object} Normalized theme object ready for ThemeReader storage and rendering.
 */
function parseVSCodeTheme(themeJson) {
  const colors = themeJson.colors || {};
  const tokenColors = themeJson.tokenColors || [];

  const bg = colors["editor.background"] || "#1e1e1e";
  const fg = colors["editor.foreground"] || "#d4d4d4";
  const link =
    colors["textLink.foreground"] || colors["textLink.activeForeground"] || "#4daafc";

  const keyword = findTokenColor(tokenColors, SCOPES.keyword) || link;
  const accent =
    findTokenColor(tokenColors, ["keyword", "storage", "entity.name"]) ||
    colors["activityBarBadge.background"] ||
    keyword;
  const comment = findTokenColor(tokenColors, SCOPES.comment) || shadeColor(fg, -35);
  const string = findTokenColor(tokenColors, SCOPES.string) || fg;
  const func = findTokenColor(tokenColors, SCOPES.function) || link;
  const number = findTokenColor(tokenColors, SCOPES.number) || accent;
  const cls = findTokenColor(tokenColors, SCOPES.class) || accent;
  const tag = findTokenColor(tokenColors, SCOPES.tag) || keyword;
  const variable = findTokenColor(tokenColors, SCOPES.variable) || fg;

  const codeBg =
    colors["textCodeBlock.background"] ||
    colors["editorWidget.background"] ||
    shadeColor(bg, -8);
  const border =
    colors["panel.border"] || colors["editorGroup.border"] || shadeColor(bg, 15);

  return {
    type: "vscode",
    name: themeJson.name || "Custom VS Code theme",
    bg,
    fg,
    link,
    accent,
    codeBg,
    border,
    comment,
    keyword,
    string,
    function: func,
    number,
    class: cls,
    tag,
    variable,
  };
}
