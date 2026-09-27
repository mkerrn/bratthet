/* ---------- slope layer, computed from terrarium elevation tiles ---------- */
const DEM_MAX_Z = 13;
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const demCache = new Map();     // "z/x/y" -> {el, slope, cell}
let demFailed = false;

function demTileUrl(z,x,y){ return DEM_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y); }

function tileLat(z,y){
  const n = Math.PI - 2*Math.PI*(y+0.5)/Math.pow(2,z);
  return Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
}

/* One decode per elevation tile. Elevation is kept as well as slope, because
   the runout model needs heights, not just angles. */
function loadDem(z,x,y){
  const key = z+'/'+x+'/'+y;
  if(demCache.has(key)) return Promise.resolve(demCache.get(key));
  const p = new Promise((resolve,reject)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const cx = c.getContext('2d', {willReadFrequently:true});
      cx.drawImage(img,0,0,256,256);
      let d;
      try { d = cx.getImageData(0,0,256,256).data; }
      catch(err){ demFailed = true; reject(err); return; }
      const el = new Float32Array(256*256);
      for(let i=0;i<256*256;i++){
        el[i] = (d[i*4]*256 + d[i*4+1] + d[i*4+2]/256) - 32768;
      }
      const cell = 156543.03392 * Math.cos(tileLat(z,y)) / Math.pow(2,z);
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
      const rec = {el:el, slope:sl, aspect:as, cell:cell};
      demCache.set(key, rec);
      resolve(rec);
    };
    img.onerror = ()=>{ demFailed = true; reject(new Error('elevation tile failed')); };
    img.src = demTileUrl(z,x,y);
  });
  return p;
}
function loadSlope(z,x,y){ return loadDem(z,x,y).then(d=>d.slope); }

/* ---------- a tile and its eight neighbours ----------
   Layers that look past the cell itself (avalanche runout, cast shadows,
   wind shelter) need the terrain beyond the tile edge, or every tile
   boundary shows up as a seam. They work on a 3×3 block at half resolution
   and keep only the middle. Missing neighbours stay NaN. Not cached: the
   tiles are, and each layer caches its own result. */
const BLOCK_N = 128;            // half the DEM resolution, plenty for these
async function demBlock(z,x,y){
  const N = BLOCK_N, M = N*3;
  const el = new Float32Array(M*M).fill(NaN);
  const sl = new Float32Array(M*M).fill(NaN);
  const as = new Float32Array(M*M).fill(NaN);
  let cell = null;
  const jobs = [];
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    jobs.push(loadDem(z, x+dx, y+dy).then(d=>({dx,dy,d})).catch(()=>null));
  }
  for(const part of await Promise.all(jobs)){
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

const SlopeLayer = L.GridLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    const dz = Math.max(0, coords.z - DEM_MAX_Z);
    const pz = coords.z - dz, px = coords.x >> dz, py = coords.y >> dz;

    loadDem(pz, px, py).then(d=>{
      const sl = d.slope, as = d.aspect, el = d.el;
      const work = document.createElement('canvas'); work.width = work.height = 256;
      const wc = work.getContext('2d');
      const img = wc.createImageData(256,256);
      const rgb = bands.map(b=>hexToRgb(b.color));
      /* null means "no filter", so the common case skips the extra tests */
      const spec = bands.map(b=>({
        min:b.min, max:b.max,
        asp: b.aspFrom == null ? null : {from:b.aspFrom, width:(b.aspTo - b.aspFrom + 360) % 360},
        lo: b.elMin, hi: b.elMax
      }));
      for(let i=0;i<256*256;i++){
        const s = sl[i];
        let k = -1;
        for(let j=0;j<spec.length;j++){
          const b = spec[j];
          if(s < b.min || s >= b.max) continue;
          if(b.lo != null && el[i] < b.lo) continue;
          if(b.hi != null && el[i] > b.hi) continue;
          if(b.asp && s >= FLAT_BELOW && (as[i] - b.asp.from + 360) % 360 > b.asp.width) continue;
          k = j; break;
        }
        if(k<0) continue;
        img.data[i*4]   = rgb[k][0];
        img.data[i*4+1] = rgb[k][1];
        img.data[i*4+2] = rgb[k][2];
        img.data[i*4+3] = 255;
      }
      wc.putImageData(img,0,0);
      const sw = 256/Math.pow(2,dz);
      const sx = (coords.x - (px<<dz))*sw, sy = (coords.y - (py<<dz))*sw;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(work, sx, sy, sw, sw, 0, 0, 256, 256);
      done(null, tile);
    }).catch(()=>{ done(null, tile); });

    return tile;
  }
});
const slope = new SlopeLayer({maxZoom:18, opacity:0.65, tileSize:256, pane:'slopePane'});
