// Goal tree data, derived from "Iron Runescape.md" (based on ladlorchart.com's ironman unlock chart).
// Each node: { id, title, link, note, type, shared, children: [...] }
// - id must stay stable so localStorage progress doesn't get orphaned.
// - type: "skill" | "quest" | "other" — drives icon lookup and the default wiki link
//   (skill -> "<Skill> training" page, quest -> the quest's own page). "other" keeps
//   whatever icon/link is set explicitly, with a generic fallback otherwise.
// - shared marks a requirement that unlocks multiple goals (e.g. Eagles' Peak). All
//   nodes with the same `shared` key share one completion checkbox across the whole tree.

const GOAL_DATA = [
  {
    id: "herb-run",
    title: "Herb Run",
    type: "other",
    icon: "Grimy_ranarr_weed.png",
    children: [
      {
        id: "herb-run.catherby-camelot",
        title: "Catherby ⇒ Camelot TP",
        type: "other",
        children: [
          {
            id: "herb-run.catherby-camelot.lunar-tp",
            title: "Catherby teleport (lunar spellbook)",
            type: "other",
            icon: "Lunar_spellbook.png",
            children: [
              { id: "herb-run.catherby-camelot.lunar-tp.87magic", title: "87 Magic", type: "skill" }
            ]
          }
        ]
      },
      {
        id: "herb-run.hosidius-tithe",
        title: "Hosidius ⇒ Tithe TP / AKR",
        type: "other",
        children: [
          { id: "herb-run.hosidius-tithe.xerics", title: "Xeric's talisman", type: "other", icon: "Xeric's_talisman.png" }
        ]
      },
      {
        id: "herb-run.troll-stronghold",
        title: "Troll Stronghold ⇒ skip",
        type: "other",
        children: [
          { id: "herb-run.troll-stronghold.73agility", title: "73 Agility", type: "skill" }
        ]
      },
      {
        id: "herb-run.weiss",
        title: "Weiss ⇒ skip",
        type: "other",
        children: [
          { id: "herb-run.weiss.arm", title: "Making Friends with My Arm", type: "quest" }
        ]
      },
      {
        id: "herb-run.harmony",
        title: "Harmony Island ⇒ skip",
        type: "other",
        children: [
          { id: "herb-run.harmony.elite-mory", title: "Elite Morytania diary", type: "other", icon: "Achievement_Diaries.png", link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Morytania" }
        ]
      }
    ]
  },
  {
    id: "graceful",
    title: "Graceful Outfit",
    type: "other",
    icon: "Graceful_hood.png",
    link: "https://oldschool.runescape.wiki/w/Graceful_outfit",
    children: []
  },
  {
    id: "tithe-farm",
    title: "Tithe Farm",
    type: "other",
    icon: "Farmer's_strawhat.png",
    link: "https://oldschool.runescape.wiki/w/Tithe_Farm",
    children: [
      { id: "tithe-farm.farming-outfit", title: "Farming outfit", type: "other", icon: "Farmer's_strawhat.png" },
      { id: "tithe-farm.water-can", title: "Unlimited water can", type: "other", icon: "Gricoller's_can.png" }
    ]
  },
  {
    id: "piety",
    title: "Piety",
    type: "other",
    icon: "Piety.png",
    link: "https://oldschool.runescape.wiki/w/Piety",
    children: [
      { id: "piety.70def", title: "70 Defence", type: "skill" },
      {
        id: "piety.70prayer",
        title: "70 Prayer",
        type: "skill",
        children: [
          {
            id: "piety.70prayer.afk",
            title: "AFK prayer training",
            type: "other",
            children: [
              {
                id: "piety.70prayer.afk.perilous-moons",
                title: "Perilous Moons",
                type: "other",
                link: "https://oldschool.runescape.wiki/w/Perilous_Moons",
                children: [
                  {
                    id: "piety.70prayer.afk.perilous-moons.glacial-temotli",
                    title: "Glacial temotli",
                    type: "other",
                    icon: "Glacial_temotli.png",
                    link: "https://oldschool.runescape.wiki/w/Glacial_temotli"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "piety.kings-ransom",
        title: "King's Ransom",
        type: "quest",
        children: [
          { id: "piety.kings-ransom.one-small-favour", title: "One Small Favour", type: "quest", shared: "one-small-favour" }
        ]
      },
      {
        id: "piety.knights-waves",
        title: "Knight Waves training (Defence)",
        type: "other",
        link: "https://oldschool.runescape.wiki/w/Knights%27_Wave_Training_Grounds",
        children: [
          { id: "piety.knights-waves.60prayer", title: "60 Prayer", type: "skill" }
        ]
      },
      {
        id: "piety.prayer-quests",
        title: "Prayer quests",
        type: "other",
        note: "Quest experience rewards",
        link: "https://oldschool.runescape.wiki/w/Quest_experience_rewards#Prayer"
      }
    ]
  },
  {
    id: "mixed-hide-boots",
    title: "Mixed Hide Boots",
    type: "other",
    icon: "Mixed_hide_boots.png",
    link: "https://oldschool.runescape.wiki/w/Mixed_hide_boots",
    children: [
      {
        id: "mixed-hide-boots.sunlight-fur",
        title: "Sunlight antelope fur",
        type: "other",
        icon: "Sunlight_antelope_fur.png",
        children: [
          { id: "mixed-hide-boots.sunlight-fur.72hunter", title: "72 Hunter", type: "skill" }
        ]
      },
      { id: "mixed-hide-boots.alt-req", title: "69 Crafting OR 46 Hunter + 17.5k gp", type: "skill" }
    ]
  },
  {
    id: "imbued-zamorak-cape",
    title: "Imbued Zamorak Cape",
    type: "other",
    icon: "Imbued_zamorak_cape.png",
    link: "https://oldschool.runescape.wiki/w/Imbued_zamorak_cape",
    children: [
      { id: "imbued-zamorak-cape.75magic", title: "75 Magic", type: "skill" }
    ]
  },
  {
    id: "spirit-tree",
    title: "Spirit Tree (Construction)",
    type: "other",
    icon: "Spirit_tree.png",
    link: "https://oldschool.runescape.wiki/w/Spirit_tree",
    children: [
      { id: "spirit-tree.75construction", title: "75 Construction (70, boostable)", type: "skill" },
      { id: "spirit-tree.83farming", title: "83 Farming (78, boostable)", type: "skill" }
    ]
  },
  {
    id: "hallowed-shard",
    title: "Hallowed Crystal Shard",
    type: "other",
    icon: "Hallowed_crystal_shard.png",
    link: "https://oldschool.runescape.wiki/w/Hallowed_crystal_shard",
    children: [
      {
        id: "hallowed-shard.sepulchre",
        title: "Hallowed Sepulchre",
        type: "other",
        link: "https://oldschool.runescape.wiki/w/Hallowed_Sepulchre",
        children: [
          {
            id: "hallowed-shard.sepulchre.sins",
            title: "Sins of the Father",
            type: "quest",
            children: [
              { id: "hallowed-shard.sepulchre.sins.50slayer", title: "50 Slayer", type: "skill", shared: "50-slayer" },
              { id: "hallowed-shard.sepulchre.sins.taste-of-hope", title: "A Taste of Hope", type: "quest" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "easy-diaries",
    title: "Easy Diaries",
    type: "other",
    icon: "Achievement_Diaries.png",
    link: "https://oldschool.runescape.wiki/w/Achievement_Diaries",
    children: [
      { id: "easy-diaries.fremennik", title: "Fremennik", type: "other", icon: "Achievement_Diaries.png", link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Fremennik" }
    ]
  },
  {
    id: "medium-diaries",
    title: "Medium Diaries",
    type: "other",
    icon: "Achievement_Diaries.png",
    link: "https://oldschool.runescape.wiki/w/Achievement_Diaries",
    children: [
      {
        id: "medium-diaries.varrock",
        title: "Varrock",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Varrock",
        children: [
          { id: "medium-diaries.varrock.souls-bane", title: "A Soul's Bane", type: "quest" }
        ]
      },
      { id: "medium-diaries.kandarin", title: "Kandarin", type: "other", icon: "Achievement_Diaries.png", link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Kandarin" },
      {
        id: "medium-diaries.wilderness",
        title: "Wilderness",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Wilderness",
        children: [
          { id: "medium-diaries.wilderness.50slayer", title: "50 Slayer", type: "skill", shared: "50-slayer" },
          { id: "medium-diaries.wilderness.between-a-rock", title: "Between a Rock...", type: "quest", shared: "between-a-rock" }
        ]
      },
      { id: "medium-diaries.karamja", title: "Karamja", type: "other", icon: "Achievement_Diaries.png", link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Karamja" },
      {
        id: "medium-diaries.kourend",
        title: "Kourend",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Kourend_%26_Kebos",
        children: [
          { id: "medium-diaries.kourend.eagles-peak", title: "Eagles' Peak", type: "quest", shared: "eagles-peak" }
        ]
      },
      {
        id: "medium-diaries.morytania",
        title: "Morytania",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Morytania",
        children: [
          {
            id: "medium-diaries.morytania.cabin-fever",
            title: "Cabin Fever",
            type: "quest",
            shared: "cabin-fever",
            children: [
              { id: "medium-diaries.morytania.cabin-fever.pirates-treasure", title: "Pirate's Treasure", type: "quest", shared: "pirates-treasure" },
              {
                id: "medium-diaries.morytania.cabin-fever.rum-deal",
                title: "Rum Deal",
                type: "quest",
                shared: "rum-deal",
                children: [
                  { id: "medium-diaries.morytania.cabin-fever.rum-deal.42slayer", title: "42 Slayer", type: "skill", shared: "42-slayer-rumdeal" }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "medium-diaries.fremennik",
        title: "Fremennik",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Fremennik",
        children: [
          { id: "medium-diaries.fremennik.olafs-quest", title: "Olaf's Quest", type: "quest" },
          { id: "medium-diaries.fremennik.eagles-peak", title: "Eagles' Peak", type: "quest", shared: "eagles-peak" },
          { id: "medium-diaries.fremennik.between-a-rock", title: "Between a Rock...", type: "quest", shared: "between-a-rock" },
          { id: "medium-diaries.fremennik.47slayer", title: "47 Slayer", type: "skill" }
        ]
      },
      {
        id: "medium-diaries.desert",
        title: "Desert",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Desert",
        children: [
          { id: "medium-diaries.desert.eagles-peak", title: "Eagles' Peak", type: "quest", shared: "eagles-peak" },
          { id: "medium-diaries.desert.spirits-of-elid", title: "Spirits of the Elid", type: "quest" }
        ]
      },
      {
        id: "medium-diaries.western",
        title: "Western Provinces",
        type: "other",
        icon: "Achievement_Diaries.png",
        link: "https://oldschool.runescape.wiki/w/Achievement_Diaries/Western_Provinces",
        children: [
          { id: "medium-diaries.western.eagles-peak", title: "Eagles' Peak", type: "quest", shared: "eagles-peak" },
          { id: "medium-diaries.western.eyes-of-glouphrie", title: "Eyes of Glouphrie", type: "quest" },
          { id: "medium-diaries.western.one-small-favour", title: "One Small Favour", type: "quest", shared: "one-small-favour" }
        ]
      }
    ]
  },
  {
    id: "slayer-mask",
    title: "Slayer Mask",
    type: "other",
    icon: "Slayer_helmet.png",
    link: "https://oldschool.runescape.wiki/w/Slayer_helmet",
    children: [
      { id: "slayer-mask.54slayer", title: "54 Slayer", type: "skill" },
      {
        id: "slayer-mask.cabin-fever",
        title: "Cabin Fever",
        type: "quest",
        shared: "cabin-fever",
        children: [
          { id: "slayer-mask.cabin-fever.pirates-treasure", title: "Pirate's Treasure", type: "quest", shared: "pirates-treasure" },
          {
            id: "slayer-mask.cabin-fever.rum-deal",
            title: "Rum Deal",
            type: "quest",
            shared: "rum-deal",
            children: [
              { id: "slayer-mask.cabin-fever.rum-deal.42slayer", title: "42 Slayer", type: "skill", shared: "42-slayer-rumdeal" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "void-armor",
    title: "Void Armor",
    type: "other",
    icon: "Void_knight_top.png",
    link: "https://oldschool.runescape.wiki/w/Void_knight_equipment",
    children: [
      { id: "void-armor.pest-control", title: "Pest Control", type: "other", link: "https://oldschool.runescape.wiki/w/Pest_Control" }
    ]
  },
  {
    id: "bottomless-compost",
    title: "Bottomless Compost Bucket",
    type: "other",
    icon: "Bottomless_compost_bucket.png",
    link: "https://oldschool.runescape.wiki/w/Bottomless_compost_bucket",
    children: [
      { id: "bottomless-compost.hespori", title: "Hespori", type: "other", link: "https://oldschool.runescape.wiki/w/Hespori" }
    ]
  },
  // The rest of Ladlor's Chart (https://ladlorchart.com/) goals — each is its own
  // top-level, parent-less goal (per chart order), since these are meant to be flat.
  // A few items already covered above (Imbued zamorak cape, Spirit tree, Hallowed
  // crystal shard, Mixed hide boots) are intentionally left out to avoid duplicates.
{ id: "gear.amulet-of-strength", title: "Amulet of strength", type: "other", icon: "Amulet_of_strength.png", link: "https://oldschool.runescape.wiki/w/Amulet_of_strength", children: [] },
  { id: "gear.climbing-boots", title: "Climbing boots", type: "other", icon: "Climbing_boots.png", link: "https://oldschool.runescape.wiki/w/Climbing_boots", children: [] },
  { id: "gear.rune-pouch", title: "Rune pouch", type: "other", icon: "Rune_pouch.png", link: "https://oldschool.runescape.wiki/w/Rune_pouch", children: [] },
  { id: "gear.iban-s-staff-u", title: "Iban's staff (u)", type: "other", icon: "Iban's_staff_(u).png", link: "https://oldschool.runescape.wiki/w/Iban's_staff_(u)", children: [] },
  { id: "gear.protect-from-melee", title: "Protect from Melee", type: "other", icon: "Protect_from_Melee.png", link: "https://oldschool.runescape.wiki/w/Protect_from_Melee", children: [] },
  { id: "gear.ancient-staff", title: "Ancient staff", type: "other", icon: "Ancient_staff.png", link: "https://oldschool.runescape.wiki/w/Ancient_staff", children: [] },
  { id: "gear.eagle-eye", title: "Eagle Eye", type: "other", icon: "Eagle_Eye.png", link: "https://oldschool.runescape.wiki/w/Eagle_Eye", children: [] },
  { id: "gear.fighter-torso", title: "Fighter torso", type: "other", icon: "Fighter_torso.png", link: "https://oldschool.runescape.wiki/w/Fighter_torso", children: [] },
  { id: "gear.granite-body", title: "Granite body", type: "other", icon: "Granite_body.png", link: "https://oldschool.runescape.wiki/w/Granite_body", children: [] },
  { id: "gear.dragon-scimitar", title: "Dragon scimitar", type: "other", icon: "Dragon_scimitar.png", link: "https://oldschool.runescape.wiki/w/Dragon_scimitar", children: [] },
  { id: "gear.dragon-dagger", title: "Dragon dagger", type: "other", icon: "Dragon_dagger.png", link: "https://oldschool.runescape.wiki/w/Dragon_dagger", children: [] },
  { id: "gear.berserker-ring-i", title: "Berserker ring (i)", type: "other", icon: "Berserker_ring_(i).png", link: "https://oldschool.runescape.wiki/w/Berserker_ring_(i)", children: [] },
  { id: "gear.helm-of-neitiznot", title: "Helm of neitiznot", type: "other", icon: "Helm_of_neitiznot.png", link: "https://oldschool.runescape.wiki/w/Helm_of_neitiznot", children: [] },
  { id: "gear.barrows-gloves", title: "Barrows gloves", type: "other", icon: "Barrows_gloves.png", link: "https://oldschool.runescape.wiki/w/Barrows_gloves", children: [] },
  { id: "gear.gem-bag", title: "gem bag", type: "other", icon: "Gem_bag.png", link: "https://oldschool.runescape.wiki/w/gem_bag", children: [] },
  { id: "gear.herb-sack", title: "Herb sack", type: "other", icon: "Herb_sack.png", link: "https://oldschool.runescape.wiki/w/Herb_sack", children: [] },
  { id: "gear.dragon-defender", title: "Dragon defender", type: "other", icon: "Dragon_defender.png", link: "https://oldschool.runescape.wiki/w/Dragon_defender", children: [] },
  { id: "gear.book-of-the-dead", title: "Book of the dead", type: "other", icon: "Book_of_the_dead.png", link: "https://oldschool.runescape.wiki/w/Book_of_the_dead", children: [] },
  { id: "gear.salve-amulet-ei", title: "Salve amulet(ei)", type: "other", icon: "Salve_amulet(ei).png", link: "https://oldschool.runescape.wiki/w/Salve_amulet(ei)", children: [] },
  { id: "gear.piety", title: "Piety", type: "other", icon: "Piety.png", link: "https://oldschool.runescape.wiki/w/Piety", children: [] },
  { id: "gear.mixed-hide-cape", title: "Mixed hide cape", type: "other", icon: "Mixed_hide_cape.png", link: "https://oldschool.runescape.wiki/w/Mixed_hide_cape", children: [] },
  { id: "gear.ava-s-accumulator", title: "Ava's accumulator", type: "other", icon: "Ava's_accumulator.png", link: "https://oldschool.runescape.wiki/w/Ava's_accumulator", children: [] },
  { id: "gear.infinity-boots", title: "Infinity boots", type: "other", icon: "Infinity_boots.png", link: "https://oldschool.runescape.wiki/w/Infinity_boots", children: [] },
  { id: "gear.mage-s-book", title: "Mage's book", type: "other", icon: "Mage's_book.png", link: "https://oldschool.runescape.wiki/w/Mage's_book", children: [] },
  { id: "gear.dark-altar-construction", title: "Dark altar (Construction)", type: "other", icon: "Dark_altar_(Construction)_icon.png", link: "https://oldschool.runescape.wiki/w/Dark_altar_(Construction)", children: [] },
  { id: "gear.rejuvenation-pool", title: "Rejuvenation pool", type: "other", icon: "Rejuvenation_pool_icon.png", link: "https://oldschool.runescape.wiki/w/Rejuvenation_pool", children: [] },
  { id: "gear.basic-jewellery-box", title: "Basic jewellery box", type: "other", icon: "Basic_jewellery_box_icon.png", link: "https://oldschool.runescape.wiki/w/Basic_jewellery_box", children: [] },
  { id: "gear.arkan-blade", title: "Arkan blade", type: "other", icon: "Arkan_blade.png", link: "https://oldschool.runescape.wiki/w/Arkan_blade", children: [] },
  { id: "gear.black-mask-i", title: "Black mask (i)", type: "other", icon: "Black_mask_(i).png", link: "https://oldschool.runescape.wiki/w/Black_mask_(i)", children: [] },
  { id: "gear.bonecrusher", title: "Bonecrusher", type: "other", icon: "Bonecrusher.png", link: "https://oldschool.runescape.wiki/w/Bonecrusher", children: [] },
  { id: "gear.pharaoh-s-sceptre", title: "Pharaoh's sceptre", type: "other", icon: "Pharaoh's_sceptre_(1).png", link: "https://oldschool.runescape.wiki/w/Pharaoh's_sceptre", children: [] },
  { id: "gear.arclight", title: "Arclight", type: "other", icon: "Arclight.png", link: "https://oldschool.runescape.wiki/w/Arclight", children: [] },
  { id: "gear.broader-fletching", title: "Broader Fletching", type: "other", icon: "Broad_arrowheads_5.png", link: "https://oldschool.runescape.wiki/w/Broader_Fletching", children: [] },
  { id: "gear.slayer-helmet-i", title: "Slayer helmet (i)", type: "other", icon: "Slayer_helmet_(i).png", link: "https://oldschool.runescape.wiki/w/Slayer_helmet_(i)", children: [] },
  { id: "gear.ice-barrage", title: "Ice Barrage", type: "other", icon: "Ice_Barrage.png", link: "https://oldschool.runescape.wiki/w/Ice_Barrage", children: [] },
  { id: "gear.bigger-and-badder", title: "Bigger and Badder", type: "other", icon: "Bigger_and_Badder.png", link: "https://oldschool.runescape.wiki/w/Bigger_and_Badder", children: [] },
  { id: "gear.ash-sanctifier", title: "Ash sanctifier", type: "other", icon: "Ash_sanctifier.png", link: "https://oldschool.runescape.wiki/w/Ash_sanctifier", children: [] },
  { id: "gear.69-slayer", title: "69 Slayer", type: "skill", children: [] },
  { id: "gear.86-strength", title: "86 Strength", type: "skill", children: [] },
  { id: "gear.karamja-gloves-3", title: "Karamja gloves 3", type: "other", icon: "Karamja_gloves_3.png", link: "https://oldschool.runescape.wiki/w/Karamja_gloves_3", children: [] },
  { id: "gear.amulet-of-glory", title: "Amulet of glory", type: "other", icon: "Amulet_of_glory(4).png", link: "https://oldschool.runescape.wiki/w/Amulet_of_glory", children: [] },
  { id: "gear.ghommal-s-hilt-2", title: "Ghommal's hilt 2", type: "other", icon: "Ghommal's_hilt_2.png", link: "https://oldschool.runescape.wiki/w/Ghommal's_hilt_2", children: [] },
  { id: "gear.void-knight-top", title: "void knight top", type: "other", icon: "Void_knight_top.png", link: "https://oldschool.runescape.wiki/w/void_knight_top", children: [] },
  { id: "gear.void-knight-robe", title: "void knight robe", type: "other", icon: "Void_knight_robe.png", link: "https://oldschool.runescape.wiki/w/void_knight_robe", children: [] },
  { id: "gear.void-ranger-helm", title: "Void ranger helm", type: "other", icon: "Void_ranger_helm.png", link: "https://oldschool.runescape.wiki/w/Void_ranger_helm", children: [] },
  { id: "gear.void-knight-gloves", title: "Void knight gloves", type: "other", icon: "Void_knight_gloves.png", link: "https://oldschool.runescape.wiki/w/Void_knight_gloves", children: [] },
  { id: "gear.red-chinchompa", title: "Red chinchompa", type: "other", icon: "Red_chinchompa.png", link: "https://oldschool.runescape.wiki/w/Red_chinchompa", children: [] },
  { id: "gear.70-ranged", title: "70 Ranged", type: "skill", children: [] },
  { id: "gear.elite-void-top", title: "Elite void top", type: "other", icon: "Elite_void_top.png", link: "https://oldschool.runescape.wiki/w/Elite_void_top", children: [] },
  { id: "gear.elite-void-robe", title: "Elite void robe", type: "other", icon: "Elite_void_robe.png", link: "https://oldschool.runescape.wiki/w/Elite_void_robe", children: [] },
  { id: "gear.crystal-halberd", title: "Crystal halberd", type: "other", icon: "Crystal_halberd.png", link: "https://oldschool.runescape.wiki/w/Crystal_halberd", children: [] },
  { id: "gear.92-ranged", title: "92 Ranged", type: "skill", children: [] },
  { id: "gear.crystal-body", title: "Crystal body", type: "other", icon: "Crystal_body.png", link: "https://oldschool.runescape.wiki/w/Crystal_body", children: [] },
  { id: "gear.crystal-legs", title: "Crystal legs", type: "other", icon: "Crystal_legs.png", link: "https://oldschool.runescape.wiki/w/Crystal_legs", children: [] },
  { id: "gear.crystal-helm", title: "Crystal helm", type: "other", icon: "Crystal_helm.png", link: "https://oldschool.runescape.wiki/w/Crystal_helm", children: [] },
  { id: "gear.bow-of-faerdhinen-c", title: "Bow of faerdhinen (c)", type: "other", icon: "Bow_of_faerdhinen_(c).png", link: "https://oldschool.runescape.wiki/w/Bow_of_faerdhinen_(c)", children: [] },
  { id: "gear.bloodbark-body", title: "Bloodbark body", type: "other", icon: "Bloodbark_body.png", link: "https://oldschool.runescape.wiki/w/Bloodbark_body", children: [] },
  { id: "gear.bloodbark-legs", title: "Bloodbark legs", type: "other", icon: "Bloodbark_legs.png", link: "https://oldschool.runescape.wiki/w/Bloodbark_legs", children: [] },
  { id: "gear.bloodbark-helm", title: "Bloodbark helm", type: "other", icon: "Bloodbark_helm.png", link: "https://oldschool.runescape.wiki/w/Bloodbark_helm", children: [] },
  { id: "gear.ava-s-assembler", title: "Ava's assembler", type: "other", icon: "Ava's_assembler.png", link: "https://oldschool.runescape.wiki/w/Ava's_assembler", children: [] },
  { id: "gear.spellbook-swap", title: "Spellbook Swap", type: "other", icon: "Spellbook_Swap.png", link: "https://oldschool.runescape.wiki/w/Spellbook_Swap", children: [] },
  { id: "gear.fire-cape", title: "Fire cape", type: "other", icon: "Fire_cape.png", link: "https://oldschool.runescape.wiki/w/Fire_cape", children: [] },
  { id: "gear.ancient-icon", title: "Ancient icon", type: "other", icon: "Ancient_icon.png", link: "https://oldschool.runescape.wiki/w/Ancient_icon", children: [] },
  { id: "gear.dragon-pickaxe", title: "Dragon pickaxe", type: "other", icon: "Dragon_pickaxe.png", link: "https://oldschool.runescape.wiki/w/Dragon_pickaxe", children: [] },
  { id: "gear.wrath-rune", title: "Wrath rune", type: "other", icon: "Wrath_rune.png", link: "https://oldschool.runescape.wiki/w/Wrath_rune", children: [] },
  { id: "gear.occult-altar", title: "Occult altar", type: "other", icon: "Occult_altar_icon.png", link: "https://oldschool.runescape.wiki/w/Occult_altar", children: [] },
  { id: "gear.ornate-jewellery-box", title: "Ornate jewellery box", type: "other", icon: "Ornate_jewellery_box_icon.png", link: "https://oldschool.runescape.wiki/w/Ornate_jewellery_box", children: [] },
  { id: "gear.fairy-ring-construction", title: "Fairy ring (Construction)", type: "other", icon: "Fairy_ring_(Construction)_icon.png", link: "https://oldschool.runescape.wiki/w/Fairy_ring_(Construction)", children: [] },
  { id: "gear.ornate-rejuvenation-pool", title: "Ornate rejuvenation pool", type: "other", icon: "Ornate_rejuvenation_pool_icon.png", link: "https://oldschool.runescape.wiki/w/Ornate_rejuvenation_pool", children: [] },
  { id: "gear.karamja-gloves-4", title: "Karamja gloves 4", type: "other", icon: "Karamja_gloves_4.png", link: "https://oldschool.runescape.wiki/w/Karamja_gloves_4", children: [] },
  { id: "gear.explorer-s-ring-4", title: "Explorer's ring 4", type: "other", icon: "Explorer's_ring_4.png", link: "https://oldschool.runescape.wiki/w/Explorer's_ring_4", children: [] },
  { id: "gear.warped-sceptre", title: "Warped sceptre", type: "other", icon: "Warped_sceptre.png", link: "https://oldschool.runescape.wiki/w/Warped_sceptre", children: [] },
  { id: "gear.reptile-got-ripped", title: "Reptile Got Ripped", type: "other", icon: "Lizardmen_icon.png", link: "https://oldschool.runescape.wiki/w/Reptile_Got_Ripped", children: [] },
  { id: "gear.prescription-goggles", title: "Prescription goggles", type: "other", icon: "Prescription_goggles_(unfocused).png", link: "https://oldschool.runescape.wiki/w/Prescription_goggles", children: [] },
  { id: "gear.alchemist-s-amulet", title: "Alchemist's amulet", type: "other", icon: "Alchemist's_amulet_(uncharged).png", link: "https://oldschool.runescape.wiki/w/Alchemist's_amulet", children: [] },
  { id: "gear.amulet-of-torture", title: "Amulet of torture", type: "other", icon: "Amulet_of_torture.png", link: "https://oldschool.runescape.wiki/w/Amulet_of_torture", children: [] },
  { id: "gear.necklace-of-anguish", title: "Necklace of anguish", type: "other", icon: "Necklace_of_anguish.png", link: "https://oldschool.runescape.wiki/w/Necklace_of_anguish", children: [] },
  { id: "gear.zamorakian-hasta", title: "Zamorakian hasta", type: "other", icon: "Zamorakian_hasta.png", link: "https://oldschool.runescape.wiki/w/Zamorakian_hasta", children: [] },
  { id: "gear.bandos-godsword", title: "Bandos godsword", type: "other", icon: "Bandos_godsword.png", link: "https://oldschool.runescape.wiki/w/Bandos_godsword", children: [] },
  { id: "gear.voidwaker", title: "Voidwaker", type: "other", icon: "Voidwaker.png", link: "https://oldschool.runescape.wiki/w/Voidwaker", children: [] },
  { id: "gear.deadeye", title: "Deadeye", type: "other", icon: "Deadeye.png", link: "https://oldschool.runescape.wiki/w/Deadeye", children: [] },
  { id: "gear.mystic-vigour", title: "Mystic Vigour", type: "other", icon: "Mystic_Vigour.png", link: "https://oldschool.runescape.wiki/w/Mystic_Vigour", children: [] },
  { id: "gear.thread-of-elidinis", title: "Thread of elidinis", type: "other", icon: "Thread_of_elidinis.png", link: "https://oldschool.runescape.wiki/w/Thread_of_elidinis", children: [] },
  { id: "gear.lightbearer", title: "Lightbearer", type: "other", icon: "Lightbearer.png", link: "https://oldschool.runescape.wiki/w/Lightbearer", children: [] },
  { id: "gear.ghommal-s-hilt-4", title: "Ghommal's hilt 4", type: "other", icon: "Ghommal's_hilt_4.png", link: "https://oldschool.runescape.wiki/w/Ghommal's_hilt_4", children: [] },
  { id: "gear.abyssal-whip", title: "Abyssal whip", type: "other", icon: "Abyssal_whip.png", link: "https://oldschool.runescape.wiki/w/Abyssal_whip", children: [] },
  { id: "gear.abyssal-tentacle", title: "Abyssal tentacle", type: "other", icon: "Abyssal_tentacle.png", link: "https://oldschool.runescape.wiki/w/Abyssal_tentacle", children: [] },
  { id: "gear.dragon-warhammer", title: "Dragon warhammer", type: "other", icon: "Dragon_warhammer.png", link: "https://oldschool.runescape.wiki/w/Dragon_warhammer", children: [] },
  { id: "gear.emberlight", title: "Emberlight", type: "other", icon: "Emberlight.png", link: "https://oldschool.runescape.wiki/w/Emberlight", children: [] },
  { id: "gear.dragon-boots", title: "Dragon boots", type: "other", icon: "Dragon_boots.png", link: "https://oldschool.runescape.wiki/w/Dragon_boots", children: [] },
  { id: "gear.scorching-bow", title: "Scorching bow", type: "other", icon: "Scorching_bow.png", link: "https://oldschool.runescape.wiki/w/Scorching_bow", children: [] },
  { id: "gear.tormented-bracelet", title: "Tormented bracelet", type: "other", icon: "Tormented_bracelet.png", link: "https://oldschool.runescape.wiki/w/Tormented_bracelet", children: [] },
  { id: "gear.burning-claws", title: "Burning claws", type: "other", icon: "Burning_claws.png", link: "https://oldschool.runescape.wiki/w/Burning_claws", children: [] },
  { id: "gear.ring-of-suffering-i", title: "Ring of suffering (i)", type: "other", icon: "Ring_of_suffering_(i).png", link: "https://oldschool.runescape.wiki/w/Ring_of_suffering_(i)", children: [] },
  { id: "gear.avernic-treads", title: "Avernic treads", type: "other", icon: "Avernic_treads.png", link: "https://oldschool.runescape.wiki/w/Avernic_treads", children: [] },
  { id: "gear.rite-of-vile-transference", title: "Rite of vile transference", type: "other", icon: "Rite_of_vile_transference.png", link: "https://oldschool.runescape.wiki/w/Rite_of_vile_transference", children: [] },
  { id: "gear.desert-amulet-4", title: "Desert amulet 4", type: "other", icon: "Desert_amulet_4.png", link: "https://oldschool.runescape.wiki/w/Desert_amulet_4", children: [] },
  { id: "gear.rada-s-blessing-4", title: "Rada's blessing 4", type: "other", icon: "Rada's_blessing_4.png", link: "https://oldschool.runescape.wiki/w/Rada's_blessing_4", children: [] },
  { id: "gear.primordial-boots", title: "Primordial boots", type: "other", icon: "Primordial_boots.png", link: "https://oldschool.runescape.wiki/w/Primordial_boots", children: [] },
  { id: "gear.amulet-of-rancour", title: "Amulet of rancour", type: "other", icon: "Amulet_of_rancour.png", link: "https://oldschool.runescape.wiki/w/Amulet_of_rancour", children: [] },
  { id: "gear.eternal-boots", title: "Eternal boots", type: "other", icon: "Eternal_boots.png", link: "https://oldschool.runescape.wiki/w/Eternal_boots", children: [] },
  { id: "gear.occult-necklace", title: "Occult necklace", type: "other", icon: "Occult_necklace.png", link: "https://oldschool.runescape.wiki/w/Occult_necklace", children: [] },
  { id: "gear.eye-of-ayak", title: "Eye of ayak", type: "other", icon: "Eye_of_ayak.png", link: "https://oldschool.runescape.wiki/w/Eye_of_ayak", children: [] },
  { id: "gear.confliction-gauntlets", title: "Confliction gauntlets", type: "other", icon: "Confliction_gauntlets.png", link: "https://oldschool.runescape.wiki/w/Confliction_gauntlets", children: [] },
  { id: "gear.toxic-blowpipe", title: "Toxic blowpipe", type: "other", icon: "Toxic_blowpipe.png", link: "https://oldschool.runescape.wiki/w/Toxic_blowpipe", children: [] },
  { id: "gear.osmumten-s-fang", title: "Osmumten's fang", type: "other", icon: "Osmumten's_fang.png", link: "https://oldschool.runescape.wiki/w/Osmumten's_fang", children: [] },
  { id: "gear.ferocious-gloves", title: "Ferocious gloves", type: "other", icon: "Ferocious_gloves.png", link: "https://oldschool.runescape.wiki/w/Ferocious_gloves", children: [] },
  { id: "gear.rigour", title: "Rigour", type: "other", icon: "Rigour.png", link: "https://oldschool.runescape.wiki/w/Rigour", children: [] },
  { id: "gear.augury", title: "Augury", type: "other", icon: "Augury.png", link: "https://oldschool.runescape.wiki/w/Augury", children: [] },
  { id: "gear.infernal-cape", title: "Infernal cape", type: "other", icon: "Infernal_cape.png", link: "https://oldschool.runescape.wiki/w/Infernal_cape", children: [] },
  { id: "gear.oathplate-chest", title: "Oathplate chest", type: "other", icon: "Oathplate_chest.png", link: "https://oldschool.runescape.wiki/w/Oathplate_chest", children: [] },
  { id: "gear.oathplate-legs", title: "Oathplate legs", type: "other", icon: "Oathplate_legs.png", link: "https://oldschool.runescape.wiki/w/Oathplate_legs", children: [] },
  { id: "gear.oathplate-helm", title: "Oathplate helm", type: "other", icon: "Oathplate_helm.png", link: "https://oldschool.runescape.wiki/w/Oathplate_helm", children: [] },
  { id: "gear.ultor-ring", title: "Ultor ring", type: "other", icon: "Ultor_ring.png", link: "https://oldschool.runescape.wiki/w/Ultor_ring", children: [] },
  { id: "gear.dizana-s-quiver", title: "Dizana's quiver", type: "other", icon: "Dizana's_quiver.png", link: "https://oldschool.runescape.wiki/w/Dizana's_quiver", children: [] },
  { id: "gear.avernic-defender", title: "Avernic defender", type: "other", icon: "Avernic_defender.png", link: "https://oldschool.runescape.wiki/w/Avernic_defender", children: [] },
  { id: "gear.scythe-of-vitur", title: "Scythe of vitur", type: "other", icon: "Scythe_of_vitur.png", link: "https://oldschool.runescape.wiki/w/Scythe_of_vitur", children: [] },
  { id: "gear.tumeken-s-shadow", title: "Tumeken's shadow", type: "other", icon: "Tumeken's_shadow.png", link: "https://oldschool.runescape.wiki/w/Tumeken's_shadow", children: [] },
  { id: "gear.magus-ring", title: "Magus ring", type: "other", icon: "Magus_ring.png", link: "https://oldschool.runescape.wiki/w/Magus_ring", children: [] },
  { id: "gear.twisted-bow", title: "Twisted bow", type: "other", icon: "Twisted_bow.png", link: "https://oldschool.runescape.wiki/w/Twisted_bow", children: [] },
  { id: "gear.dragon-claws", title: "Dragon claws", type: "other", icon: "Dragon_claws.png", link: "https://oldschool.runescape.wiki/w/Dragon_claws", children: [] },
  { id: "gear.ancestral-robe-top", title: "Ancestral robe top", type: "other", icon: "Ancestral_robe_top.png", link: "https://oldschool.runescape.wiki/w/Ancestral_robe_top", children: [] },
  { id: "gear.ancestral-robe-bottom", title: "Ancestral robe bottom", type: "other", icon: "Ancestral_robe_bottom.png", link: "https://oldschool.runescape.wiki/w/Ancestral_robe_bottom", children: [] },
  { id: "gear.ancestral-hat", title: "Ancestral hat", type: "other", icon: "Ancestral_hat.png", link: "https://oldschool.runescape.wiki/w/Ancestral_hat", children: [] },
  { id: "gear.elder-maul", title: "Elder maul", type: "other", icon: "Elder_maul.png", link: "https://oldschool.runescape.wiki/w/Elder_maul", children: [] },
  { id: "gear.masori-body-f", title: "Masori body (f)", type: "other", icon: "Masori_body_(f).png", link: "https://oldschool.runescape.wiki/w/Masori_body_(f)", children: [] },
  { id: "gear.masori-chaps-f", title: "Masori chaps (f)", type: "other", icon: "Masori_chaps_(f).png", link: "https://oldschool.runescape.wiki/w/Masori_chaps_(f)", children: [] },
  { id: "gear.masori-mask-f", title: "Masori mask (f)", type: "other", icon: "Masori_mask_(f).png", link: "https://oldschool.runescape.wiki/w/Masori_mask_(f)", children: [] },
  { id: "gear.elidinis-ward", title: "Elidinis' ward", type: "other", icon: "Elidinis'_ward.png", link: "https://oldschool.runescape.wiki/w/Elidinis'_ward", children: [] },
  { id: "gear.saturated-heart", title: "Saturated heart", type: "other", icon: "Saturated_heart.png", link: "https://oldschool.runescape.wiki/w/Saturated_heart", children: [] },
  { id: "gear.zaryte-crossbow", title: "Zaryte crossbow", type: "other", icon: "Zaryte_crossbow.png", link: "https://oldschool.runescape.wiki/w/Zaryte_crossbow", children: [] },
  { id: "gear.zaryte-vambraces", title: "Zaryte vambraces", type: "other", icon: "Zaryte_vambraces.png", link: "https://oldschool.runescape.wiki/w/Zaryte_vambraces", children: [] }
];

// Per-type emoji fallback, generic wiki icon, and label.
const TYPE_META = {
  skill: { icon: "⚔️", wikiIcon: null, label: "Skill" },
  quest: { icon: "📜", wikiIcon: "Quest_point_icon.png", label: "Quest" },
  other: { icon: "📦", wikiIcon: null, label: "Other" }
};

const WIKI_ICON_BASE = "https://oldschool.runescape.wiki/images/";

// OSRS skill names, used to auto-detect the skill icon/guide page for "skill" nodes.
const SKILL_NAMES = [
  "Attack", "Strength", "Defence", "Ranged", "Prayer", "Magic", "Runecraft",
  "Construction", "Hitpoints", "Agility", "Herblore", "Thieving", "Crafting",
  "Fletching", "Slayer", "Hunter", "Mining", "Smithing", "Fishing", "Cooking",
  "Firemaking", "Woodcutting", "Farming"
];

function detectSkillName(title) {
  for (const skill of SKILL_NAMES) {
    if (new RegExp("\\b" + skill + "\\b", "i").test(title)) return skill;
  }
  return null;
}

function detectSkillIcon(title) {
  const skill = detectSkillName(title);
  return skill ? skill + "_icon.png" : null;
}

// Parses a clean "<level> <Skill>" requirement (e.g. "87 Magic") for hiscores
// auto-tracking. Returns null for compound requirements, which stay manual.
function parseSkillRequirement(title) {
  if (/\bOR\b/i.test(title)) return null;
  const m = title.match(/^(\d+)\s+([A-Za-z]+)/);
  if (!m) return null;
  const level = parseInt(m[1], 10);
  const skill = SKILL_NAMES.find(s => s.toLowerCase() === m[2].toLowerCase());
  if (!skill) return null;
  return { skill, level };
}

// Attack and Strength share the combined Melee ironman guide page.
const IRONMAN_GUIDE_PAGE = { Attack: "Melee", Strength: "Melee" };

function ironmanGuideLink(skill) {
  const page = IRONMAN_GUIDE_PAGE[skill] || skill;
  return `https://oldschool.runescape.wiki/w/Ironman_Guide/${encodeURIComponent(page)}`;
}

// Best wiki icon filename for a node: explicit icon > detected skill > type generic.
function resolveIconFile(node) {
  if (node.icon) return node.icon;
  if (node.type === "skill") {
    const detected = detectSkillIcon(node.title);
    if (detected) return detected;
  }
  if (node.type && TYPE_META[node.type]) return TYPE_META[node.type].wikiIcon;
  return null;
}

// Default wiki link for a node without an explicit one: skills link to their
// "Ironman Guide/<Skill>" page, quests to their own page.
function resolveDefaultLink(node) {
  if (node.link) return null;
  if (node.type === "skill") {
    const skill = detectSkillName(node.title);
    if (skill) return { link: ironmanGuideLink(skill), note: "Ironman Guide: " + skill };
  }
  if (node.type === "quest") {
    const page = node.title.trim().replace(/ /g, "_");
    return { link: `https://oldschool.runescape.wiki/w/${encodeURIComponent(page)}`, note: null };
  }
  return null;
}

// ladlorchart.com's tier groupings as purely visual clusters (bordered boxes,
// no dependency between members). Goals with no tier stay ungrouped.
const GEAR_GROUPS = [
  ["gear.amulet-of-strength", "gear.climbing-boots", "gear.rune-pouch"],
  ["gear.iban-s-staff-u", "gear.protect-from-melee", "gear.ancient-staff", "gear.eagle-eye"],
  ["gear.fighter-torso", "gear.granite-body"],
  ["gear.dragon-scimitar", "gear.dragon-dagger", "gear.berserker-ring-i"],
  ["gear.helm-of-neitiznot", "gear.barrows-gloves", "gear.gem-bag", "gear.herb-sack"],
  ["gear.dragon-defender", "gear.book-of-the-dead", "gear.salve-amulet-ei", "gear.piety"],
  ["gear.mixed-hide-cape", "mixed-hide-boots"],
  ["gear.ava-s-accumulator", "imbued-zamorak-cape"],
  ["spirit-tree"],
  ["hallowed-shard"],
  ["gear.infinity-boots", "gear.mage-s-book"],
  ["gear.dark-altar-construction", "gear.rejuvenation-pool", "gear.basic-jewellery-box"],
  ["gear.arkan-blade"],
  ["gear.black-mask-i", "gear.bonecrusher"],
  ["gear.pharaoh-s-sceptre"],
  ["gear.arclight", "gear.broader-fletching", "gear.slayer-helmet-i", "gear.ice-barrage", "gear.bigger-and-badder", "gear.ash-sanctifier"],
  ["gear.69-slayer", "gear.86-strength"],
  ["gear.karamja-gloves-3"],
  ["gear.amulet-of-glory"],
  ["gear.ghommal-s-hilt-2"],
  ["gear.void-knight-top", "gear.void-knight-robe", "gear.void-ranger-helm", "gear.void-knight-gloves"],
  ["gear.red-chinchompa", "gear.70-ranged"],
  ["gear.elite-void-top", "gear.elite-void-robe", "gear.crystal-halberd"],
  ["gear.92-ranged"],
  ["gear.crystal-body", "gear.crystal-legs", "gear.crystal-helm", "gear.bow-of-faerdhinen-c"],
  ["gear.bloodbark-body", "gear.bloodbark-legs", "gear.bloodbark-helm", "gear.ava-s-assembler"],
  ["gear.spellbook-swap"],
  ["gear.fire-cape", "gear.ancient-icon", "gear.dragon-pickaxe", "gear.wrath-rune"],
  ["gear.occult-altar", "gear.ornate-jewellery-box", "gear.fairy-ring-construction", "gear.ornate-rejuvenation-pool"],
  ["gear.karamja-gloves-4", "gear.explorer-s-ring-4"],
  ["gear.warped-sceptre", "gear.reptile-got-ripped"],
  ["gear.prescription-goggles", "gear.alchemist-s-amulet"],
  ["gear.amulet-of-torture", "gear.necklace-of-anguish", "gear.zamorakian-hasta", "gear.bandos-godsword"],
  ["gear.voidwaker"],
  ["gear.deadeye", "gear.mystic-vigour"],
  ["gear.thread-of-elidinis", "gear.lightbearer"],
  ["gear.ghommal-s-hilt-4"],
  ["gear.abyssal-whip", "gear.abyssal-tentacle", "gear.dragon-warhammer", "gear.emberlight", "gear.dragon-boots", "gear.scorching-bow", "gear.tormented-bracelet", "gear.burning-claws", "gear.ring-of-suffering-i"],
  ["gear.avernic-treads", "gear.rite-of-vile-transference"],
  ["gear.desert-amulet-4", "gear.rada-s-blessing-4"],
  ["gear.primordial-boots", "gear.amulet-of-rancour", "gear.eternal-boots", "gear.occult-necklace"],
  ["gear.eye-of-ayak", "gear.confliction-gauntlets"],
  ["gear.toxic-blowpipe"],
  ["gear.osmumten-s-fang"],
  ["gear.ferocious-gloves"],
  ["gear.rigour", "gear.augury"],
  ["gear.infernal-cape"],
  ["gear.oathplate-chest", "gear.oathplate-legs", "gear.oathplate-helm"],
  ["gear.ultor-ring"],
  ["gear.dizana-s-quiver"],
  ["gear.avernic-defender", "gear.scythe-of-vitur"],
  ["gear.tumeken-s-shadow", "gear.magus-ring"],
  ["gear.twisted-bow", "gear.dragon-claws", "gear.ancestral-robe-top", "gear.ancestral-robe-bottom", "gear.ancestral-hat", "gear.elder-maul"],
  ["gear.masori-body-f", "gear.masori-chaps-f", "gear.masori-mask-f", "gear.elidinis-ward"],
  ["gear.saturated-heart"],
  ["gear.zaryte-crossbow", "gear.zaryte-vambraces"]
];
