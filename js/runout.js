/* ---------- modelled runout, alpha angle rule ----------
   Anything steeper than the release threshold is treated as a possible start
   zone. Snow is then let run downhill from it, and it is allowed to keep going
   only while the line back to its start zone is steeper than the alpha angle.
   The classic field rule of thumb: sight 18–20° up from where you stand, and
   if that line reaches the start zone you are standing in the runout.
   Distance is measured along the flow path rather than straight through the
   mountain, which is what a hand-drawn alpha angle uses, so this runs slightly
   short in strongly curved paths.                                            */
const RUN_N = 128;              // half the DEM resolution, plenty for this
const runoutCache = new Map();
let runAlpha = 18, runRelease = 30;

async function runoutMask(z,x,y,alpha,release){
  const key = [z,x,y,alpha,release].join('/');
  if(runoutCache.has(key)) return runoutCache.get(key);

  /* Avalanches do not respect tile edges, so model a 3×3 block and keep the
     middle. Without this every tile boundary grows a false stopping line. */
  const M = RUN_N*3;
  const el = new Float32Array(M*M).fill(NaN);
  const sl = new Float32Array(M*M).fill(NaN);
  let cell = null;

  const jobs = [];
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    jobs.push(loadDem(z, x+dx, y+dy).then(d=>({dx,dy,d})).catch(()=>null));
  }
  for(const part of await Promise.all(jobs)){
    if(!part) continue;                       // missing neighbour stays NaN
    if(cell === null) cell = part.d.cell*2;
    const ox = (part.dx+1)*RUN_N, oy = (part.dy+1)*RUN_N;
    for(let j=0;j<RUN_N;j++) for(let i=0;i<RUN_N;i++){
      el[(oy+j)*M + ox+i] = part.d.el[(j*2)*256 + i*2];
      sl[(oy+j)*M + ox+i] = part.d.slope[(j*2)*256 + i*2];
    }
  }
  if(cell === null) throw new Error('no elevation here');

  const tanA = Math.tan(alpha*Math.PI/180);
  /* P is the height of the alpha cone above sea level at each cell. Snow can be
     there if the cone still clears the ground. Cone height only ever falls
     along a path, so this is Dijkstra with the highest value popped first.
     P must be Float64: with Float32 a popped key no longer equals the value
     stored for its own cell and every entry looks stale. */
  const P = new Float64Array(M*M).fill(-Infinity);
  const hk = [], hv = [];
  function push(k,v){
    let i = hk.length; hk.push(k); hv.push(v);
    while(i>0){
      const p=(i-1)>>1; if(hk[p]>=hk[i]) break;
      const a=hk[p]; hk[p]=hk[i]; hk[i]=a;
      const b=hv[p]; hv[p]=hv[i]; hv[i]=b; i=p;
    }
  }
  function pop(){
    const k=hk[0], v=hv[0], n=hk.length-1;
    hk[0]=hk[n]; hv[0]=hv[n]; hk.pop(); hv.pop();
    let i=0;
    for(;;){
      const l=2*i+1, r=l+1; let m=i;
      if(l<hk.length && hk[l]>hk[m]) m=l;
      if(r<hk.length && hk[r]>hk[m]) m=r;
      if(m===i) break;
      const a=hk[m]; hk[m]=hk[i]; hk[i]=a;
      const b=hv[m]; hv[m]=hv[i]; hv[i]=b; i=m;
    }
    return [k,v];
  }

  for(let i=0;i<M*M;i++){
    if(!isNaN(el[i]) && sl[i] >= release){ P[i] = el[i]; push(el[i], i); }
  }
  while(hk.length){
    const popped = pop(), p = popped[0], i = popped[1];
    if(p < P[i]) continue;                                  // stale entry
    const yy = (i/M)|0, xx = i - yy*M;
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
      if(!dx && !dy) continue;
      const nx = xx+dx, ny = yy+dy;
      if(nx<0 || ny<0 || nx>=M || ny>=M) continue;
      const j = ny*M + nx, zj = el[j];
      if(isNaN(zj)) continue;
      const cand = p - tanA*cell*((dx && dy) ? Math.SQRT2 : 1);
      /* No downhill-only rule: run-up onto the opposite side is real, and a
         hard downhill test makes the model stop dead on flat valley floors. */
      if(cand > zj && cand > P[j]){ P[j] = cand; push(cand, j); }
    }
  }

  const mask = new Uint8Array(RUN_N*RUN_N);
  for(let j=0;j<RUN_N;j++) for(let i=0;i<RUN_N;i++){
    const s = (j+RUN_N)*M + (i+RUN_N);
    mask[j*RUN_N+i] = (P[s] > el[s] && sl[s] < release) ? 1 : 0;
  }
  if(runoutCache.size > 200) runoutCache.clear();
  runoutCache.set(key, mask);
  return mask;
}

const RunoutLayer = L.GridLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    const dz = Math.max(0, coords.z - DEM_MAX_Z);
    const pz = coords.z - dz, px = coords.x >> dz, py = coords.y >> dz;

    runoutMask(pz, px, py, runAlpha, runRelease).then(mask=>{
      const rgb = hexToRgb(document.getElementById('runColor').value);
      const work = document.createElement('canvas');
      work.width = work.height = RUN_N;
      const wc = work.getContext('2d');
      const img = wc.createImageData(RUN_N, RUN_N);
      for(let i=0;i<RUN_N*RUN_N;i++){
        if(!mask[i]) continue;
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
const runout = new RunoutLayer({maxZoom:18, opacity:0.45, tileSize:256, pane:'runoutPane'});

function applyRunout(){
  const on = document.getElementById('runOn').checked;
  runoutCache.clear();
  if(map.hasLayer(runout)) map.removeLayer(runout);
  if(!on) return;
  runAlpha   = Math.min(45, Math.max(5,  parseFloat(document.getElementById('runAlpha').value)   || 18));
  runRelease = Math.min(60, Math.max(20, parseFloat(document.getElementById('runRelease').value) || 30));
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
