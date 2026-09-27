/* ---------- scale bar ---------- */
/* Measured across the middle of the screen, so it stays honest as Mercator
   stretches the map towards the poles. */
const scaleBarEl = document.getElementById('scaleBar');
const scaleLabelEl = document.getElementById('scaleLabel');
const MAX_SCALE_PX = 110;

function niceNumber(x){
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x/p;
  return (f>=5 ? 5 : f>=3 ? 3 : f>=2 ? 2 : 1) * p;
}
function fmtLen(m){
  if(m >= 10000) return (m/1000).toFixed(1) + ' km';
  if(m >= 1000)  return (m/1000).toFixed(2) + ' km';
  return Math.round(m) + ' m';
}
function updateScale(){
  const y = map.getSize().y/2;
  const a = map.containerPointToLatLng([0, y]);
  const b = map.containerPointToLatLng([MAX_SCALE_PX, y]);
  const maxMeters = a.distanceTo(b);
  if(!isFinite(maxMeters) || maxMeters <= 0) return;
  const round = niceNumber(maxMeters);
  scaleBarEl.style.width = Math.round(MAX_SCALE_PX * round/maxMeters) + 'px';
  scaleLabelEl.textContent = round >= 1000
    ? (round/1000) + ' km'
    : round + ' m';
}

/* ---------- contour interval of the base map ---------- */
/* Raster tiles carry no metadata, so this is the published equidistance of
   each map series at the zoom you are looking at, not something read out of
   the tile. Null means the base map draws no contours worth naming there. */
const CONTOURS = {
  kv:  z => z >= 12 ? 20 : null,          // Kartverket topo, N50-derived
  kvgrey: z => z >= 12 ? 20 : null,       // same map in grey
  otm: z => z >= 15 ? 10 : z >= 13 ? 50 : z >= 12 ? 100 : null
};
const BASE_NAMES = {kv:'Kartverket', kvgrey:'Kartverket', otm:'OpenTopoMap'};
const contourEl = document.getElementById('contourInfo');
let currentBase = 'kv';

function updateContour(){
  const f = CONTOURS[currentBase];
  const v = f ? f(map.getZoom()) : null;
  if(v == null){ contourEl.classList.remove('on'); contourEl.textContent = ''; return; }
  contourEl.textContent = 'Contours ' + v + ' m · ' + (BASE_NAMES[currentBase] || '');
  contourEl.classList.add('on');
}

map.on('move zoom zoomend moveend resize', ()=>{ updateScale(); updateContour(); });
updateScale();
updateContour();
