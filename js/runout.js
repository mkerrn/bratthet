/* ---------- avalanche runout, NVE's three alpha bands ----------
   The model is in runout-core.js: release areas as in AutoATES (praTile),
   then snow routed downhill until the line back to its start zone is
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

/* Release areas per elevation tile, kept on the tile's demCache record.
   They need the tile's own neighbours for the wind shelter, so a runout
   tile looks two tiles out. */
function loadPra(z,x,y){
  return loadDem(z,x,y).then(d=>{
    if(!d.praJob){
      d.praJob = demParts(z,x,y).then(parts=>runJob('pra', {
        parts: parts.map(p=>p && {dx:p.dx, dy:p.dy, d:{el:p.d.el}}),
        cell: d.cell
      })).then(pra=>{ d.pra = pra; return d; });
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
const runout = new RunoutLayer({maxZoom:18, opacity:0.55, tileSize:256, pane:'runoutPane'});

function applyRunout(){
  const on = document.getElementById('runOn').checked;
  if(map.hasLayer(runout)) map.removeLayer(runout);
  if(!on) return;
  runout.setOpacity(+document.getElementById('runOpacity').value/100);
  runout.addTo(map);
}

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
