/* ---------- sun and wind along the measured line ----------
   Munter time says when you reach each point of the line from the start
   time you give. From that: is the spot in sun when you get there, and how
   much sun has it had that day before you arrive (what softens a south face
   or turns it wet). With a wind direction known, which stretches are in the
   lee or exposed, and above all which are both steep and loaded. */
const ROUTE_Z = 12;            // elevation level for the shadow rays; 20–40 m cells
const RAY_STEP = 50;           // metres between samples along a ray towards the sun
const RAY_MAX = 8000;          // metres; a ridge further away than this is ignored
const ROUTE_POINTS = 300;      // at most this many points get their own sun sums
const ROUTE_SUN_STEP = 30;     // minutes between sun positions before arrival
const TOP_OF_ALPS = 4810;      // no terrain above this, so a ray can stop early
const routeExpLayer = L.layerGroup().addTo(map);
const routeStartEl = document.getElementById('routeStart');
const routeSunEl = document.getElementById('routeSun');
const routeWindEl = document.getElementById('routeWind');
const measureSun = document.getElementById('measureSun');
const measureWind = document.getElementById('measureWind');
try { const v = localStorage.getItem('bratthet.routeStart'); if(/^\d\d:\d\d$/.test(v)) routeStartEl.value = v; } catch(e){}
let routeExpToken = 0;

/* Hours from the start to every sample, by the same Munter rule as the
   total, scaled so the last point lands exactly on the total shown. */
function arrivalHours(p, mode){
  const r = MUNTER[mode], n = p.ele.length, t = [0];
  for(let i=1;i<n;i++){
    const d = (p.dist[i] - p.dist[i-1])/1000, dh = p.ele[i] - p.ele[i-1];
    const g = (p.grade[i] + p.grade[i-1])/2;
    let h;
    if(g > FLAT_GRADE) h = (d + Math.max(0, dh)/100)/r.up;
    else if(g < -FLAT_GRADE) h = (d + Math.max(0, -dh)/100)/r.down;
    else h = d/r.flat;
    t.push(t[i-1] + h);
  }
  const total = munterTime(p, mode).total;
  if(t[n-1] > 0) for(let i=0;i<n;i++) t[i] *= total/t[n-1];
  return t;
}

/* Elevation straight from the tile cache; missing tiles are noted so the
   caller can load them and run again. */
function routeEl(lat, lng, missing){
  const t = tileCoords({lat:lat, lng:lng}, ROUTE_Z);
  const rec = demCache.get(ROUTE_Z + '/' + t.x + '/' + t.y);
  if(!rec){ missing.add(t.x + '/' + t.y); return NaN; }
  return rec.el[t.py*256 + t.px];
}
/* Is the spot in the shadow of terrain between it and the sun? */
function rayShaded(lat, lng, e0, alt, az, missing){
  const rise = Math.tan(alt*EXP_RAD);
  const dn = Math.cos(az*EXP_RAD)/111320, de = Math.sin(az*EXP_RAD)/(111320*Math.cos(lat*EXP_RAD));
  for(let d=RAY_STEP*1.5; d<=RAY_MAX; d+=RAY_STEP){
    const need = e0 + d*rise;
    if(need > TOP_OF_ALPS) return false;
    if(routeEl(lat + d*dn, lng + d*de, missing) > need) return true;
  }
  return false;
}
/* How square-on the sun hits the ground at a sample: 0 in shade. */
function sunOnGround(p, i, pos, missing){
  if(pos.alt <= 0) return 0;
  const sl = p.ground[i]*EXP_RAD, zen = (90 - pos.alt)*EXP_RAD;
  const ci = Math.cos(zen)*Math.cos(sl) + Math.sin(zen)*Math.sin(sl)*Math.cos((pos.az - p.aspect[i])*EXP_RAD);
  if(!(ci >= Math.sin(SUN_MIN_ANGLE*EXP_RAD))) return 0;
  const s = p.samples[i];
  return rayShaded(s.lat, s.lng, p.ele[i] + 2, pos.alt, pos.az, missing) ? 0 : ci;
}

async function routeSun(p, iso, startMin){
  const n = p.ele.length, arrive = arrivalHours(p, munterMode);
  const stride = Math.max(1, Math.ceil(n/ROUTE_POINTS));
  const idx = [];
  for(let i=0;i<n;i+=stride) idx.push(i);
  if(idx[idx.length-1] !== n-1) idx.push(n-1);
  const t0 = dayStart(iso);
  let res = null;
  /* Rays reach into tiles the line never touched; load those and go again. */
  for(let pass=0; pass<3; pass++){
    const missing = new Set();
    res = idx.map(i=>{
      const s = p.samples[i], m = startMin + arrive[i]*60;
      const now = sunOnGround(p, i, solarPos(t0 + m*60000, s.lat, s.lng), missing);
      let before = 0;
      for(let mm = ROUTE_SUN_STEP/2; mm < m; mm += ROUTE_SUN_STEP){
        before += sunOnGround(p, i, solarPos(t0 + mm*60000, s.lat, s.lng), missing)*ROUTE_SUN_STEP/60;
      }
      return {i:i, m:m, now:now, before:before};
    });
    if(!missing.size) break;
    await Promise.all([...missing].map(k=>{
      const [x, y] = k.split('/').map(Number);
      return loadDem(ROUTE_Z, x, y).catch(()=>null);
    }));
  }
  /* Every sample takes the value of the nearest computed point. */
  const at = new Array(n);
  for(let i=0;i<n;i++) at[i] = res[Math.min(res.length-1, Math.round(i/stride))];
  return at;
}

