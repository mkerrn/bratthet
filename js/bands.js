/* ---------- slope classes ---------- */
/* Each class is an angle range plus optional filters:
   aspFrom / aspTo: the slope must face somewhere clockwise from aspFrom to
                    aspTo, in compass degrees (both null = any direction),
   elMin / elMax:   altitude limits in metres (null = no limit). */
const COMPASS = ['N','NE','E','SE','S','SW','W','NW'];
const COMPASS16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const FLAT_BELOW = 3;          // degrees; below this, aspect is just noise
const ASPECT_SNAP = 5;         // taps on the dial snap to this many degrees
function newBand(min, max, color){
  return {min:min, max:max, color:color, aspFrom:null, aspTo:null, elMin:null, elMax:null,
          open:false, pick:null};   // pick: start of a range being chosen on the dial
}
const DEFAULT_BANDS = [
  newBand(15, 20, '#86c06c'),
  newBand(20, 29, '#3f8f4a')
];
let bands = JSON.parse(JSON.stringify(DEFAULT_BANDS));

const bandsEl = document.getElementById('bands');
function hexToRgb(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}

function norm360(d){ return ((Math.round(d) % 360) + 360) % 360; }
function dirName(deg){ return COMPASS16[Math.round(deg/22.5) % 16]; }
/* Two equal ends would be an empty range, so that means "every direction". */
function setAspect(b, from, to){
  if(from == null || to == null || norm360(from) === norm360(to)){ b.aspFrom = b.aspTo = null; }
  else { b.aspFrom = norm360(from); b.aspTo = norm360(to); }
  b.pick = null;
}
function aspectText(b){
  if(b.pick != null) return 'Faces ' + dirName(b.pick) + ' to …';
  if(b.aspFrom == null) return 'Any direction';
  return 'Faces ' + dirName(b.aspFrom) + '–' + dirName(b.aspTo) + ' (' + b.aspFrom + '°–' + b.aspTo + '°)';
}
function altText(b){
  if(b.elMin == null && b.elMax == null) return 'any altitude';
  if(b.elMax == null) return 'above ' + b.elMin + ' m';
  if(b.elMin == null) return 'below ' + b.elMax + ' m';
  return b.elMin + '–' + b.elMax + ' m';
}
function isFiltered(b){ return b.aspFrom != null || b.elMin != null || b.elMax != null; }
function summary(b){ return aspectText(b) + ' · ' + altText(b); }
const COG_SVG = '<svg viewBox="-12 -12 24 24" width="15" height="15" aria-hidden="true">' +
  '<circle r="8.5" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="3.34 3.34"/>' +
  '<circle r="6" fill="none" stroke="currentColor" stroke-width="3"/></svg>';

/* ----- the dial ----- */
const DIAL_R = 50, ALL_R = 15;
function dialPt(deg, r){
  const t = deg*Math.PI/180;
  return (r*Math.sin(t)).toFixed(2) + ' ' + (-r*Math.cos(t)).toFixed(2);
}
function wedgePath(from, to){
  const w = (to - from + 360) % 360;
  if(w === 0) return '';
  return 'M0 0 L' + dialPt(from, DIAL_R) + ' A' + DIAL_R + ' ' + DIAL_R + ' 0 ' +
         (w > 180 ? 1 : 0) + ' 1 ' + dialPt(to, DIAL_R) + ' Z';
}
const FULL_DISC = 'M0 -' + DIAL_R + ' A' + DIAL_R + ' ' + DIAL_R + ' 0 1 1 0 ' + DIAL_R +
                  ' A' + DIAL_R + ' ' + DIAL_R + ' 0 1 1 0 -' + DIAL_R + ' Z';
