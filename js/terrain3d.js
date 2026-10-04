/* ---------- 3D terrain view ----------
   Leaflet only draws flat maps, so the 3D view is a separate MapLibre GL map
   laid over the Leaflet one. It drapes the current base map over the same
   terrarium elevation tiles the slope layer reads (DEM_URL). MapLibre is
   about 800 KB, so it is only fetched the first time someone opens 3D. The
   overlays are Leaflet layers and stay in the 2D map. */
const ML_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/';
const btn3d = document.getElementById('btn3d');
const box3d = document.getElementById('map3d');
let map3d = null, mlLoad = null, is3d = false;

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
function baseSource(key){
  const l = bases[key], o = l.options;
  const subs = typeof o.subdomains === 'string' ? o.subdomains.split('') : o.subdomains;
  const tiles = l._url.includes('{s}') ? subs.map(s=> l._url.replace('{s}', s)) : [l._url];
  return {type:'raster', tiles, tileSize:256, maxzoom:o.maxNativeZoom || o.maxZoom || 18,
          attribution:o.attribution || ''};
}

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
    /* Heights drawn a little taller than life so gentle relief still reads at
       a distance; the slope colours in 2D are what to judge steepness by. */
    terrain:{source:'dem', exaggeration:1.3},
    sky:{'sky-color':'#7fb3d5', 'horizon-color':'#dce9f0', 'sky-horizon-blend':0.6}
  };
}

/* Leaflet counts zoom on 256 px tiles, MapLibre on 512 px ones. */
function camFromLeaflet(){
  const c = map.getCenter();
  return {center:[c.lng, c.lat], zoom:Math.max(0, map.getZoom() - 1)};
}

function sync3dBase(){
  if(!map3d || !map3d.isStyleLoaded()) return;
  map3d.removeLayer('base');
  map3d.removeSource('base');
  map3d.addSource('base', baseSource(currentBase));
  map3d.addLayer({id:'base', type:'raster', source:'base'}, 'shade');
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
                                pitch:60, maxPitch:80, attributionControl:{compact:true}});
    map3d.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'top-left');
  } else {
    map3d.resize();
    sync3dBase();
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
