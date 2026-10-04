/* ---------- sun and wind exposure ----------
   Two guesses at what the weather has done to the snow, computed from the
   same elevation tiles as the slope colours. Sun: how long each spot is in
   direct sun on a given day, with shadows cast by the terrain around it.
   Wind: whether the ground just upwind rises above a spot (sheltered, where
   drifting snow is dropped) or falls away from it (exposed, where it is
   blown off). Both work on the 3×3 block from demBlock, so shadows and
   shelter carry across tile edges. */
const EXP_RAD = Math.PI/180;

/* Draws the middle N×N of a block result onto a map tile. fill() writes
   RGBA into the image. Zoomed past the elevation data, the tile is cut out
   of the parent and smoothed, as for the hillshade. */
function drawBlockTile(tile, coords, fill){
  const dz = Math.max(0, coords.z - DEM_MAX_Z);
  const px = coords.x >> dz, py = coords.y >> dz, N = BLOCK_N;
  const work = document.createElement('canvas'); work.width = work.height = N;
  const wc = work.getContext('2d');
  const img = wc.createImageData(N, N);
  fill(img.data);
  wc.putImageData(img, 0, 0);
  const sw = N/Math.pow(2,dz);
  const sx = (coords.x - (px<<dz))*sw, sy = (coords.y - (py<<dz))*sw;
  const ctx = tile.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(work, sx, sy, sw, sw, 0, 0, 256, 256);
}
function demCoords(coords){
  const dz = Math.max(0, coords.z - DEM_MAX_Z);
  return {z:coords.z - dz, x:coords.x >> dz, y:coords.y >> dz};
}
/* One layer class for both: options.paint(tile, coords) returns a promise. */
const ExposureLayer = L.GridLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    this.options.paint(tile, coords).then(()=>done(null, tile)).catch(()=>done(null, tile));
    return tile;
  }
});
/* Repaint the tiles on screen in place, so dragging a control does not flash. */
function repaintExposure(layer){
  if(!map.hasLayer(layer)) return;
  Object.values(layer._tiles).forEach(t=>{ layer.options.paint(t.el, t.coords).catch(()=>{}); });
  changed3d(layer);
}
function colourRamp(stops){
  /* 101 steps of [r,g,b,a] between the stops, a in 0..255 */
  const lut = [];
  for(let k=0;k<=100;k++){
    const r = k/100;
    let s = 1;
    while(s < stops.length-1 && stops[s][0] < r) s++;
    const a = stops[s-1], b = stops[s], t = (r - a[0])/((b[0] - a[0]) || 1);
    lut.push([1,2,3,4].map(c=>Math.round(a[c] + (b[c] - a[c])*t)));
  }
  return lut;
}

/* ---------- sun ---------- */
const SUN_STEP = 15;           // minutes between sun positions over the day
const SUN_MIN_ANGLE = 5;       // sun lower than this over the slope is not counted

/* Low-precision solar position (the Astronomical Almanac formula). It is
   good to a fraction of a degree, far finer than the terrain. */