function dialSvg(i){
  let ticks = '';
  for(let d = 0; d < 360; d += 22.5){
    const len = d % 90 === 0 ? 7 : d % 45 === 0 ? 5 : 3;
    ticks += '<path class="tick" d="M' + dialPt(d, DIAL_R) + ' L' + dialPt(d, DIAL_R - len) + '"/>';
  }
  let labels = '';
  [['N',0],['E',90],['S',180],['W',270]].forEach(([n,d])=>{
    const [x,y] = dialPt(d, 37).split(' ');
    labels += '<text class="lbl" x="' + x + '" y="' + y + '">' + n + '</text>';
  });
  return '<svg class="compass" data-i="' + i + '" viewBox="-60 -60 120 120" role="img" ' +
           'aria-label="Direction dial. Tap where the range starts, then where it ends.">' +
         '<circle class="dial" r="' + DIAL_R + '"/>' +
         '<path class="wedge"/><path class="preview"/>' + ticks + labels +
         '<path class="mark m-from"/><path class="mark m-to"/>' +
         '<g class="allbtn"><circle r="' + ALL_R + '"/><text class="lbl">All</text></g>' +
         '</svg>';
}
/* Update one band's dial, summary and direction boxes without rebuilding the
   panel, so a finger or a text cursor is never interrupted. */
function paintBand(i, hover, syncInputs){
  const wrap = bandsEl.children[i]; if(!wrap) return;
  const b = bands[i];
  const tg = wrap.querySelector('.bf-toggle');
  tg.title = 'Direction and altitude: ' + summary(b);
  tg.classList.toggle('active', isFiltered(b));
  const svg = wrap.querySelector('.compass'); if(!svg) return;
  const wedge = svg.querySelector('.wedge'), prev = svg.querySelector('.preview');
  const mf = svg.querySelector('.m-from'), mt = svg.querySelector('.m-to');
  const mark = (el, deg)=> el.setAttribute('d', deg == null ? '' : 'M0 0 L' + dialPt(deg, DIAL_R));
  const hint = wrap.querySelector('.dial-hint');

  svg.classList.toggle('is-all', b.pick == null && b.aspFrom == null);
  if(b.pick != null){
    wedge.setAttribute('d', '');
    prev.setAttribute('d', hover != null ? wedgePath(b.pick, hover) : '');
    mark(mf, b.pick); mark(mt, hover);
    hint.textContent = 'Now tap where it ends, going clockwise.';
  } else if(b.aspFrom != null){
    wedge.setAttribute('d', wedgePath(b.aspFrom, b.aspTo));
    prev.setAttribute('d', '');
    mark(mf, b.aspFrom); mark(mt, b.aspTo);
    hint.textContent = 'Tap the dial again to start a new range.';
  } else {
    wedge.setAttribute('d', FULL_DISC);
    prev.setAttribute('d', '');
    mark(mf, null); mark(mt, null);
    hint.textContent = 'Tap where the range starts.';
  }
  if(syncInputs){
    wrap.querySelector('[data-k="aspFrom"]').value = b.aspFrom ?? '';
    wrap.querySelector('[data-k="aspTo"]').value = b.aspTo ?? '';
  }
}
function dialPoint(svg, e){
  const r = svg.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width/2), dy = e.clientY - (r.top + r.height/2);
  const dist = Math.hypot(dx, dy) * 120 / r.width;          // in viewBox units
  const brg = norm360(Math.round(((Math.atan2(dx, -dy)*180/Math.PI + 360) % 360) / ASPECT_SNAP) * ASPECT_SNAP);
  return {dist:dist, brg:brg};
}

