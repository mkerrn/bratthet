/* ---------- hillshading, from the same elevation tiles ----------
   Standard hillshade: light from azimuth 315°, 45° above the horizon, using
   the slope and aspect already computed for each cell. The value is divided
   by what flat ground gets, so flat and sunlit ground stay white (no change
   under multiply) and only slopes turned away from the light are shaded. */
let shadeAz = 315;             // compass direction the light comes from
const SHADE_ALT = 45;          // degrees above the horizon

function paintShadeTile(tile, coords){
  const dz = Math.max(0, coords.z - DEM_MAX_Z);
  const pz = coords.z - dz, px = coords.x >> dz, py = coords.y >> dz;
  return loadDem(pz, px, py).then(d=>{
    const rad = Math.PI/180;
    const zen = (90 - SHADE_ALT)*rad, cz = Math.cos(zen), sz = Math.sin(zen);
    const work = document.createElement('canvas'); work.width = work.height = 256;
    const wc = work.getContext('2d');
    const img = wc.createImageData(256,256);
    for(let i=0;i<256*256;i++){
      const sl = d.slope[i]*rad;
      const hs = cz*Math.cos(sl) + sz*Math.sin(sl)*Math.cos((shadeAz - d.aspect[i])*rad);
      const g = 255 * Math.min(1, Math.max(0, hs/cz));
      img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = g;
      img.data[i*4+3] = 255;
    }
    wc.putImageData(img,0,0);
    const sw = 256/Math.pow(2,dz);
    const sx = (coords.x - (px<<dz))*sw, sy = (coords.y - (py<<dz))*sw;
    const ctx = tile.getContext('2d');
    ctx.imageSmoothingEnabled = true;       // soft when zoomed past the data
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work, sx, sy, sw, sw, 0, 0, 256, 256);
  });
}
const ShadeLayer = L.GridLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    paintShadeTile(tile, coords).then(()=>done(null, tile)).catch(()=>done(null, tile));
    return tile;
  }
});
const shade = new ShadeLayer({maxZoom:18, opacity:0.55, tileSize:256, pane:'shadePane'});
/* Turning the light repaints the tiles already on screen rather than
   rebuilding the layer, so dragging the dial does not flash. */
function repaintShade(){
  if(!map.hasLayer(shade)) return;
  Object.values(shade._tiles).forEach(t=>{ paintShadeTile(t.el, t.coords).catch(()=>{}); });
}
function applyShade(){
  const ticked = document.getElementById('shadeOn').checked;
  document.getElementById('shadeRow').classList.toggle('off', !ticked);
  if(ticked && !map.hasLayer(shade)) shade.addTo(map);
  if(!ticked && map.hasLayer(shade)) map.removeLayer(shade);
}
document.getElementById('shadeOn').onchange = ()=> applyShade();
document.getElementById('shadeOpacity').oninput = e=> shade.setOpacity(e.target.value/100);

/* ----- the light dial ----- */
const sunDial = document.getElementById('sunDial');
function paintSun(){
  const t = shadeAz*Math.PI/180;
  const x = (13*Math.sin(t)).toFixed(2), y = (-13*Math.cos(t)).toFixed(2);
  document.getElementById('sunDot').setAttribute('cx', x);
  document.getElementById('sunDot').setAttribute('cy', y);
  document.getElementById('sunRay').setAttribute('d', 'M0 0 L' + x + ' ' + y);
  document.getElementById('sunDeg').textContent = dirName(shadeAz);
  sunDial.setAttribute('aria-valuenow', shadeAz);
  sunDial.setAttribute('aria-valuetext', 'Light from ' + dirName(shadeAz) + ', ' + shadeAz + '°');
  sunDial.setAttribute('title', 'Light from ' + dirName(shadeAz) + ' (' + shadeAz + '°)');
}
let sunQueued = false;
function setSun(deg){
  const v = norm360(Math.round(deg/5)*5);
  if(v === shadeAz) return;
  shadeAz = v;
  paintSun();
  /* Choosing a light direction means you want to see it. */
  const box = document.getElementById('shadeOn');
  if(!box.checked){ box.checked = true; applyShade(); syncOrderChecks(); }
  if(!sunQueued){
    sunQueued = true;
    requestAnimationFrame(()=>{ sunQueued = false; repaintShade(); });
  }
}
function sunFromEvent(e){
  const r = sunDial.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width/2), dy = e.clientY - (r.top + r.height/2);
  if(Math.hypot(dx, dy) < r.width*0.08) return;          // dead centre: no direction
  setSun(Math.atan2(dx, -dy)*180/Math.PI);
}
sunDial.addEventListener('pointerdown', e=>{ sunDial.setPointerCapture(e.pointerId); sunFromEvent(e); });
sunDial.addEventListener('pointermove', e=>{ if(sunDial.hasPointerCapture(e.pointerId)) sunFromEvent(e); });
sunDial.addEventListener('keydown', e=>{
  const step = e.shiftKey ? 45 : 5;
  if(e.key === 'ArrowRight' || e.key === 'ArrowUp'){ setSun(shadeAz + step); e.preventDefault(); }
  if(e.key === 'ArrowLeft' || e.key === 'ArrowDown'){ setSun(shadeAz - step); e.preventDefault(); }
});
paintSun();
