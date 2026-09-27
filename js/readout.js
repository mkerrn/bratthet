/* ---------- readout ---------- */
/* Always read at the finest elevation level, whatever the zoom, so a tap on a
   zoomed-out map gives the same numbers as one zoomed in. */
const readout = document.getElementById('readout');
function compassName(deg){ return COMPASS[Math.round(deg/45) % 8]; }

map.on('click', e=>{
  if(measuring){ addMeasurePoint(e.latlng); return; }
  const t = tileCoords(e.latlng, DEM_MAX_Z);
  const fc = forecastLine(e.latlng);
  readout.textContent = 'Reading…';
  loadDem(DEM_MAX_Z, t.x, t.y).then(d=>{
    const i = t.py*256 + t.px;
    const s = d.slope[i], a = d.aspect[i], h = d.el[i];
    const faces = s < FLAT_BELOW
      ? 'Flat'
      : 'Faces <b>' + compassName(a) + '</b> (' + Math.round(a) + '°)';
    readout.innerHTML =
      'Slope <b>' + s.toFixed(0) + '°</b> · ' + faces + ' · <b>' + Math.round(h) + ' m</b>' +
      '<div class="sub">' + e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4) + '</div>' + fc;
  }).catch(()=>{ readout.innerHTML = 'No elevation data here' + fc; });
});
