'use strict';
// Server-owned game and continuity. No localStorage/IndexedDB.
let world = null;
let busy = false;
const $ = id => document.getElementById(id);
const places = {tavern:'The Old Tavern', woods_edge:'Dark Woods edge', woods:'The Dark Woods'};
function ready(value) {
  busy = !value;
  document.querySelectorAll('[data-command], #submit, #command').forEach(el => el.disabled = !value);
}
async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function render(data) {
  world = data.world;
  const state = world.state;
  $('traveler').textContent = state.name;
  $('health').textContent = `${state.health}/100`;
  $('inventory').textContent = state.inventory.join(', ') || 'empty';
  $('location').textContent = (places[state.location] || state.location).toUpperCase();
  $('scene').textContent = state.last_scene;
  $('connection').textContent = `Saved on disk · revision ${world.revision}`;
  $('db-path').textContent = data.storage.path;
  $('db-size').textContent = `${data.storage.bytes.toLocaleString()} bytes on disk`;
  $('receipts').replaceChildren();
  for (const receipt of data.history) {
    const li = document.createElement('li');
    const count = receipt.state.inventory?.length || 0;
    for (const [className,text] of [['meta',`#${String(receipt.revision).padStart(4,'0')} · ${new Date(receipt.created_at).toLocaleTimeString()}`],['action',receipt.request.action?.command || 'The world begins'],['where',`${places[receipt.state.location] || receipt.state.location} · ${count} ${count===1?'object':'objects'}`]]) {
      const line = document.createElement('div'); line.className = className; line.textContent = text; li.append(line);
    }
    $('receipts').append(li);
  }
}
async function load() {
  ready(false);
  try {
    render(await api('/api/world'));
    $('notice').textContent = 'Your last committed moment is restored.';
    ready(true);
  } catch(error) {
    $('notice').textContent = error.message + ' Start the local bridge, then reload.';
    $('connection').textContent = 'Ledger unavailable';
  }
}
async function act(raw) {
  if (busy || !world) return;
  const command = raw.trim().toLowerCase();
  ready(false);
  $('notice').textContent='Writing this moment to the ledger…';
  const request = {request_id:crypto.randomUUID(), expected_revision:world.revision, command};
  try {
    await api('/api/commands', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(request)});
    // Reveal only after the disk bridge acknowledges the commit.
    render(await api('/api/world'));
    $('command').value='';
    $('notice').textContent=`Receipt ${world.revision} committed. You can close this tab.`;
    ready(true); $('command').focus();
  } catch(error) {
    $('notice').textContent=error.message + ' Use “Reload world” before another action.';
    $('connection').textContent='Reload to confirm saved state';
  }
}
$('command-form').addEventListener('submit', e=>{e.preventDefault(); act($('command').value);});
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>act(button.dataset.command)));
$('reload').addEventListener('click',load);
$('verify').addEventListener('click',async()=>{
  try { const result=await api('/api/verify'); $('verification').textContent=`Verified ${result.receipts} receipts. SQLite integrity: ${result.integrity}.`; }
  catch(error) { $('verification').textContent=error.message; }
});
load();
