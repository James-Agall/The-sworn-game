// HUD layout glue that runs once at page load, after the main menu is set up (it used to sit at the end of
// main.ts). Moves the time / strategy / pause controls out of the collapsible inventory into a #colony-header and
// keeps the CSS variables that other panels position against (--toolbar-bottom, --colony-header-bottom) current.
export function setupHudLayout() {
  // The control strip can wrap at different window sizes and text scales.
  const toolbarForLayout=document.getElementById('control-buttons');
  if(toolbarForLayout){const placeLedger=()=>document.documentElement.style.setProperty('--toolbar-bottom',`${toolbarForLayout.getBoundingClientRect().bottom+8}px`);new ResizeObserver(placeLedger).observe(toolbarForLayout);placeLedger();}

  // Keep controls outside the collapsible inventory; reparenting retains every existing listener.
  const colonyHeader = document.createElement('section');
  colonyHeader.id = 'colony-header';
  colonyHeader.setAttribute('aria-label', 'Colony status and time');
  const colonyCommands = document.createElement('div');
  colonyCommands.id = 'colony-commands';
  for (const id of ['strategy-btn', 'pause-btn', 'time-controls']) colonyCommands.append(document.getElementById(id)!);
  colonyHeader.append(colonyCommands, document.getElementById('colony-stats')!);
  document.body.append(colonyHeader);
  document.getElementById('control-buttons')!.append(document.getElementById('next-bar')!);
  document.getElementById('economy-panel-toggle')!.textContent = 'Stockpile';
  const stockPanel = document.getElementById('economy-panel')!;
  const syncStockPanel = () => document.body.classList.toggle('stockpile-open', !stockPanel.classList.contains('collapsed'));
  new MutationObserver(syncStockPanel).observe(stockPanel, {attributes:true, attributeFilter:['class']});
  syncStockPanel();
  const measureHeader = () => document.documentElement.style.setProperty('--colony-header-bottom', `${colonyHeader.getBoundingClientRect().bottom + 12}px`);
  new ResizeObserver(measureHeader).observe(colonyHeader);
  measureHeader();
}
