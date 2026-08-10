// Color themes. Each theme is a block of CSS variables in style.css keyed by
// data-theme on <html>; this file only picks which one is active. The choice is
// global (not per-profile) and lives in its own localStorage key.

const THEME_KEY = "iron-tracker:theme";
const DEFAULT_THEME = "default";

const THEMES = [
  { id: "default", name: "Classic Gold" },
  { id: "parchment", name: "Parchment" },
  { id: "wilderness", name: "Wilderness" },
  { id: "zanaris", name: "Zanaris" },
  { id: "tidal", name: "Tidal" }
];

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEMES.some(t => t.id === saved)) return saved;
  } catch (e) {
    console.error("Failed to load theme", e);
  }
  return DEFAULT_THEME;
}

function applyTheme(id, save) {
  const theme = THEMES.some(t => t.id === id) ? id : DEFAULT_THEME;
  // The default theme is the bare :root block, so it carries no attribute.
  if (theme === DEFAULT_THEME) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  if (save) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      console.error("Failed to save theme", e);
    }
  }
  return theme;
}

// Runs from <head>, before the body paints, so a saved theme never flashes the
// default colors first.
applyTheme(loadTheme(), false);

function initThemeUI() {
  const select = document.getElementById("themeSelect");
  if (!select) return;
  select.innerHTML = "";
  for (const t of THEMES) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  }
  select.value = loadTheme();
  select.addEventListener("change", () => applyTheme(select.value, true));
}
