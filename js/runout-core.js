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

/* ---------- potential release areas (AutoATES v2.0) ----------
   NVE's start zones come from AutoATES: a fuzzy mix of slope angle, a wind
   shelter index and forest cover. The numbers are copied from the
   AutoATES v2.0 code (PRA_AutoATES-v2.0.py), quirks included, so the result
   lines up with Varsom's. Worked on the full resolution tile (about 10 m in
   Norway, the grid NVE used), with a margin from the neighbour tiles so the
   shelter index and the sieve see across tile edges.

   Cauchy membership: mu(x) = 1 / (1 + ((x - c)/a)^(2b)).
   Slope (degrees): a 11, b 4, c 43, so mu is 0.5 at 32 and 54 degrees.
   Shelter: the median angle (radians) up or down to every cell within 60 m.
   The parameters a 3, b 10, c 3 make that a smooth step around 0: hollows
   and lee sides about 1, ridges about 0.
   Forest: tree cover in percent (part.d.forest, Copernicus, optional) with
   AutoATES' canopy cover parameters a 40, b 3.5, c -15, so mu is 0.5 at
   25 % and under 0.1 above 40 %. Without data, or with forest: false, it
   is 1. Stronger or weaker curves matched NVE no better.
   AutoATES uses a PRA threshold of 0.15. 0.25 matched NVE slightly better
   in tools/runout-check (docs/alpha-runout-results.md). */
const PRA_OPTS = {radius:60, spacing:10, threshold:0.25, sieve:3, forest:true, forestMu:[40, 3.5, -15]};

/* Median of the first n values of buf, partly reordering it (quickselect).
   Even counts average the two middle values, as numpy's quantile does. */
function medianOf(buf, n){
  const k = (n-1) >> 1;
  let lo = 0, hi = n-1;
  while(lo < hi){
    const piv = buf[(lo+hi) >> 1];
    let i = lo, j = hi;
    while(i <= j){
      while(buf[i] < piv) i++;
      while(buf[j] > piv) j--;
      if(i <= j){ const t = buf[i]; buf[i] = buf[j]; buf[j] = t; i++; j--; }
    }
    if(k <= j) hi = j; else if(k >= i) lo = i; else break;
  }
  if(n & 1) return buf[k];
  let next = Infinity;
  for(let i=k+1;i<n;i++) if(buf[i] < next) next = buf[i];
  return (buf[k] + next) / 2;
}

/* parts: the tile and its eight neighbours as {dx, dy, d} with d.el the full
   256×256 heights and d.forest the tree cover (null where missing). Returns
   1 per pixel of the middle tile where a release area can start. */
