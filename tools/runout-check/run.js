/* Run the app's runout model over the cached test areas.

   Loads js/util.js and js/runout-core.js into this Node context with
   vm.runInThisContext, so the maths is the exact code the browser runs.

   Usage: node run.js [--model app|baseline|pra] [options] [--tag name] [area ...]
     --model app       what the app draws: praTile release areas and
                       runoutBands with the defaults in runout-core.js
                       (--maxslope 27 leaves out steep ground as NVE's map does)
     --model baseline  release where slope >= --release (30), envelope (session 1)
     --model pra       praTile release areas (threshold --thr), then a route:
       --route envelope  runoutCone, every path the energy line allows
       --route flow      runoutFlow with exponent --exp, spreading budget --fthr,
                         --persist 1|0 and --flat degrees
       --zmax            cap on the energy line above ground, both routes
       --alphas 32,27,23 other angles for the three bands
     --dem terrarium|glo30
   Defaults for the options are the app's (PRA_OPTS, FLOW_OPTS), except that
   --route envelope has no zmax unless given, so the baseline stays as it was.
   Writes cache/<area>/model-<tag>.u8, one byte per block cell over the
   area's own tiles (128 per tile, as the app draws them):
     bits 0-1  band: 0 none, 1 short (32), 2 medium (27), 3 long (23)
     bit  2    start zone
   plus a .json with the grid and timing. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const HERE = __dirname, ROOT = path.join(HERE, '..', '..'), CACHE = path.join(HERE, 'cache');
for(const f of ['js/util.js', 'js/runout-core.js']){
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {filename:f});
}

const args = process.argv.slice(2), pick = [];
const opt = {dem:'terrarium', model:'baseline', release:30, route:'envelope', tag:'baseline'};
for(let i=0;i<args.length;i++){
  if(args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pick.push(args[i]);
}
let ALPHAS = RUNOUT_ALPHAS;                          // short, medium, long
if(opt.alphas) ALPHAS = String(opt.alphas).split(',').map(Number);
opt.release = +opt.release;
const praOpt = opt.thr !== undefined ? {threshold:+opt.thr} : {};
if(opt.forest !== undefined) praOpt.forest = !!+opt.forest;
if(opt.forestmu !== undefined) praOpt.forestMu = String(opt.forestmu).split(',').map(Number);
const flowOpt = {};
for(const [k, a] of [['exp','exp'], ['thr','fthr'], ['persist','persist'], ['zmax','zmax'], ['flat','flat']]){
  if(opt[a] !== undefined) flowOpt[k] = k === 'persist' ? !!+opt[a] : +opt[a];
}
const maxSlope = opt.maxslope !== undefined ? +opt.maxslope : undefined;
const cone = (b, alpha) => opt.route === 'flow' ? runoutFlow(b, alpha, b.start, flowOpt)
                                                : runoutCone(b, alpha, b.start, flowOpt);

const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'areas.json'), 'utf8'));
const z = cfg.zoom;

/* Same as tile_range in fetch.py */
function tileRange(a){
  const h = a.size_km*500, dlat = h/111320, dlon = h/(111320*Math.cos(a.lat*Math.PI/180));
  const n = 2**z;
  const tx = lon => Math.floor((lon+180)/360*n);
  const ty = lat => Math.floor((1 - Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
  return [tx(a.lon-dlon), ty(a.lat+dlat), tx(a.lon+dlon), ty(a.lat-dlat)];
}

/* The app's loadDem, minus the image and canvas */
const tiles = new Map();
function loadTile(x,y){
  const key = x+'/'+y;
  if(tiles.has(key)) return tiles.get(key);
  let el = null;
  if(opt.dem === 'terrarium'){
    const f = path.join(CACHE, 'terrarium', ''+z, `${x}_${y}.rgba`);
    if(fs.existsSync(f)) el = terrariumDecode(new Uint8Array(fs.readFileSync(f)));
  } else {
    const f = path.join(CACHE, opt.dem, ''+z, `${x}_${y}.f32`);
    if(fs.existsSync(f)){ const b = fs.readFileSync(f); el = new Float32Array(b.buffer, b.byteOffset, 256*256).slice(); }
  }
  let rec = null;
  if(el){
    const cell = tileCell(z,y), sa = slopeAspect(el, cell);
    rec = {el:el, slope:sa.slope, aspect:sa.aspect, cell:cell};
    const f = path.join(CACHE, 'forest', ''+z, `${x}_${y}.u8`);
    if(fs.existsSync(f)) rec.forest = new Uint8Array(fs.readFileSync(f));
  }
  tiles.set(key, rec);
  return rec;
}
function around(x, y, get){
  const parts = [];
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    const d = get(x+dx, y+dy);
    parts.push(d ? {dx, dy, d} : null);
  }
  return parts;
}
/* PRA per tile, from the tile and its neighbours, as the app's loadPra does */
function praOf(x,y){
  const d = loadTile(x,y);
  if(!d) return null;
  if(!d.pra) d.pra = praTile(around(x, y, loadTile), d.cell, praOpt);
  return d;
}
let praMs = 0;
function block(x,y){
  const b = blockFromTiles(around(x, y, loadTile));
  if(opt.model !== 'baseline'){
    const t = Date.now();
    b.start = praBlock(around(x, y, praOf));
    praMs += Date.now() - t;
  } else b.start = opt.release;
  return b;
}

/* The three NVE alphas on one block; b.start is a slope threshold or a mask */
function modelTile(b){
  const N = b.N;
  let out;
  if(opt.model === 'app') out = runoutBands(b, b.start, maxSlope, flowOpt);
  else {
    out = new Uint8Array(N*N);
    for(let k=ALPHAS.length-1; k>=0; k--){             // long first, short last wins
      const m = runoutMiddle(b, cone(b, ALPHAS[k]), b.start);
      for(let i=0;i<N*N;i++) if(m[i]) out[i] = k+1;
    }
  }
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    if(isStart(b, b.start, (j+N)*b.M + i+N)) out[j*N+i] |= 4;
  }
  return out;
}