async function routeWind(p, from){
  const n = p.samples.length, z = DEM_MAX_Z;
  const coords = p.samples.map(s=>tileCoords(s, z));
  const grids = new Map();
  coords.forEach(c=>{ const k = c.x + '/' + c.y; if(!grids.has(k)) grids.set(k, windGrid(z, c.x, c.y, from)); });
  const got = new Map();
  await Promise.all([...grids].map(([k, pr])=>pr.then(g=>got.set(k, g)).catch(()=>null)));
  const out = new Array(n);
  coords.forEach((c, i)=>{
    const g = got.get(c.x + '/' + c.y);
    out[i] = g ? windClass(g[(c.py>>1)*BLOCK_N + (c.px>>1)]) : 0;
  });
  return out;
}

function clearRouteExposure(){
  routeExpToken++;
  routeExpLayer.clearLayers();
  measureSun.classList.remove('on');
  measureWind.classList.remove('on');
}

function updateRouteExposure(){
  const p = curProfile;
  if(!p){ clearRouteExposure(); return; }
  const tok = ++routeExpToken;
  const iso = document.getElementById('sunDate').value || TODAY;
  const [hh, mm] = (routeStartEl.value || '09:00').split(':').map(Number);
  const startMin = hh*60 + mm;
  const from = document.getElementById('windOn').checked ? windFromNow() : null;
  document.getElementById('routeDate').textContent = niceDate(iso);
  measureSun.classList.add('on');
  routeSunEl.innerHTML = '<span class="wait">Working out the sun…</span>';
  measureWind.classList.add('on');
  routeWindEl.innerHTML = from === null
    ? '<span class="wait">Turn on Wind exposure to check the wind along the line.</span>'
    : '<span class="wait">Reading the wind…</span>';

  Promise.all([routeSun(p, iso, startMin), from === null ? null : routeWind(p, from)]).then(([sun, wind])=>{
    if(tok !== routeExpToken || p !== curProfile) return;
    p.sunAt = sun; p.windAt = wind; p.windFrom = from; p.sunIso = iso;
    showRouteSun(p);
    showRouteWind(p);
    renderProfile();
  }).catch(()=>{
    if(tok === routeExpToken) routeSunEl.innerHTML = '<span class="wait">No sun estimate for this line</span>';
  });
}

function showRouteSun(p){
  const n = p.samples.length, sun = p.sunAt;
  let lit = 0, dark = true, best = 0;
  for(let i=1;i<n;i++){
    const d = p.dist[i] - p.dist[i-1];
    if(sun[i].now > 0) lit += d;
    if(sun[i].now > 0 || sun[i].before > 0) dark = false;
    if(sun[i].before > sun[best].before) best = i;
  }
  if(dark){ routeSunEl.textContent = 'No direct sun anywhere on the line at the times you pass.'; return; }
  const b = sun[best];
  routeSunEl.innerHTML =
    'In sun <b>' + Math.round(100*lit/p.total) + '%</b> of the way as you pass, in shade ' + Math.round(100 - 100*lit/p.total) + '%' +
    (b.before >= 0.25
      ? '<div class="sub">Most sun before you get there: <b>' + b.before.toFixed(1) + ' h</b> of full sun by ' +
        clockAt(p.sunIso, Math.round(b.m)) + ', at ' + fmtLen(p.dist[best]) + '</div>'
      : '');
}

function showRouteWind(p){
  routeExpLayer.clearLayers();
  if(!p.windAt){ return; }
  const n = p.samples.length, w = p.windAt;
  let lee = 0, bare = 0, slab = 0, run = null;
  const drawRun = r=>{
    if(r.length > 1) L.polyline(r, {color:'#e8467c', weight:10, opacity:.9, interactive:false}).addTo(routeExpLayer);
  };
  for(let i=0;i<n;i++){
    const d = i ? p.dist[i] - p.dist[i-1] : 0;
    if(w[i] > 0) lee += d;
    if(w[i] < 0) bare += d;
    const steepLoaded = w[i] > 0 && p.ground[i] >= STEEP_WARN;
    if(steepLoaded){
      slab += d;
      if(!run) run = i ? [p.samples[i-1]] : [];
      run.push(p.samples[i]);
    } else if(run){ run.push(p.samples[i]); drawRun(run); run = null; }
  }
  if(run) drawRun(run);
  /* keep the steepest-spot dot on top of the pink */
  profileLayer.eachLayer(l=>{ if(l.bringToFront) l.bringToFront(); });
  routeWindEl.innerHTML =
    'Wind from ' + dirName(p.windFrom) + ': lee <b>' + fmtLen(lee) + '</b> · exposed ' + fmtLen(bare) +
    (slab > 0
      ? '<div class="sub"><b class="warn">' + fmtLen(slab) + ' steep and loaded</b>: over ' + STEEP_WARN + '° in the lee, edged pink on the map</div>'
      : '<div class="sub">Nothing over ' + STEEP_WARN + '° in the lee</div>');
}

/* One line for the scrubber readout. */
function routeExpText(p, i){
  const out = [];
  if(p.sunAt){
    const s = p.sunAt[i];
    out.push((s.now > 0 ? 'sun' : 'shade') + ' ' + clockAt(p.sunIso, Math.round(s.m)));
  }
  if(p.windAt && p.windAt[i]) out.push(p.windAt[i] > 0 ? 'lee' : 'exposed');
  return out.length ? ' · ' + out.join(' · ') : '';
}

routeStartEl.onchange = ()=>{
  try { localStorage.setItem('bratthet.routeStart', routeStartEl.value); } catch(e){}
  updateRouteExposure();
};
/* The sun date and the wind direction live in the panel; follow them. */
const routeExpSoon = debounce(()=>{ if(curProfile) updateRouteExposure(); }, 400);
