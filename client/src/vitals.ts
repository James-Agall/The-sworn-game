export type VitalKind = 'health' | 'food' | 'rest' | 'energy';
let healthState: {value:number;text?:string} = {value:100};
const art: Record<VitalKind, string> = { health:'heart', food:'stomach', rest:'rest', energy:'rest' };
export function vitalMeter(kind: VitalKind, label: string, value: number): HTMLElement {
  const el = document.createElement('div');
  el.className = `vital vital-${kind}`;
  el.dataset.vital = kind;
  el.setAttribute('role','meter');
  el.setAttribute('aria-label',label);
  el.setAttribute('aria-valuemin','0');
  el.setAttribute('aria-valuemax','100');
  const url = `/sprites/hero-hud/${art[kind]}.png`;
  el.innerHTML = `<div class="vital-art"><img class="vital-empty" src="${url}" alt=""><img class="vital-fill" src="${url}" alt="">${kind==='health'?'<i class="blood-drop"></i>':''}</div><span class="vital-label">${label}</span><strong class="vital-value"></strong>`;
  setVital(el,kind==='health'?healthState.value:value,kind==='health'?healthState.text:undefined);
  return el;
}
const lastValues=new WeakMap<HTMLElement,{amount:number;text:string}>();
export function setVital(el: HTMLElement, value: number, text?: string) {
  const amount=Math.max(0,Math.min(100,Number.isFinite(value)?value:0));
  const label=text??`${Math.round(amount)}%`,previous=lastValues.get(el);
  if(previous?.amount===amount&&previous.text===label)return;
  lastValues.set(el,{amount,text:label});
  el.style.setProperty('--empty',`${100-amount}%`);
  el.setAttribute('aria-valuenow',String(Math.round(amount)));
  el.setAttribute('aria-valuetext',text??`${Math.round(amount)}%`);
  el.title=`${el.getAttribute('aria-label')}: ${text??`${Math.round(amount)}%`}` + (el.dataset.vital==='rest'?' — tiredness; restored by sleeping':el.dataset.vital==='energy'?' — tool stamina; restored by food and resting':'');
  el.querySelector('.vital-value')!.textContent=text??`${Math.round(amount)}%`;
  el.classList.toggle('low',amount<25);
}
export function updateVitals(kind: VitalKind, value: number, text?: string) {
  if(kind==='health')healthState={value,text};
  const nodes=document.querySelectorAll<HTMLElement>(`[data-vital="${kind}"]`);
  for(let i=0;i<nodes.length;i++)setVital(nodes[i],value,text);
}
