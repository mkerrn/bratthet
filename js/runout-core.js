/* ---------- terrain and runout maths, no DOM ----------
   Pure functions on elevation arrays: slope and aspect, the 3×3 block a
   tile is modelled on, and the alpha-angle runout. Nothing here touches the
   page, Leaflet or the network, so tools/runout-check runs this exact file
   in Node and scores it against NVE. Keep it that way: the app and the
   harness must not drift apart. */

function tileLat(z,y){
  const n = Math.PI - 2*Math.PI*(y+0.5)/Math.pow(2,z);
  return Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
}
/* Ground size of one pixel of a 256 px web mercator tile, in metres */
function tileCell(z,y){ return 156543.03392 * Math.cos(tileLat(z,y)) / Math.pow(2,z); }

/* Terrarium encodes height as R*256 + G + B/256 − 32768 metres */
function terrariumDecode(rgba){
  const el = new Float32Array(256*256);
  for(let i=0;i<256*256;i++){
    el[i] = (rgba[i*4]*256 + rgba[i*4+1] + rgba[i*4+2]/256) - 32768;
  }
  return el;
}

/* Horn's 3×3 slope and aspect. Edge pixels reuse the nearest row/column. */
function slopeAspect(el, cell){
  const sl = new Float32Array(256*256);
  const as = new Float32Array(256*256);   // aspect, compass bearing the slope faces
  const at = (px,py)=>el[Math.min(255,Math.max(0,py))*256 + Math.min(255,Math.max(0,px))];
  for(let py=0;py<256;py++){
    for(let px=0;px<256;px++){
      const a=at(px-1,py-1), b=at(px,py-1), c2=at(px+1,py-1),
            dd=at(px-1,py),              f=at(px+1,py),
            g=at(px-1,py+1), h=at(px,py+1), i2=at(px+1,py+1);
      const dzdx = ((c2 + 2*f + i2) - (a + 2*dd + g)) / (8*cell);
      const dzdy = ((g + 2*h + i2) - (a + 2*b + c2)) / (8*cell);
      sl[py*256+px] = Math.atan(Math.hypot(dzdx,dzdy)) * 180/Math.PI;
      /* Rows run north to south, so dzdy is the rise going south. The slope
         faces downhill: east component -dzdx, north component +dzdy. */
      as[py*256+px] = (Math.atan2(-dzdx, dzdy) * 180/Math.PI + 360) % 360;
    }
  }
  return {slope:sl, aspect:as};
}

/* ---------- a tile and its eight neighbours ----------
   Layers that look past the cell itself (avalanche runout, cast shadows,
   wind shelter) need the terrain beyond the tile edge, or every tile
   boundary shows up as a seam. They work on a 3×3 block at half resolution
   and keep only the middle. parts is a list of {dx, dy, d} with d a decoded
   tile {el, slope, aspect, cell}; missing neighbours stay NaN. */
const BLOCK_N = 128;            // half the DEM resolution, plenty for these
function blockFromTiles(parts){
  const N = BLOCK_N, M = N*3;
  const el = new Float32Array(M*M).fill(NaN);
  const sl = new Float32Array(M*M).fill(NaN);
  const as = new Float32Array(M*M).fill(NaN);
  let cell = null;
  for(const part of parts){
    if(!part) continue;
    if(cell === null) cell = part.d.cell*2;
    const ox = (part.dx+1)*N, oy = (part.dy+1)*N;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++){
      const s = (j*2)*256 + i*2, o = (oy+j)*M + ox+i;
      el[o] = part.d.el[s];
      sl[o] = part.d.slope[s];
      as[o] = part.d.aspect[s];
    }
  }
  if(cell === null) throw new Error('no elevation here');
  return {el:el, sl:sl, as:as, cell:cell, N:N, M:M};
}

/* ---------- modelled runout, alpha angle rule ----------
   Anything steeper than the release threshold is treated as a possible start
   zone. Snow is then let run downhill from it, and it is allowed to keep going
   only while the line back to its start zone is steeper than the alpha angle.
   Distance is measured along the flow path rather than straight through the
   mountain, which is what a hand-drawn alpha angle uses, so this runs slightly
   short in strongly curved paths.

   Returns P, the height of the alpha cone above sea level at each cell of the
   block. Snow can be there if the cone still clears the ground. Cone height
   only ever falls along a path, so this is Dijkstra with the highest value
   popped first. P must be Float64: with Float32 a popped key no longer equals
   the value stored for its own cell and every entry looks stale. */
function runoutCone(b, alpha, release){
  const M = b.M, el = b.el, sl = b.sl, cell = b.cell;
  const tanA = Math.tan(alpha*Math.PI/180);
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
  return P;
}

/* The middle tile of the block: 1 where the cone clears the ground and the
   cell is not itself a start zone. */
function runoutMiddle(b, P, release){
  const N = b.N, M = b.M, el = b.el, sl = b.sl;
  const mask = new Uint8Array(N*N);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const s = (j+N)*M + (i+N);
    mask[j*N+i] = (P[s] > el[s] && sl[s] < release) ? 1 : 0;
  }
  return mask;
}
