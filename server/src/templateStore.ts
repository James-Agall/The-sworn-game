// templateStore.ts: a JSON template store (built-ins in server/data/<kind>/*.json, a broken one fails the boot; the
// creative editor's user templates in server/data/<kind>/user/*.json, with COLONY_TEST_HOOKS=1 a <kind>-user folder
// in COLONY_SAVE_DIR so tests never write into the repo; an env override beats both). The same rules as the camp
// store (camps.ts), shared by the building and settlement templates.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAVE_DIR } from "./constants.js";

export interface StoreOpts<T extends { id: string; builtin?: boolean }> {
  // Folder name under server/data and in log lines ("buildings").
  kind: string;
  // Env var that overrides the user folder.
  userEnv: string;
  validate(raw: unknown): string[];
  // Only the known fields (a hand-edited file may carry notes).
  normalise(raw: T): T;
}

export interface TemplateStore<T extends { id: string; builtin?: boolean }> {
  load(): { builtins: number; users: number };
  all(): T[];
  byId(id: string): T | undefined;
  save(raw: unknown): string | null;
  remove(id: string): string | null;
  userDir(): string;
}

export function makeTemplateStore<T extends { id: string; builtin?: boolean }>(o: StoreOpts<T>): TemplateStore<T> {
  const builtinDir = fileURLToPath(new URL(`../data/${o.kind}/`, import.meta.url));
  const userDir = () => {
    if (process.env[o.userEnv]) return path.resolve(process.env[o.userEnv]!);
    if (process.env.COLONY_TEST_HOOKS === "1") return path.join(SAVE_DIR, `${o.kind}-user`);
    return path.join(builtinDir, "user");
  };
  const readDir = (dir: string, strict: boolean): T[] => {
    if (!existsSync(dir)) return [];
    const out: T[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
      try {
        const raw = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        const errs = o.validate(raw);
        if (errs.length > 0) throw new Error(errs.join("; "));
        out.push(o.normalise(raw));
      } catch (err) {
        if (strict) throw new Error(`${o.kind} template ${f}: ${(err as Error).message}`);
        console.warn(`[${o.kind}] skipping user template ${f}: ${(err as Error).message}`);
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  let builtins: T[] | null = null;
  let users: T[] | null = null;
  const ensure = () => {
    if (!builtins) {
      builtins = readDir(builtinDir, true);
      if (builtins.length === 0) throw new Error(`no ${o.kind} templates in ${builtinDir}`);
    }
    if (!users) {
      const ids = new Set(builtins.map((t) => t.id));
      users = readDir(userDir(), false).filter((t) => {
        if (ids.has(t.id)) console.warn(`[${o.kind}] user template ${t.id} shadows a built-in: skipped`);
        return !ids.has(t.id);
      });
    }
  };
  const all = () => {
    ensure();
    return [...builtins!.map((t) => ({ ...t, builtin: true })), ...users!];
  };
  return {
    load() {
      builtins = null;
      users = null;
      ensure();
      return { builtins: builtins!.length, users: users!.length };
    },
    all,
    byId: (id) => all().find((t) => t.id === id),
    save(raw) {
      const errs = o.validate(raw);
      if (errs.length > 0) return errs.join("; ");
      const t = o.normalise(raw as T);
      ensure();
      if (builtins!.some((b) => b.id === t.id)) return `"${t.id}" is a built-in template: save it under another id (Duplicate)`;
      const dir = userDir();
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${t.id}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify(t, null, 2) + "\n");
      renameSync(`${file}.tmp`, file);
      users = null;
      return null;
    },
    remove(id) {
      ensure();
      if (builtins!.some((b) => b.id === id)) return "Built-in templates can't be deleted";
      if (!users!.some((u) => u.id === id)) return `No user template "${id}"`;
      rmSync(path.join(userDir(), `${id}.json`), { force: true });
      users = null;
      return null;
    },
    userDir,
  };
}
