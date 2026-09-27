/* ---------- avalanche forecast: map layer, readout line, forecast link ---------- */
/* ----- drawing ----- */
const dangerOn = document.getElementById('dangerOn');
const dangerStatus = document.getElementById('dangerStatus');
const dangerState = {date:TODAY, layers:new Map(), ratings:new Map(), token:0};
function ratingFor(sid, rid){
  const m = dangerState.ratings.get(sid + '|' + dangerState.date);
  return m ? m.get(rid) : null;
}
function dangerStyle(sid){
  const op = +document.getElementById('dangerOpacity').value/100;
  return f=>{
    const r = ratingFor(sid, f.properties.id);
    if(!r || !r.max) return {color:'#6d828c', weight:1, opacity:.8, dashArray:'3 4', fill:false};
    /* setStyle merges, so every key the unrated style sets is reset here */
    return {color:'#2a2a2a', weight:1, opacity:.7, dashArray:null, fill:true,
            fillColor:DANGER[Math.min(5, r.max)].c, fillOpacity:op};
  };
}
function ensureDangerLayer(sid, feats){
  if(dangerState.layers.has(sid)) return dangerState.layers.get(sid);
  const lyr = L.geoJSON({type:'FeatureCollection', features:feats},
    {pane:'dangerPane', interactive:false, style:dangerStyle(sid)});
  dangerState.layers.set(sid, lyr);
  return lyr;
}
function restyleDanger(){
  dangerState.layers.forEach((lyr, sid)=>lyr.setStyle(dangerStyle(sid)));
}
async function refreshDanger(){
  const token = ++dangerState.token;
  if(!dangerOn.checked){
    dangerState.layers.forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
    dangerStatus.textContent = '';
    return;
  }
  dangerState.layers.forEach(l=>{ if(!map.hasLayer(l)) l.addTo(map); });
  ensureNames();
  const date = dangerState.date = addDays(TODAY, +document.getElementById('dangerDay').value);
  restyleDanger();
  dangerStatus.classList.remove('warn');
  if(map.getZoom() < 5){ dangerStatus.textContent = 'Zoom in to load the forecast regions.'; return; }
  const view = map.getBounds();
  const services = SERVICES.filter(s=>s.geo && boxMeets(s.bbox, view)).slice(0, 10);
  if(!services.length){
    dangerStatus.textContent = 'No European forecast service covers this view.';
    return;
  }
  dangerStatus.textContent = 'Loading forecast regions…';
  const res = await Promise.all(services.map(async s=>{
    try{
      const feats = await loadRegions(s.id);
      if(token !== dangerState.token) return null;
      const lyr = ensureDangerLayer(s.id, feats);
      if(dangerOn.checked && !map.hasLayer(lyr)) lyr.addTo(map);
      const m = await loadRatings(s.id, date);
      dangerState.ratings.set(s.id + '|' + date, m);
      if(token === dangerState.token) lyr.setStyle(dangerStyle(s.id));
      const rated = feats.filter(f=>{ const r = m.get(f.properties.id); return r && r.max; }).length;
      return {s, rated, src: s.id === 'NO' && [...m.values()].some(r=>r.src === 'Varsom') ? 'Varsom' : s.name};
    } catch(e){ return {s, failed:true}; }
  }));
  if(token !== dangerState.token) return;
  const ok = res.filter(r=>r && !r.failed), failed = res.filter(r=>r && r.failed);
  const rated = ok.filter(r=>r.rated);
  const when = document.getElementById('dangerDay').value === '1' ? 'tomorrow' : 'today';
  let msg;
  if(rated.length){
    const n = rated.reduce((a, r)=>a + r.rated, 0);
    const names = [...new Set(rated.map(r=>r.src))].join(', ');
    msg = n + ' region' + (n === 1 ? '' : 's') + ' rated for ' + when + ' (' + date + ') by ' + names + '.';
    const quiet = ok.filter(r=>!r.rated).map(r=>r.s.name);
    if(quiet.length) msg += ' Nothing yet from ' + [...new Set(quiet)].join(', ') + '.';
  } else if(ok.length){
    msg = 'No forecast published for ' + when + ' in this view. Outside the season most services are silent' +
      (when === 'tomorrow' ? ', and tomorrow\u2019s usually appears in the afternoon (Varsom by 16:00).' : '.');
    dangerStatus.classList.add('warn');
  } else msg = '';
  if(failed.length){
    msg += ' Could not reach the region data for ' + [...new Set(failed.map(r=>r.s.name))].join(', ') + '.';
    dangerStatus.classList.add('warn');
  }
  dangerStatus.textContent = msg.trim();
}
const refreshDangerSoon = debounce(refreshDanger, 400);
dangerOn.onchange = refreshDanger;
document.getElementById('dangerDay').onchange = ()=>{ if(!dangerOn.checked) dangerOn.checked = true; refreshDanger(); };
document.getElementById('dangerOpacity').oninput = restyleDanger;

