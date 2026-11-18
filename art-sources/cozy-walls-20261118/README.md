# Cosy timber interior walls
Generated using the built-in image generation tool, 18 November 2026, with the user's supplied cosy pixel-art room as a style reference. The source atlas has genuine alpha. Sliced and sized into 12 reusable sprites; no backgrounds were painted over.

Prompt: create a production pixel-art interior house wall atlas, 4 columns x 3 rows, transparent, no text or furniture. Match cosy golden timber panelling, warm brown outlines, amber highlights, chunky readable pixels. Flat square X/Y grid, no isometric geometry. Row 1: plain panel, glowing window, framed landscape, supporting beam. Row 2: horizontal cap, vertical cap, L corner, T junction. Row 3: doorway, left jamb, right jamb, timber-framed plaster panel. Keep piece scale consistent and transparent gutters between pieces.

Run `node art-sources/cozy-walls-20261118/slice.mjs`, then `node scripts/pack-atlas.mjs`. House renderer uses front-facing panels, windows and pictures with low side/front rails; flat wood floors run vertically like the reference. Exterior building walls are unaffected.
