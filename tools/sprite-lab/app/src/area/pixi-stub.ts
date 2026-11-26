// Stand-in for "pixi.js" in the Lab's Vite build only (server/lab.ts alias). The Area tab imports the game's tile-art
// TABLES from client/src/worldVisuals.ts / spriteRegistry.ts; those files also hold texture helpers that import pixi,
// which the Lab never calls (it draws the same PNG files with a 2D canvas). Any use throws, so nothing silently differs.
const nope = (name: string) => new Proxy({}, { get: (_t, k) => { if (k === Symbol.toPrimitive || k === "then") return undefined; throw new Error(`pixi.js.${name}.${String(k)} is not available in the Sprite Lab`); } });
export const Assets = nope("Assets");
export const Texture = nope("Texture");
export class Rectangle { constructor() { throw new Error("pixi.js Rectangle is not available in the Sprite Lab"); } }
