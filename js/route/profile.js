/* ---------- elevation profile at the bottom of the screen ---------- */
let pf = null;   // geometry of the last drawing, for the scrubber

function niceStep(range, maxTicks, steps){
  for(const s of steps) if(range/s <= maxTicks) return s;
  return steps[steps.length-1];
}

function renderProfile(){
  const p = curProfile;
  const W = profileSvg.clientWidth, H = profileSvg.clientHeight;
  if(!p || !W || !H) return;
  const L0 = 34, R0 = 6, T0 = 12, B0 = 14;
  const cw = W - L0 - R0, ch = H - T0 - B0;

  let lo = p.min, hi = p.max;
  const minSpan = 40;
  if(hi - lo < minSpan){ const mid = (hi+lo)/2; lo = mid - minSpan/2; hi = mid + minSpan/2; }
  const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const X = d => L0 + d / p.total * cw;
  const Y = e => T0 + (hi - e) / (hi - lo) * ch;
  const base = T0 + ch;
  pf = {L0:L0, cw:cw, X:X, Y:Y, T0:T0, base:base};

  const out = [];
  /* horizontal grid and height labels */
  const ys = niceStep(hi - lo, 3, [10,20,25,50,100,200,250,500,1000]);
  for(let v = Math.ceil(lo/ys)*ys; v <= hi; v += ys){
    const y = Y(v).toFixed(1);
    out.push('<line class="grid" x1="' + L0 + '" x2="' + (W-R0) + '" y1="' + y + '" y2="' + y + '"/>');
    out.push('<text class="lbl" x="' + (L0-4) + '" y="' + y + '" dy="3" text-anchor="end">' + v + '</text>');
  }
  /* distance labels along the bottom */
  const maxX = Math.max(2, Math.floor(cw / 60));
  const xs = niceStep(p.total, maxX, [50,100,200,250,500,1000,2000,2500,5000,10000,20000,50000]);
  for(let d = 0; d <= p.total + 1e-6; d += xs){
    const x = X(d);
    const t = d === 0 ? '0' : d >= 1000 ? (d/1000) + ' km' : d + ' m';
    const anchor = d === 0 ? 'start' : (x > W - 24 ? 'end' : 'middle');
    out.push('<text class="lbl" x="' + x.toFixed(1) + '" y="' + (H-2) + '" text-anchor="' + anchor + '">' + t + '</text>');
  }

  /* fill under the curve, coloured by the ground the line crosses */
  const n = p.ele.length;
  const col = profileColorMode === 'bands'
    ? i => bandColorAt(p, i)
    : i => groundColor((p.ground[i] + p.ground[Math.min(n-1, i+1)]) / 2);
  let a = 0;
  while(a < n-1){
    const c = col(a);
    let b = a + 1;
    while(b < n-1 && col(b) === c) b++;
    let d = 'M' + X(p.dist[a]).toFixed(1) + ',' + base;
    for(let i=a;i<=b;i++) d += 'L' + X(p.dist[i]).toFixed(1) + ',' + Y(p.ele[i]).toFixed(1);
    d += 'L' + X(p.dist[b]).toFixed(1) + ',' + base + 'Z';
    out.push(c ? '<path d="' + d + '" fill="' + c + '" fill-opacity=".7"/>'
               : '<path class="flat" d="' + d + '"/>');
    a = b;
  }

  /* the tapped points */
  (p.vtx || []).slice(1, -1).forEach(k=>{
    const x = X(p.dist[k]).toFixed(1);
    out.push('<line class="vtx" x1="' + x + '" x2="' + x + '" y1="' + T0 + '" y2="' + base + '"/>');
  });

  /* the profile line */
  let d = '';
  for(let i=0;i<n;i++) d += (i ? 'L' : 'M') + X(p.dist[i]).toFixed(1) + ',' + Y(p.ele[i]).toFixed(1);
  out.push('<path class="curve" d="' + d + '"/>');

  /* steepest ground, labelled */
  const k = p.maxGroundIdx, kx = X(p.dist[k]), ky = Y(p.ele[k]);
  out.push('<circle cx="' + kx.toFixed(1) + '" cy="' + ky.toFixed(1) + '" r="3" fill="#fff"/>');
  out.push('<text class="peak" x="' + Math.min(W-R0-12, Math.max(L0+12, kx)).toFixed(1) +
           '" y="' + Math.max(10, ky - 6).toFixed(1) + '">' + Math.round(p.maxGround) + '°</text>');

  /* scrubber, hidden until used */
  out.push('<line class="scrub" id="pfScrub" y1="' + T0 + '" y2="' + base + '" visibility="hidden"/>');
  out.push('<circle class="scrubDot" id="pfDot" r="4" visibility="hidden"/>');

  profileSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  profileSvg.innerHTML = out.join('');
  profileRead.textContent = 'Drag along the curve to find the spot on the map';
}

function scrubTo(clientX){
  const p = curProfile;
  if(!p || !pf) return;
  const r = profileSvg.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (clientX - r.left - pf.L0) / pf.cw));
  const want = f * p.total;
  let lo = 0, hi = p.dist.length - 1;
  while(hi - lo > 1){ const m = (lo+hi) >> 1; if(p.dist[m] <= want) lo = m; else hi = m; }
  const i = (want - p.dist[lo] <= p.dist[hi] - want) ? lo : hi;

  const x = pf.X(p.dist[i]), y = pf.Y(p.ele[i]);
  const line = document.getElementById('pfScrub'), dot = document.getElementById('pfDot');
  line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');

  const g = p.grade[i];
  profileRead.innerHTML =
    fmtLen(p.dist[i]) + ' · <b>' + Math.round(p.ele[i]) + ' m</b> · ground <b>' +
    Math.round(p.ground[i]) + '°</b> · track ' + (Math.abs(g) < 1 ? 'flat' : (g > 0 ? '↑ ' : '↓ ') + Math.round(Math.abs(g)) + '°');

  if(!scrubMarker){
    scrubMarker = L.circleMarker(p.samples[i], {radius:6, color:'#12232c', weight:2,
      fillColor:'#ffb020', fillOpacity:1, interactive:false}).addTo(profileLayer);
  } else scrubMarker.setLatLng(p.samples[i]);
}
function hideScrub(){
  const line = document.getElementById('pfScrub'), dot = document.getElementById('pfDot');
  if(line) line.setAttribute('visibility', 'hidden');
  if(dot) dot.setAttribute('visibility', 'hidden');
  if(scrubMarker){ profileLayer.removeLayer(scrubMarker); scrubMarker = null; }
  profileRead.textContent = 'Drag along the curve to find the spot on the map';
}
let scrubbing = false;
profileSvg.addEventListener('pointerdown', e=>{
  scrubbing = true;
  try { profileSvg.setPointerCapture(e.pointerId); } catch(err){}
  scrubTo(e.clientX);
});
profileSvg.addEventListener('pointermove', e=>{
  if(scrubbing || e.pointerType === 'mouse') scrubTo(e.clientX);
});
profileSvg.addEventListener('pointerup', ()=>{ scrubbing = false; });
profileSvg.addEventListener('pointercancel', ()=>{ scrubbing = false; });
profileSvg.addEventListener('pointerleave', e=>{ if(e.pointerType === 'mouse' && !scrubbing) hideScrub(); });
/* keep clicks on the profile from reaching the map underneath */
L.DomEvent.disableClickPropagation(profileBox);
L.DomEvent.disableScrollPropagation(profileBox);
window.addEventListener('resize', debounce(renderProfile, 120));
