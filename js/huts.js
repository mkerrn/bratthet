/* ---------- huts ----------
   DNT cabins and other mountain huts from OpenStreetMap. Overpass is slow and
   often busy, so tools/update-huts.py saves a snapshot to data/huts.json and
   that file is only fetched the first time the layer is switched on.
   Thousands of markers at once would make phones crawl, so only the huts in
   view are drawn: nothing when zoomed far out, then only the big huts, and
   the rest once zoomed in a bit. */
const HUT_KINDS = {
  s: 'Staffed DNT hut',
  e: 'Self-service DNT hut',
  n: 'No-service DNT hut',
  m: 'Mountain hut',
  w: 'Wilderness hut',
  b: 'Basic hut'
};
const HUT_BIGZOOM = 7;     // from here the staffed and bigger huts show
const HUT_ALLZOOM = 9;     // and from here all of them
const hutLayer = L.layerGroup();
const hutStatus = document.getElementById('hutStatus');
let huts = null;           // [{ll, name, kind, op, ele, beds, web, key, ref, mk}] once loaded
let hutDate = '';
let hutToken = 0;

/* A little house; the kind picks the fill through CSS (css/map-ui.css). */
const HUT_SVG = '<svg viewBox="0 0 16 16"><path d="M8 1.5 15 8h-2v6.5H3V8H1z"/><rect x="6" y="9" width="4" height="4"/></svg>';
const hutIcons = {};
Object.keys(HUT_KINDS).forEach(k=>{
  const size = k === 'b' ? 14 : 18;
  hutIcons[k] = L.divIcon({className:'hut hut-' + k, html:HUT_SVG, iconSize:[size, size]});
});
document.querySelectorAll('.hut-legend i').forEach(i=>{ i.innerHTML = HUT_SVG; });

function hutPopup(h){
  const bits = [HUT_KINDS[h.kind]];
  if(h.op) bits.push(esc(h.op));
  const facts = [];
  if(h.ele) facts.push(h.ele + ' m');
  if(h.beds) facts.push(h.beds + ' beds');
  if(h.key) facts.push('locked with the DNT key');
  const links = [];
  if(/^https?:\/\//.test(h.web)) links.push('<a href="' + esc(h.web) + '" target="_blank" rel="noopener">Website</a>');
  const type = {n:'node', w:'way', r:'relation'}[h.ref[0]];
  links.push('<a href="https://www.openstreetmap.org/' + type + '/' + h.ref.slice(1) + '" target="_blank" rel="noopener">OpenStreetMap</a>');
  return '<b>' + esc(h.name || 'Unnamed hut') + '</b><br>' + bits.join(' · ') +
    (facts.length ? '<br>' + facts.join(' · ') : '') + '<br>' + links.join(' · ');
}

/* Tapping a hut while measuring adds it as a route point instead of opening
   the popup, since a marker click never reaches the map's own handler. */
function hutMarker(h){
  if(h.mk) return h.mk;
  h.mk = L.marker(h.ll, {pane:'hutPane', icon:hutIcons[h.kind], title:h.name, keyboard:false});
  h.mk.on('click', ()=>{
    if(measuring){ addMeasurePoint(h.ll); return; }
    L.popup({offset:[0, -6]}).setLatLng(h.ll).setContent(hutPopup(h)).openOn(map);
  });
  return h.mk;
}

function drawHuts(){
  if(!huts || !map.hasLayer(hutLayer)) return;
  const z = map.getZoom(), view = map.getBounds().pad(0.25);
  const big = h=> h.kind === 's' || (h.kind === 'm' && h.beds >= 20);
  const want = new Set(z < HUT_BIGZOOM ? [] :
    huts.filter(h=> (z >= HUT_ALLZOOM || big(h)) && view.contains(h.ll)));
  hutLayer.eachLayer(mk=>{ if(!want.has(mk.hut)) hutLayer.removeLayer(mk); });
  want.forEach(h=>{ const mk = hutMarker(h); mk.hut = h; if(!hutLayer.hasLayer(mk)) hutLayer.addLayer(mk); });
  hutStatus.textContent = (z < HUT_BIGZOOM ? 'Zoom in to see huts. ' :
                           z < HUT_ALLZOOM ? 'Zoom in to see the smaller huts too. ' : '') +
    'OpenStreetMap data from ' + niceDate(hutDate) + '.';
}

function loadHuts(){
  if(huts) return Promise.resolve();
  const token = ++hutToken;
  hutStatus.textContent = 'Loading huts…';
  return fetchJson('data/huts.json', 30000).then(d=>{
    if(token !== hutToken) return;
    hutDate = d.date;
    huts = d.huts.map(r=>({ll:L.latLng(r[0], r[1]), name:r[2], kind:r[3], op:r[4],
                           ele:r[5], beds:r[6], web:r[7], key:r[8], ref:r[9]}));
  }).catch(()=>{
    if(token === hutToken) hutStatus.textContent = 'Could not load the huts. Try again later.';
  });
}

/* A layer group has no attribution of its own, so credit OpenStreetMap by hand. */
const HUT_CREDIT = 'Huts © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
function applyHuts(){
  const on = document.getElementById('hutOn').checked;
  if(!on){
    hutToken++;
    if(map.hasLayer(hutLayer)){ map.removeLayer(hutLayer); map.attributionControl.removeAttribution(HUT_CREDIT); }
    hutStatus.textContent = '';
    return;
  }
  if(!map.hasLayer(hutLayer)){ hutLayer.addTo(map); map.attributionControl.addAttribution(HUT_CREDIT); }
  loadHuts().then(drawHuts);
}
map.on('moveend', debounce(drawHuts, 150));
