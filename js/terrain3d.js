/* ---------- 3D terrain view ----------
   Leaflet only draws flat maps, so the 3D view is a separate MapLibre GL map
   laid over the Leaflet one. It drapes the current base map over the same
   terrarium elevation tiles the slope layer reads (DEM_URL). MapLibre is
   about 800 KB, so it is only fetched the first time someone opens 3D. The
   tile overlays (official steepness, pistes, heatmap), GPX tracks and the
   measured line are copied across from their Leaflet layers; the computed
   layers are drawn on Leaflet canvases and stay in the 2D map. */
const ML_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/';
const btn3d = document.getElementById('btn3d');
const box3d = document.getElementById('map3d');
/* ready3d rather than isStyleLoaded(): MapLibre's check also waits for every
   tile in view, so it says no for as long as anything is still downloading. */
let map3d = null, mlLoad = null, is3d = false, ready3d = false;

function loadMapLibre(){
  if(mlLoad) return mlLoad;
  mlLoad = new Promise((ok, fail)=>{
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = ML_CDN + 'maplibre-gl.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = ML_CDN + 'maplibre-gl.js';
    s.onload = ()=> ok();
    s.onerror = ()=>{ mlLoad = null; fail(new Error('MapLibre did not load')); };
    document.head.appendChild(s);
  });
  return mlLoad;
}

/* MapLibre knows {z}/{x}/{y} but not Leaflet's {s}, so a template with
   subdomains is spelled out once per subdomain. */
function tileSource(l){
  const o = l.options;
  const subs = typeof o.subdomains === 'string' ? o.subdomains.split('') : o.subdomains;
  const tiles = l._url.includes('{s}') ? subs.map(s=> l._url.replace('{s}', s)) : [l._url];
  return {type:'raster', tiles, tileSize:256, maxzoom:o.maxNativeZoom || o.maxZoom || 18,
          attribution:o.attribution || ''};
}
function baseSource(key){ return tileSource(bases[key]); }

function style3d(){
  return {
    version:8,
    sources:{
      base: baseSource(currentBase),
      dem: {type:'raster-dem', tiles:[DEM_URL], tileSize:256, maxzoom:15, encoding:'terrarium',
            attribution:'Terrain: Mapzen/AWS terrain tiles'},
      /* MapLibre shades better from a source of its own; the browser cache
         means the tiles are still only downloaded once. */
      demShade: {type:'raster-dem', tiles:[DEM_URL], tileSize:256, maxzoom:15, encoding:'terrarium'}
    },
    layers:[
      {id:'base', type:'raster', source:'base'},
      {id:'shade', type:'hillshade', source:'demShade',
       paint:{'hillshade-exaggeration':0.25, 'hillshade-shadow-color':'#0b1a22'}}
    ],
    /* True heights, so the slopes look as steep as they will in the field. */
    terrain:{source:'dem', exaggeration:1},
    sky:{'sky-color':'#7fb3d5', 'horizon-color':'#dce9f0', 'sky-horizon-blend':0.6}
  };
}

/* Leaflet counts zoom on 256 px tiles, MapLibre on 512 px ones. */
function camFromLeaflet(){
  const c = map.getCenter();
  return {center:[c.lng, c.lat], zoom:Math.max(0, map.getZoom() - 1)};
}

function sync3dBase(){
  if(!ready3d) return;
  map3d.removeLayer('base');
  map3d.removeSource('base');
  map3d.addSource('base', baseSource(currentBase));
  map3d.addLayer({id:'base', type:'raster', source:'base'}, 'shade');
}

/* ---------- overlays in 3D ----------
   Rebuilt from scratch from whatever Leaflet is showing, in the order of the
   layer list, so the panel controls keep working while 3D is open. Lines and
   dots are draped on the terrain. */
const OVL3D = 'ovl3d-';
function tileOverlays3d(){
  const out = {};
  const steep = steepCurrent && steepLayers[steepCurrent];
  if(steep && map.hasLayer(steep)) out.aval = steep;
  if(map.hasLayer(pisteLayer)) out.piste = pisteLayer;
  if(heatLayer && map.hasLayer(heatLayer)) out.heat = heatLayer;
  return out;
}
function gpxGeo3d(){
  const f = [];
  if(map.hasLayer(gpxTrackLayer)) gpxTrackLayer.eachLayer(l=>{
    if(l instanceof L.CircleMarker){
      const c = l.getLatLng();
      f.push({type:'Feature', geometry:{type:'Point', coordinates:[c.lng, c.lat]}});
    } else if(l instanceof L.Polyline){
      f.push({type:'Feature', geometry:{type:'LineString',
              coordinates:l.getLatLngs().map(c=>[c.lng, c.lat])}});
    }
  });
  return {type:'FeatureCollection', features:f};
}
/* Same dots as drawMeasure: every point on a short line, only the ends on a
   long one brought in from a GPX file. */
