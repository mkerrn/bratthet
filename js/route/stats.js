/* ---------- Munter time ----------
   Werner Munter's rule of thumb: 1 km of distance and 100 m of height are one
   unit each; divide by how many units you cover in an hour. */
const MUNTER = {
  ski:  {up:4, flat:6, down:10},
  foot: {up:4, flat:6, down:6}
};
let munterMode = 'ski';
try { const m = localStorage.getItem('bratthet.munter'); if(MUNTER[m]) munterMode = m; } catch(e){}
munterModeEl.value = munterMode;

function munterTime(p, mode){
  const r = MUNTER[mode];
  const up   = (p.distUp/1000   + p.up/100)   / r.up;
  const down = (p.distDown/1000 + p.down/100) / r.down;
  const flat = (p.distFlat/1000) / r.flat;
  return {up:up, down:down, flat:flat, total:up+down+flat};
}
function fmtHours(h){
  const min = Math.max(5, Math.round(h*60/5)*5);
  if(min < 60) return min + ' min';
  const hh = Math.floor(min/60), mm = min % 60;
  return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
}

/* Ground steepness classes for the profile and the map, the familiar
   avalanche-map ramp rather than the editable bands above, so 30° always
   looks the same here. */
const GROUND_RAMP = [
  {min:25, color:'#f2e14c'},
  {min:30, color:'#f59a2c'},
  {min:35, color:'#e5412d'},
  {min:40, color:'#b0247a'},
  {min:45, color:'#7a3a9a'}
];
function groundColor(s){
  let c = null;
  for(const r of GROUND_RAMP) if(s >= r.min) c = r.color;
  return c;
}
/* Or the user's own slope classes, matched exactly as the slope layer does:
   first class in the list whose angle, direction and altitude all fit. */
function bandColorAt(p, i){
  const s = p.ground[i], el = p.ele[i], as = p.aspect[i];
  for(const b of bands){
    if(s < b.min || s >= b.max) continue;
    if(b.elMin != null && el < b.elMin) continue;
    if(b.elMax != null && el > b.elMax) continue;
    if(b.aspFrom != null && s >= FLAT_BELOW){
      const width = (b.aspTo - b.aspFrom + 360) % 360;
      if((as - b.aspFrom + 360) % 360 > width) continue;
    }
    return b.color;
  }
  return null;
}
function inkFor(hex){
  const [r,g,b] = hexToRgb(hex);
  return (0.299*r + 0.587*g + 0.114*b) > 150 ? '#111' : '#fff';
}

let profileColorMode = 'ramp';
try { const m = localStorage.getItem('bratthet.profileColor'); if(m === 'ramp' || m === 'bands') profileColorMode = m; } catch(e){}
const profileColorEl = document.getElementById('profileColor');
const profileKeyEl = document.getElementById('profileKey');
profileColorEl.value = profileColorMode;

function renderProfileKey(){
  if(profileColorMode === 'bands'){
    profileKeyEl.title = 'Colour under the curve: your slope classes, with their direction and altitude filters';
    profileKeyEl.innerHTML = bands.map(b=>
      '<span style="background:' + b.color + ';color:' + inkFor(b.color) + '" title="' +
      esc(aspectText(b) + ' · ' + altText(b)) + '">' + b.min + '–' + b.max + '°' +
      (isFiltered(b) ? '*' : '') + '</span>').join('');
  } else {
    profileKeyEl.title = 'Colour under the curve: steepness of the ground the line crosses';
    profileKeyEl.innerHTML =
      GROUND_RAMP.map(r=>'<span style="background:' + r.color + '">' + r.min + '°</span>').join('');
  }
}
renderProfileKey();
profileColorEl.onchange = ()=>{
  profileColorMode = profileColorEl.value;
  try { localStorage.setItem('bratthet.profileColor', profileColorMode); } catch(e){}
  renderProfileKey();
  renderProfile();
};

let gainToken = 0;
let curProfile = null;

function clearProfile(){
  curProfile = null;
  profileLayer.clearLayers();
  scrubMarker = null;
  measureSteep.classList.remove('on');
  measureTime.classList.remove('on');
  document.body.classList.remove('has-profile');
}

