/* ---------- where I am and where the phone points ---------- */
const locBtn = document.getElementById('locBtn');
let meLatLng = null, meAcc = 0, heading = null, headingSrc = '';
let meMarker = null, meCircle = null, meRay = null;
let watchId = null, firstFix = true, orientBound = false;

const arrowIcon = L.divIcon({
  className:'', iconSize:[34,34], iconAnchor:[17,17],
  html:'<div class="me-arrow" id="meArrow">' +
       '<svg width="34" height="34" viewBox="0 0 34 34">' +
       '<path d="M17 1 L24 13 L17 10 L10 13 Z" fill="#1d7fe0" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>' +
       '<circle cx="17" cy="19" r="6.5" fill="#1d7fe0" stroke="#fff" stroke-width="3"/>' +
       '</svg></div>'
});

/* point at `dist` metres along a great circle bearing */
function destination(lat,lng,brg,dist){
  const R = 6371000, d = dist/R, b = brg*Math.PI/180;
  const la = lat*Math.PI/180, lo = lng*Math.PI/180;
  const la2 = Math.asin(Math.sin(la)*Math.cos(d) + Math.cos(la)*Math.sin(d)*Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(la),
                              Math.cos(d) - Math.sin(la)*Math.sin(la2));
  return [la2*180/Math.PI, ((lo2*180/Math.PI + 540) % 360) - 180];
}
/* long enough to always leave the screen, whatever the zoom */
function rayLength(){
  const b = map.getBounds();
  return map.distance(b.getNorthWest(), b.getSouthEast()) * 1.2;
}

function drawMe(){
  if(!meLatLng) return;
  if(!meMarker){
    meCircle = L.circle(meLatLng,{radius:meAcc,color:'#1d7fe0',weight:1,
                fillColor:'#1d7fe0',fillOpacity:.10,interactive:false}).addTo(map);
    meRay = L.polyline([meLatLng,meLatLng],{color:'#1d7fe0',weight:2,opacity:.9,
                interactive:false}).addTo(map);
    meMarker = L.marker(meLatLng,{icon:arrowIcon,interactive:false,zIndexOffset:1000}).addTo(map);
  } else {
    meMarker.setLatLng(meLatLng);
    meCircle.setLatLng(meLatLng).setRadius(meAcc);
  }
  const el = document.getElementById('meArrow');
  if(el) el.style.transform = 'rotate(' + (heading==null ? 0 : heading) + 'deg)';
  if(el) el.style.opacity = (heading==null ? .45 : 1);
  meRay.setLatLngs(heading==null
    ? [meLatLng, meLatLng]
    : [meLatLng, destination(meLatLng[0], meLatLng[1], heading, rayLength())]);
}
map.on('moveend zoomend', ()=>{ if(meLatLng) drawMe(); });

function onOrient(e){
  let h = null;
  if(typeof e.webkitCompassHeading === 'number'){ h = e.webkitCompassHeading; headingSrc='compass'; }
  else if(typeof e.alpha === 'number' && (e.absolute || e.type==='deviceorientationabsolute')){
    h = 360 - e.alpha; headingSrc='compass';
  }
  if(h === null) return;
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  heading = (h + so + 360) % 360;
  drawMe();
}

function stopLocate(){
  if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
  window.removeEventListener('deviceorientationabsolute', onOrient, true);
  window.removeEventListener('deviceorientation', onOrient, true);
  orientBound = false;
  [meMarker, meCircle, meRay].forEach(l=>{ if(l) map.removeLayer(l); });
  meMarker = meCircle = meRay = null;
  meLatLng = null; heading = null; firstFix = true;
  locBtn.classList.remove('on');
}

async function startLocate(){
  if(!navigator.geolocation){ readout.textContent = 'This browser has no location support'; return; }
  locBtn.classList.add('on');
  readout.textContent = 'Looking for you…';

  watchId = navigator.geolocation.watchPosition(p=>{
    meLatLng = [p.coords.latitude, p.coords.longitude];
    meAcc = p.coords.accuracy || 0;
    /* no compass? fall back to direction of travel while moving */
    if(headingSrc !== 'compass' && p.coords.heading != null && !isNaN(p.coords.heading)
       && (p.coords.speed == null || p.coords.speed > 0.5)){
      heading = p.coords.heading;
    }
    if(firstFix){ map.setView(meLatLng, Math.max(map.getZoom(), 14)); firstFix = false; }
    readout.innerHTML = 'You: ' + meLatLng[0].toFixed(4) + ', ' + meLatLng[1].toFixed(4) +
                        ' · ±' + Math.round(meAcc) + ' m' +
                        (heading==null ? ' · no heading yet' : ' · ' + Math.round(heading) + '°');
    drawMe();
  }, err=>{
    readout.textContent = 'Location unavailable: ' + err.message;
    stopLocate();
  }, {enableHighAccuracy:true, maximumAge:2000, timeout:20000});

  /* iOS needs an explicit ask, and it only works from a tap like this one */
  if(typeof DeviceOrientationEvent !== 'undefined' &&
     typeof DeviceOrientationEvent.requestPermission === 'function'){
    try{ await DeviceOrientationEvent.requestPermission(); }catch(e){}
  }
  if(!orientBound){
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    orientBound = true;
  }
}

locBtn.onclick = ()=>{ watchId === null ? startLocate() : stopLocate(); };
