/* ---------- map ---------- */
const bases = {
  kv: L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
      {maxZoom:18, attribution:'© Kartverket'}),
  otm: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      {maxZoom:17, attribution:'© OpenTopoMap, OpenStreetMap contributors'}),
  /* Kartverket's own aerial photos (Norge i bilder) need a token, so Norway
     gets Esri's world imagery instead. It is free to show with attribution,
     sends CORS headers (so it drapes in 3D too) and is sharp in most of
     Norway's mountains. */
  esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:18, attribution:'© Esri, Maxar, Earthstar Geographics'}),
  /* National maps that are free to use with attribution: Kartverket and
     basemap.at under CC BY 4.0, IGN under the Etalab open licence, swisstopo
     under its FSDI terms (free, fair use up to about 20,000 users a day).
     Each covers only its own country, so they are picked by hand, not by
     "follow the map". IGN's SCAN 25 is left out: its free licence covers
     professional and association use, not a private site like this one. */
  kvgrey: L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
      {maxZoom:18, attribution:'© Kartverket'}),
  ch: L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
      {maxZoom:18, attribution:'© swisstopo'}),
  chimg: L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
      {maxZoom:18, attribution:'© swisstopo'}),
  ign: L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
      '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
      '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
      {maxZoom:18, attribution:'© IGN'}),
  ignimg: L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
      '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
      '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
      {maxZoom:18, attribution:'© IGN'}),
  at: L.tileLayer('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png',
      {maxZoom:18, attribution:'© basemap.at'}),
  atimg: L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
      {maxZoom:18, attribution:'© basemap.at'})
};

const map = L.map('map', {center:[61.63, 8.31], zoom:12, layers:[bases.kv], zoomControl:true});

/* ---------- layer order ----------
   Each overlay group lives in its own pane. Panes sit above the base map
   (tilePane, z 200) and below lines and markers (overlayPane, z 400), and
   their z-index decides which group is drawn on top. */
/* The name here is also written into the matching section heading in the
   panel (h2 with data-layer), so a layer is called the same thing in both. */
const LAYER_GROUPS = {
  hut:    {name:'Huts',                         pane:'hutPane'},
  gpx:    {name:'GPX track',                    pane:'gpxPane'},
  piste:  {name:'Ski pistes',                   pane:'pistePane'},
  heat:   {name:'Heatmap',                      pane:'heatPane'},
  danger: {name:'Avalanche forecast',           pane:'dangerPane'},
  runout: {name:'Avalanche runout (alpha)',     pane:'runoutPane'},
  aval:   {name:'Official steepness',  pane:'avalPane'},
  slope:  {name:'Angle classes',                pane:'slopePane'},
  wind:   {name:'Wind exposure',                pane:'windPane'},
  sun:    {name:'Sun exposure',                 pane:'sunPane'},
  snow:   {name:'Snow condition',      pane:'snowPane'}
};
/* Snow sits lowest because the satellite photos are opaque; the forecast
   regions are a light wash, so they can go near the top. */
let layerOrder = ['hut', 'gpx', 'sun', 'wind', 'piste', 'heat', 'danger', 'runout', 'aval', 'slope', 'snow'];   // first = on top
if(!HEATMAP_URL){
  delete LAYER_GROUPS.heat;
  layerOrder = layerOrder.filter(k=>k !== 'heat');
  document.getElementById('heatSection').style.display = 'none';
}
document.querySelectorAll('h2[data-layer]').forEach(h=>{
  const g = LAYER_GROUPS[h.dataset.layer];
  if(g) h.textContent = g.name;
});
/* Only one layer's settings are shown at a time, so the panel stays short:
   tapping a name in the order list opens that layer's section (the sections
   come right after the list, so it appears just below it) and tapping it
   again closes it. The tick box only shows or hides the layer on the map. */
let openLayer = null;
const layerSections = {};
document.querySelectorAll('h2[data-layer]').forEach(h=>{
  const sec = h.closest('section');
  layerSections[h.dataset.layer] = sec;
  sec.hidden = true;
});
function showLayerSettings(key){
  openLayer = openLayer === key ? null : key;
  Object.entries(layerSections).forEach(([k, sec])=>{ sec.hidden = k !== openLayer; });
  document.querySelectorAll('#order li[data-key]').forEach(li=>{
    const on = li.dataset.key === openLayer;
    li.classList.toggle('open', on);
    li.querySelector('.name').setAttribute('aria-expanded', on);
  });
}

/* Show/hide for each row in the order list. Each one drives the control the
   layer already has in its own section, so the two always agree. The official
   steepness layer has no tick box of its own, only a source menu with "Off",
   so unticking it here sets that menu to Off and ticking restores the source. */
let steepLast = 'auto';
const LAYER_TOGGLES = {
  hut:    {get:()=>document.getElementById('hutOn').checked,
           set:v=>{ document.getElementById('hutOn').checked = v; applyHuts(); }},
  gpx:    {get:()=>document.getElementById('gpxOn').checked,
           set:v=>{ document.getElementById('gpxOn').checked = v; applyGpxTrack(); }},
  piste:  {get:()=>document.getElementById('pisteOn').checked,
           set:v=>{ document.getElementById('pisteOn').checked = v; applyPiste(); }},
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
  wind:   {get:()=>document.getElementById('windOn').checked,
           set:v=>{ document.getElementById('windOn').checked = v; applyWind(); }},
  sun:    {get:()=>document.getElementById('sunOn').checked,
           set:v=>{ document.getElementById('sunOn').checked = v; applySun(); }},
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
    const name = LAYER_GROUPS[key].name;
    li.classList.toggle('open', key === openLayer);
    li.innerHTML = '<input type="checkbox" aria-label="Show ' + name + ' on the map">' +
      '<button type="button" class="name" aria-expanded="' + (key === openLayer) + '" title="Settings for ' + name + '">' + name + '</button>' +
      '<button type="button" class="mv" title="Move up" aria-label="Move ' + name + ' up">▲</button>' +
      '<button type="button" class="mv" title="Move down" aria-label="Move ' + name + ' down">▼</button>';
    li.querySelector('.name').onclick = ()=> showLayerSettings(key);
    const [up, down] = li.querySelectorAll('.mv');
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
