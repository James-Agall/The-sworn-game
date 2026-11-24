import {TileType} from './protocol.js';
export const TOWN_INDUSTRY_STYLES=['hearthmoor','ironhold','riverwatch'] as const;
export const TOWN_INDUSTRY_ART:Partial<Record<TileType,string>>={
 [TileType.Blacksmith]:'blacksmith',[TileType.Bloomery]:'bloomery',[TileType.BuildersGuild]:'carpenter',
 [TileType.Bakery]:'brewery',[TileType.TailorShop]:'tailor',[TileType.Brewery]:'brewery',[TileType.BarnPost]:'barn',
};
export const TOWN_INDUSTRY_URLS=TOWN_INDUSTRY_STYLES.flatMap(s=>Object.values(TOWN_INDUSTRY_ART).map(n=>`/sprites/towns-v2/industry/${s}-${n}.png`));
export function townIndustryUrl(tile:number,style:string|undefined){
 const name=TOWN_INDUSTRY_ART[tile as TileType];
 return name&&TOWN_INDUSTRY_STYLES.some(s=>s===style)?`/sprites/towns-v2/industry/${style}-${name}.png`:undefined;
}
