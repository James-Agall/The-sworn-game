// Example piece: a knight's helmet in the game's painted style, to compare with the helmet of heroes/champion-01.
// node helm.mjs <out dir>
import { Canvas, M } from "../paint.mjs";
const out = process.argv[2] || ".";
const c = new Canvas(36, 34);
const steel = M.metal("#8e8a8c");
// dome and back of the head
c.shape({ ellipse: [17, 14, 13.5, 13] }, { ...steel, round: 7, rim: 2.2 });
// lower face guard: a rounded plate jutting a little forward
c.shape({ poly: [[5, 18], [29, 18], [31, 29], [24, 33], [11, 33], [6, 27]] }, { ...steel, base: "#7d797b", round: 5, rim: 2.0 });
// brim ridge between dome and guard
c.shape({ rect: [4.5, 16.4, 25, 3.2, 1.6] }, { ...M.metal("#a39ea0"), round: 1.8, rim: 1.4 });
// the visor slit and breath holes: dark, flat
c.flat({ rect: [14, 19.6, 15, 2.4, 1] }, "#15100f", 1);
for (const [x, y] of [[22, 25], [25, 26.5], [22, 28], [25, 29.5]]) c.flat({ ellipse: [x, y, 0.9, 0.9] }, "#1b1514", 0.95);
// vertical crest line and a soft specular on the dome
c.flat({ line: [17, 3.5, 17.4, 16, 1.2] }, "#5f5a5d", 0.55);
c.flat({ ellipse: [11.5, 9, 3.2, 4.6, -25] }, "#f4eeea", 0.55);
c.flat({ ellipse: [10.2, 7.6, 1.4, 2, -25] }, "#ffffff", 0.7);
// rivets
for (const [x, y] of [[8, 17.8], [17, 17.8], [27, 17.8]]) { c.flat({ ellipse: [x, y, 0.8, 0.8] }, "#d8d2d0", 0.9); }
c.save(out + "/helm.png");
console.log("wrote", out + "/helm.png");
