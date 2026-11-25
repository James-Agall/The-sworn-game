// Each suite creates an isolated in-memory world, with no live server or user saves.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const name of ['layout','boss','gameplay']){
 const proc=spawn(path.join(root,'node_modules/.bin/tsx'),[path.join(root,`server/adventure-${name}-test.ts`)],{cwd:root,env:{...process.env,COLONY_WORLD_SIZE:'512'},stdio:'inherit'});
 const code=await new Promise(r=>proc.on('close',r));if(code!==0)process.exit(code??1);
}
