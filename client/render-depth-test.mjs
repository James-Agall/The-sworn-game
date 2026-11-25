import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p=spawn(path.join(root,'node_modules/.bin/tsx'),[path.join(root,'client/render-depth-test.ts')],{cwd:root,stdio:'inherit'});
process.exit(await new Promise(resolve=>p.on('close',resolve))??1);