function praTile(parts, cell, opt){
  const o = Object.assign({}, PRA_OPTS, opt);
  const R = Math.ceil(o.radius/cell);
  const Q = R + 5, W = 256 + 2*Q;          // 5 px beyond the tile for the sieve
  const el = new Float32Array(W*W).fill(NaN);
  const fo = o.forest ? new Uint8Array(W*W) : null;      // tree cover %, 0 = none
  for(const part of parts){
    if(!part) continue;
    const ox = part.dx*256 + Q, oy = part.dy*256 + Q, src = part.d.el, fsrc = part.d.forest;
    const i0 = Math.max(0, -ox), i1 = Math.min(256, W-ox);
    const j0 = Math.max(0, -oy), j1 = Math.min(256, W-oy);
    if(i0 >= i1) continue;
    for(let j=j0;j<j1;j++){
      el.set(src.subarray(j*256+i0, j*256+i1), (oy+j)*W + ox+i0);
      if(fo && fsrc) fo.set(fsrc.subarray(j*256+i0, j*256+i1), (oy+j)*W + ox+i0);
    }
  }
  /* Forest membership per tree cover value. Over 100 is the service's "no
     data" (sea, outside Europe) and counts as open ground. */
  const MF = new Float64Array(256), [fa, fb, fc] = o.forestMu;
  for(let v=0; v<256; v++) MF[v] = v > 100 ? 1 : 1/(1 + Math.pow((v-fc)/fa, 2*fb));

  /* The cells within the radius on a lattice of o.spacing metres, NVE's
     10 m grid, rounded to our pixels. At 70°N a pixel is under 7 m and on
     Svalbard 4 m, so taking every pixel would cost up to six times more for
     the same median. */
  const offs = [], invd = [], r = Math.round(o.radius/o.spacing), f = o.spacing/cell;
  for(let j=-r; j<=r; j++) for(let i=-r; i<=r; i++){
    if((!i && !j) || i*i+j*j > r*r) continue;
    const dx = Math.round(i*f), dy = Math.round(j*f);
    if(!dx && !dy) continue;
    offs.push(dy*W + dx); invd.push(1/(Math.hypot(dx,dy)*cell));
  }
  const nOff = offs.length, buf = new Float64Array(nOff);

  /* Highest PRA a cell can reach with perfect shelter, to skip the costly
     shelter index on gentle ground: about 28° at the default threshold. */
  const thr = o.threshold;
  const best = ms => ms - ms*ms + ms*(ms+2)/3;

  const lo = R, hi = W - R, S = hi - lo;  // cells with the whole disc inside
  const pra = new Uint8Array(S*S);
  for(let y=lo; y<hi; y++){
    for(let x=lo; x<hi; x++){
      const k = y*W + x, z = el[k];
      const a=el[k-W-1], b=el[k-W], c2=el[k-W+1], dd=el[k-1], f=el[k+1],
            g=el[k+W-1], h=el[k+W], i2=el[k+W+1];
      const dzdx = ((c2 + 2*f + i2) - (a + 2*dd + g)) / (8*cell);
      const dzdy = ((g + 2*h + i2) - (a + 2*b + c2)) / (8*cell);
      const s = Math.atan(Math.hypot(dzdx,dzdy)) * 180/Math.PI;
      if(!(s > 0)) continue;                // NaN too
      const ms = 1/(1 + Math.pow((s-43)/11, 8));
      if(best(ms) <= thr) continue;
      let n = 0;
      for(let q=0;q<nOff;q++){
        const v = el[k+offs[q]];
        if(v === v) buf[n++] = (v - z)*invd[q];
      }
      if(!n) continue;
      const mw = 1/(1 + Math.pow((Math.atan(medianOf(buf, n)) - 3)/3, 20));
      const mf = fo ? MF[fo[k]] : 1;
      const m = Math.min(ms, mw, mf);
      if((1-m)*m + m*(ms+mw+mf)/3 > thr) pra[(y-lo)*S + x-lo] = 1;
    }
  }

  /* Sieve: drop 8-connected clusters of o.sieve cells or fewer. The 5 px
     margin is enough to see whether a cluster touching the tile is small. */
  if(o.sieve > 0){
    const seen = new Uint8Array(S*S), stack = [], members = [];
    for(let s0=0; s0<S*S; s0++){
      if(!pra[s0] || seen[s0]) continue;
      stack.length = 0; members.length = 0;
      stack.push(s0); seen[s0] = 1;
      while(stack.length){
        const s = stack.pop(); members.push(s);
        const sy = (s/S)|0, sx = s - sy*S;
        for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
          const nx = sx+dx, ny = sy+dy;
          if(nx<0 || ny<0 || nx>=S || ny>=S) continue;
          const t = ny*S + nx;
          if(pra[t] && !seen[t]){ seen[t] = 1; stack.push(t); }
        }
      }
      if(members.length <= o.sieve) for(const s of members) pra[s] = 0;
    }
  }

  const out = new Uint8Array(256*256), m0 = Q - lo;
  for(let j=0;j<256;j++) out.set(pra.subarray((j+m0)*S + m0, (j+m0)*S + m0 + 256), j*256);
  return out;
}

/* The PRA of the 3×3 tiles on the block grid. parts as in blockFromTiles,
   with d.pra from praTile. A block cell is a start zone when any of its
   2×2 pixels is: thin gully release areas survive the halving. */
function praBlock(parts){
  const N = BLOCK_N, M = N*3, out = new Uint8Array(M*M);
  for(const part of parts){
    if(!part || !part.d.pra) continue;
    const ox = (part.dx+1)*N, oy = (part.dy+1)*N, p = part.d.pra;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++){
      const s = (j*2)*256 + i*2;
      if(p[s] | p[s+1] | p[s+256] | p[s+257]) out[(oy+j)*M + ox+i] = 1;
    }
  }
  return out;
}

