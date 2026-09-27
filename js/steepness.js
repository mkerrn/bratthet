/* Official steepness layers. Each country models this differently, so the one
   you get depends on where you are looking. */
const steepLayers = {
  nve: L.tileLayer(
    'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:22, maxNativeZoom:16, opacity:0.55, attribution:'Avalanche terrain © NVE', pane:'avalPane', zIndex:1}),
  ch: L.tileLayer(
    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png',
    {maxZoom:22, maxNativeZoom:17, opacity:0.55, attribution:'Slope classes © swisstopo', pane:'avalPane', zIndex:1}),
  fr: L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&TILEMATRIXSET=PM' +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    {maxZoom:22, maxNativeZoom:16, opacity:0.55, attribution:'Carte des pentes © IGN', pane:'avalPane', zIndex:1})
};
const steepNotes = {
  nve: 'Norway: NVE release areas above 27° plus modelled runout, the layer Varsom and regObs use. © NVE, NLOD.',
  ch: 'Alps: swisstopo slope classes above 30° from a 10 m model, covering Switzerland and roughly 100 km past the border into France, Italy, Austria and Bavaria. Accuracy drops where the national models meet. © swisstopo.',
  fr: 'France: IGN carte des pentes, zones above 30°, 35°, 40° and 45° from BD ALTI at 5 m. Metropolitan France only. © IGN.'
};

/* One entry per place the app knows something official about. Adding a country
   means adding a row here and, if it has its own steepness service, a layer
   above. Nothing else in the app needs to change. */
const REGIONS = [
  {key:'no',  name:'Norway',      bounds:[57.5, 3.0, 71.5, 32.0], base:'kv',  steep:'nve'},
  {key:'alp', name:'The Alps',    bounds:[43.4, 4.3, 48.6, 16.6], base:'otm', steep:'ch'}
];
const FALLBACK = {key:'', name:'', base:'otm', steep:null};

function inBox(ll, b){ return ll.lat>=b[0] && ll.lat<=b[2] && ll.lng>=b[1] && ll.lng<=b[3]; }
function regionFor(ll){
  return REGIONS.find(r=>inBox(ll, r.bounds)) || FALLBACK;
}

let steepCurrent = null;
function setSteep(key){
  if(steepCurrent === key) return;
  Object.values(steepLayers).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
  steepCurrent = key;
  if(!key) return;
  const l = steepLayers[key];
  l.setOpacity(+document.getElementById('nveOpacity').value/100);
  l.addTo(map);
}
function applySteep(){
  const choice = document.getElementById('steepSrc').value;
  const key = choice === 'auto' ? regionFor(map.getCenter()).steep
            : choice === 'off' ? null
            : choice;
  setSteep(key);
  document.getElementById('steepNote').textContent = key
    ? steepNotes[key]
    : 'No official layer here. The slope bands above still work anywhere — they come from a global elevation model.';
}
