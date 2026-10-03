/* ---------- modelled runout, alpha angle rule ----------
   The model itself is runoutCone in runout-core.js. The classic field rule of
   thumb: sight 18–20° up from where you stand, and if that line reaches the
   start zone you are standing in the runout.                                 */
const RUN_N = BLOCK_N;
const runoutCache = new Map();
let runAlpha = 18, runRelease = 30;

async function runoutMask(z,x,y,alpha,release){
  const key = [z,x,y,alpha,release].join('/');
  if(runoutCache.has(key)) return runoutCache.get(key);

  /* Avalanches do not respect tile edges, so model a 3×3 block and keep the
     middle. Without this every tile boundary grows a false stopping line. */
  const b = await demBlock(z,x,y);
  const mask = runoutMiddle(b, runoutCone(b, alpha, release), release);
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