function measureGeo3d(){
  const f = [];
  if(mpts.length > 1) f.push({type:'Feature', geometry:{type:'LineString',
                              coordinates:mpts.map(c=>[c.lng, c.lat])}});
  const busy = mpts.length > 30;
  mpts.forEach((c, i)=>{
    if(busy && i && i !== mpts.length-1) return;
    f.push({type:'Feature', geometry:{type:'Point', coordinates:[c.lng, c.lat]}});
  });
  return {type:'FeatureCollection', features:f};
}
function vecLayers3d(key, color, opacity, fill){
  return [
    {id:OVL3D + key + '-line', type:'line', source:OVL3D + key, filter:['==', '$type', 'LineString'],
     layout:{'line-join':'round', 'line-cap':'round'},
     paint:{'line-color':color, 'line-width':3, 'line-opacity':opacity}},
    {id:OVL3D + key + '-dot', type:'circle', source:OVL3D + key, filter:['==', '$type', 'Point'],
     paint:{'circle-radius':4, 'circle-color':fill, 'circle-opacity':opacity, 'circle-stroke-color':color,
            'circle-stroke-width':2, 'circle-stroke-opacity':opacity, 'circle-pitch-alignment':'map'}}
  ];
}

/* Rebuilding re-requests the tiles and flickers, so it only happens when the
   set of layers, their order or a tile URL changed. Otherwise the opacities
   and the lines are updated in place. */
let shape3d = '';
function sync3dOverlays(){
  if(!is3d || !ready3d) return;
  const tiles = tileOverlays3d();
  const stack = [], sources = {};   // stack is bottom first
  layerOrder.slice().reverse().forEach(key=>{
    const l = tiles[key];
    if(l){
      sources[OVL3D + key] = tileSource(l);
      stack.push({id:OVL3D + key, type:'raster', source:OVL3D + key,
                  paint:{'raster-opacity':l.options.opacity}});
    } else if(key === 'gpx'){
      sources[OVL3D + 'gpx'] = {type:'geojson', data:gpxGeo3d()};
      stack.push(...vecLayers3d('gpx', '#e040fb', gpxOpacity, '#fff'));
    }
  });
  /* The measured line has no row in the layer list; it is always on top, as in 2D. */
  sources[OVL3D + 'meas'] = {type:'geojson', data:measureGeo3d()};
  stack.push(...vecLayers3d('meas', '#ffb020', .95, '#12232c'));

  const shape = JSON.stringify([stack.map(l=> l.id),
    Object.values(sources).map(src=> src.tiles || '')]);
  if(shape === shape3d && map3d.getSource(OVL3D + 'meas')){
    Object.entries(sources).forEach(([k, src])=>{ if(src.data) map3d.getSource(k).setData(src.data); });
    stack.forEach(l=> Object.entries(l.paint).forEach(([p, v])=>{
      if(p.endsWith('opacity')) map3d.setPaintProperty(l.id, p, v);
    }));
    return;
  }
  shape3d = shape;
  map3d.getStyle().layers.filter(l=> l.id.startsWith(OVL3D)).forEach(l=> map3d.removeLayer(l.id));
  Object.keys(map3d.getStyle().sources).filter(k=> k.startsWith(OVL3D)).forEach(k=> map3d.removeSource(k));
  Object.entries(sources).forEach(([k, src])=> map3d.addSource(k, src));
  stack.forEach(l=> map3d.addLayer(l));
}
const sync3dSoon = debounce(sync3dOverlays, 150);
/* Adding or removing any Leaflet layer (a tile layer, a GPX line, a measure
   dot) and any change in the panel (opacity sliders, menus) brings 3D up to
   date. Nothing runs while 3D is closed. */
map.on('layeradd layerremove', ()=>{ if(is3d) sync3dSoon(); });
['input', 'change'].forEach(ev=> document.getElementById('panel').addEventListener(ev, ()=>{ if(is3d) sync3dSoon(); }));

/* The Strava heatmap answers only with the login cookie the browser holds for it. */
function request3d(url){
  return url.includes('strava.com') ? {url, credentials:'include'} : {url};
}

async function open3d(){
  btn3d.disabled = true;
  try { await loadMapLibre(); }
  catch(e){ btn3d.disabled = false; btn3d.title = 'The 3D view could not load. Try again later.'; return; }
  btn3d.disabled = false;
  if(measuring) setMeasuring(false);
  is3d = true;
  document.body.classList.add('is3d');
  btn3d.classList.add('on');
  btn3d.setAttribute('aria-pressed', 'true');
  if(!map3d){
    map3d = new maplibregl.Map({container:box3d, style:style3d(), ...camFromLeaflet(),
                                pitch:60, maxPitch:80, attributionControl:{compact:true},
                                transformRequest:request3d});
    map3d.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'top-left');
    map3d.on('style.load', ()=>{ ready3d = true; sync3dOverlays(); });
  } else {
    map3d.resize();
    sync3dBase();
    sync3dOverlays();
    map3d.jumpTo({...camFromLeaflet(), pitch:Math.max(map3d.getPitch(), 45)});
  }
}

/* Coming back to 2D puts Leaflet where the 3D camera was looking. */
function close3d(){
  is3d = false;
  document.body.classList.remove('is3d');
  btn3d.classList.remove('on');
  btn3d.setAttribute('aria-pressed', 'false');
  if(map3d){
    const c = map3d.getCenter();
    map.setView([c.lat, c.lng], Math.round(map3d.getZoom() + 1));
  }
}

btn3d.onclick = ()=>{ is3d ? close3d() : open3d(); };
