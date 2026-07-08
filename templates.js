// Template registry. A template defines the starting goal tree (GOAL_DATA) and
// tier groupings (GEAR_GROUPS) a new profile is seeded from. Built-in templates
// ship with the app; user templates are imported from JSON files and stored in
// localStorage, so they can be added or removed without touching source.
//
// applyTemplate() reassigns the global GOAL_DATA / GEAR_GROUPS to the selected
// template's content before a profile's state is built or rendered.
//
// The "ladlor" template contains only the goals shown on ladlorchart.com (the
// tier-group gear), nothing else. data.js still holds the full historical tree
// (herb runs, quest/diary sub-trees, etc.); that full set is the "__full__"
// internal template that pre-existing profiles are pinned to (see
// ensureProfileTemplates in app.js) so their saved progress renders exactly as
// before. "__full__" is never offered in the picker.
//
// Template JSON (import/export) is { name, goalData, gearGroups }. The `id` is
// internal only and is never exported nor read on import (a fresh id is minted
// each time), so importing can never silently overwrite an existing template.
(function (global) {
  var TEMPLATES_KEY = "iron-tracker:templates";
  var DEFAULT_TEMPLATE_ID = "ladlor";
  var FULL_TEMPLATE_ID = "__full__";

  function deepClone(v) { return JSON.parse(JSON.stringify(v || [])); }

  var FULL_GOAL_DATA = global.GOAL_DATA || [];
  var FULL_GEAR_GROUPS = global.GEAR_GROUPS || [];

  // The ladlorchart.com page is exactly the tier-group gear: keep only top-level
  // goals that belong to a gear group, dropping every ungrouped goal and every
  // sub-goal (the page shows these gear items as standalone cards).
  function ladlorPageGoals(goalData, gearGroups) {
    var grouped = {};
    (gearGroups || []).forEach(function (g) { g.forEach(function (id) { grouped[id] = true; }); });
    return (goalData || [])
      .filter(function (n) { return grouped[n.id]; })
      .map(function (n) { return Object.assign({}, n, { children: [] }); });
  }

  // Built-in templates offered in the New profile picker. Each carries a
  // `version`: bump it here whenever a template's goalData/gearGroups change, so
  // profiles pinned to an older version see the "template updated" banner and can
  // review + apply the changes (see templateUpdateInfo in app.js).
  var BUILTIN_TEMPLATES = [
    { id: "empty", name: "Empty", builtin: true, version: 1, goalData: [], gearGroups: [] },
    {
      id: DEFAULT_TEMPLATE_ID,
      name: "Ironman Ladlord Chart",
      builtin: true,
      version: 2,
      goalData: ladlorPageGoals(FULL_GOAL_DATA, FULL_GEAR_GROUPS),
      gearGroups: FULL_GEAR_GROUPS
    }
  ];

  // The full historical tree, for pre-existing profiles. Not user-facing and
  // never versioned (internal templates never raise the update banner).
  var FULL_TEMPLATE = {
    id: FULL_TEMPLATE_ID, name: "Full (legacy)", builtin: true, internal: true, version: 1,
    goalData: FULL_GOAL_DATA, gearGroups: FULL_GEAR_GROUPS
  };

  function loadUserTemplates() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(TEMPLATES_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // Backfill a version on templates saved before versioning existed.
      arr.forEach(function (t) { if (t && t.version == null) t.version = 1; });
      return arr;
    } catch (e) {
      console.error("Failed to load user templates", e);
      return [];
    }
  }

  function saveUserTemplates(list) {
    if (global.localStorage) global.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
  }

  // Templates shown in the New profile picker and Manage templates modal.
  function listTemplates() {
    return BUILTIN_TEMPLATES.concat(loadUserTemplates());
  }

  // Resolve any template id, including the internal "__full__".
  function getTemplate(id) {
    if (id === FULL_TEMPLATE_ID) return FULL_TEMPLATE;
    var all = listTemplates();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // Point the global data at a template's content. Falls back to the default
  // template when the id is unknown (e.g. a user template that was removed).
  function applyTemplate(id) {
    var t = getTemplate(id) || getTemplate(DEFAULT_TEMPLATE_ID);
    return applyContent(t ? t.goalData : [], t ? t.gearGroups : [], t ? t.id : DEFAULT_TEMPLATE_ID);
  }

  // Point the global data at explicit content. Used to render a profile from its
  // pinned template snapshot (see applyProfileTemplate in app.js) rather than the
  // live template, so a template update does not change a profile until accepted.
  function applyContent(goalData, gearGroups, id) {
    global.GOAL_DATA = deepClone(goalData || []);
    global.GEAR_GROUPS = deepClone(gearGroups || []);
    api.currentTemplateId = id || DEFAULT_TEMPLATE_ID;
    return api.currentTemplateId;
  }

  // Validate a parsed JSON template. The incoming `id` is ignored on purpose so
  // an import always creates a new template rather than overwriting one.
  function normalizeImported(obj) {
    if (!obj || typeof obj !== "object") throw new Error("not a template file");
    var name = (obj.name || "").trim();
    if (!name) throw new Error("template is missing a name");
    if (!Array.isArray(obj.goalData)) throw new Error("template is missing goalData");
    if (obj.gearGroups != null && !Array.isArray(obj.gearGroups)) throw new Error("gearGroups must be a list");
    return {
      id: "tpl-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      name: name, version: 1, goalData: obj.goalData, gearGroups: obj.gearGroups || []
    };
  }

  function addUserTemplate(obj) {
    var rec = normalizeImported(obj);
    var list = loadUserTemplates();
    list.push(rec);
    saveUserTemplates(list);
    return rec;
  }

  // Replace an existing user template's content in place and bump its version, so
  // profiles created from it can be prompted to adopt the new content. Keeps the
  // template id (and thus the pin from existing profiles) intact.
  function updateUserTemplate(id, obj) {
    var incoming = normalizeImported(obj);
    var list = loadUserTemplates();
    var found = null;
    list.forEach(function (t) {
      if (t.id !== id) return;
      found = t;
      t.name = incoming.name;
      t.goalData = incoming.goalData;
      t.gearGroups = incoming.gearGroups;
      t.version = (t.version || 1) + 1;
    });
    if (!found) throw new Error("template not found");
    saveUserTemplates(list);
    return found;
  }

  function removeUserTemplate(id) {
    var list = loadUserTemplates().filter(function (t) { return t.id !== id; });
    saveUserTemplates(list);
  }

  var api = {
    DEFAULT_TEMPLATE_ID: DEFAULT_TEMPLATE_ID,
    FULL_TEMPLATE_ID: FULL_TEMPLATE_ID,
    currentTemplateId: DEFAULT_TEMPLATE_ID,
    listTemplates: listTemplates,
    getTemplate: getTemplate,
    applyTemplate: applyTemplate,
    applyContent: applyContent,
    addUserTemplate: addUserTemplate,
    updateUserTemplate: updateUserTemplate,
    removeUserTemplate: removeUserTemplate
  };
  global.Templates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
