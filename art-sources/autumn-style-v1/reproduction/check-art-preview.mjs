import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire('/home/james/projects/auto-loan-ff-release/package.json');
const {chromium}=require('playwright');
const repo='/home/james/projects/colony2d';
const output='/mnt/c/Users/maxim/Documents/Codex/2026-11-10/go-x20/outputs';
const free=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const gamePort=await free(),webPort=await free();
const save=mkdtempSync(tmpdir()+'/colony-art-preview-');
const server=spawn(repo+'/node_modules/.bin/tsx',['src/index.ts'],{cwd:repo+'/server',env:{...process.env,PORT:String(gamePort),COLONY_SAVE_DIR:save,COLONY_TEST_HOOKS:'1',COLONY_UNLOCK_ALL:'1',COLONY_WORLD_SEED:'20261110'},stdio:['ignore','pipe','pipe']});
const vite=spawn(process.execPath,[repo+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(webPort),'--strictPort'],{cwd:repo+'/client',stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);vite.stderr.on('data',b=>logs+=b);vite.stdout.on('data',b=>logs+=b);
let browser;
const report={gamePort,webPort,save,errors:[],failedImages:[]};
try{
 for(let i=0;i<80;i++){try{await fetch(`http://127.0.0.1:${webPort}`);break}catch{await new Promise(r=>setTimeout(r,250))}}
 browser=await chromium.launch({headless:true,executablePath:'/home/james/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('response',r=>{if(r.url().includes('/sprites/')&&r.status()>=400)report.failedImages.push({url:r.url(),status:r.status()})});
 await page.goto(`http://127.0.0.1:${webPort}/sprite-preview.html`);
 await page.waitForFunction(()=>window.artLibraryReady);
 await page.waitForTimeout(2500);
 await page.screenshot({path:output+'/cave-runtime-preview.png',fullPage:false});
 report.libraryReady=true;
 console.log('Asset library rendered');
 await page.addInitScript(port=>{
  const Original=window.WebSocket;
  window.WebSocket=class extends Original{
   constructor(url,protocols){super(String(url).replace('localhost:8080',`127.0.0.1:${port}`),protocols);window.artSocket=this;this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='welcome')window.artWelcome=m;if(m.type==='snapshot')window.artSnapshot=m}catch{}})}
  };
 },gamePort);
 await page.goto(`http://127.0.0.1:${webPort}/?mode=creative`);
 await page.locator('#menu-creative').click();
 await page.waitForFunction(()=>window.artWelcome&&window.artSnapshot,{},{timeout:120000});
 await page.waitForTimeout(3000);
 report.gameReady=true;
 console.log('Game loaded on private server');
 await page.evaluate(()=>{
  const p=window.artSnapshot.players?.[0];if(!p)return;
  ['knight','archer','militia','cavalry','builder','farmer'].forEach((kind,i)=>window.artSocket.send(JSON.stringify({type:'creativeSpawn',side:'own',kind,count:1,x:p.x+(i-2)*40,y:p.y+50,formation:'line',level:1,gear:1,stance:'defensive'})));
 });
 await page.waitForTimeout(2500);
 await page.screenshot({path:output+'/game-autumn-preview.png'});
 report.visibleCanvas=await page.locator('canvas').count();
 report.spriteResponsesFailed=report.failedImages.length;
 writeFileSync(output+'/browser-art-check.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(e){report.errors.push(String(e));writeFileSync(output+'/browser-art-check.json',JSON.stringify(report,null,2));writeFileSync(output+'/browser-art-check.log',logs);throw e}
finally{await browser?.close();server.kill('SIGTERM');vite.kill('SIGTERM')}
