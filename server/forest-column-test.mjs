import {spawnSync} from 'node:child_process';
const r=spawnSync(process.execPath,['--import','tsx','forest-column-regression.mts'],{cwd:import.meta.dirname,env:{...process.env,COLONY_TEST_HOOKS:'1'},stdio:'inherit'});process.exit(r.status??1);
