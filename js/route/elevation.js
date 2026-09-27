/* ---------- measuring tape ---------- */
/* Consecutive taps, straight legs between them, running total at every point.
   Great-circle distances via Leaflet, so legs stay right at any latitude. */
let measuring = false;
let mpts = [];
const measureLayer = L.layerGroup().addTo(map);
const measBtn = document.getElementById('measBtn');
const measureBox = document.getElementById('measureBox');
const measureTotal = document.getElementById('measureTotal');
const measureSub = document.getElementById('measureSub');
const measureGain = document.getElementById('measureGain');
const measureSteep = document.getElementById('measureSteep');
const measureTime = document.getElementById('measureTime');
const munterOut = document.getElementById('munterOut');
const munterSplit = document.getElementById('munterSplit');
const munterModeEl = document.getElementById('munterMode');
const munterPaceEl = document.getElementById('munterPace');
const gpxBtn = document.getElementById('measGpx');
const profileBox = document.getElementById('profileBox');
const profileSvg = document.getElementById('profileSvg');
const profileRead = document.getElementById('profileRead');
const profileLayer = L.layerGroup().addTo(map);   // steep stretches, steepest spot, scrub dot

/* ---------- ascent and descent along the line ----------
   The same terrarium tiles that make the slope colours are sampled along each
   leg. They are 10–30 m data, so every reading carries a metre or two of noise;
   summing it raw would invent a few hundred metres of climb on a flat traverse.
   So the profile is smoothed, and height only counts once it has moved past a
   threshold — the standard hysteresis a GPS watch uses on a barometric trace. */
const GAIN_THRESHOLD = 6;      // metres of movement before it counts
const GAIN_SMOOTH = 2;         // ± samples in the moving average
const MAX_SAMPLES = 1500;
const STEEP_WARN = 30;         // degrees of ground slope that get flagged
const GRADE_HALF = 30;         // metres either side for the steepness of the line itself
const FLAT_GRADE = 3;          // degrees; gentler than this counts as flat for the time

function tileCoords(ll, z){
  const n = Math.pow(2,z);
  const lat = ll.lat*Math.PI/180;
  const xf = (ll.lng+180)/360*n;
  const yf = (1 - Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*n;
  const x = Math.floor(xf), y = Math.floor(yf);
  return {x:x, y:y,
          px:Math.min(255,Math.max(0,Math.floor((xf-x)*256))),
          py:Math.min(255,Math.max(0,Math.floor((yf-y)*256)))};
}

/* evenly spaced points along the polyline, roughly one per DEM cell */
function sampleLine(pts){
  const z = DEM_MAX_Z;
  const cell = 156543.03392 * Math.cos(pts[0].lat*Math.PI/180) / Math.pow(2,z);
  let total = 0;
  for(let i=1;i<pts.length;i++) total += map.distance(pts[i-1], pts[i]);
  if(total <= 0) return [];
  const step = Math.max(cell, total/MAX_SAMPLES);
  const out = [];
  const vtx = [];                // sample index of every tapped point
  for(let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i];
    const d = map.distance(a,b);
    const n = Math.max(1, Math.round(d/step));
    vtx.push(out.length);
    for(let k=0;k<n;k++){
      const t = k/n;
      out.push(L.latLng(a.lat + (b.lat-a.lat)*t, a.lng + (b.lng-a.lng)*t));
    }
  }
  vtx.push(out.length);
  out.push(pts[pts.length-1]);
  out.vtx = vtx;
  return out;
}

async function elevationProfile(pts){
  const z = DEM_MAX_Z;
  const samples = sampleLine(pts);
  if(samples.length < 2) return null;

  /* One fetch per tile, then read every sample straight out of the cache. */
  const coords = samples.map(s=>tileCoords(s, z));
  const need = new Map();
  coords.forEach(c=>{ need.set(c.x+'/'+c.y, c); });
  await Promise.all([...need.values()].map(c=>loadDem(z, c.x, c.y)));

  const raw = [], groundRaw = [], aspect = [];
  coords.forEach(c=>{
    const rec = demCache.get(z+'/'+c.x+'/'+c.y);
    raw.push(rec ? rec.el[c.py*256 + c.px] : NaN);
    groundRaw.push(rec ? rec.slope[c.py*256 + c.px] : NaN);
    aspect.push(rec ? rec.aspect[c.py*256 + c.px] : 0);
  });
  if(raw.some(isNaN)) return null;

  const sm = raw.map((_,i)=>{
    let s = 0, n = 0;
    for(let k=i-GAIN_SMOOTH; k<=i+GAIN_SMOOTH; k++){
      if(k>=0 && k<raw.length){ s += raw[k]; n++; }
    }
    return s/n;
  });

  let up = 0, down = 0, ref = sm[0];
  for(let i=1;i<sm.length;i++){
    const d = sm[i] - ref;
    if(d >  GAIN_THRESHOLD){ up   += d; ref = sm[i]; }
    else if(d < -GAIN_THRESHOLD){ down += -d; ref = sm[i]; }
  }

  /* distance along the line at every sample */
  const n = sm.length;
  const dist = new Array(n); dist[0] = 0;
  for(let i=1;i<n;i++) dist[i] = dist[i-1] + map.distance(samples[i-1], samples[i]);

  /* Steepness of the ground under the line. Single cells of the slope grid
     jump around, so a light ±1 average before taking the maximum. */
  const ground = groundRaw.map((_,i)=>{
    let s = 0, k = 0;
    for(let j=i-1;j<=i+1;j++) if(j>=0 && j<n){ s += groundRaw[j]; k++; }
    return s/k;
  });

  /* Steepness of the line itself, in the direction it was drawn, measured
     across about GRADE_HALF metres either side so DEM noise doesn't show up
     as 40° steps. Positive is climbing. */
  const grade = new Array(n);
  let j0 = 0, j1 = 0;
  for(let i=0;i<n;i++){
    while(j0+1 <= i && dist[i] - dist[j0+1] >= GRADE_HALF) j0++;
    if(j1 < i) j1 = i;
    while(j1 < n-1 && dist[j1] - dist[i] < GRADE_HALF) j1++;
    const base = dist[j1] - dist[j0];
    grade[i] = base > 0 ? Math.atan((sm[j1]-sm[j0])/base) * 180/Math.PI : 0;
  }

  let maxGround = -1, maxGroundIdx = 0, over = 0, maxUp = 0, maxDown = 0;
  let distUp = 0, distDown = 0, distFlat = 0;
  for(let i=0;i<n;i++){
    if(ground[i] > maxGround){ maxGround = ground[i]; maxGroundIdx = i; }
    if(grade[i] > maxUp) maxUp = grade[i];
    if(-grade[i] > maxDown) maxDown = -grade[i];
    if(i){
      const d = dist[i] - dist[i-1];
      if((ground[i] + ground[i-1])/2 >= STEEP_WARN) over += d;
      const g = (grade[i] + grade[i-1])/2;
      if(g > FLAT_GRADE) distUp += d; else if(g < -FLAT_GRADE) distDown += d; else distFlat += d;
    }
  }

  return {up:up, down:down, start:sm[0], end:sm[sm.length-1],
          min:Math.min.apply(null,sm), max:Math.max.apply(null,sm),
          samples:samples, vtx:samples.vtx, dist:dist, ele:sm, ground:ground, grade:grade, aspect:aspect,
          total:dist[n-1], maxGround:maxGround, maxGroundIdx:maxGroundIdx, over:over,
          maxUp:maxUp, maxDown:maxDown, distUp:distUp, distDown:distDown, distFlat:distFlat};
}
