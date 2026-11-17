// Example piece: a longsword (blade pointing up-right at the same angle as heroes/base-05's raised sword) for comparison.
import { Canvas, M } from "../paint.mjs";
const out = process.argv[2] || ".";
const c = new Canvas(52, 44);
// built along a straight axis then drawn at the angle: here simply drawn diagonally with polygons
const blade = [[9, 37], [14, 29], [44, 4], [49, 6], [47, 13], [18, 38]];
c.shape({ poly: blade }, { ...M.metal("#cdd0d4"), round: 3.2, rim: 2.0, contrast: 1.6 });
c.flat({ line: [16, 31, 44, 8, 1.1] }, "#f7f4ee", 0.85);          // fuller highlight
c.flat({ line: [18, 35.5, 46, 11.5, 0.8] }, "#7a7e86", 0.45);      // shadow side
// crossguard (gold) and grip (leather) and pommel
c.shape({ poly: [[5, 36], [12, 28], [16, 32], [10, 39]] }, { ...M.gold(), round: 2, rim: 1.5 });
c.shape({ capsule: [8.5, 36.5, 3.2, 42, 2.2, 2.2] }, { ...M.leather("#6f4326"), round: 2, rim: 1.5 });
c.shape({ ellipse: [2.6, 42, 2.6, 2.6] }, { ...M.gold(), round: 2, rim: 1.4 });
c.save(out + "/sword.png");
console.log("wrote", out + "/sword.png");
