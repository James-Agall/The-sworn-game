// This suite creates an isolated in-memory world, never a live server or user saves.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p=spawn(path.join(root,'node_modules/.bin/tsx'),[path.join(root,'server/interactions-test.ts')],{cwd:root,env:{...process.env,COLONY_WORLD_SIZE:'512'},stdio:'inherit'});
const code=await new Promise(resolve=>p.on('close',resolve));process.exit(code??1);
