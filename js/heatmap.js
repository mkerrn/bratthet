/* ---------- Strava heatmap ---------- */
let heatLayer = null;
let detectedZ = null;
let heatTmpl = HEATMAP_URL;          // sport swapped in by the Activity menu

function fmtTile(tmpl,z,x,y){
  return tmpl.replace('{s}','a').replace('{z}',z).replace('{x}',x).replace('{y}',y);
}
function lngLatToTile(lat,lng,z){
  const n = Math.pow(2,z), r = lat*Math.PI/180;
  return {
    x: Math.floor((lng+180)/360*n),
    y: Math.floor((1 - Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n)
  };
}
function probe(url){
  return new Promise(res=>{
    const img = new Image();
    let done = false;
    const finish = v=>{ if(!done){ done = true; res(v); } };
    img.onload = ()=>finish(true);
    img.onerror = ()=>finish(false);
    setTimeout(()=>finish(false), 6000);
    img.src = url;
  });
}
/* Ask the server, once, how deep it actually goes here. Every tile then comes
   from that single level, so the whole layer stays at one consistent sharpness
   and simply stretches as you zoom past it. */
async function detectDepth(tmpl){
  const c = map.getCenter();
  for(let z=16; z>=9; z--){
    const t = lngLatToTile(c.lat, c.lng, z);
    const spots = [[t.x,t.y],[t.x+1,t.y],[t.x,t.y+1],[t.x+1,t.y+1]];
    const hits = await Promise.all(spots.map(([x,y])=>probe(fmtTile(tmpl,z,x,y))));
    if(hits.some(Boolean)) return z;
  }
  return null;                       // nothing answered at any zoom
}

const status = document.getElementById('heatStatus') || {textContent:''};

let heatToken = 0;
async function buildHeatmap(){
  const token = ++heatToken;          // a newer call wins if the checks overlap
  if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
  if(!document.getElementById('heatOn').checked){ status.textContent = 'Heatmap off.'; return; }

  const tmpl = heatTmpl;
  if(!tmpl){ status.textContent = 'No heatmap source is set up.'; return; }
  if(detectedZ === null){
    status.textContent = 'Checking how sharp the heatmap gets here…';
    const z = await detectDepth(tmpl);
    if(token !== heatToken) return;
    if(z === null){
      status.textContent = 'The heatmap source sent no tiles for this area. It may need you '
        + 'to be logged in to it in this browser.';
      return;
    }
    detectedZ = z;
  }
  const native = detectedZ;

  heatLayer = L.tileLayer(tmpl, {
    maxZoom: 22,
    maxNativeZoom: native,
    opacity: +document.getElementById('heatOpacity').value/100,
    attribution: 'Heatmap',
    pane: 'heatPane'
  });
  heatLayer.addTo(map);
  status.textContent = 'Showing detail down to zoom ' + native + ', the most this source serves here. '
    + 'Zooming in further enlarges those tiles, so the tracks get softer.';
}