/* Binary max-heap of (key, value) pairs, highest key popped first */
function maxHeap(){
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
  return {push:push, pop:pop, size:()=>hk.length};
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
   the value stored for its own cell and every entry looks stale.

   release is either a slope threshold in degrees or a start zone mask over
   the block (praBlock). */
function isStart(b, release, i){
  return typeof release === 'number' ? b.sl[i] >= release : release[i] === 1;
}
function runoutCone(b, alpha, release, opt){
  const o = Object.assign({zmax:Infinity}, opt);
  const M = b.M, el = b.el, cell = b.cell, top = o.zmax;
  const tanA = Math.tan(alpha*Math.PI/180);
  const P = new Float64Array(M*M).fill(-Infinity);
  const heap = maxHeap(), push = heap.push, pop = heap.pop;

  for(let i=0;i<M*M;i++){
    if(!isNaN(el[i]) && isStart(b, release, i)){ P[i] = el[i]; push(el[i], i); }
  }
  while(heap.size()){
    const popped = pop(), p = popped[0], i = popped[1];
    if(p < P[i]) continue;                                  // stale entry
    const yy = (i/M)|0, xx = i - yy*M;
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
      if(!dx && !dy) continue;
      const nx = xx+dx, ny = yy+dy;
      if(nx<0 || ny<0 || nx>=M || ny>=M) continue;
      const j = ny*M + nx, zj = el[j];
      if(isNaN(zj)) continue;
      const cand = Math.min(p - tanA*cell*((dx && dy) ? Math.SQRT2 : 1), zj + top);
      /* No downhill-only rule: run-up onto the opposite side is real, and a
         hard downhill test makes the model stop dead on flat valley floors. */
      if(cand > zj && cand > P[j]){ P[j] = cand; push(cand, j); }
    }
  }
  return P;
}

/* ---------- routed runout, closer to Flow-Py ----------
   runoutCone lets snow spread in every direction the energy line allows, so
   on flat valley floors and fjords it grows round octagons that NVE does not
   have. Flow-Py (which NVE's layer is built on) routes the flow instead:
   each step shares it among the neighbours by tan(beta/2 + 45°)^8, beta
   being the drop angle to the neighbour, so nearly all of it goes the
   steepest way, and multiplies by a persistence term that favours carrying
   on in the direction it came from (1 straight on, 0.71 at 45°, 0 at 90°).

   Running Flow-Py from every start cell on its own is far too slow here, so
   this keeps one pass per alpha and gives each path a spreading budget
   instead of a flux: 1 at a start cell, multiplied at each step by that
   neighbour's weight relative to the best neighbour's. The steepest way
   costs nothing; each step off it costs a share, and a path stops when the
   budget falls below opt.thr. The energy line is the same as runoutCone's.
   Each cell keeps the step direction of its best path for the persistence.

   On nearly flat ground (block slope under opt.flat degrees, e.g. lakes and
   the sea) the direction is carried on unchanged, or the path would wander
   45° at a time and fill a round fan again. As in Flow-Py the energy line is
   at most opt.zmax (270 m) above the ground.

   tan(beta/2 + 45°) is sec(beta) + tan(beta), so no trigonometry is
   needed. Neighbours the energy line does not clear get no share. The
   settings were picked with tools/runout-check. */
