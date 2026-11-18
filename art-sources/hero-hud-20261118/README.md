# Hero HUD artwork
Generated with the built-in image-generation tool on 2026-11-18. The six-cell atlas contains heart, stomach, rest moon, backpack, empty armour stand and spellbook. Assets are nearest-neighbour slices, consumed by vitals.ts and the inventory UI. Alpha is retained.

Prompt: one transparent 3-column by 2-row atlas for a grounded medieval pixel-art game HUD. Anatomically recognizable red heart with aorta, coronary vessels and two drops; pink stomach; silver-blue resting moon; worn leather backpack; empty front-facing wooden armour stand; simple leather spellbook. Dark outlines, visible pixels, moderate detail, muted autumn palette; no labels, scenery or gold ornaments. A second built-in edit removed the light background while preserving the objects and cell positions.

Runtime meters clip the coloured image from top to bottom over a dim silhouette, using server health/food/rest values. Small blood-drip motion respects reduced-motion settings. Item and spell equip actions reuse the authoritative existing server messages. Resource carrying mechanics are unchanged; the contents now appear in Stockpile.
