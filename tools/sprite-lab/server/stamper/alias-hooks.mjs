// Module resolve hook for the stamp worker: @colony/shared/<x> -> THIS repo's shared/src/<x>.ts (the root
// node_modules/@colony/shared link may point at another checkout). Registered after tsx, so it runs first.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../shared/src");

export async function resolve(specifier, context, next) {
  const m = /^@colony\/shared(?:\/(.+))?$/.exec(specifier);
  if (m) return { url: pathToFileURL(path.join(SHARED, (m[1] ?? "index") + ".ts")).href, shortCircuit: true };
  return next(specifier, context);
}