/* Region under a point, from whatever geometry is already loaded. */
function loadedRegionAt(ll){
  for(const s of SERVICES_FINE_FIRST){
    if(!boxHas(s.bbox, ll) || !dangerState.layers.has(s.id)) continue;
    const lyr = dangerState.layers.get(s.id);
    for(const l of lyr.getLayers()){
      const f = l.feature;
      if(f && f.box && boxHas(f.box, ll) && geomHas(f.geometry, ll)) return {s, f};
    }
  }
  return null;
}
function serviceLink(s){
  return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>';
}
/* One line under the slope readout. Names come from Varsom, or from the
   EAWS name list, which is fetched the first time it is needed. */
let namesNow = {};
function ensureNames(){ loadNames().then(n=>{ namesNow = (n && typeof n === 'object') ? n : {}; }); }
function forecastLine(ll){
  if(!dangerOn.checked) return '';
  const hit = loadedRegionAt(ll);
  if(!hit) return '';
  const rid = hit.f.properties.id, r = ratingFor(hit.s.id, rid);
  const name = (r && r.name) || namesNow[rid] || rid;
  let head;
  if(r && r.max){
    const d = DANGER[Math.min(5, r.max)];
    head = '<span class="dz" style="background:' + d.c + (d.ink ? ';color:' + d.ink : '') + '">' + r.max + '</span>' +
           d.n + ' · ' + esc(name);
    if(r.hi && r.lo && r.hi !== r.lo) head += ' · ' + r.hi + ' high, ' + r.lo + ' low';
  } else head = 'No rating ' + (dangerState.date === TODAY ? 'today' : 'for ' + dangerState.date) + ' · ' + esc(name);
  const text = r && r.text ? '<div class="sub">' + esc(r.text) + '</div>' : '';
  return '<div class="fc">' + head + ' · ' + serviceLink(hit.s) + '</div>' + text;
}

/* ----- which service to send people to, for the note at the bottom ----- */
async function serviceAt(ll){
  const loaded = loadedRegionAt(ll);
  if(loaded) return {one: loaded.s};
  const cands = SERVICES_FINE_FIRST.filter(s=>boxHas(s.bbox, ll));
  if(!cands.length) return null;
  if(cands.length === 1) return {one: cands[0]};
  const outlines = await Promise.all(cands.map(s=>loadOutline(s.id)));
  const inside = cands.filter((s, i)=>outlines[i] && outlines[i].some(f=>geomHas(f.geometry, ll)));
  if(inside.length) return {one: inside[0]};
  if(outlines.every(o=>o)) return null;               // all known, none covers this spot
  return {many: cands};                              // could not tell: offer them all
}
let linkToken = 0;
async function updateForecastLink(){
  const token = ++linkToken;
  const res = await serviceAt(map.getCenter()).catch(()=>null);
  if(token !== linkToken) return;
  const el = document.getElementById('fcLink');
  if(res && res.one) el.innerHTML = serviceLink(res.one);
  else if(res && res.many){
    const uniq = [...new Map(res.many.map(s=>[s.url, s])).values()];
    el.innerHTML = uniq.map(serviceLink).join(', ') + ', whichever covers where you are going';
  } else el.innerHTML = 'the local avalanche service (<a href="https://www.avalanches.org" target="_blank" rel="noopener">avalanches.org</a> lists them for Europe)';
}
const updateForecastLinkSoon = debounce(updateForecastLink, 600);

map.on('moveend', ()=>{
  if(snowSrcEl.value === 'auto') applySnow();
  updateS2Link();
  refreshDangerSoon();
  updateForecastLinkSoon();
});
updateForecastLink();
