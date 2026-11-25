// Opt-in diagnostics (?perf=1). All clocks, samples and GPU queries stay dormant otherwise.
import type { Application } from 'pixi.js';
export interface PerfProbe {
 onSnapshot(bytes:number,parseMs:number):void;
 setScene(units:number,children:number):void;
 setRenderStats(total:number,visible:number,floors:number,covers:number):void;
 now():number;
 phase(name:string,start:number):void;
 setQueue(chunks:number):void;
}
const NOOP:PerfProbe={onSnapshot(){},setScene(){},setRenderStats(){},now(){return 0;},phase(){},setQueue(){}};
export function initPerfOverlay(app:Application):PerfProbe {
 if(new URLSearchParams(location.search).get('perf')!=='1')return NOOP;
 const el=document.createElement('pre');
 el.style.cssText='position:fixed;left:6px;top:6px;z-index:99999;margin:0;padding:6px 8px;background:rgba(0,0,0,.78);color:#9f9;font:11px/1.35 monospace;pointer-events:none;white-space:pre;border-radius:4px';
 document.body.appendChild(el);
 const keydown=(e:KeyboardEvent)=>{if(e.key==='p'&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement))el.hidden=!el.hidden;};
 window.addEventListener('keydown',keydown);
 const frames:number[]=[],gaps:number[]=[],parses:number[]=[],sizes:number[]=[],cpu:number[]=[],draw:number[]=[],gpu:number[]=[];
 const phases=new Map<string,number[]>(),longTasks:{at:number;ms:number}[]=[];
 let lastSnapAt=0,units=0,children=0,queue=0,renderStats='',frameAt=0,drawAt=0,renderDepth=0,gpuFrame=0;
 const push=(a:number[],v:number,max=240)=>{a.push(v);if(a.length>max)a.shift();};
 const avg=(a:number[])=>a.length?a.reduce((a,b)=>a+b,0)/a.length:0;
 const percentile=(a:number[],p:number)=>{const sorted=a.slice().sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;};
 const worst=(a:number[])=>a.length?Math.max(...a):0;
 let observer:PerformanceObserver|undefined;
 try{observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({at:performance.now(),ms:e.duration});});observer.observe({entryTypes:['longtask']});}catch{/* Optional browser API. */}
 // Never wait for GPU results. Read a result only once the driver says it is available.
 const gl=(app.renderer as unknown as {gl?:WebGL2RenderingContext}).gl;
 const ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2') as {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}|null|undefined;
 const pending:WebGLQuery[]=[];let active:WebGLQuery|null=null;
 const renderProbe={
  prerender(){
   if(renderDepth++>0)return;
   drawAt=performance.now();
   if(!gl||!ext||gl.isContextLost())return;
   const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
   while(pending.length&&(disjoint||gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE))){
    const q=pending.shift()!;if(!disjoint)push(gpu,gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);
   }
   if(++gpuFrame%30!==0||pending.length>=4||gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return;
   active=gl.createQuery();if(active)gl.beginQuery(ext.TIME_ELAPSED_EXT,active);
  },
  postrender(){
   if(--renderDepth>0)return;
   if(active&&gl&&ext){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null;}
   push(draw,performance.now()-drawAt);
  },
 };
 app.renderer.runners.prerender.add(renderProbe);app.renderer.runners.postrender.add(renderProbe);
 const begin=()=>{frameAt=performance.now();};
 const end=()=>{push(cpu,performance.now()-frameAt);push(frames,app.ticker.elapsedMS);};
 app.ticker.add(begin,undefined,1000);app.ticker.add(end,undefined,-1000);
 const timer=window.setInterval(()=>{
  const now=performance.now();while(longTasks.length&&now-longTasks[0].at>10000)longTasks.shift();
  const fa=avg(frames),phaseRows=Array.from(phases,([name,a])=>`${name} ${avg(a).toFixed(2)} / ${percentile(a,.95).toFixed(2)} ms`).join('  ');
  el.textContent=`frame ${fa.toFixed(1)} ms avg (${fa>0?(1000/fa).toFixed(0):'-'} fps) p50 ${percentile(frames,.5).toFixed(1)} p95 ${percentile(frames,.95).toFixed(1)} p99 ${percentile(frames,.99).toFixed(1)}\n`+
   `CPU ${avg(cpu).toFixed(2)} avg / ${percentile(cpu,.95).toFixed(2)} p95 ms  draw ${avg(draw).toFixed(2)} ms  GPU ${gpu.length?avg(gpu).toFixed(2)+' ms':'n/a'} (100 fps budget 10 ms)\n`+
   `snap gap ${avg(gaps).toFixed(0)} ms avg / ${worst(gaps).toFixed(0)} worst  parse ${avg(parses).toFixed(2)} ms / ${percentile(parses,.95).toFixed(2)} p95  ${(avg(sizes)/1024).toFixed(0)} KB\n`+
   `phases avg / p95: ${phaseRows}\nlong ${longTasks.length} tasks >50 ms / 10 s; worst ${worst(longTasks.map(t=>t.ms)).toFixed(0)} ms; chunk jobs ${queue}\nscene ${units} units; ${children} active objects\n${renderStats}`;
 },500);
 app.renderer.runners.destroy.add({destroy(){window.clearInterval(timer);observer?.disconnect();window.removeEventListener('keydown',keydown);app.ticker.remove(begin);app.ticker.remove(end);if(gl)for(const q of pending)gl.deleteQuery(q);el.remove();}});
 return{
  now:()=>performance.now(),
  phase(name,start){let a=phases.get(name);if(!a)phases.set(name,a=[]);push(a,performance.now()-start);},
  setQueue(n){queue=n;},
  onSnapshot(bytes,parseMs){const now=performance.now();if(lastSnapAt)push(gaps,now-lastSnapAt,60);lastSnapAt=now;push(parses,parseMs,60);push(sizes,bytes,60);},
  setRenderStats(total,visible,floors,covers){renderStats=`scenery ${visible}/${total} active; floors ${floors}; hero occluders ${covers}`;},
  setScene(u,c){units=u;children=c;},
 };
}