function updateGain(){
  const token = ++gainToken;
  if(mpts.length < 2){
    measureGain.classList.remove('on'); measureGain.textContent='';
    clearProfile();
    return;
  }
  measureGain.classList.add('on');
  measureGain.innerHTML = '<span class="wait">Reading the profile…</span>';
  const noData = ()=>{
    measureGain.innerHTML = '<span class="wait">No elevation data here</span>';
    clearProfile();
  };
  elevationProfile(mpts.slice()).then(p=>{
    if(token !== gainToken) return;                 // a newer point won the race
    if(!p){ noData(); return; }
    measureGain.innerHTML =
      '<span class="up">↑ ' + Math.round(p.up) + ' m</span> · ' +
      '<span class="dn">↓ ' + Math.round(p.down) + ' m</span> · ' +
      '<span class="wait">' + Math.round(p.start) + '→' + Math.round(p.end) + ' m</span>';
    curProfile = p;
    showSteep(p);
    showTime(p);
    drawProfileOnMap(p);
    document.body.classList.toggle('has-profile', measuring);
    renderProfile();
  }).catch(()=>{
    if(token === gainToken) noData();
  });
}

function showSteep(p){
  const g = Math.round(p.maxGround);
  const cls = p.maxGround >= STEEP_WARN ? 'warn' : 'ok';
  const overTxt = p.over > 0
    ? ' · ' + fmtLen(p.over) + ' over ' + STEEP_WARN + '°'
    : ' · all below ' + STEEP_WARN + '°';
  const track = [];
  if(p.maxUp >= 1)   track.push('↑ ' + Math.round(p.maxUp) + '°');
  if(p.maxDown >= 1) track.push('↓ ' + Math.round(p.maxDown) + '°');
  measureSteep.innerHTML =
    'Steepest ground <b class="' + cls + '">' + g + '°</b>' + overTxt +
    '<div class="sub">Steepest track ' + (track.length ? track.join(' · ') : 'flat') + '</div>';
  measureSteep.classList.add('on');
}

function showTime(p){
  const t = munterTime(p, munterMode);
  munterOut.textContent = fmtHours(t.total);
  const parts = [];
  if(t.up   >= 1/24) parts.push('up ' + fmtHours(t.up));
  if(t.flat >= 1/24) parts.push('flat ' + fmtHours(t.flat));
  if(t.down >= 1/24) parts.push('down ' + fmtHours(t.down));
  munterSplit.textContent = (parts.length > 1 ? parts.join(' · ') + ' · ' : '') + 'no breaks included';
  measureTime.classList.add('on');
}

munterModeEl.onchange = ()=>{
  munterMode = munterModeEl.value;
  try { localStorage.setItem('bratthet.munter', munterMode); } catch(e){}
  if(curProfile) showTime(curProfile);
};

/* Red over the stretches that cross ground of 30° or more, and a dot on the
   single steepest spot, so the answer to "does it stay below 30?" is on the map. */
let scrubMarker = null;
function drawProfileOnMap(p){
  profileLayer.clearLayers();
  scrubMarker = null;
  let run = null;
  for(let i=0;i<p.samples.length;i++){
    if(p.ground[i] >= STEEP_WARN){
      if(!run) run = i ? [p.samples[i-1]] : [];
      run.push(p.samples[i]);
    } else if(run){
      run.push(p.samples[i]);
      L.polyline(run, {color:'#ff4d4d', weight:5, opacity:.95, interactive:false}).addTo(profileLayer);
      run = null;
    }
  }
  if(run && run.length > 1)
    L.polyline(run, {color:'#ff4d4d', weight:5, opacity:.95, interactive:false}).addTo(profileLayer);

  const s = p.samples[p.maxGroundIdx];
  L.circleMarker(s, {radius:5, color:'#fff', weight:2, fillColor: groundColor(p.maxGround) || '#9fd88a',
    fillOpacity:1, interactive:false})
    .bindTooltip('steepest ' + Math.round(p.maxGround) + '°', {permanent:true, direction:'left',
      className:'meas', offset:[-7,0]})
    .addTo(profileLayer);
}