function renderBands(){
  bandsEl.innerHTML = '';
  bands.forEach((b,i)=>{
    const wrap = document.createElement('div');
    wrap.className = 'bandWrap';
    let html =
      '<div class="band">' +
      '<input type="number" min="0" max="90" step="1" value="'+b.min+'" data-k="min" data-i="'+i+'" aria-label="Lowest angle">' +
      '<div class="dash">–</div>' +
      '<input type="number" min="0" max="90" step="1" value="'+b.max+'" data-k="max" data-i="'+i+'" aria-label="Highest angle">' +
      '<input type="color" value="'+b.color+'" data-k="color" data-i="'+i+'" aria-label="Colour">' +
      '<button type="button" class="bf-toggle'+(b.open ? ' open' : '')+'" data-toggle="'+i+'" aria-expanded="'+b.open+'" aria-label="Direction and altitude">' + COG_SVG + '</button>' +
      '<button title="Remove" data-del="'+i+'">×</button>' +
      '</div>';
    if(b.open){
      html += '<div class="bf-edit"><div>' + dialSvg(i) + '<p class="dial-hint"></p></div>' +
        '<div class="bf-fields">' +
          '<div class="grp"><label>Direction, °</label><div class="pair">' +
            '<input type="number" min="0" max="359" step="5" placeholder="from" data-k="aspFrom" data-i="'+i+'" aria-label="Direction range starts at, degrees">' +
            '<div class="dash">–</div>' +
            '<input type="number" min="0" max="359" step="5" placeholder="to" data-k="aspTo" data-i="'+i+'" aria-label="Direction range ends at, degrees">' +
          '</div></div>' +
          '<div class="grp"><label>Altitude, m</label><div class="pair">' +
            '<input type="number" step="50" placeholder="min" value="'+(b.elMin??'')+'" data-k="elMin" data-i="'+i+'" aria-label="Lowest altitude">' +
            '<div class="dash">–</div>' +
            '<input type="number" step="50" placeholder="max" value="'+(b.elMax??'')+'" data-k="elMax" data-i="'+i+'" aria-label="Highest altitude">' +
          '</div></div>' +
          '<p>Directions run clockwise from the first to the second. Leave boxes empty for no limit.</p>' +
        '</div></div>';
    }
    wrap.innerHTML = html;
    bandsEl.appendChild(wrap);
    paintBand(i, null, true);
  });
}
bandsEl.addEventListener('input', e=>{
  const t = e.target, i = +t.dataset.i, k = t.dataset.k;
  if(k===undefined) return;
  const b = bands[i];
  if(k==='color') b[k] = t.value;
  else if(k==='elMin' || k==='elMax'){
    const v = parseFloat(t.value);
    b[k] = isNaN(v) ? null : v;
    paintBand(i, null, false);
  }
  else if(k==='aspFrom' || k==='aspTo'){
    const wrap = bandsEl.children[i];
    const f = parseFloat(wrap.querySelector('[data-k="aspFrom"]').value);
    const to = parseFloat(wrap.querySelector('[data-k="aspTo"]').value);
    setAspect(b, isNaN(f) ? null : f, isNaN(to) ? null : to);
    paintBand(i, null, false);
  }
  else b[k] = parseFloat(t.value)||0;
});
bandsEl.addEventListener('pointermove', e=>{
  const svg = e.target.closest && e.target.closest('.compass'); if(!svg) return;
  const i = +svg.dataset.i;
  if(bands[i].pick == null) return;
  const p = dialPoint(svg, e);
  paintBand(i, p.dist > ALL_R ? p.brg : null, false);
});
bandsEl.addEventListener('click', e=>{
  const svg = e.target.closest('.compass');
  if(svg){
    const i = +svg.dataset.i, b = bands[i], p = dialPoint(svg, e);
    if(p.dist <= ALL_R)       setAspect(b, null, null);    // the middle: everything
    else if(b.pick == null)   b.pick = p.brg;              // first end
    else                      setAspect(b, b.pick, p.brg); // second end
    paintBand(i, null, true);
    return;
  }
  const t = e.target.closest('button'); if(!t) return;
  const d = t.dataset;
  if(d.del !== undefined){ bands.splice(+d.del,1); renderBands(); return; }
  if(d.toggle !== undefined){
    const b = bands[+d.toggle];
    b.open = !b.open;
    if(!b.open) b.pick = null;      // closing abandons a half-chosen range
    renderBands();
  }
});
document.getElementById('addBand').onclick = ()=>{ bands.push(newBand(29, 90, '#d7301f')); renderBands(); };
renderBands();
