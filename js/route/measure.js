/* ---------- measuring tape: drawing the line and the tool on/off ---------- */
function legLength(a,b){ return map.distance(a,b); }

function drawMeasure(){
  measureLayer.clearLayers();
  gpxBtn.disabled = mpts.length < 2;
  if(mpts.length > 1){
    L.polyline(mpts, {color:'#ffb020', weight:3, opacity:.95, interactive:false})
      .addTo(measureLayer);
  }
  /* A line brought in from a GPX file has hundreds of points; a dot and a
     running total at each would bury the map, so long lines only mark the
     ends and every kilometre. */
  const busy = mpts.length > 30;
  let total = 0, lastKm = 0;
  mpts.forEach((p,i)=>{
    if(i) total += legLength(mpts[i-1], p);
    const km = Math.floor(total/1000);
    const end = i === 0 || i === mpts.length-1;
    if(busy && !end && km === lastKm) return;
    lastKm = km;
    const mk = L.circleMarker(p, {radius:4, color:'#ffb020', weight:2,
                fillColor:'#12232c', fillOpacity:1, interactive:false}).addTo(measureLayer);
    if(i) mk.bindTooltip(fmtLen(total), {permanent:true, direction:'right',
                className:'meas', offset:[7,0]}).openTooltip();
  });

  profileLayer.eachLayer(l=>{ if(l.bringToFront) l.bringToFront(); });
  if(!mpts.length){
    measureTotal.textContent = 'Tap the map to start the line';
    measureSub.textContent = 'Points are joined by straight lines.';
    updateGain();
    return;
  }
  const last = mpts.length > 1 ? legLength(mpts[mpts.length-2], mpts[mpts.length-1]) : 0;
  measureTotal.innerHTML = 'Distance <b>' + fmtLen(total) + '</b>';
  measureSub.textContent = mpts.length > 1
    ? mpts.length + ' points · last leg ' + fmtLen(last)
    : 'Tap the next point';
  updateGain();
}

function addMeasurePoint(latlng){
  mpts.push(L.latLng(latlng.lat, latlng.lng));
  drawMeasure();
}

function setMeasuring(on){
  measuring = on;
  measBtn.classList.toggle('on', on);
  measureBox.classList.toggle('on', on);
  document.body.classList.toggle('measuring', on);   // shows the profile and fold buttons on the scale card
  document.getElementById('map').classList.toggle('measuring', on);
  if(on){
    drawMeasure();
  } else {
    document.body.classList.remove('has-profile');
    hideScrub();
  }
}

/* Switching the tool off leaves the line on the map so you can keep looking
   at it; Clear or Done is what removes it. */
measBtn.onclick = ()=> setMeasuring(!measuring);
document.getElementById('measUndo').onclick = ()=>{ mpts.pop(); drawMeasure(); };
document.getElementById('measClear').onclick = ()=>{ mpts = []; drawMeasure(); };
document.getElementById('measDone').onclick = ()=>{ mpts = []; drawMeasure(); setMeasuring(false); };

/* ---------- measure box: profile on/off and folding (buttons on the scale card) ---------- */
/* Both choices are remembered, so a phone user who always wants the map
   clear of the profile only has to say so once. */
const measProfBtn = document.getElementById('measProfBtn');
const measFold = document.getElementById('measFold');

function setProfileShown(on){
  document.body.classList.toggle('profile-off', !on);
  measProfBtn.setAttribute('aria-pressed', on);
  measProfBtn.title = on ? 'Hide the elevation profile' : 'Show the elevation profile';
  try{ localStorage.setItem('bratthet.measProfile', on ? '1' : '0'); }catch(e){}
  if(on && curProfile) renderProfile();   // it may have been drawn while hidden at zero size
}
function setMeasureCompact(on){
  measureBox.classList.toggle('compact', on);
  measFold.setAttribute('aria-expanded', !on);
  measFold.title = on ? 'Show the measure box' : 'Hide the measure box';
  try{ localStorage.setItem('bratthet.measCompact', on ? '1' : '0'); }catch(e){}
}
measProfBtn.onclick = ()=> setProfileShown(document.body.classList.contains('profile-off'));
measFold.onclick = ()=> setMeasureCompact(!measureBox.classList.contains('compact'));
try{
  if(localStorage.getItem('bratthet.measProfile') === '0') setProfileShown(false);
  if(localStorage.getItem('bratthet.measCompact') === '1') setMeasureCompact(true);
}catch(e){}
