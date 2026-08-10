// Pure data-migration logic (no DOM/localStorage), loadable both as a <script>
// and via require(). Add an entry to ID_MIGRATIONS whenever a built-in goal id
// is renamed/restructured so saved progress follows it.

const ID_MIGRATIONS = {
  "gear-progression.tier0.amulet-of-strength": "gear.amulet-of-strength",
  "gear-progression.tier0.climbing-boots": "gear.climbing-boots",
  "gear-progression.tier0.rune-pouch": "gear.rune-pouch",
  "gear-progression.tier1.iban-s-staff-u": "gear.iban-s-staff-u",
  "gear-progression.tier1.protect-from-melee": "gear.protect-from-melee",
  "gear-progression.tier1.ancient-staff": "gear.ancient-staff",
  "gear-progression.tier1.eagle-eye": "gear.eagle-eye",
  "gear-progression.tier2.fighter-torso": "gear.fighter-torso",
  "gear-progression.tier2.granite-body": "gear.granite-body",
  "gear-progression.tier3.dragon-scimitar": "gear.dragon-scimitar",
  "gear-progression.tier3.dragon-dagger": "gear.dragon-dagger",
  "gear-progression.tier3.berserker-ring-i": "gear.berserker-ring-i",
  "gear-progression.tier4.helm-of-neitiznot": "gear.helm-of-neitiznot",
  "gear-progression.tier4.barrows-gloves": "gear.barrows-gloves",
  "gear-progression.tier4.gem-bag": "gear.gem-bag",
  "gear-progression.tier4.herb-sack": "gear.herb-sack",
  "gear-progression.tier5.dragon-defender": "gear.dragon-defender",
  "gear-progression.tier5.book-of-the-dead": "gear.book-of-the-dead",
  "gear-progression.tier5.salve-amulet-ei": "gear.salve-amulet-ei",
  "gear-progression.tier5.piety": "gear.piety",
  "gear-progression.mixed-hide-cape": "gear.mixed-hide-cape",
  "gear-progression.ava-s-accumulator": "gear.ava-s-accumulator",
  "gear-progression.tier10.infinity-boots": "gear.infinity-boots",
  "gear-progression.tier10.mage-s-book": "gear.mage-s-book",
  "gear-progression.tier11.dark-altar-construction": "gear.dark-altar-construction",
  "gear-progression.tier11.rejuvenation-pool": "gear.rejuvenation-pool",
  "gear-progression.tier11.basic-jewellery-box": "gear.basic-jewellery-box",
  "gear-progression.arkan-blade": "gear.arkan-blade",
  "gear-progression.tier13.black-mask-i": "gear.black-mask-i",
  "gear-progression.tier13.bonecrusher": "gear.bonecrusher",
  "gear-progression.pharaoh-s-sceptre": "gear.pharaoh-s-sceptre",
  "gear-progression.tier15.arclight": "gear.arclight",
  "gear-progression.tier15.broader-fletching": "gear.broader-fletching",
  "gear-progression.tier15.slayer-helmet-i": "gear.slayer-helmet-i",
  "gear-progression.tier15.ice-barrage": "gear.ice-barrage",
  "gear-progression.tier15.bigger-and-badder": "gear.bigger-and-badder",
  "gear-progression.tier15.ash-sanctifier": "gear.ash-sanctifier",
  "gear-progression.tier16.69-slayer": "gear.69-slayer",
  "gear-progression.tier16.86-strength": "gear.86-strength",
  "gear-progression.karamja-gloves-3": "gear.karamja-gloves-3",
  "gear-progression.amulet-of-glory": "gear.amulet-of-glory",
  "gear-progression.ghommal-s-hilt-2": "gear.ghommal-s-hilt-2",
  "gear-progression.tier20.void-knight-top": "gear.void-knight-top",
  "gear-progression.tier20.void-knight-robe": "gear.void-knight-robe",
  "gear-progression.tier20.void-ranger-helm": "gear.void-ranger-helm",
  "gear-progression.tier20.void-knight-gloves": "gear.void-knight-gloves",
  "gear-progression.tier21.red-chinchompa": "gear.red-chinchompa",
  "gear-progression.tier21.70-ranged": "gear.70-ranged",
  "gear-progression.tier22.elite-void-top": "gear.elite-void-top",
  "gear-progression.tier22.elite-void-robe": "gear.elite-void-robe",
  "gear-progression.tier22.crystal-halberd": "gear.crystal-halberd",
  "gear-progression.92-ranged": "gear.92-ranged",
  "gear-progression.tier24.crystal-body": "gear.crystal-body",
  "gear-progression.tier24.crystal-legs": "gear.crystal-legs",
  "gear-progression.tier24.crystal-helm": "gear.crystal-helm",
  "gear-progression.tier24.bow-of-faerdhinen-c": "gear.bow-of-faerdhinen-c",
  "gear-progression.tier25.bloodbark-body": "gear.bloodbark-body",
  "gear-progression.tier25.bloodbark-legs": "gear.bloodbark-legs",
  "gear-progression.tier25.bloodbark-helm": "gear.bloodbark-helm",
  "gear-progression.tier25.ava-s-assembler": "gear.ava-s-assembler",
  "gear-progression.spellbook-swap": "gear.spellbook-swap",
  "gear-progression.tier27.fire-cape": "gear.fire-cape",
  "gear-progression.tier27.ancient-icon": "gear.ancient-icon",
  "gear-progression.tier27.dragon-pickaxe": "gear.dragon-pickaxe",
  "gear-progression.tier27.wrath-rune": "gear.wrath-rune",
  "gear-progression.tier28.occult-altar": "gear.occult-altar",
  "gear-progression.tier28.ornate-jewellery-box": "gear.ornate-jewellery-box",
  "gear-progression.tier28.fairy-ring-construction": "gear.fairy-ring-construction",
  "gear-progression.tier28.ornate-rejuvenation-pool": "gear.ornate-rejuvenation-pool",
  "gear-progression.tier29.karamja-gloves-4": "gear.karamja-gloves-4",
  "gear-progression.tier29.explorer-s-ring-4": "gear.explorer-s-ring-4",
  "gear-progression.tier30.warped-sceptre": "gear.warped-sceptre",
  "gear-progression.tier30.reptile-got-ripped": "gear.reptile-got-ripped",
  "gear-progression.tier31.prescription-goggles": "gear.prescription-goggles",
  "gear-progression.tier31.alchemist-s-amulet": "gear.alchemist-s-amulet",
  "gear-progression.tier32.amulet-of-torture": "gear.amulet-of-torture",
  "gear-progression.tier32.necklace-of-anguish": "gear.necklace-of-anguish",
  "gear-progression.tier32.zamorakian-hasta": "gear.zamorakian-hasta",
  "gear-progression.tier32.bandos-godsword": "gear.bandos-godsword",
  "gear-progression.voidwaker": "gear.voidwaker",
  "gear-progression.tier34.deadeye": "gear.deadeye",
  "gear-progression.tier34.mystic-vigour": "gear.mystic-vigour",
  "gear-progression.tier35.thread-of-elidinis": "gear.thread-of-elidinis",
  "gear-progression.tier35.lightbearer": "gear.lightbearer",
  "gear-progression.ghommal-s-hilt-4": "gear.ghommal-s-hilt-4",
  "gear-progression.tier37.abyssal-whip": "gear.abyssal-whip",
  "gear-progression.tier37.abyssal-tentacle": "gear.abyssal-tentacle",
  "gear-progression.tier37.dragon-warhammer": "gear.dragon-warhammer",
  "gear-progression.tier37.emberlight": "gear.emberlight",
  "gear-progression.tier37.dragon-boots": "gear.dragon-boots",
  "gear-progression.tier37.scorching-bow": "gear.scorching-bow",
  "gear-progression.tier37.tormented-bracelet": "gear.tormented-bracelet",
  "gear-progression.tier37.burning-claws": "gear.burning-claws",
  "gear-progression.tier37.ring-of-suffering-i": "gear.ring-of-suffering-i",
  "gear-progression.tier38.avernic-treads": "gear.avernic-treads",
  "gear-progression.tier38.rite-of-vile-transference": "gear.rite-of-vile-transference",
  "gear-progression.tier39.desert-amulet-4": "gear.desert-amulet-4",
  "gear-progression.tier39.rada-s-blessing-4": "gear.rada-s-blessing-4",
  "gear-progression.tier40.primordial-boots": "gear.primordial-boots",
  "gear-progression.tier40.amulet-of-rancour": "gear.amulet-of-rancour",
  "gear-progression.tier40.eternal-boots": "gear.eternal-boots",
  "gear-progression.tier40.occult-necklace": "gear.occult-necklace",
  "gear-progression.tier41.eye-of-ayak": "gear.eye-of-ayak",
  "gear-progression.tier41.confliction-gauntlets": "gear.confliction-gauntlets",
  "gear-progression.toxic-blowpipe": "gear.toxic-blowpipe",
  "gear-progression.osmumten-s-fang": "gear.osmumten-s-fang",
  "gear-progression.ferocious-gloves": "gear.ferocious-gloves",
  "gear-progression.tier45.rigour": "gear.rigour",
  "gear-progression.tier45.augury": "gear.augury",
  "gear-progression.infernal-cape": "gear.infernal-cape",
  "gear-progression.tier47.oathplate-chest": "gear.oathplate-chest",
  "gear-progression.tier47.oathplate-legs": "gear.oathplate-legs",
  "gear-progression.tier47.oathplate-helm": "gear.oathplate-helm",
  "gear-progression.ultor-ring": "gear.ultor-ring",
  "gear-progression.dizana-s-quiver": "gear.dizana-s-quiver",
  "gear-progression.tier50.avernic-defender": "gear.avernic-defender",
  "gear-progression.tier50.scythe-of-vitur": "gear.scythe-of-vitur",
  "gear-progression.tier51.tumeken-s-shadow": "gear.tumeken-s-shadow",
  "gear-progression.tier51.magus-ring": "gear.magus-ring",
  "gear-progression.tier52.twisted-bow": "gear.twisted-bow",
  "gear-progression.tier52.dragon-claws": "gear.dragon-claws",
  "gear-progression.tier52.ancestral-robe-top": "gear.ancestral-robe-top",
  "gear-progression.tier52.ancestral-robe-bottom": "gear.ancestral-robe-bottom",
  "gear-progression.tier52.ancestral-hat": "gear.ancestral-hat",
  "gear-progression.tier52.elder-maul": "gear.elder-maul",
  "gear-progression.tier53.masori-body-f": "gear.masori-body-f",
  "gear-progression.tier53.masori-chaps-f": "gear.masori-chaps-f",
  "gear-progression.tier53.masori-mask-f": "gear.masori-mask-f",
  "gear-progression.tier53.elidinis-ward": "gear.elidinis-ward",
  "gear-progression.saturated-heart": "gear.saturated-heart",
  "gear-progression.tier55.zaryte-crossbow": "gear.zaryte-crossbow",
  "gear-progression.tier55.zaryte-vambraces": "gear.zaryte-vambraces",
  // Ladlord chart re-keyed these two goals to slugs matching its live nodes; the
  // sub-goal ids follow their parent's new prefix.
  "spirit-tree": "spirit-tree-construction",
  "spirit-tree.75construction": "spirit-tree-construction.75construction",
  "spirit-tree.83farming": "spirit-tree-construction.83farming",
  "hallowed-shard": "hallowed-crystal-shard",
  "hallowed-shard.sepulchre": "hallowed-crystal-shard.sepulchre",
  "hallowed-shard.sepulchre.sins": "hallowed-crystal-shard.sepulchre.sins",
  "hallowed-shard.sepulchre.sins.50slayer": "hallowed-crystal-shard.sepulchre.sins.50slayer",
  "hallowed-shard.sepulchre.sins.taste-of-hope": "hallowed-crystal-shard.sepulchre.sins.taste-of-hope"
};

