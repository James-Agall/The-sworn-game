// Loads the Lab's Area model (shared/area.ts), which imports the GAME'S shared code (shared/src/*.ts of this repo), in
// Node. Node's built-in type stripping cannot run that code (enums, ".js" specifiers for ".ts" files), so it goes
// through tsx's tsImport (the repo's own tsx, an isolated loader: nothing else in the Lab process is affected).
import { tsImport } from "tsx/esm/api";

export type AreaModule = typeof import("../shared/area.ts");
let cached: Promise<AreaModule> | null = null;
export function loadArea(): Promise<AreaModule> {
  cached ??= tsImport("../shared/area.ts", import.meta.url) as Promise<AreaModule>;
  return cached;
}
