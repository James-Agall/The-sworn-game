# Adventure experience release — 25 November 2026

Short, persistent expeditions now accompany the ten existing long stories. The existing journal, named residents, real interiors, physical containers, equipment inventory, workstation crafting, armies and livestock remain authoritative.

## Playable content

- Eighteen finite contracts: three each for rescue, recovery, hunt, sabotage, mine restoration and investigation. Variations unlock in order and bind distinct suitable locations. Mine jobs appear only for recorded infested or cleared working mines.
- Hesta's missing apprentice: accept in the journal or in Hesta's conversation, collect the camp key, free the cage without a kill-all requirement, optionally recover a chest, and return to the forge. Wren has one residence and moves to the forge when reported. A changed target can be replaced. There are no silent deadlines.
- Main and optional objectives, durable evidence, destination markers, report requirements and selectable gear rewards. Full inventory retains the pending reward. Clan gold pays once per contract; eligible heroes can claim their own item once.
- Four encounter arrangements with three seeded variations: guarded doorway, crossfire, alarm position and occupied courtyard. Lairs are selected from reachable floor, and additions preserve exits. Locked rooms retain their original key route; suitable rooms also receive a breakable alternate entrance and a winch.
- Destructible pitch barrels damage nearby players and creatures and briefly burn creatures. Walls stop the blast. Signal braziers can be destroyed; activation uses the existing saved reinforcement budget. Reinforcements never spawn indefinitely.
- Lanterns toggle actual detection, with a visible unlit form. Sneaking slows the hero and reduces sleeping ordinary enemies' detection in darkness; walls block initial detection. Attacking reveals the hero. Alert enemies retain awareness; bosses do not become trivial to bypass.
- The apprentice's bench and approach-road projects consume real stockpile resources once. The bench changes the forge and unlocks commissions; the road project upgrades existing dirt road without overwriting structures. Clearing working mines restores their native production rules.
- Earned titles appear in the inventory. Adventure trophies can be displayed in owned houses or halls. One persistent steady trait can be trained per owned horse at its stable, costing 20 gold and five grain; riding happiness then falls 15% more slowly.
- One personal companion: Ser Alden (guard), Neri Bow (ranger), or Mother Aveline (healer), recruited near their real residence for 50 gold after the apprentice adventure. Follow, Hold and Retreat; armoury refitting; real world actors; authoritative room movement, attacks and healing. Interior actors are removed from the overworld rather than duplicated. Injury replaces permanent death, with recovery at the forge after a day. Companions and equipment survive saving.

## Practical gear and tradeoffs

| Item | Benefit | Drawback |
| --- | --- | --- |
| Counterweight sword | Longer perfect-block counter opportunity | -10 damage bonus points |
| Long ash spear | One extra target in the thrust line | -12% attack speed |
| Breaching axe | Double heavy-blow damage to breakables | +0.2 seconds recovery |
| Yew hunting bow | Charged arrows pierce an extra target | Quick shots deal 15% less damage |
| Steady round shield | Perfect-block window extends one tick | -4% movement speed |
| Wayfarer boots | Dodge recovers four ticks sooner | +6% damage taken |

Effects require the correctly equipped item kind and slot. Ordinary gear, army stats and material tiers are unchanged. Boots use the existing legs slot. Benefits and drawbacks are shown before choosing a reward and on item tooltips. Learned commissions use the existing personal blacksmith crafting system and its skill, input, interruption and capacity checks.

## Persistence and cost

Bound contract coordinates, claims, evidence, projects, recipes and trophies use the existing versioned hero-life flags. Companion records have their own version 1 record in saved hero profiles; horse training uses the saved animal record. Existing named-cast residence generation remains cached. Projects derive safe cached room improvements from saved facts. Only active rooms run alarms, detection, hazards or companion combat. There is no new global quest simulation, lighting simulation or world path search per frame. Companion room searches are bounded and throttled.

## Verification

- Server and client TypeScript checks.
- 27 new regression scenarios, including full bags, remote/malformed claims, co-op payouts, actual equipment effects, 120 seeded layouts, devices, capped reinforcements, JSON saves, all companion roles and horse training.
- Existing adventures: 40 layout checks, twenty boss profiles and all 120 stages of the ten long stories, including their real workstation outputs and services.
- Existing player combat, hero, spells, forest columns, smoke/startup, interiors, layered mines, personal workstations, save/load and delta snapshots.
- Livestock recall failed once in the combined run; the frozen baseline and an isolated candidate repeat both passed. Retained as an intermittent test concern.
- Browser: accepted and tracked the real journal action; used E to pick up the camp key and open the cage; reported at the forge; selected and equipped the sword; verified the earned title and changed damage multiplier; no browser console errors.
- Repeated 300-versus-300 matched battle samples: live baseline mean 9.95 ms and mean p95 16.32 ms; candidate mean 9.71 ms and mean p95 16.36 ms. Random actor IDs and contact patterns differ, so this supports no material regression rather than a speedup or a guarantee of 100 FPS.

These are initial content and balance values. Travel time depends on world size and the hero's distance from the issuer. Combat support uses existing class artwork; no new sprite sheets were generated for this release.