function remapId(id) {
  return ID_MIGRATIONS[id] || id;
}

function remapKeyedObject(obj) {
  if (!obj) return obj;
  const out = {};
  Object.keys(obj).forEach(id => { out[remapId(id)] = obj[id]; });
  return out;
}

// Rewrites every id-shaped reference in a saved state blob. Idempotent, so it's
// safe to run on every load.
function migrateStateData(parsed) {
  if (!parsed) return parsed;
  if (parsed.done) parsed.done = remapKeyedObject(parsed.done);
  if (parsed.inProgress) parsed.inProgress = remapKeyedObject(parsed.inProgress);
  if (parsed.order) parsed.order = remapKeyedObject(parsed.order);
  if (parsed.collapsed) parsed.collapsed = remapKeyedObject(parsed.collapsed);
  if (parsed.removed) parsed.removed = remapKeyedObject(parsed.removed);
  if (parsed.rootGoals) parsed.rootGoals = remapKeyedObject(parsed.rootGoals);
  if (parsed.overrides) parsed.overrides = remapKeyedObject(parsed.overrides);
  // Outer key only: the inner keys are currency ids, not node ids.
  if (parsed.costs) parsed.costs = remapKeyedObject(parsed.costs);
  if (parsed.customNodes) {
    Object.values(parsed.customNodes).forEach(custom => {
      if (custom && custom.parentId) custom.parentId = remapId(custom.parentId);
    });
  }
  ["linkedEdges", "removedEdges"].forEach(field => {
    if (!parsed[field]) return;
    const remapped = {};
    Object.keys(parsed[field]).forEach(parentId => {
      remapped[remapId(parentId)] = (parsed[field][parentId] || []).map(remapId);
    });
    parsed[field] = remapped;
  });
  if (parsed.groupsState && parsed.groupsState.groups) {
    const newGroups = {};
    Object.keys(parsed.groupsState.groups).forEach(gid => {
      newGroups[gid] = (parsed.groupsState.groups[gid] || []).map(remapId);
    });
    parsed.groupsState.groups = newGroups;
  }
  return parsed;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ID_MIGRATIONS, remapId, remapKeyedObject, migrateStateData };
}