const FLOW_OPTS = {exp:8, thr:0.5, persist:true, zmax:270, flat:3};
const FLOW_DX = [-1,0,1,-1,1,-1,0,1], FLOW_DY = [-1,-1,-1,0,0,1,1,1];
function runoutFlow(b, alpha, release, opt){
  const o = Object.assign({}, FLOW_OPTS, opt);
  const M = b.M, el = b.el, cell = b.cell;
  const tanA = Math.tan(alpha*Math.PI/180);
  const P = new Float64Array(M*M).fill(-Infinity);
  const F = new Float64Array(M*M);           // spreading budget left (Float64, as P)
  const H = new Int8Array(M*M).fill(-1);     // direction of the best step in
  const queued = new Uint8Array(M*M);
  const heap = maxHeap();
  const dist = [], unit = [];
  for(let k=0;k<8;k++){
    const d = Math.hypot(FLOW_DX[k], FLOW_DY[k]);
    dist.push(d*cell); unit.push([FLOW_DX[k]/d, FLOW_DY[k]/d]);
  }
  /* cos of the angle between each pair of directions, below 0 counts as 0 */
  const PERS = new Float32Array(64);
  for(let h=0;h<8;h++) for(let k=0;k<8;k++){
    PERS[h*8+k] = Math.max(0, unit[h][0]*unit[k][0] + unit[h][1]*unit[k][1]);
  }
  const w = new Float64Array(8), cand = new Float64Array(8);

  for(let i=0;i<M*M;i++){
    if(!isNaN(el[i]) && isStart(b, release, i)){
      P[i] = el[i]; F[i] = 1; queued[i] = 1; heap.push(el[i], i);
    }
  }
  while(heap.size()){
    const i = heap.pop()[1];
    if(!queued[i]) continue;                 // already handled since
    queued[i] = 0;
    const yy = (i/M)|0, xx = i - yy*M, zi = el[i], h = H[i];
    let wmax = 0;
    for(let k=0;k<8;k++){
      w[k] = 0;
      const nx = xx+FLOW_DX[k], ny = yy+FLOW_DY[k];
      if(nx<0 || ny<0 || nx>=M || ny>=M) continue;
      const j = ny*M + nx, zj = el[j];
      if(isNaN(zj)) continue;
      const c = Math.min(P[i] - tanA*dist[k], zj + o.zmax);
      if(c <= zj) continue;
      const t = (zi - zj)/dist[k];
      let r = Math.pow(Math.sqrt(1 + t*t) + t, o.exp);
      if(o.persist && h >= 0) r *= PERS[h*8+k];
      w[k] = r; cand[k] = c;
      if(r > wmax) wmax = r;
    }
    if(wmax <= 0) continue;
    for(let k=0;k<8;k++){
      if(w[k] <= 0) continue;
      const f = F[i]*w[k]/wmax;
      if(f < o.thr) continue;
      const j = (yy+FLOW_DY[k])*M + xx+FLOW_DX[k];
      let better = false;
      if(cand[k] > P[j]){
        P[j] = cand[k]; better = true;
        H[j] = (h >= 0 && b.sl[j] < o.flat) ? h : k;
      }
      if(f > F[j]){ F[j] = f; better = true; }
      if(better){ queued[j] = 1; heap.push(P[j], j); }
    }
  }
  return P;
}

/* The middle tile of the block: 1 where the cone clears the ground or the
   cell is a start zone. With a slope threshold, start zones are left out.
   With a start zone mask, ground steeper than maxSlope (optional) is left
   out instead, as NVE's map does above 27°. The app does not: our slope from
   the ~7 m Terrarium pixels runs steeper than NVE's 10 m classes, and
   blanking over 27° cut a fifth of the bands NVE draws. */
function runoutMiddle(b, P, release, maxSlope){
  const N = b.N, M = b.M, el = b.el, sl = b.sl;
  const byMask = typeof release !== 'number', top = maxSlope ?? Infinity;
  const mask = new Uint8Array(N*N);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const s = (j+N)*M + (i+N);
    const open = byMask ? sl[s] <= top : sl[s] < release;
    mask[j*N+i] = (P[s] >= el[s] && open) ? 1 : 0;
  }
  return mask;
}

/* ---------- the three NVE bands ----------
   Lied & Bakkehøi's alpha angles as NVE uses them: 32° reaches as far as the
   median avalanche from a path, 27° the 75th and 23° the 95th percentile.
   Returns the middle tile, one byte per cell: 0 none, 1 short, 2 medium,
   3 long, each cell getting the shortest band that reaches it. */
const RUNOUT_ALPHAS = [32, 27, 23];
function runoutBands(b, start, maxSlope, opt){
  const N = b.N, out = new Uint8Array(N*N);
  for(let k=RUNOUT_ALPHAS.length-1; k>=0; k--){
    const m = runoutMiddle(b, runoutFlow(b, RUNOUT_ALPHAS[k], start, opt), start, maxSlope);
    for(let i=0;i<N*N;i++) if(m[i]) out[i] = k+1;
  }
  return out;
}

/* The two jobs runout.js asks for, in the worker or, without one, on the
   page. 'pra': release areas of one tile from it and its neighbours (el
   and forest are needed). 'bands': the three bands of the middle tile, from the 3×3
   tiles with el, slope, aspect, cell and pra. */
function runoutJob(type, a){
  if(type === 'pra') return praTile(a.parts, a.cell);
  return runoutBands(blockFromTiles(a.parts), praBlock(a.parts), a.maxSlope);
}
