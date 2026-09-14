/**
 * @file popup.js
 * @description Controller script for the ThemeReader toolbar popup interface (`popup.html`).
 *
 * Responsibilities:
 * - Queries active browser tab hostname.
 * - Loads active theme settings and user-saved custom library items from `chrome.storage.local`.
 * - Populates theme selection dropdown grouped by Built-in Dark, Built-in Light, and Custom Saved items.
 * - Handles theme application, global toggle switch, site exclusion switch, and settings page navigation.
 */

const enabledToggle = document.getElementById("enabledToggle");
const disableSiteToggle = document.getElementById("disableSiteToggle");
const currentHostEl = document.getElementById("currentHost");
const themeSelect = document.getElementById("themeSelect");
const builtinDarkGroup = document.getElementById("builtinDarkGroup");
const builtinLightGroup = document.getElementById("builtinLightGroup");
const customGroup = document.getElementById("customGroup");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const forceDarkBgToggle = document.getElementById("forceDarkBgToggle");
const statusEl = document.getElementById("status");
const themeNameLabel = document.getElementById("themeNameLabel");

/** @type {string} Active tab domain hostname. */
let currentHostname = "";

/** Keys of built-in dark themes defined in builtin-themes.js */
const BUILTIN_DARK = [
  "dracula",
  "one-dark",
  "monokai",
  "solarized-dark",
  "nord",
  "gruvbox-dark",
  "night-owl",
  "tokyo-night",
  "catppuccin-mocha",
];

/** Keys of built-in light themes defined in builtin-themes.js */
const BUILTIN_LIGHT = ["solarized-light"];

/**
 * Updates status text and status color styling in the popup.
 *
 * @param {string} msg - Message to display.
 * @param {boolean} isError - True if message is an error notification, false if success.
 */
function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#f48771" : "#89d185";
}

/**
 * Retrieves the domain hostname of the currently active browser tab.
 *
 * @param {function(string): void} callback - Callback receiving domain hostname or empty string.
 */
function getActiveTabHostname(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      const url = new URL(tabs[0].url);
      callback(url.hostname);
    } catch (e) {
      callback("");
    }
  });
}

/**
 * Helper function to instantiate an `<option>` element for HTML `<select>` menus.
 *
 * @param {string} value - Option value attribute string.
 * @param {string} label - Display text label.
 * @returns {HTMLOptionElement} Formatted option element.
 */
function optionEl(value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}

/**
 * Fills `<select id="themeSelect">` with built-in themes and user-saved custom items.
 *
 * @param {Array<Object>} customThemes - Array of saved custom VS Code theme objects.
 * @param {Array<Object>} customImages - Array of saved background image objects.
 * @param {Array<Object>} customCombos - Array of saved combo theme objects.
 * @param {string} selectedValue - Value string of the currently active item (e.g. "builtin:dracula").
 */
function populateSelect(customThemes, customImages, customCombos, selectedValue) {
  builtinDarkGroup.innerHTML = "";
  builtinLightGroup.innerHTML = "";
  customGroup.innerHTML = "";

  BUILTIN_DARK.forEach((key) =>
    builtinDarkGroup.appendChild(optionEl("builtin:" + key, BUILTIN_THEMES[key].name))
  );
  BUILTIN_LIGHT.forEach((key) =>
    builtinLightGroup.appendChild(optionEl("builtin:" + key, BUILTIN_THEMES[key].name))
  );

  customThemes.forEach((t) => customGroup.appendChild(optionEl("theme:" + t.id, t.name)));
  customImages.forEach((i) => customGroup.appendChild(optionEl("image:" + i.id, i.name)));
  customCombos.forEach((c) =>
    customGroup.appendChild(optionEl("combo:" + c.id, c.name + " (combo)"))
  );
  customGroup.hidden =
    customThemes.length === 0 && customImages.length === 0 && customCombos.length === 0;

  if (selectedValue) themeSelect.value = selectedValue;
}

/**
 * Saves selected theme object and current site exclusion state to `chrome.storage.local`.
 *
 * @param {Object} theme - Theme object to set as active.
 * @param {string} [statusMsg] - Optional custom status message.
 */
