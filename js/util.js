/* ---------- small shared helpers ---------- */
function isoDay(d){
  const z = n => String(n).padStart(2,'0');
  return d.getFullYear() + '-' + z(d.getMonth()+1) + '-' + z(d.getDate());
}
function addDays(iso, n){
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
const TODAY = isoDay(new Date());
function niceDate(iso){
  if(iso === TODAY) return 'today';
  if(iso === addDays(TODAY, 1)) return 'tomorrow';
  if(iso === addDays(TODAY, -1)) return 'yesterday';
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
}
function esc(t){ return String(t).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function debounce(fn, ms){ let h; return ()=>{ clearTimeout(h); h = setTimeout(fn, ms); }; }
function fetchJson(url, ms){
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), ms || 15000);
  return fetch(url, {signal:ctl.signal, headers:{Accept:'application/json'}})
    .then(r=>{ if(!r.ok) throw new Error(r.status + ' ' + url); return r.json(); })
    .finally(()=>clearTimeout(timer));
}
