/* Run the app's runout model over the cached test areas.

   Loads js/util.js and js/runout-core.js into this Node context with
   vm.runInThisContext, so the maths is the exact code the browser runs:
   terrariumDecode, slopeAspect, blockFromTiles, runoutCone, runoutMiddle.

   Usage: node run.js [--dem terrarium|glo30] [--release 30] [--tag baseline] [area ...]
   Writes cache/<area>/model-<tag>.u8, one byte per block cell over the
   area's own tiles (128 per tile, as the app draws them):
     bits 0-1  band: 0 none, 1 short (32), 2 medium (27), 3 long (23)
     bit  2    start zone (slope >= release)
   plus a .json with the grid and timing. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const HERE = __dirname, ROOT = path.join(HERE, '..', '..'), CACHE = path.join(HERE, 'cache');
for(const f of ['js/util.js', 'js/runout-core.js']){
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {filename:f});
}

const args = process.argv.slice(2), opt = {dem:'terrarium', release:30, tag:'baseline'}, pick = [];
for(let i=0;i<args.length;i++){
  if(args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pick.push(args[i]);
}
opt.release = +opt.release;
const ALPHAS = [32, 27, 23];          // short, medium, long

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
  }
  tiles.set(key, rec);
  return rec;
}
function block(x,y){
  const parts = [];
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    const d = loadTile(x+dx, y+dy);
    parts.push(d ? {dx, dy, d} : null);
  }
  return blockFromTiles(parts);
}

/* The baseline: the app's current model at the three NVE alphas */
function modelTile(b){
  const N = b.N, out = new Uint8Array(N*N);
  for(let k=ALPHAS.length-1; k>=0; k--){               // long first, short last wins
    const m = runoutMiddle(b, runoutCone(b, ALPHAS[k], opt.release), opt.release);
    for(let i=0;i<N*N;i++) if(m[i]) out[i] = k+1;
  }
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    if(b.sl[(j+N)*b.M + i+N] >= opt.release) out[j*N+i] |= 4;
  }
  return out;
}

for(const a of cfg.areas){
  if(pick.length && !pick.includes(a.name)) continue;
  if(!pick.length && !a.nve && opt.dem === 'terrarium') continue;   // nothing to score against
  const [x0,y0,x1,y1] = tileRange(a), N = BLOCK_N;
  const W = (x1-x0+1)*N, H = (y1-y0+1)*N, grid = new Uint8Array(W*H);
  tiles.clear();
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
    area:a.name, dem:opt.dem, release:opt.release, alphas:ALPHAS, z, x0, y0, x1, y1,
    W, H, cell_m: tileCell(z, (y0+y1)/2)*2, tiles:n, ms
  }, null, 1));
  console.log(`${a.name}: ${n} tiles, ${(ms/n).toFixed(0)} ms/tile`);
}
