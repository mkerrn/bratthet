/* ---------- slope layer, computed from terrarium elevation tiles ---------- */
const DEM_MAX_Z = 13;
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const demCache = new Map();     // "z/x/y" -> {el, slope, cell}
let demFailed = false;

function demTileUrl(z,x,y){ return DEM_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y); }

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
      const el = terrariumDecode(d);
      const cell = tileCell(z,y);
      const sa = slopeAspect(el, cell);
      const rec = {el:el, slope:sa.slope, aspect:sa.aspect, cell:cell};
      demCache.set(key, rec);
      resolve(rec);
    };
    img.onerror = ()=>{ demFailed = true; reject(new Error('elevation tile failed')); };
    img.src = demTileUrl(z,x,y);
  });
  return p;
}
function loadSlope(z,x,y){ return loadDem(z,x,y).then(d=>d.slope); }

/* A tile and its eight neighbours as [{dx, dy, d}], null where a tile
   failed. load is loadDem or anything that resolves to the same record. */
function demParts(z,x,y,load){
  const jobs = [];
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    jobs.push((load || loadDem)(z, x+dx, y+dy).then(d=>({dx,dy,d})).catch(()=>null));
  }
  return Promise.all(jobs);
}

/* The 3×3 block around a tile (see blockFromTiles in runout-core.js). Not
   cached: the tiles are, and each layer caches its own result. */
async function demBlock(z,x,y){
  return blockFromTiles(await demParts(z,x,y));
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
document.getElementById('slopeOpacity').oninput = e=> slope.setOpacity(e.target.value/100);
