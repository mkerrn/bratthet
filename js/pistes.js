/* ---------- ski pistes ----------
   OpenSnowMap draws pistes and lifts from OpenStreetMap on transparent tiles.
   The tiles are CC-BY-SA and the data ODbL, so both get credited. */
const pisteLayer = L.tileLayer('https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png',
  {maxZoom:18, opacity:0.9, pane:'pistePane',
   attribution:'Pistes © <a href="https://www.opensnowmap.org">OpenSnowMap</a> CC-BY-SA, data © OpenStreetMap contributors'});

function applyPiste(){
  const on = document.getElementById('pisteOn').checked;
  if(on && !map.hasLayer(pisteLayer)) pisteLayer.addTo(map);
  if(!on && map.hasLayer(pisteLayer)) map.removeLayer(pisteLayer);
}
document.getElementById('pisteOpacity').oninput = e=> pisteLayer.setOpacity(e.target.value/100);
