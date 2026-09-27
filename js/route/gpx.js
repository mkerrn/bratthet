/* ---------- GPX export ----------
   A track rather than a route: that is what Garmin, Suunto, Coros and the
   phone apps import as a course, and the elevations let a watch show the
   climb ahead. Points are thinned to about one every 20 m. */
function xmlEsc(t){ return String(t).replace(/[<>&"']/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }

function buildGpx(pts, p){
  const now = new Date();
  const stamp = now.toISOString().slice(0,10);
  const name = 'Bratthet route ' + stamp;
  const rows = [];
  if(p){
    const keep = new Set(p.vtx || []);
    let last = -Infinity;
    for(let i=0;i<p.samples.length;i++){
      const isV = keep.has(i) || i === p.samples.length-1;
      if(!isV && p.dist[i] - last < 20) continue;
      last = p.dist[i];
      const s = p.samples[i];
      rows.push('      <trkpt lat="' + s.lat.toFixed(6) + '" lon="' + s.lng.toFixed(6) + '"><ele>' +
                p.ele[i].toFixed(1) + '</ele></trkpt>');
    }
  } else {
    pts.forEach(s=>rows.push('      <trkpt lat="' + s.lat.toFixed(6) + '" lon="' + s.lng.toFixed(6) + '"></trkpt>'));
  }
  let total = 0;
  for(let i=1;i<pts.length;i++) total += map.distance(pts[i-1], pts[i]);
  let desc = fmtLen(total);
  if(p){
    desc += ', up ' + Math.round(p.up) + ' m, down ' + Math.round(p.down) + ' m, steepest ground ' +
            Math.round(p.maxGround) + '°, Munter ' + fmtHours(munterTime(p, munterMode).total) +
            ' ' + (munterMode === 'ski' ? 'on skis' : 'on foot');
  }
  return {
    name: name,
    file: 'bratthet-route-' + stamp + '-' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + '.gpx',
    xml:
'<?xml version="1.0" encoding="UTF-8"?>\n' +
'<gpx version="1.1" creator="Bratthet" xmlns="http://www.topografix.com/GPX/1/1">\n' +
'  <metadata>\n    <name>' + xmlEsc(name) + '</name>\n    <time>' + now.toISOString() + '</time>\n  </metadata>\n' +
'  <trk>\n    <name>' + xmlEsc(name) + '</name>\n    <desc>' + xmlEsc(desc) + '</desc>\n    <trkseg>\n' +
rows.join('\n') + '\n    </trkseg>\n  </trk>\n</gpx>\n'
  };
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

async function exportGpx(){
  if(mpts.length < 2) return;
  const pts = mpts.slice();
  let p = null;
  try { p = await elevationProfile(pts); } catch(e){ p = null; }
  const g = buildGpx(pts, p);
  const blob = new Blob([g.xml], {type:'application/gpx+xml'});
  /* On a phone, the share sheet is the way into Garmin Connect, Suunto,
     FATMAP-style apps and the like; elsewhere a plain download. */
  const touch = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  if(touch && navigator.canShare){
    const file = new File([blob], g.file, {type:'application/gpx+xml'});
    if(navigator.canShare({files:[file]})){
      try { await navigator.share({files:[file], title:g.name}); return; }
      catch(err){ if(err && err.name === 'AbortError') return; }
    }
  }
  downloadBlob(blob, g.file);
}
gpxBtn.onclick = ()=>{ exportGpx(); };
