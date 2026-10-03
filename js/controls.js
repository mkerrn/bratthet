/* ----- explanations switch ----- */
document.getElementById('infoOn').onchange = e=>{
  document.getElementById('panel').classList.toggle('show-info', e.target.checked);
};

/* ---------- controls ---------- */
document.getElementById('apply').onclick = ()=>{
  slope.redraw();
  renderProfileKey();
  renderProfile();
  detectedZ = null;
  buildHeatmap();
};
document.getElementById('slopeOn').onchange = applySlopeVisible;
document.getElementById('nveOpacity').oninput = e=>{
  if(steepCurrent) steepLayers[steepCurrent].setOpacity(e.target.value/100);
};
document.getElementById('heatOpacity').oninput = e=>{ if(heatLayer) heatLayer.setOpacity(e.target.value/100); };
document.getElementById('heatSport').onchange = e=>{
  heatTmpl = heatTmpl.replace(/\/(tiles|tiles-auth)\/[^/]+\//, '/$1/' + e.target.value + '/');
  detectedZ = null;
  buildHeatmap();
};
document.getElementById('steepSrc').onchange = e=>{
  if(e.target.value !== 'off') steepLast = e.target.value;
  applySteep();
};
document.getElementById('runOn').onchange = applyRunout;
for(const id of RUN_BAND_IDS){
  document.getElementById(id).onchange = ()=>{ if(map.hasLayer(runout)) runout.redraw(); };
}
document.getElementById('runOpacity').oninput = e=> runout.setOpacity(e.target.value/100);
document.getElementById('heatOn').onchange = ()=> buildHeatmap();
document.getElementById('jumpTo').onchange = e=>{
  if(!e.target.value) return;
  const [lat,lng,z] = e.target.value.split(',').map(Number);
  map.setView([lat,lng], z);
};
let baseChoice = 'auto';
function setBase(key){
  Object.values(bases).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
  bases[key].addTo(map);
  bases[key].bringToBack();
  currentBase = key;
  applyShade();
  updateContour();
}
/* Kartverket stops at the border, so outside Norway the auto setting hands
   over to OpenTopoMap rather than showing you blank paper. */
function autoBase(){
  if(baseChoice !== 'auto') return;
  setBase(regionFor(map.getCenter()).base);
}
document.getElementById('baseSel').onchange = e=>{
  baseChoice = e.target.value;
  if(baseChoice === 'auto') autoBase(); else setBase(baseChoice);
};
autoBase();

if(HEATMAP_URL){
  document.getElementById('heatOn').checked = true;
  buildHeatmap();
}
/* Any change in the panel (tick boxes, source menus set to Off, a date arrow
   that switches snow on) is reflected in the layer order boxes. */
document.getElementById('body').addEventListener('change', syncOrderChecks);
syncOrderChecks();

const panel = document.getElementById('panel');
document.getElementById('panelHead').onclick = ()=>{
  panel.classList.toggle('closed');
  document.getElementById('toggleHint').textContent = panel.classList.contains('closed') ? 'show' : 'hide';
};

setTimeout(()=>{
  if(demFailed) readout.textContent = 'Elevation tiles blocked here — open the file directly in a browser';
}, 6000);
