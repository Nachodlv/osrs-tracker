// Template registry. A template defines the starting goal tree (GOAL_DATA) and
// tier groupings (GEAR_GROUPS) a new profile is seeded from. Built-in templates
// ship with the app; user templates are imported from JSON files and stored in
// localStorage, so they can be added or removed without touching source.
//
// applyTemplate() reassigns the global GOAL_DATA / GEAR_GROUPS to the selected
// template's content before a profile's state is built or rendered. Existing
// profiles have no templateId and default to "ladlor", so they are unaffected.
//
// Template shape (also the JSON import/export format):
//   { id, name, goalData: [...], gearGroups: [[...]] }
(function (global) {
  var TEMPLATES_KEY = "iron-tracker:templates";
  var DEFAULT_TEMPLATE_ID = "ladlor";

  function deepClone(v) { return JSON.parse(JSON.stringify(v || [])); }

  // Built-in templates. Ladlor captures the data.js content as loaded (data.js
  // runs before this file); Empty starts a blank chart the user builds up.
  var BUILTIN_TEMPLATES = [
    { id: "empty", name: "Empty", builtin: true, goalData: [], gearGroups: [] },
    {
      id: DEFAULT_TEMPLATE_ID,
      name: "Ironman Ladlord Chart",
      builtin: true,
      goalData: global.GOAL_DATA || [],
      gearGroups: global.GEAR_GROUPS || []
    }
  ];

  function loadUserTemplates() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(TEMPLATES_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.error("Failed to load user templates", e);
      return [];
    }
  }

  function saveUserTemplates(list) {
    if (global.localStorage) global.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
  }

  function listTemplates() {
    return BUILTIN_TEMPLATES.concat(loadUserTemplates());
  }

  function getTemplate(id) {
    var all = listTemplates();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // Point the global data at a template's content. Falls back to the default
  // template when the id is unknown (e.g. a user template that was removed).
  function applyTemplate(id) {
    var t = getTemplate(id) || getTemplate(DEFAULT_TEMPLATE_ID);
    global.GOAL_DATA = deepClone(t ? t.goalData : []);
    global.GEAR_GROUPS = deepClone(t ? t.gearGroups : []);
    return t ? t.id : DEFAULT_TEMPLATE_ID;
  }

  // Validate and normalize a parsed JSON template. Returns the stored record or
  // throws with a user-facing message.
  function normalizeImported(obj) {
    if (!obj || typeof obj !== "object") throw new Error("not a template file");
    var name = (obj.name || "").trim();
    if (!name) throw new Error("template is missing a name");
    if (!Array.isArray(obj.goalData)) throw new Error("template is missing goalData");
    if (obj.gearGroups != null && !Array.isArray(obj.gearGroups)) throw new Error("gearGroups must be a list");
    var id = (obj.id || "").trim();
    if (!id || /^(empty|ladlor)$/.test(id)) id = "tpl-" + Date.now();
    return { id: id, name: name, goalData: obj.goalData, gearGroups: obj.gearGroups || [] };
  }

  // Add (or replace by id) a user template from a parsed JSON object.
  function addUserTemplate(obj) {
    var rec = normalizeImported(obj);
    var list = loadUserTemplates();
    var replaced = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === rec.id) { list[i] = rec; replaced = true; break; }
    }
    if (!replaced) list.push(rec);
    saveUserTemplates(list);
    return rec;
  }

  function removeUserTemplate(id) {
    var list = loadUserTemplates().filter(function (t) { return t.id !== id; });
    saveUserTemplates(list);
  }

  var api = {
    DEFAULT_TEMPLATE_ID: DEFAULT_TEMPLATE_ID,
    listTemplates: listTemplates,
    getTemplate: getTemplate,
    applyTemplate: applyTemplate,
    addUserTemplate: addUserTemplate,
    removeUserTemplate: removeUserTemplate
  };
  global.Templates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
