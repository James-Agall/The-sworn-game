import {TileType} from './protocol.js';
export const LANDMARK_ART:Partial<Record<TileType,{url:string;w:number;h:number}>>={
 [TileType.BanditTent]:{url:'/sprites/regions-v2/tent.png',w:3.1,h:3},
 [TileType.BanditHall]:{url:'/sprites/regions-v2/tent.png',w:4.3,h:4},
 [TileType.CaveEntrance]:{url:'/sprites/regions-v4/great-cave.png',w:8,h:8},
 [TileType.CampEntrance]:{url:'/sprites/regions-v4/bandit-gate.png',w:3.3,h:3.5},
 [TileType.CampSideEntrance]:{url:'/sprites/regions-v4/bandit-gate.png',w:3.3,h:3.5},
 [TileType.RuinTower]:{url:'/sprites/regions-v4/ruin-tower.png',w:3.6,h:5},
 [TileType.RuinMasonry]:{url:'/sprites/regions-v4/ruin-masonry.png',w:3.1,h:3},
 [TileType.SkullBones]:{url:'/sprites/regions-v4/skulls.png',w:.85,h:.7},
 [TileType.FallenSkeleton]:{url:'/sprites/regions-v4/skeleton.png',w:1.4,h:.8},
 [TileType.Cobweb]:{url:'/sprites/regions-v4/web.png',w:1.5,h:1.1},
 [TileType.Overgrowth]:{url:'/sprites/regions-v4/brambles.png',w:1.5,h:1.2},
 [TileType.BanditTower]:{url:'/sprites/regions-v4/watchtower.png',w:2.5,h:4.2},
};
export const LANDMARK_ART_URLS=[...new Set(Object.values(LANDMARK_ART).map(a=>a!.url))];
