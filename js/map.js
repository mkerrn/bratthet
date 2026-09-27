/* ---------- map ---------- */
const bases = {
  kv: L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
      {maxZoom:18, attribution:'© Kartverket'}),
  otm: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      {maxZoom:17, attribution:'© OpenTopoMap, OpenStreetMap contributors'})
};

const map = L.map('map', {center:[61.63, 8.31], zoom:12, layers:[bases.kv], zoomControl:true});

/* ---------- layer order ----------
   Each overlay group lives in its own pane. Panes sit above the base map
   (tilePane, z 200) and below lines and markers (overlayPane, z 400), and
   their z-index decides which group is drawn on top. */
/* The name here is also written into the matching section heading in the
   panel (h2 with data-layer), so a layer is called the same thing in both. */
const LAYER_GROUPS = {
  heat:   {name:'Heatmap',                      pane:'heatPane'},
  danger: {name:'Avalanche forecast',           pane:'dangerPane'},
  runout: {name:'Alpha angle runout',  pane:'runoutPane'},
  aval:   {name:'Official steepness',  pane:'avalPane'},
  slope:  {name:'Angle classes',                pane:'slopePane'},
  snow:   {name:'Snow condition',      pane:'snowPane'}
};
/* Snow sits lowest because the satellite photos are opaque; the forecast
   regions are a light wash, so they can go near the top. */
let layerOrder = ['heat', 'danger', 'runout', 'aval', 'slope', 'snow'];   // first = on top
if(!HEATMAP_URL){
  delete LAYER_GROUPS.heat;
  layerOrder = layerOrder.filter(k=>k !== 'heat');
  document.getElementById('heatSection').style.display = 'none';
}
document.querySelectorAll('h2[data-layer]').forEach(h=>{
  const g = LAYER_GROUPS[h.dataset.layer];
  if(g) h.textContent = g.name;
});

/* Show/hide for each row in the order list. Each one drives the control the
   layer already has in its own section, so the two always agree. The official
   steepness layer has no tick box of its own, only a source menu with "Off",
   so unticking it here sets that menu to Off and ticking restores the source. */
let steepLast = 'auto';
const LAYER_TOGGLES = {
  heat:   {get:()=>document.getElementById('heatOn').checked,
           set:v=>{ document.getElementById('heatOn').checked = v; buildHeatmap(); }},
  danger: {get:()=>document.getElementById('dangerOn').checked,
           set:v=>{ document.getElementById('dangerOn').checked = v; refreshDanger(); }},
  runout: {get:()=>document.getElementById('runOn').checked,
           set:v=>{ document.getElementById('runOn').checked = v; applyRunout(); }},
  aval:   {get:()=>document.getElementById('steepSrc').value !== 'off',
           set:v=>{
             const sel = document.getElementById('steepSrc');
             if(v){ if(sel.value === 'off') sel.value = steepLast; }
             else if(sel.value !== 'off'){ steepLast = sel.value; sel.value = 'off'; }
             applySteep();
           }},
  slope:  {get:()=>document.getElementById('slopeOn').checked,
           set:v=>{ document.getElementById('slopeOn').checked = v; applySlopeVisible(); }},
  snow:   {get:()=>document.getElementById('snowOn').checked,
           set:v=>{ document.getElementById('snowOn').checked = v; applySnow(); }}
};
function syncOrderChecks(){
  document.querySelectorAll('#order li[data-key]').forEach(li=>{
    const on = LAYER_TOGGLES[li.dataset.key].get();
    li.querySelector('input').checked = on;
    li.classList.toggle('hidden-layer', !on);
  });
}
Object.values(LAYER_GROUPS).forEach(g=>{ map.createPane(g.pane).style.pointerEvents = 'none'; });
/* Hillshading belongs to the base map, not the overlay stack: it sits just
   above the base tiles and multiplies onto them, so white leaves the map
   untouched and only the shadows darken it. */
const shadePane = map.createPane('shadePane');
shadePane.style.zIndex = 250;
shadePane.style.pointerEvents = 'none';
shadePane.style.mixBlendMode = 'multiply';

function applyOrder(){
  layerOrder.forEach((key, i)=>{
    map.getPane(LAYER_GROUPS[key].pane).style.zIndex = 300 - i*10;
  });
  renderOrder();
}
function moveLayer(i, dir){
  const j = i + dir;
  if(j < 0 || j >= layerOrder.length) return;
  [layerOrder[i], layerOrder[j]] = [layerOrder[j], layerOrder[i]];
  applyOrder();
}
function renderOrder(){
  const ul = document.getElementById('order');
  ul.innerHTML = '';
  layerOrder.forEach((key, i)=>{
    const li = document.createElement('li');
    li.dataset.key = key;
    li.innerHTML = '<input type="checkbox" id="ord-' + key + '">' +
      '<label for="ord-' + key + '">' + LAYER_GROUPS[key].name + '</label>' +
      '<button type="button" title="Move up" aria-label="Move ' + LAYER_GROUPS[key].name + ' up">▲</button>' +
      '<button type="button" title="Move down" aria-label="Move ' + LAYER_GROUPS[key].name + ' down">▼</button>';
    const [up, down] = li.querySelectorAll('button');
    up.disabled = i === 0;
    down.disabled = i === layerOrder.length - 1;
    up.onclick = ()=> moveLayer(i, -1);
    down.onclick = ()=> moveLayer(i, 1);
    const box = li.querySelector('input');
    box.checked = LAYER_TOGGLES[key].get();
    li.classList.toggle('hidden-layer', !box.checked);
    box.onchange = ()=>{ LAYER_TOGGLES[key].set(box.checked); syncOrderChecks(); };
    ul.appendChild(li);
  });
  const base = document.createElement('li');
  base.className = 'fixed';
  base.innerHTML = '<span>Base map</span>';
  ul.appendChild(base);
}
applyOrder();
