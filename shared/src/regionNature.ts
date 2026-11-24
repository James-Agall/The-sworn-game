export const REGION_NATURE_NAMES=['pine','oak','birch','willow','reeds','marsh','bridge-h','bridge-v','cage','tent'] as const;
export const REGION_NATURE_URLS=REGION_NATURE_NAMES.map(n=>`/sprites/regions-v2/${n}.png`);
export function treeSpeciesAt(x:number,y:number,swamp=false):'pine'|'oak'|'birch'|'willow'{
 if(swamp)return 'willow';const h=(Math.imul(x+71,19349663)^Math.imul(y+29,73856093))>>>0;return ['pine','oak','birch'][h%3] as 'pine'|'oak'|'birch';
}