function saveTheme(theme, statusMsg) {
  chrome.storage.local.get(["disabledSites"], (settings) => {
    let disabledSites = settings.disabledSites || [];
    if (disableSiteToggle.checked) {
      if (!disabledSites.includes(currentHostname)) {
        disabledSites.push(currentHostname);
      }
    } else {
      disabledSites = disabledSites.filter((h) => h !== currentHostname);
    }

    chrome.storage.local.set(
      { enabled: enabledToggle.checked, disabledSites, theme },
      () => {
        setStatus(statusMsg || "Applied — no reload needed.", false);
        themeNameLabel.textContent = "Current theme: " + (theme.name || theme.type);
      }
    );
  });
}

/**
 * Updates only the `disabledSites` array in `chrome.storage.local` when the site toggle changes.
 */
function saveDisabledSitesOnly() {
  chrome.storage.local.get(["disabledSites"], (settings) => {
    let disabledSites = settings.disabledSites || [];
    if (disableSiteToggle.checked) {
      if (!disabledSites.includes(currentHostname)) {
        disabledSites.push(currentHostname);
      }
    } else {
      disabledSites = disabledSites.filter((h) => h !== currentHostname);
    }
    chrome.storage.local.set({ disabledSites });
  });
}

/**
 * Loads configuration settings and custom items from `chrome.storage.local` to initialize UI controls.
 */
function loadSettings() {
  chrome.storage.local.get(
    ["enabled", "disabledSites", "theme", "customThemes", "customImages", "customCombos", "forceDarkBg"],
    (settings) => {
      enabledToggle.checked = settings.enabled !== false; // default on
      forceDarkBgToggle.checked = settings.forceDarkBg === true; // default off
      const disabledSites = settings.disabledSites || [];
      disableSiteToggle.checked = disabledSites.includes(currentHostname);

      const customThemes = settings.customThemes || [];
      const customImages = settings.customImages || [];
      const customCombos = settings.customCombos || [];
      const theme = settings.theme;

      let selectedValue = "builtin:dracula";
      if (theme) {
        themeNameLabel.textContent = "Current theme: " + (theme.name || theme.type);
        if (theme.type === "builtin") {
          const key = Object.keys(BUILTIN_THEMES).find(
            (k) => BUILTIN_THEMES[k].name === theme.name
          );
          if (key) selectedValue = "builtin:" + key;
        } else if (theme.type === "image") {
          const match = customImages.find((i) => i.id === theme.id);
          if (match) selectedValue = "image:" + match.id;
        } else if (theme.type === "vscode") {
          const match = customThemes.find((t) => t.id === theme.id);
          if (match) selectedValue = "theme:" + match.id;
        } else if (theme.type === "combo") {
          const match = customCombos.find((c) => c.id === theme.id);
          if (match) selectedValue = "combo:" + match.id;
        }
      } else {
        themeNameLabel.textContent = "No theme applied yet";
      }

      populateSelect(customThemes, customImages, customCombos, selectedValue);
    }
  );
}

// --- Event Listeners ---

/** Listener for theme dropdown selection changes. */
themeSelect.addEventListener("change", () => {
  const [kind, id] = themeSelect.value.split(":");
  if (kind === "builtin") {
    saveTheme(BUILTIN_THEMES[id]);
    return;
  }
  const key = kind === "theme" ? "customThemes" : kind === "image" ? "customImages" : "customCombos";
  chrome.storage.local.get([key], (s) => {
    const match = (s[key] || []).find((x) => x.id === id);
    if (match) saveTheme(match, `Applied "${match.name}".`);
  });
});

/** Listener for "Add / manage your own themes & images" button. Opens options page in a full tab. */
openSettingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

/** Listener for global extension enable/disable toggle. */
enabledToggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledToggle.checked });
});

/** Listener for current domain exclusion toggle. */
disableSiteToggle.addEventListener("change", saveDisabledSitesOnly);

/** Listener for "Force Dark Backgrounds" toggle. Saves preference to storage. */
forceDarkBgToggle.addEventListener("change", () => {
  chrome.storage.local.set({ forceDarkBg: forceDarkBgToggle.checked });
});

// Initialize popup logic on DOM load
getActiveTabHostname((hostname) => {
  currentHostname = hostname;
  currentHostEl.textContent = hostname || "this page";
  loadSettings();
});
