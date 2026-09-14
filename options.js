/**
 * @file options.js
 * @description Controller script for the full Settings tab page (`options.html`).
 *
 * Responsibilities:
 * - Uploads and parses user VS Code theme JSON/JSONC files.
 * - Uploads and validates background image files (data URLs).
 * - Creates background image + VS Code theme combo presets.
 * - Manages saved themes library (renders list, applies active theme, handles deletions).
 * - Implements storage safety checks against quota limits via `safeSet()`.
 */

const themeName = document.getElementById("themeName");
const themeFile = document.getElementById("themeFile");
const themeStatus = document.getElementById("themeStatus");
const saveThemeBtn = document.getElementById("saveThemeBtn");

const imageName = document.getElementById("imageName");
const imageFile = document.getElementById("imageFile");
const imageStatus = document.getElementById("imageStatus");
const saveImageBtn = document.getElementById("saveImageBtn");

const comboName = document.getElementById("comboName");
const comboFile = document.getElementById("comboFile");
const comboThemeSelect = document.getElementById("comboThemeSelect");
const comboStatus = document.getElementById("comboStatus");
const saveComboBtn = document.getElementById("saveComboBtn");

const savedList = document.getElementById("savedList");
const emptyHint = document.getElementById("emptyHint");

/**
 * Wrapper around `chrome.storage.local.set` that explicitly inspects `chrome.runtime.lastError`.
 * Prevents false "Saved!" UI claims if storage writes fail due to quota limits or I/O errors.
 *
 * @param {Object} items - Storage payload object.
 * @param {function(): void} [onSuccess] - Success callback handler.
 * @param {function(Error): void} [onError] - Error callback handler.
 */
function safeSet(items, onSuccess, onError) {
  chrome.storage.local.set(items, () => {
    if (chrome.runtime.lastError) {
      if (onError) onError(chrome.runtime.lastError);
      return;
    }
    if (onSuccess) onSuccess();
  });
}

/** Built-in theme display order keys. */
const BUILTIN_ORDER = [
  "dracula",
  "one-dark",
  "monokai",
  "solarized-dark",
  "solarized-light",
  "nord",
  "gruvbox-dark",
  "night-owl",
  "tokyo-night",
  "catppuccin-mocha",
];

/**
 * Populates the theme select menu in the Background + Theme Combo creator card.
 */
function populateComboThemeSelect() {
  chrome.storage.local.get(["customThemes"], (s) => {
    const customThemes = s.customThemes || [];
    comboThemeSelect.innerHTML = "";

    const builtinGroup = document.createElement("optgroup");
    builtinGroup.label = "Built-in";
    BUILTIN_ORDER.forEach((key) => {
      const opt = document.createElement("option");
      opt.value = "builtin:" + key;
      opt.textContent = BUILTIN_THEMES[key].name;
      builtinGroup.appendChild(opt);
    });
    comboThemeSelect.appendChild(builtinGroup);

    if (customThemes.length > 0) {
      const customGroup = document.createElement("optgroup");
      customGroup.label = "Your saved themes";
      customThemes.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = "theme:" + t.id;
        opt.textContent = t.name;
        customGroup.appendChild(opt);
      });
      comboThemeSelect.appendChild(customGroup);
    }
  });
}

/**
 * Updates status message text and applies status CSS modifier class ("ok" or "error").
 *
 * @param {HTMLElement} el - Status element.
 * @param {string} msg - Message text.
 * @param {string} [kind] - Status class modifier ("ok" or "error").
 */
function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

/**
 * Generates a unique alphanumeric ID string for saved custom items.
 *
 * @returns {string} Unique ID string (e.g., "ck2x9m8a1b").
 */
function uid() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Reads saved custom themes, images, and combos from `chrome.storage.local`
 * and renders the interactive library list with color swatches, Apply buttons, and Delete buttons.
 */
function renderSavedList() {
  chrome.storage.local.get(["customThemes", "customImages", "customCombos"], (settings) => {
    const themes = settings.customThemes || [];
    const images = settings.customImages || [];
    const combos = settings.customCombos || [];
    const all = [
      ...themes.map((t) => ({ ...t, kind: "theme" })),
      ...images.map((i) => ({ ...i, kind: "image" })),
      ...combos.map((c) => ({ ...c, kind: "combo" })),
    ];

    savedList.innerHTML = "";
    emptyHint.style.display = all.length === 0 ? "block" : "none";

    all.forEach((item) => {
      const li = document.createElement("li");

      const info = document.createElement("div");
      info.className = "saved-item__info";

      const swatch = document.createElement("div");
      swatch.className = "saved-item__swatch";
      swatch.style.background =
        item.kind === "image" ? "#888" : item.accent || item.bg || "#888";
      info.appendChild(swatch);

      const nameSpan = document.createElement("span");
      nameSpan.className = "saved-item__name";
      nameSpan.textContent = item.name;
      info.appendChild(nameSpan);

      const typeSpan = document.createElement("span");
      typeSpan.className = "saved-item__type";
      typeSpan.textContent = item.kind;
      info.appendChild(typeSpan);

      const actions = document.createElement("div");
      actions.className = "saved-item__actions";

      const applyBtn = document.createElement("button");
      applyBtn.className = "secondary";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", () => {
        chrome.storage.local.set({ theme: item }, () => {
          const statusEl =
            item.kind === "theme" ? themeStatus : item.kind === "image" ? imageStatus : comboStatus;
          setStatus(statusEl, `Applied "${item.name}" everywhere.`, "ok");
        });
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        const key =
          item.kind === "theme" ? "customThemes" : item.kind === "image" ? "customImages" : "customCombos";
        chrome.storage.local.get([key], (s) => {
          const updated = (s[key] || []).filter((x) => x.id !== item.id);
          chrome.storage.local.set({ [key]: updated }, renderSavedList);
        });
      });

      actions.appendChild(applyBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(info);
      li.appendChild(actions);
      savedList.appendChild(li);
    });
  });
}