function solarPos(ms, lat, lon){
  const d = ms/86400000 - 10957.5;                       // days since J2000.0
  const g = (357.529 + 0.98560028*d)*EXP_RAD;
  const q = 280.459 + 0.98564736*d;
  const L = (q + 1.915*Math.sin(g) + 0.020*Math.sin(2*g))*EXP_RAD;
  const e = (23.439 - 0.00000036*d)*EXP_RAD;
  const ra = Math.atan2(Math.cos(e)*Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e)*Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908*d;       // hours
  const H = (gmst*15 + lon)*EXP_RAD - ra;
  const la = lat*EXP_RAD;
  const alt = Math.asin(Math.sin(la)*Math.sin(dec) + Math.cos(la)*Math.cos(dec)*Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec)*Math.cos(la) - Math.sin(la)*Math.cos(H));
  return {alt: alt/EXP_RAD, az: (az/EXP_RAD + 360) % 360};
}
/* Days and clock times are in the device's own time zone. */
function dayStart(iso){ return new Date(iso + 'T00:00:00').getTime(); }
function clockAt(iso, m){
  return new Date(dayStart(iso) + m*60000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
/* Sun positions for every step of the day with the sun above the horizon,
   taken in the middle of each step. */
function sunSteps(iso, lat, lon){
  const t0 = dayStart(iso), out = [];
  for(let m=0; m<1440; m+=SUN_STEP){
    const p = solarPos(t0 + (m + SUN_STEP/2)*60000, lat, lon);
    if(p.alt > 0) out.push({m:m, alt:p.alt, az:p.az});
  }
  return out;
}

/* Cast shadows over the whole block for one sun position. Sweep away from
   the sun one row or column at a time, carrying the height of the shadow
   surface: it drops by tan(altitude) per metre travelled and is lifted
   wherever the ground pokes through it. Ground under the surface is in
   shadow. One pass costs the same however long the shadows are. */
const shadeM = BLOCK_N*3;
const shadeTop = new Float32Array(shadeM*shadeM);
const shadeDark = new Uint8Array(shadeM*shadeM);
function castShadows(b, az, alt){
  const M = b.M, el = b.el, H = shadeTop, dark = shadeDark;
  const sx = Math.sin(az*EXP_RAD), sy = -Math.cos(az*EXP_RAD);    // towards the sun; rows run south
  const byCol = Math.abs(sx) >= Math.abs(sy);
  const major = byCol ? sx : sy, minor = (byCol ? sy : sx)/Math.abs(major);
  const dir = major > 0 ? 1 : -1;
  const drop = b.cell*Math.hypot(1, minor)*Math.tan(alt*EXP_RAD);
  const su = byCol ? 1 : M, sv = byCol ? M : 1;
  for(let k=0;k<M;k++){
    const u = dir > 0 ? M-1-k : k, up = u + dir;
    const inside = up >= 0 && up < M;
    for(let v=0; v<M; v++){
      const i = u*su + v*sv;
      const g = el[i] === el[i] ? el[i] : -1e9;          // missing ground casts nothing
      let h = -1e9;
      if(inside){
        const fv = v + minor, v0 = Math.floor(fv);
        if(v0 >= 0 && v0 < M-1){
          const t = fv - v0, j = up*su + v0*sv;
          h = H[j]*(1-t) + H[j+sv]*t - drop;
        }
      }
      dark[i] = h > g ? 1 : 0;
      H[i] = h > g ? h : g;
    }
  }
  return dark;
}

/* The most sun any slope can get that day: one facing the midday sun, tilted
   to meet it square on at noon. Effective hours are scaled against it, and
   it depends only on latitude and date, so neighbouring tiles agree. */
function sunRef(steps, lat){
  if(!steps.length) return 0;
  let noon = steps[0];
  for(const s of steps) if(s.alt > noon.alt) noon = s;
  const tilt = (90 - noon.alt)*EXP_RAD, face = lat >= 0 ? 180 : 0;
  let sum = 0;
  for(const s of steps){
    const zen = (90 - s.alt)*EXP_RAD;
    const ci = Math.cos(zen)*Math.cos(tilt) + Math.sin(zen)*Math.sin(tilt)*Math.cos((s.az - face)*EXP_RAD);
    if(ci > 0) sum += ci*SUN_STEP/60;
  }
  return sum;
}

/* Day mode: effective hours of sun per cell. An hour of sun hitting the
   ground square on counts as an hour, glancing sun for less, because that is
   what warms the snow. Also the plain hours in sun, and the first and last
   minute in sun.
   Time mode: how square-on the sun hits each cell (0 = shade). Cached as
   promises so the readout and the tile share one computation. */
const sunCache = new Map();
function sunGrid(z,x,y,iso,mode,minute){
  const key = [z,x,y,iso,mode,mode === 'time' ? minute : 0].join('/');
  if(sunCache.has(key)) return sunCache.get(key);
  const p = demBlock(z,x,y).then(b=>{
    const N = b.N, M = b.M;
    const lat = tileLat(z,y)/EXP_RAD, lon = (x+0.5)/Math.pow(2,z)*360 - 180;
    let steps;
    if(mode === 'time'){
      const s = solarPos(dayStart(iso) + minute*60000, lat, lon);
      steps = s.alt > 0 ? [{m:minute, alt:s.alt, az:s.az}] : [];
    } else steps = sunSteps(iso, lat, lon);
    const val = new Float32Array(N*N), hrs = new Float32Array(N*N);
    const first = new Int16Array(N*N).fill(-1), last = new Int16Array(N*N).fill(-1);
    const minCos = Math.sin(SUN_MIN_ANGLE*EXP_RAD);
    for(const s of steps){
      const dark = castShadows(b, s.az, s.alt);
      const zen = (90 - s.alt)*EXP_RAD, cz = Math.cos(zen), sz = Math.sin(zen);
      for(let j=0;j<N;j++) for(let i=0;i<N;i++){
        const bi = (j+N)*M + i+N, o = j*N + i;
        if(dark[bi]) continue;
        const sl = b.sl[bi]*EXP_RAD;
        const ci = cz*Math.cos(sl) + sz*Math.sin(sl)*Math.cos((s.az - b.as[bi])*EXP_RAD);
        if(!(ci >= minCos)) continue;                    // also skips missing cells
        if(mode === 'time'){ val[o] = ci; continue; }
        val[o] += ci*SUN_STEP/60;
        hrs[o] += SUN_STEP/60;
        if(first[o] < 0) first[o] = s.m;
        last[o] = s.m + SUN_STEP;
      }
    }
    return {val:val, hrs:hrs, first:first, last:last, up:steps.length > 0, ref:sunRef(steps, lat)};
  });
  p.catch(()=>sunCache.delete(key));
  if(sunCache.size > 120) sunCache.clear();
  sunCache.set(key, p);
  return p;
}

/* Blue for shade through clear to yellow and orange for long sun. The ramp
   is scaled to the length of the day, so midwinter still shows contrast. */
const SUN_DAY_RAMP = colourRamp([
  [0,    40, 90,215,205], [0.2, 120,165,235,115], [0.4, 120,165,235,0],
  [0.6, 255,210, 60,0],   [0.8, 255,200, 50,115], [1,   255,120,  0,190]
]);
let sunToken = 0;
function sunSettings(){
  return {
    iso: document.getElementById('sunDate').value || TODAY,
    mode: document.getElementById('sunMode').value,
    minute: +document.getElementById('sunTime').value
  };
}
function paintSunTile(tile, coords){
  const tok = sunToken, s = sunSettings(), c = demCoords(coords);
  return sunGrid(c.z, c.x, c.y, s.iso, s.mode, s.minute).then(g=>{
    if(tok !== sunToken) return;                         // settings changed meanwhile
    drawBlockTile(tile, coords, data=>{
      if(!g.up) return;
      for(let i=0;i<g.val.length;i++){
        let rgba;
        if(s.mode === 'time') rgba = g.val[i] > 0 ? [255,210,60,Math.round(130*g.val[i])] : [40,90,215,160];
        else rgba = SUN_DAY_RAMP[Math.min(100, Math.round(100*g.val[i]/g.ref))];
        data[i*4] = rgba[0]; data[i*4+1] = rgba[1]; data[i*4+2] = rgba[2]; data[i*4+3] = rgba[3];
      }
    });
  });
}
const sunLayer = new ExposureLayer({maxZoom:18, opacity:0.7, tileSize:256, pane:'sunPane', paint:paintSunTile});

/* Status line and legend for the map centre. */
function updateSunInfo(){
  const s = sunSettings(), c = map.getCenter();
  const timeMode = s.mode === 'time';
  document.getElementById('sunTimeRow').hidden = !timeMode;
  document.getElementById('sunTimeOut').textContent = clockAt(s.iso, s.minute);
  document.getElementById('sunBar').classList.toggle('at-time', timeMode);
  const st = document.getElementById('sunStatus');
  const steps = sunSteps(s.iso, c.lat, c.lng);
  const len = steps.length*SUN_STEP/60;
  const leg = document.getElementById('sunLegend').children[1].children;
  if(timeMode){
    leg[0].textContent = 'Shade'; leg[1].textContent = ''; leg[2].textContent = 'Sun straight on';
    const p = solarPos(dayStart(s.iso) + s.minute*60000, c.lat, c.lng);
    st.textContent = p.alt > 0
      ? 'At ' + clockAt(s.iso, s.minute) + ' ' + niceDate(s.iso) + ' the sun is ' + Math.round(p.alt) + '° up in the ' + dirName(p.az) + ' at the map centre.'
      : 'The sun is below the horizon at ' + clockAt(s.iso, s.minute) + ' ' + niceDate(s.iso) + '.';
    return;
  }
  const ref = sunRef(steps, c.lat);
  leg[0].textContent = '0 h'; leg[1].textContent = (ref/2).toFixed(1) + ' h'; leg[2].textContent = ref.toFixed(1) + ' h of full sun';
  if(!steps.length) st.textContent = 'The sun does not rise at the map centre ' + niceDate(s.iso) + '.';
  else if(steps.length*SUN_STEP >= 1440) st.textContent = 'Midnight sun at the map centre ' + niceDate(s.iso) + '.';
  else st.textContent = 'Sun above the horizon ' + clockAt(s.iso, steps[0].m) + '–' +
    clockAt(s.iso, steps[steps.length-1].m + SUN_STEP) + ' ' + niceDate(s.iso) + ' at the map centre (' + len.toFixed(1) + ' h).';
}
function applySun(){
  const on = document.getElementById('sunOn').checked;
  if(on && !map.hasLayer(sunLayer)) sunLayer.addTo(map);
  if(!on && map.hasLayer(sunLayer)) map.removeLayer(sunLayer);
  updateSunInfo();
}
/* Changing a sun setting means you want to see it. */
let sunQueuedExp = false;
function sunChanged(){
  const box = document.getElementById('sunOn');
  if(!box.checked){ box.checked = true; applySun(); syncOrderChecks(); }
  sunToken++;
  updateSunInfo();
  routeExpSoon();
  if(!sunQueuedExp){
    sunQueuedExp = true;
    requestAnimationFrame(()=>{ sunQueuedExp = false; repaintExposure(sunLayer); });
  }
}
const sunDateEl = document.getElementById('sunDate');
sunDateEl.value = TODAY;
sunDateEl.onchange = sunChanged;
document.getElementById('sunPrev').onclick = ()=>{ sunDateEl.value = addDays(sunDateEl.value || TODAY, -1); sunChanged(); };
document.getElementById('sunNext').onclick = ()=>{ sunDateEl.value = addDays(sunDateEl.value || TODAY, 1); sunChanged(); };
document.getElementById('sunToday').onclick = ()=>{ sunDateEl.value = TODAY; sunChanged(); };
document.getElementById('sunMode').onchange = sunChanged;
document.getElementById('sunTime').oninput = sunChanged;
document.getElementById('sunOpacity').oninput = e=> sunLayer.setOpacity(e.target.value/100);

/* ---------- wind ---------- */
const WIND_REACH = 300;        // metres upwind that can shelter a spot
const WIND_FAN = 15;           // degrees either side of the wind direction
const WIND_DRIFT = 5;          // m/s, roughly where loose snow starts to move
const WIND_EDGE = 8;           // degrees of shelter or exposure before it is coloured; less is any gentle slope
const WIND_MIN_Z = 11;         // coarser cells make a 300 m reach meaningless

/* Winstral's shelter index: the steepest angle up to the terrain within
   the reach, looking upwind along three rays. Positive means something
   upwind stands above the spot (lee), negative that the ground falls away
   towards the wind (ridge crests and windward slopes). */
const windCache = new Map();
function windGrid(z,x,y,from){
  const key = [z,x,y,from].join('/');
  if(windCache.has(key)) return windCache.get(key);
  const p = demBlock(z,x,y).then(b=>{
    const N = b.N, M = b.M, el = b.el;
    const K = Math.min(N, Math.ceil(WIND_REACH/b.cell));
    const rays = [-WIND_FAN, 0, WIND_FAN].map(o=>[Math.sin((from+o)*EXP_RAD), -Math.cos((from+o)*EXP_RAD)]);
    const sx = new Float32Array(N*N).fill(NaN);
    for(let j=0;j<N;j++) for(let i=0;i<N;i++){
      const e0 = el[(j+N)*M + i+N];
      if(e0 !== e0) continue;
      let best = -Infinity;
      for(const r of rays){
        for(let k=1;k<=K;k++){
          const e = el[Math.round(j+N + r[1]*k)*M + Math.round(i+N + r[0]*k)];
          if(e !== e) break;
          const t = (e - e0)/k;
          if(t > best) best = t;
        }
      }
      sx[j*N+i] = Math.atan(best/b.cell)/EXP_RAD;
    }
    return sx;
  });
  p.catch(()=>windCache.delete(key));
  if(windCache.size > 120) windCache.clear();
  windCache.set(key, p);
  return p;
}
const WIND_LOADED = [232,70,124], WIND_SCOURED = [43,179,163];
function windClass(sx){ return sx > WIND_EDGE ? 1 : sx < -WIND_EDGE ? -1 : 0; }

/* Where the wind comes from: the model's last three days, or the dial. */
let windSrc = 'auto', windHand = 270;
let windAuto = null;           // {from, max, hours, steady, elev}; from is null without drifting wind
let windAt = null;             // map centre of the last fetch
let windToken = 0;
function windFromNow(){
  if(windSrc === 'hand') return windHand;
  return windAuto ? windAuto.from : null;
}
function paintWindTile(tile, coords){
  const tok = windToken, from = windFromNow(), c = demCoords(coords);
  if(from === null || c.z < WIND_MIN_Z){
    tile.getContext('2d').clearRect(0, 0, 256, 256);
    return Promise.resolve();
  }
  return windGrid(c.z, c.x, c.y, from).then(sx=>{
    if(tok !== windToken) return;
    drawBlockTile(tile, coords, data=>{
      for(let i=0;i<sx.length;i++){
        const k = windClass(sx[i]);
        if(!k) continue;
        const rgb = k > 0 ? WIND_LOADED : WIND_SCOURED;
        const a = Math.min(1, (Math.abs(sx[i]) - WIND_EDGE)/20);
        data[i*4] = rgb[0]; data[i*4+1] = rgb[1]; data[i*4+2] = rgb[2];
        data[i*4+3] = Math.round(50 + 170*a);
      }
    });
  });
}
const windLayer = new ExposureLayer({maxZoom:18, opacity:0.6, tileSize:256, pane:'windPane', paint:paintWindTile});

function updateWindInfo(){
  const from = windFromNow();
  document.getElementById('windDeg').textContent = from === null ? '—' : dirName(from);
  const dot = document.getElementById('windDot'), ray = document.getElementById('windRay');
  const dial = document.getElementById('windDial');
  dot.style.display = ray.style.display = from === null ? 'none' : '';
  if(from !== null){
    const t = from*EXP_RAD;
    const x = (13*Math.sin(t)).toFixed(2), y = (-13*Math.cos(t)).toFixed(2);
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    ray.setAttribute('d', 'M0 0 L' + x + ' ' + y);
    dial.setAttribute('aria-valuenow', from);
    dial.setAttribute('aria-valuetext', 'Wind from ' + dirName(from) + ', ' + from + '°');
  }
  const st = document.getElementById('windStatus');
  let msg;
  if(windSrc === 'hand') msg = 'Wind set by hand: from ' + dirName(windHand) + '.';
  else if(!windAuto) msg = windAt ? 'Fetching the wind of the last three days…' : '';
  else if(windAuto.error) msg = 'Could not fetch the wind from Open-Meteo. Set the direction by hand.';
  else if(windAuto.from === null)
    msg = 'Last three days at the map centre: no hour with drifting wind (' + WIND_DRIFT + ' m/s or more), at most ' +
      Math.round(windAuto.max) + ' m/s. Set a direction by hand to see where wind would load.';
  else msg = 'Last three days at the map centre: drifting wind for ' + windAuto.hours + ' h, mostly from ' +
      dirName(windAuto.from) + (windAuto.steady < 0.6 ? ' but shifting' : '') + ', up to ' + Math.round(windAuto.max) +
      ' m/s (Open-Meteo model, ' + Math.round(windAuto.elev) + ' m).';
  if(document.getElementById('windOn').checked && map.getZoom() < WIND_MIN_Z) msg += ' Zoom in to see it on the map.';
  st.textContent = msg;
}
function fetchWind(){
  const c = map.getCenter(), tok = ++windToken;
  windAt = c;
  windAuto = null;
  updateWindInfo();
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) +
    '&hourly=wind_speed_10m,wind_direction_10m&past_days=3&forecast_days=1&wind_speed_unit=ms&timezone=GMT';
  fetchJson(url).then(j=>{
    if(tok !== windToken) return;
    const h = j.hourly, now = Date.now();
    let u = 0, v = 0, w = 0, max = 0, n = 0;
    h.time.forEach((t, i)=>{
      const ms = Date.parse(t + 'Z');
      if(ms > now || ms < now - 72*3600000) return;
      const s = h.wind_speed_10m[i], d = h.wind_direction_10m[i];
      if(s == null || d == null) return;
      max = Math.max(max, s);
      if(s < WIND_DRIFT) return;
      u += s*Math.sin(d*EXP_RAD); v += s*Math.cos(d*EXP_RAD); w += s; n++;
    });
    /* Round to 5° so small shifts between fetches reuse the cache. */
    const from = n ? norm360(Math.round(Math.atan2(u, v)/EXP_RAD/5)*5) : null;
    windAuto = {from:from, max:max, hours:n, steady:n ? Math.hypot(u, v)/w : 0, elev:j.elevation};
    updateWindInfo();
    repaintExposure(windLayer);
    routeExpSoon();
  }).catch(()=>{
    if(tok !== windToken) return;
    windAuto = {from:null, max:0, hours:0, error:true};
    windAt = null;                                       // try again after the next move
    updateWindInfo();
    repaintExposure(windLayer);
  });
}
function applyWind(){
  const on = document.getElementById('windOn').checked;
  if(on && windSrc === 'auto' && !windAt) fetchWind();
  if(on && !map.hasLayer(windLayer)) windLayer.addTo(map);
  if(!on && map.hasLayer(windLayer)) map.removeLayer(windLayer);
  updateWindInfo();
  routeExpSoon();
}
let windQueued = false;
function windChanged(){
  const box = document.getElementById('windOn');
  if(!box.checked){ box.checked = true; applyWind(); syncOrderChecks(); }
  windToken++;
  updateWindInfo();
  routeExpSoon();
  if(!windQueued){
    windQueued = true;
    requestAnimationFrame(()=>{ windQueued = false; repaintExposure(windLayer); });
  }
}
document.getElementById('windSrc').onchange = e=>{
  windSrc = e.target.value;
  if(windSrc === 'auto' && !windAt) fetchWind();
  windChanged();
};
document.getElementById('windOpacity').oninput = e=> windLayer.setOpacity(e.target.value/100);

/* ----- the wind dial: the dot sits where the wind comes from ----- */
const windDial = document.getElementById('windDial');
function setWindHand(deg){
  const v = norm360(Math.round(deg/5)*5);
  const sel = document.getElementById('windSrc');
  if(v === windHand && windSrc === 'hand') return;
  windHand = v;
  windSrc = sel.value = 'hand';
  windChanged();
}
function windFromEvent(e){
  const r = windDial.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width/2), dy = e.clientY - (r.top + r.height/2);
  if(Math.hypot(dx, dy) < r.width*0.08) return;
  setWindHand(Math.atan2(dx, -dy)/EXP_RAD);
}
windDial.addEventListener('pointerdown', e=>{ windDial.setPointerCapture(e.pointerId); windFromEvent(e); });
windDial.addEventListener('pointermove', e=>{ if(windDial.hasPointerCapture(e.pointerId)) windFromEvent(e); });
windDial.addEventListener('keydown', e=>{
  const step = e.shiftKey ? 45 : 5, cur = windFromNow() ?? windHand;
  if(e.key === 'ArrowRight' || e.key === 'ArrowUp'){ setWindHand(cur + step); e.preventDefault(); }
  if(e.key === 'ArrowLeft' || e.key === 'ArrowDown'){ setWindHand(cur - step); e.preventDefault(); }
});

