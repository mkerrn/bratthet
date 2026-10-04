/* ---------- avalanche runout, NVE's three alpha bands ----------
   The model is in runout-core.js: release areas as in AutoATES (praTile,
   with tree cover from loadForest below), then snow routed downhill until the line back to its start zone is
   flatter than 32°, 27° or 23° (runoutBands). Colours are NVE's. Unlike
   NVE's map the bands also cover the steep ground (see runoutMiddle).
   docs/alpha-runout-results.md has how closely it matches NVE in Norway. */
const RUN_N = BLOCK_N;
const RUN_COLORS = [[0x00,0x4D,0xA8], [0x4C,0x9B,0xFF], [0x9A,0xB1,0xE6]];   // short, medium, long
const RUN_BAND_IDS = ['runShort', 'runMedium', 'runLong'];
const runoutCache = new Map();     // "z/x/y" -> bands of that tile, 0..3 per cell

/* Workers are started the first time the layer needs them, up to four, one
   fewer than the cores, and each job goes to the least busy one. If they
   cannot start (an old browser, a file:// page) the jobs run on the page. */
let runWorkers = null, runJobId = 0;
const runJobs = new Map();
function runoutWorkers(){
  if(runWorkers) return runWorkers;
  runWorkers = [];
  const n = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  try {
    for(let k=0;k<n;k++){
      const w = new Worker('js/runout-worker.js');
      w.busy = 0;
      w.onmessage = e=>{
        const job = runJobs.get(e.data.id);
        if(!job) return;
        runJobs.delete(e.data.id); w.busy--;
        if(e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.out);
      };
      w.onerror = ()=>{
        runWorkers = runWorkers.filter(x=>x !== w);
        for(const [id, job] of runJobs){
          if(job.worker !== w) continue;
          runJobs.delete(id);
          runJob(job.type, job.args).then(job.resolve, job.reject);
        }
      };
      runWorkers.push(w);
    }
  } catch(err){ /* no workers: runJob computes on the page */ }
  return runWorkers;
}
function runJob(type, args){
  const ws = runoutWorkers();
  if(!ws.length) return new Promise(resolve=>resolve(runoutJob(type, args)));
  const w = ws.reduce((a,b)=> b.busy < a.busy ? b : a);
  return new Promise((resolve, reject)=>{
    const id = ++runJobId;
    runJobs.set(id, {resolve, reject, type, args, worker:w});
    w.busy++;
    w.postMessage(Object.assign({id:id, type:type}, args));
  });
}

/* ---------- tree cover ----------
   Dense forest keeps avalanches from starting, so the release areas use
   Copernicus' Tree Cover Density 2018 (10 m, 0–100 %), as AutoATES does.
   It covers Europe up to about 72°N. EEA's image server sends it raw with
   format=bip: the first 256×256 bytes are the values, a mask follows. If a
   tile fails, its release areas are worked out without forest. */
const FOREST_URL = 'https://image.discomap.eea.europa.eu/arcgis/rest/services/GioLandPublic/' +
  'HRL_TreeCoverDensity_2018/ImageServer/exportImage';
const forestCache = new Map();     // "z/x/y" -> promise of a Uint8Array or null
function loadForest(z,x,y){
  const key = z+'/'+x+'/'+y;
  if(forestCache.has(key)) return forestCache.get(key);
  const R = 20037508.342789244, s = 2*R/Math.pow(2,z);
  const bbox = [-R+x*s, R-(y+1)*s, -R+(x+1)*s, R-y*s].map(v=>v.toFixed(3)).join(',');
  const url = FOREST_URL + '?bbox=' + bbox + '&bboxSR=3857&imageSR=3857&size=256,256' +
    '&format=bip&pixelType=U8&interpolation=RSP_NearestNeighbor&f=image';
  const ctl = new AbortController(), timer = setTimeout(()=>ctl.abort(), 20000);
  const p = fetch(url, {signal:ctl.signal})
    .then(r=>{ if(!r.ok) throw new Error('tree cover ' + r.status); return r.arrayBuffer(); })
    .then(b=>{
      if(b.byteLength < 256*256) throw new Error('no tree cover here');   // an error message
      return new Uint8Array(b.slice(0, 256*256));
    })
    .catch(()=>{ forestCache.delete(key); return null; })
    .finally(()=>clearTimeout(timer));
  forestCache.set(key, p);
  return p;
}

