import { TILE_SIZE, type MobKind } from './protocol.js';

export type CombatWeapon = 'unarmed' | 'sword' | 'axe' | 'spear' | 'bow';
export interface CombatStrike {
  weapon: CombatWeapon; heavy: boolean; mounted: boolean; ranged: boolean;
  angle: number; reach: number; width: number; arc: number; maxTargets: number;
  damageMult: number; windup: number; recovery: number; guardBreak: boolean;
}
export interface CombatLive {
  phase: 'charge' | 'windup' | 'recovery' | 'guard' | 'dodge' | 'ready';
  angle: number; progress: number; heavy: boolean; weapon: CombatWeapon;
  dodgeCooldown: number; counter?: boolean;
  feedback?: 'block' | 'parry' | 'guardBreak';
}
export type DuelStyle = 'reckless' | 'defender' | 'keeper' | 'archer';
export interface DuelLive {
  phase: 'windup' | 'recovery' | 'stagger' | 'guard'; style: DuelStyle;
  x: number; y: number; angle: number; reach: number; progress: number;
}
export const COMBAT_CHARGE_TICKS = 8;
export const COMBAT_MAX_CHARGE_TICKS = 22;
export const COMBAT_BUFFER_TICKS = 3;
export const COMBAT_DODGE_TICKS = 4;
export const COMBAT_DODGE_COOLDOWN = 30;
export function combatWeapon(kind?: string): CombatWeapon {
  return kind === 'sword' || kind === 'axe' || kind === 'spear' || kind === 'bow' ? kind : 'unarmed';
}
export function attackSpec(weapon: CombatWeapon, heavy = false, mounted = false, angle = 0, speed = 1): CombatStrike {
  const rows = {
    unarmed: [heavy ? 34 : 30, .95, 10, 1, heavy ? 1.4 : 1, heavy ? 5 : 3, heavy ? 10 : 7],
    sword: [44, 1.95, 12, 3, heavy ? 1.5 : 1, heavy ? 6 : 3, heavy ? 11 : 7],
    axe: [42, 1.65, 12, heavy ? 3 : 2, heavy ? 1.75 : 1, heavy ? 10 : 5, heavy ? 16 : 10],
    spear: [heavy ? 82 : 64, .6, heavy ? 9 : 7, heavy ? 2 : 1, heavy ? 1.5 : 1, heavy ? 7 : 4, heavy ? 12 : 8],
    bow: [TILE_SIZE * (heavy ? 7 : 5), .12, 6, 1, heavy ? 1.6 : 1, heavy ? 2 : 5, heavy ? 10 : 8],
  }[weapon];
  return { weapon, heavy, mounted, ranged: weapon === 'bow', angle, reach: rows[0] + (mounted && weapon !== 'bow' ? 8 : 0),
    arc: rows[1], width: rows[2], maxTargets: rows[3], damageMult: rows[4],
    windup: Math.max(2, Math.round(rows[5] / Math.max(.5, speed))), recovery: Math.max(4, Math.round(rows[6] / Math.max(.5, speed))),
    guardBreak: heavy && weapon === 'axe' };
}
export function facingPoint(angle: number, from: {x:number;y:number}, target: {x:number;y:number}, halfArc = 1.2): boolean {
  const dx=target.x-from.x, dy=target.y-from.y, d=Math.hypot(dx,dy);
  return d < .01 || (dx*Math.cos(angle)+dy*Math.sin(angle))/d >= Math.cos(halfArc);
}
export function strikeContains(s: CombatStrike, from:{x:number;y:number}, at:{x:number;y:number}, radius=8):boolean {
  const dx=at.x-from.x,dy=at.y-from.y,d=Math.hypot(dx,dy),along=dx*Math.cos(s.angle)+dy*Math.sin(s.angle);
  if(d>s.reach+radius||along < -radius*.25)return false;
  if(s.weapon==='spear'||s.ranged)return along>=0&&along<=s.reach+radius&&Math.abs(-dx*Math.sin(s.angle)+dy*Math.cos(s.angle))<=s.width+radius;
  return d<radius||along/d>=Math.cos(s.arc/2+Math.asin(Math.min(.5,radius/Math.max(radius,d))));
}
export function duelStyle(kind: MobKind, ranged=false):DuelStyle {
  if(ranged)return 'archer';
  if(kind==='armoredOrc'||kind==='banditElite'||kind==='townKnight')return 'defender';
  if(kind==='goblinRider'||kind==='skeleton'||kind==='townGuard')return 'keeper';
  return 'reckless';
}