// --- Form Handlers ---

/** Listener for "Save theme" button. Handles VS Code theme JSON file upload. */
saveThemeBtn.addEventListener("click", () => {
  const name = themeName.value.trim();
  const file = themeFile.files[0];
  if (!name) {
    setStatus(themeStatus, "Give it a name first.", "error");
    return;
  }
  if (!file) {
    setStatus(themeStatus, "Choose a .json theme file.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = parseVSCodeTheme(parseLenientJson(reader.result));
    } catch (e) {
      setStatus(themeStatus, "Couldn't parse that file as JSON. Is it a VS Code theme?", "error");
      return;
    }
    const entry = { ...parsed, id: uid(), name };
    chrome.storage.local.get(["customThemes"], (s) => {
      const list = s.customThemes || [];
      list.push(entry);
      safeSet(
        { customThemes: list },
        () => {
          setStatus(themeStatus, `Saved "${name}". It's now in the popup dropdown.`, "ok");
          themeName.value = "";
          themeFile.value = "";
          renderSavedList();
          populateComboThemeSelect();
        },
        () => setStatus(themeStatus, "Couldn't save — storage is full or unavailable.", "error")
      );
    });
  };
  reader.readAsText(file);
});

/** Listener for "Save image" button. Handles background image file upload (< 3MB). */
saveImageBtn.addEventListener("click", () => {
  const name = imageName.value.trim();
  const file = imageFile.files[0];
  if (!name) {
    setStatus(imageStatus, "Give it a name first.", "error");
    return;
  }
  if (!file) {
    setStatus(imageStatus, "Choose an image file.", "error");
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    setStatus(imageStatus, "That image is over 3MB — pick something smaller.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const entry = {
      type: "image",
      id: uid(),
      name,
      dataUrl: reader.result,
      fg: "#f0f0f0",
      link: "#8ab4f8",
    };
    chrome.storage.local.get(["customImages"], (s) => {
      const list = s.customImages || [];
      list.push(entry);
      safeSet(
        { customImages: list },
        () => {
          setStatus(imageStatus, `Saved "${name}". It's now in the popup dropdown.`, "ok");
          imageName.value = "";
          imageFile.value = "";
          renderSavedList();
        },
        () => setStatus(imageStatus, "Couldn't save — storage is full or unavailable.", "error")
      );
    });
  };
  reader.readAsDataURL(file);
});

/** Listener for "Save combo" button. Handles combining a background image with a VS Code theme. */
saveComboBtn.addEventListener("click", () => {
  const name = comboName.value.trim();
  const file = comboFile.files[0];
  const selected = comboThemeSelect.value;

  if (!name) {
    setStatus(comboStatus, "Give it a name first.", "error");
    return;
  }
  if (!file) {
    setStatus(comboStatus, "Choose a background image.", "error");
    return;
  }
  if (!selected) {
    setStatus(comboStatus, "Pick a theme for the colors.", "error");
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    setStatus(comboStatus, "That image is over 3MB — pick something smaller.", "error");
    return;
  }

  const [kind, id] = selected.split(":");

  /** Helper to assemble combo theme payload and write to storage. */
  function withThemeColors(themeColors) {
    const comboReader = new FileReader();
    comboReader.onload = () => {
      const entry = {
        ...themeColors,
        type: "combo",
        id: uid(),
        name,
        dataUrl: comboReader.result,
      };
      chrome.storage.local.get(["customCombos"], (s) => {
        const list = s.customCombos || [];
        list.push(entry);
        safeSet(
          { customCombos: list },
          () => {
            setStatus(comboStatus, `Saved "${name}". It's now in the popup dropdown.`, "ok");
            comboName.value = "";
            comboFile.value = "";
            renderSavedList();
          },
          () => setStatus(comboStatus, "Couldn't save — storage is full or unavailable.", "error")
        );
      });
    };
    comboReader.readAsDataURL(file);
  }

  if (kind === "builtin") {
    withThemeColors(BUILTIN_THEMES[id]);
  } else {
    chrome.storage.local.get(["customThemes"], (s) => {
      const match = (s.customThemes || []).find((t) => t.id === id);
      if (!match) {
        setStatus(comboStatus, "That saved theme couldn't be found — pick another.", "error");
        return;
      }
      withThemeColors(match);
    });
  }
});

// Initialization
renderSavedList();
populateComboThemeSelect();