/* Release areas per elevation tile, kept on the tile's demCache record.
   They need the tile's own neighbours for the wind shelter, so a runout
   tile looks two tiles out. */
function loadPra(z,x,y){
  return loadDem(z,x,y).then(d=>{
    if(!d.praJob){
      const withForest = (z,x,y)=>Promise.all([loadDem(z,x,y), loadForest(z,x,y)])
        .then(r=>({el:r[0].el, forest:r[1]}));
      d.praJob = demParts(z,x,y,withForest)
        .then(parts=>runJob('pra', {parts:parts, cell:d.cell}))
        .then(pra=>{ d.pra = pra; return d; });
      d.praJob.catch(()=>{ d.praJob = null; });
    }
    return d.praJob;
  });
}

async function runoutMask(z,x,y){
  const key = z+'/'+x+'/'+y;
  if(runoutCache.has(key)) return runoutCache.get(key);
  const parts = await demParts(z,x,y,loadPra);
  if(!parts[4]) throw new Error('no elevation here');
  const bands = await runJob('bands', {
    parts: parts.map(p=>p && {dx:p.dx, dy:p.dy,
      d:{el:p.d.el, slope:p.d.slope, aspect:p.d.aspect, cell:p.d.cell, pra:p.d.pra}})
  });
  if(runoutCache.size > 200) runoutCache.clear();
  runoutCache.set(key, bands);
  return bands;
}

/* The bands are nested: the 23° footprint holds the 27° one, which holds
   the 32° one. A cell takes the colour of the shortest band that reaches it
   and is switched on, so hiding a band shows the next longer one there. */
function runoutPalette(){
  const show = RUN_BAND_IDS.map(id=>document.getElementById(id).checked);
  const pal = [null];
  for(let v=1; v<=3; v++){
    let k = v-1;
    while(k < 3 && !show[k]) k++;
    pal.push(k < 3 ? RUN_COLORS[k] : null);
  }
  return pal;
}

const RunoutLayer = L.GridLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    const dz = Math.max(0, coords.z - DEM_MAX_Z);
    const pz = coords.z - dz, px = coords.x >> dz, py = coords.y >> dz;

    runoutMask(pz, px, py).then(bands=>{
      const pal = runoutPalette();
      const work = document.createElement('canvas');
      work.width = work.height = RUN_N;
      const wc = work.getContext('2d');
      const img = wc.createImageData(RUN_N, RUN_N);
      for(let i=0;i<RUN_N*RUN_N;i++){
        const rgb = pal[bands[i]];
        if(!rgb) continue;
        img.data[i*4] = rgb[0]; img.data[i*4+1] = rgb[1];
        img.data[i*4+2] = rgb[2]; img.data[i*4+3] = 255;
      }
      wc.putImageData(img,0,0);
      const sw = RUN_N/Math.pow(2,dz);
      const sx = (coords.x - (px<<dz))*sw, sy = (coords.y - (py<<dz))*sw;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(work, sx, sy, sw, sw, 0, 0, 256, 256);
      done(null, tile);
    }).catch(()=>{ done(null, tile); });

    return tile;
  }
});
const runout = new RunoutLayer({maxZoom:18, opacity:0.55, tileSize:256, pane:'runoutPane',
  attribution:'Tree cover © European Union, Copernicus Land Monitoring Service'});
/* A layer has only one credit, so the elevation one is added by hand. The
   control counts them, so it shows once even with the slope layer on too. */
