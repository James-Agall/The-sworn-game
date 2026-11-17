# NPC-style hero animation sheets

560 outline-isolated poses from the approved eight sheets. Each atlas is 10 columns by 7 rows of 256x240 cells.
Foot ground anchor (120,163); mounted (120,211); nominal standing body height 89. Foot canvases crop to 256x192.
Rows: sword, sword/shield, spear, spear/shield, axe, axe/shield, bow.
Columns: idle 0-1, walk 2-5, attack 6-8, hurt 9. Hurt contains the authored crimson splash.
Rebuild with `node scripts/slice-npc-hero.mjs SOURCE_DIRECTORY OUTPUT_DIRECTORY`; SOURCE_DIRECTORY contains the generated eight PNGs and layout.json.
The slicer segments connected outlines globally before assigning rows/columns, avoiding nominal-grid cuts through weapons and horses. Each row uses one scale from its idle body, consistent ground anchors and torso-centred horizontal alignment. It does not resize the body for each swing.

Runtime uses npcHero.ts through the shared heroFrame entrypoint, including creator, world and interior views.
The pack contains one fixed male appearance and bay mount; other colours/hair/faces are not represented in these sheets.
The rig remains a fallback for females, unarmed/tool poses, missing assets and independently mixed gear tiers/helmet combinations not present in the pack. This prevents silently drawing the wrong equipped helmet or weapon tier.
The old art files are retained for those fallbacks; they are no longer the primary path for matching male loadouts.
No live deployment.

2026-11-17: Corrected spear/shield attack cells (row 3, columns 6–8) across all armour and mount states. Each spear is gripped by one hand; shield hand is concealed. The aligned correction source is scripts/rig-layouts/hero-spear-shield-correction.png and slice-npc-hero.mjs reapplies it automatically.
