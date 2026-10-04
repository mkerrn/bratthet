/* ----- explanations switch ----- */
document.getElementById('infoOn').onchange = e=>{
  document.getElementById('panel').classList.toggle('show-info', e.target.checked);
};

/* ---------- controls ---------- */
document.getElementById('apply').onclick = ()=>{
  slope.redraw();
  changed3d(slope);
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
  document.getElementById(id).onchange = ()=>{ if(map.hasLayer(runout)){ runout.redraw(); changed3d(runout); } };
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
  updateBaseAcc();
  sync3dBase();
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

/* ---------- keyboard shortcuts ----------
   Cmd (Mac) or Ctrl (elsewhere) plus a letter shows or hides a layer. The
   letter is the layer's first letter, except where two layers would share
   one. Cmd/Ctrl+3 switches between 2D and 3D, Cmd/Ctrl+L the layers panel.
   Some combinations belong to the browser or the OS and never reach the page
   (Cmd+W/Ctrl+W closes the tab, Cmd+H hides the browser on a Mac). */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const LAYER_KEYS = {a:'slope', o:'aval', r:'runout', s:'sun', w:'wind', c:'snow',
                    f:'danger', h:'heat', p:'piste', u:'hut', g:'gpx'};
document.addEventListener('keydown', e=>{
  if(!(IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) || e.altKey || e.shiftKey) return;
  /* Leave copy, paste and select-all alone while typing in a field. */
  const t = e.target;
  if(t.isContentEditable || t.tagName === 'TEXTAREA' ||
     (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes(t.type))) return;
  const k = e.key.toLowerCase();
  if(k === '3'){
    e.preventDefault();
    if(!btn3d.disabled) btn3d.click();
  } else if(k === 'l'){
    e.preventDefault();
    document.getElementById('panelHead').click();
  } else if(LAYER_KEYS[k] && LAYER_GROUPS[LAYER_KEYS[k]]){
    e.preventDefault();
    const tog = LAYER_TOGGLES[LAYER_KEYS[k]];
    tog.set(!tog.get());
    syncOrderChecks();
  }
});

/* ---------- disclaimer ----------
   The public site opens with a disclaimer that has to be accepted once per
   device. Change the stored version when the wording changes, so everyone
   sees the new text. Friends mode skips it, and also keeps the heatmap
   sentence in "Before you use this". */
const DISCLAIMER_VERSION = '1';
if(!FRIENDS){
  document.getElementById('heatCaveat').hidden = true;
  let seen = false;
  try{ seen = localStorage.getItem('bratthet.disclaimer') === DISCLAIMER_VERSION; }catch(e){}
  if(!seen){
    const box = document.getElementById('disclaimer');
    box.hidden = false;
    document.getElementById('disclaimerOk').focus();
    document.getElementById('disclaimerOk').onclick = ()=>{
      box.hidden = true;
      try{ localStorage.setItem('bratthet.disclaimer', DISCLAIMER_VERSION); }catch(e){}
    };
  }
}