runout.on('add', ()=>map.attributionControl.addAttribution(DEM_CREDIT));
runout.on('remove', ()=>map.attributionControl.removeAttribution(DEM_CREDIT));

/* ---------- how far to trust it here ----------
   The bands are only as good as the elevation tiles under them, and those
   differ a lot by country (docs/alpha-runout-results.md, session 3).
   Terrarium names its sources in a header that CORS lets us read, so the
   note says what is under the middle of the map. The worst source in a
   tile decides, so the first match wins. */
const RUN_TERRAIN = [
  [/eudem/, 'Terrain here: EU-DEM, about 25 m. Compared with Swiss 2 m lidar it finds only half to four fifths of the ground over 30°, so narrow gullies, couloirs and small start zones are often missing, and so is their runout: in tests about a quarter of the short band was missing. A gap in the bands here does not mean safe ground.'],
  [/pgdc|arctic/i, 'Terrain here: ArcticDEM, 5 m from satellite images. Sharp, but with spikes and noise over water, glaciers and steep shade. On Svalbard the medium and long bands matched NVE about as well as on the mainland; the short band less well.'],
  [/kartverket/, 'Terrain here: Kartverket 10 m, the same kind of data NVE uses. In test areas around Norway about nine in ten cells agree with NVE\'s bands, and half the edges are within 20–30 m of NVE\'s.'],
  [/austria/, 'Terrain here: Austria\'s 10 m model. It finds 95 % of the ground swisstopo marks as over 30°, and the bands should be about as close as in Norway.']
];
const RUN_TERRAIN_OTHER = 'Terrain here: coarse global data (SRTM or similar, 30–90 m). Treat the bands as rough: narrow terrain and small start zones are missed.';
const runSources = new Map();      // "z/x/y" -> promise of the source list
let runTerrainToken = 0;
function runTerrainNote(){
  const el = document.getElementById('runTerrain');
  const c = map.getCenter(), z = DEM_MAX_Z, n = Math.pow(2,z);
  const x = ((Math.floor((c.lng+180)/360*n) % n) + n) % n;      // wrapped round the date line
  const y = Math.floor((1 - Math.asinh(Math.tan(c.lat*Math.PI/180))/Math.PI)/2*n);
  if(y < 0 || y >= n) return;
  const key = z+'/'+x+'/'+y;
  if(!runSources.has(key)){
    /* S3 refuses HEAD across origins, so GET and drop the body: the
       tile is usually in the browser cache already. */
    runSources.set(key, fetch(demTileUrl(z,x,y))
      .then(r=>{
        if(r.body) r.body.cancel();
        return r.headers.get('x-amz-meta-x-imagery-sources') || '';
      })
      .catch(()=>{ runSources.delete(key); return null; }));
  }
  const token = ++runTerrainToken;
  runSources.get(key).then(src=>{
    if(token !== runTerrainToken || src === null) return;
    const hit = RUN_TERRAIN.find(r=>r[0].test(src));
    el.textContent = hit ? hit[1] : RUN_TERRAIN_OTHER;
  });
}

function applyRunout(){
  const on = document.getElementById('runOn').checked;
  if(map.hasLayer(runout)) map.removeLayer(runout);
  if(!on) return;
  runout.setOpacity(+document.getElementById('runOpacity').value/100);
  runout.addTo(map);
  runTerrainNote();
}
map.on('moveend', debounce(()=>{
  if(document.getElementById('runOn').checked) runTerrainNote();
}, 300));

function applySlopeVisible(){
  const on = document.getElementById('slopeOn').checked;
  if(on && !map.hasLayer(slope)) slope.addTo(map);
  if(!on && map.hasLayer(slope)) map.removeLayer(slope);
}
applySlopeVisible();
applySteep();
map.on('moveend', ()=>{
  if(document.getElementById('steepSrc').value === 'auto') applySteep();
  autoBase();
});
