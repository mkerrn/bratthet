/* ---------- uploaded GPX tracks ----------
   A file from a watch, an app or a friend's trip report, read in the browser
   and never sent anywhere. Tracks and routes become lines and waypoints dots.
   Several files can be loaded at once; Clear removes them all. */
const gpxTrackLayer = L.featureGroup();
const gpxFileEl = document.getElementById('gpxFile');
const gpxStatus = document.getElementById('gpxStatus');
const gpxClearBtn = document.getElementById('gpxClear');
let gpxFiles = [];     // {name, km, pts} per loaded file, for the status line
let gpxOpacity = 0.9;

function applyGpxTrack(){
  const on = document.getElementById('gpxOn').checked;
  if(on && !map.hasLayer(gpxTrackLayer)) gpxTrackLayer.addTo(map);
  if(!on && map.hasLayer(gpxTrackLayer)) map.removeLayer(gpxTrackLayer);
}

/* Namespace wildcards so files with a gpx: prefix, or an old 1.0 namespace,
   read the same as plain ones. */
function gpxTags(el, name){ return Array.from(el.getElementsByTagNameNS('*', name)); }
function gpxPoint(el){
  const lat = parseFloat(el.getAttribute('lat')), lng = parseFloat(el.getAttribute('lon'));
  return isFinite(lat) && isFinite(lng) ? L.latLng(lat, lng) : null;
}

function parseGpx(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('not valid XML');
  const lines = [];
  gpxTags(doc, 'trkseg').forEach(seg=> lines.push(gpxTags(seg, 'trkpt').map(gpxPoint).filter(Boolean)));
  gpxTags(doc, 'rte').forEach(rte=> lines.push(gpxTags(rte, 'rtept').map(gpxPoint).filter(Boolean)));
  const wpts = gpxTags(doc, 'wpt').map(w=>{
    const ll = gpxPoint(w);
    const n = gpxTags(w, 'name')[0];
    return ll && {ll, name: n ? n.textContent.trim() : ''};
  }).filter(Boolean);
  return {lines: lines.filter(l=>l.length > 1), wpts};
}

function renderGpxStatus(errors){
  gpxClearBtn.disabled = !gpxFiles.length;
  gpxStatus.innerHTML = (errors || []).concat(gpxFiles.map(f=>
    '<b>' + esc(f.name) + '</b>: ' + (f.km ? f.km.toFixed(1) + ' km' : 'no track') +
    (f.wpts ? ', ' + f.wpts + ' waypoint' + (f.wpts > 1 ? 's' : '') : ''))).join('<br>');
}

async function loadGpxFiles(files){
  const bounds = L.latLngBounds([]);
  const errors = [];
  for(const file of files){
    let g;
    try { g = parseGpx(await file.text()); }
    catch(e){ errors.push(esc(file.name) + ' could not be read (' + esc(e.message) + ').'); continue; }
    if(!g.lines.length && !g.wpts.length){
      errors.push(esc(file.name) + ' has no tracks, routes or waypoints.');
      continue;
    }
    let m = 0;
    g.lines.forEach(pts=>{
      for(let i=1;i<pts.length;i++) m += map.distance(pts[i-1], pts[i]);
      L.polyline(pts, {pane:'gpxPane', color:'#e040fb', weight:3, opacity:gpxOpacity, interactive:false})
        .addTo(gpxTrackLayer);
      bounds.extend(L.latLngBounds(pts));
    });
    g.wpts.forEach(w=>{
      const mk = L.circleMarker(w.ll, {pane:'gpxPane', radius:4, color:'#e040fb', weight:2,
                  fillColor:'#fff', fillOpacity:gpxOpacity, opacity:gpxOpacity, interactive:false})
        .addTo(gpxTrackLayer);
      if(w.name) mk.bindTooltip(w.name, {permanent:true, direction:'right', className:'meas', offset:[6,0]});
      bounds.extend(w.ll);
    });
    gpxFiles.push({name:file.name, km:m/1000, wpts:g.wpts.length});
  }
  renderGpxStatus(errors);
  if(bounds.isValid()){
    LAYER_TOGGLES.gpx.set(true);
    syncOrderChecks();
    map.fitBounds(bounds, {padding:[30,30], maxZoom:15});
  }
}

document.getElementById('gpxPick').onclick = ()=> gpxFileEl.click();
gpxFileEl.onchange = ()=>{
  loadGpxFiles(Array.from(gpxFileEl.files));
  gpxFileEl.value = '';   // so picking the same file again still fires
};
gpxClearBtn.onclick = ()=>{
  gpxTrackLayer.clearLayers();
  gpxFiles = [];
  renderGpxStatus();
};
document.getElementById('gpxOpacity').oninput = e=>{
  gpxOpacity = e.target.value/100;
  gpxTrackLayer.eachLayer(l=> l.setStyle({opacity:gpxOpacity, fillOpacity:gpxOpacity}));
};
