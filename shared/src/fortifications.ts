import { TileType as T } from './protocol.js';
export const FORT_BUILDABLE = [T.Rampart,T.WallLadder,T.LargeGateH,T.LargeGateV,T.WideBridgeH,T.WideBridgeV] as const;
export const FORT_GATES = [T.LargeGateH,T.LargeGateHPart,T.LargeGateV,T.LargeGateVPart,T.WideBridgeH,T.WideBridgeHPart,T.WideBridgeV,T.WideBridgeVPart] as const;
export const isFortPart=(t:number)=>[T.LargeGateHPart,T.LargeGateVPart,T.WideBridgeHPart,T.WideBridgeVPart].includes(t);
export const isLargeGate=(t:number)=>t>=T.LargeGateH&&t<=T.LargeGateVPart;
export const isWideBridge=(t:number)=>t>=T.WideBridgeH&&t<=T.WideBridgeVPart;
export const isFortification=(t:number)=>t>=T.Rampart&&t<=T.WideBridgeVPart;
export function fortPartner(t:number):{dx:number;dy:number;tile:T}|undefined{if(t<T.LargeGateH||t>T.WideBridgeVPart)return;const part=isFortPart(t),vertical=t===T.LargeGateV||t===T.LargeGateVPart||t===T.WideBridgeV||t===T.WideBridgeVPart;return{dx:vertical?0:part?-1:1,dy:vertical?(part?-1:1):0,tile:(part?t-1:t+1) as T};}
export function fortAnchor(at:(x:number,y:number)=>number,x:number,y:number){const t=at(x,y),p=fortPartner(t);return isFortPart(t)&&p?{x:x+p.dx,y:y+p.dy}:{x,y};}
export const wallConnects=(t:number)=>[T.Wall,T.StoneWall,T.Gate,T.WoodDoor,T.StoneDoor,T.WoodWindow,T.StoneWindow,T.Rampart,T.WallLadder].includes(t)||isLargeGate(t);
export const moatConnects=(t:number)=>t===T.Moat||t===T.Drawbridge||isWideBridge(t);
export function connectionMask(at:(x:number,y:number)=>number,x:number,y:number,joins:(t:number)=>boolean){return(joins(at(x,y-1))?1:0)|(joins(at(x+1,y))?2:0)|(joins(at(x,y+1))?4:0)|(joins(at(x-1,y))?8:0);}
// Walls are reached through ladder/gate access cells, never by crossing a vertical side.
export function rampartTransition(from:number,to:number){const access=(t:number)=>t===T.WallLadder||isLargeGate(t);return from===T.Rampart?to===T.Rampart||access(to):to!==T.Rampart||access(from);}
export const wallWalkLift=(t:number)=>t===T.Rampart||isLargeGate(t)?16:0;
