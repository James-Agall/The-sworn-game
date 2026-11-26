// --import this after tsx (see alias-hooks.mjs).
import { register } from "node:module";
register(new URL("./alias-hooks.mjs", import.meta.url));
