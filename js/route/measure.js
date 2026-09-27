/* ---------- measuring tape: drawing the line and the tool on/off ---------- */
function legLength(a,b){ return map.distance(a,b); }

function drawMeasure(){
  measureLayer.clearLayers();
  gpxBtn.disabled = mpts.length < 2;
  if(mpts.length > 1){
    L.polyline(mpts, {color:'#ffb020', weight:3, opacity:.95, interactive:false})
      .addTo(measureLayer);
  }
  let total = 0;
  mpts.forEach((p,i)=>{
    if(i) total += legLength(mpts[i-1], p);
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