for(const a of cfg.areas){
  if(pick.length && !pick.includes(a.name)) continue;
  if(!pick.length && !a.nve && opt.dem === 'terrarium') continue;   // nothing to score against
  const [x0,y0,x1,y1] = tileRange(a), N = BLOCK_N;
  const W = (x1-x0+1)*N, H = (y1-y0+1)*N, grid = new Uint8Array(W*H);
  tiles.clear(); praMs = 0;
  const t0 = Date.now();
  let n = 0;
  for(let y=y0; y<=y1; y++) for(let x=x0; x<=x1; x++){
    let m;
    try { m = modelTile(block(x,y)); } catch(e){ continue; }
    n++;
    const ox = (x-x0)*N, oy = (y-y0)*N;
    for(let j=0;j<N;j++) grid.set(m.subarray(j*N, j*N+N), (oy+j)*W + ox);
  }
  const ms = Date.now() - t0;
  const dir = path.join(CACHE, a.name);
  fs.mkdirSync(dir, {recursive:true});
  const base = path.join(dir, `model-${opt.tag}`);
  fs.writeFileSync(base + '.u8', grid);
  fs.writeFileSync(base + '.json', JSON.stringify({
    area:a.name, dem:opt.dem, model:opt.model, release:opt.release, route:opt.route,
    pra: Object.assign({}, PRA_OPTS, praOpt), flow: Object.assign({}, FLOW_OPTS, flowOpt),
    maxslope: maxSlope ?? null, alphas:ALPHAS,
    z, x0, y0, x1, y1, W, H, cell_m: tileCell(z, (y0+y1)/2)*2, tiles:n, ms, pra_ms:praMs
  }, null, 1));
  console.log(`${a.name}: ${n} tiles, ${(ms/n).toFixed(0)} ms/tile` +
              (opt.model !== 'baseline' ? ` (PRA ${(praMs/n).toFixed(0)})` : ''));
}