/* The sun legend follows the map centre; the wind is fetched again once the
   centre has moved far enough to be in different weather. */
map.on('moveend', debounce(()=>{
  updateSunInfo();
  if(document.getElementById('windOn').checked && windSrc === 'auto' &&
     (!windAt || map.distance(windAt, map.getCenter()) > 15000)) fetchWind();
  else updateWindInfo();
}, 600));
updateSunInfo();
updateWindInfo();

/* ---------- lines for the tap readout ---------- */
function exposureLine(ll){
  const parts = [];
  const t = tileCoords(ll, DEM_MAX_Z), o = (t.py>>1)*BLOCK_N + (t.px>>1);
  if(document.getElementById('sunOn').checked){
    const s = sunSettings();
    parts.push(sunGrid(DEM_MAX_Z, t.x, t.y, s.iso, s.mode, s.minute).then(g=>{
      if(s.mode === 'time'){
        if(!g.up) return 'The sun is down at ' + clockAt(s.iso, s.minute);
        return 'In <b>' + (g.val[o] > 0 ? 'sun' : 'shade') + '</b> at ' + clockAt(s.iso, s.minute) + ' ' + niceDate(s.iso);
      }
      if(!(g.hrs[o] > 0)) return '<b>No direct sun</b> ' + niceDate(s.iso);
      return 'In sun ' + g.hrs[o].toFixed(g.hrs[o] < 10 ? 1 : 0) + ' h ' + niceDate(s.iso) + ', ' +
        clockAt(s.iso, g.first[o]) + '–' + clockAt(s.iso, g.last[o]) +
        ', as strong as <b>' + g.val[o].toFixed(1) + ' h</b> of full sun';
    }));
  }
  const from = windFromNow();
  if(document.getElementById('windOn').checked && from !== null){
    parts.push(windGrid(DEM_MAX_Z, t.x, t.y, from).then(sx=>{
      const k = windClass(sx[o]);
      return 'Wind from ' + dirName(from) + ': ' +
        (k > 0 ? '<b>sheltered lee</b>, likely loaded' : k < 0 ? '<b>exposed</b>, likely scoured' : 'neither sheltered nor exposed');
    }));
  }
  return Promise.all(parts.map(p=>p.catch(()=>''))).then(a=>
    a.filter(Boolean).map(s=>'<div class="fc">' + s + '</div>').join(''));
}
