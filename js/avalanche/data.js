/* ---------- avalanche forecast regions ----------
   Geometry: the official micro-regions every EAWS member publishes through
   regions.avalanches.org. Ratings: Varsom's own API for Norway, and the EAWS
   daily files (the ones avalanche.report and avalanches.org draw from) for
   everyone else. Services are listed with the rough box they cover, so only
   the ones in view are ever downloaded. */
const EAWS_REGIONS = 'https://regions.avalanches.org/';
const EAWS_STATIC  = 'https://static.avalanche.report/eaws_bulletins/';
const VARSOM_API   = 'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.2/api/';

const DANGER = [null,
  {c:'#ccff66', n:'Low'}, {c:'#ffff00', n:'Moderate'}, {c:'#ff9900', n:'Considerable'},
  {c:'#ff0000', n:'High'}, {c:'#6b0000', n:'Very high', ink:'#fff'}];
const DANGER_WORDS = {low:1, moderate:2, considerable:3, high:4, very_high:5, veryhigh:5};

/* id, link text, forecast page, [west, south, east, north], and whether EAWS
   publishes micro-region geometry for it. From regions.avalanches.org. */
const SERVICES = [
  ['NO',  'varsom.no', 'https://www.varsom.no/en/avalanches/avalanche-warnings/', [4.5,57.9,31.5,71.3]],
  ['SE',  'lavinprognoser.se', 'https://lavinprognoser.se/en/', [11.97,62.53,19.78,68.58]],
  ['FI',  'FMI', 'https://en.ilmatieteenlaitos.fi/avalanche-forecast', [20.55,66.13,29.48,69.15]],
  ['CH',  'SLF (whiterisk.ch)', 'https://whiterisk.ch/en/conditions', [5.956,45.818,10.492,47.807]],
  ['LI',  'SLF (whiterisk.ch)', 'https://whiterisk.ch/en/conditions', [9.472,47.049,9.635,47.271], false],
  ['FR',  'Météo-France', 'https://meteofrance.com/meteo-montagne', [-1.31,41.70,9.28,46.40]],
  ['AT-07','avalanche.report', 'https://avalanche.report', [10.10,46.65,12.96,47.74]],
  ['IT-32-BZ','avalanche.report', 'https://avalanche.report', [10.38,46.22,12.48,47.09]],
  ['IT-32-TN','avalanche.report', 'https://avalanche.report', [10.45,45.67,11.96,46.53]],
  ['AT-02','LWD Kärnten', 'https://lawinenwarndienst.ktn.gv.at/?lang=en', [12.66,46.37,15.07,47.13]],
  ['AT-03','LWD Niederösterreich', 'https://www.lawinenwarndienst-niederoesterreich.at', [14.47,47.42,16.37,48.17]],
  ['AT-04','LWD Oberösterreich', 'https://oberoesterreich.avalanche-warnings.eu', [13.44,47.46,14.77,48.03]],
  ['AT-05','LWD Salzburg', 'https://lawine.salzburg.at/en', [12.08,46.94,14.00,47.83]],
  ['AT-06','LWD Steiermark', 'https://www.lawine-steiermark.at', [13.56,46.64,16.17,47.83]],
  ['AT-08','LWD Vorarlberg', 'https://warnung.vorarlberg.at/vtgdb/dist/index.html#//lwd_lagebericht_en.html', [9.53,46.84,10.24,47.60]],
  ['DE-BY','LWD Bayern', 'https://lawinenwarndienst.bayern.de/', [9.97,47.27,13.10,47.83]],
  ['IT-25-SO-LI','Livigno (ALPSOLUT)', 'https://www.livigno.eu/en/avalanche-bulletin', [10.04,46.42,10.22,46.63]],
  ['IT-21','AINEVA', 'https://bollettini-en.aineva.it', [6.63,44.06,8.70,46.46]],
  ['IT-23','AINEVA', 'https://bollettini-en.aineva.it', [6.80,45.47,7.94,45.99]],
  ['IT-25','AINEVA', 'https://bollettini-en.aineva.it', [8.59,44.68,10.83,46.63]],
  ['IT-34','AINEVA', 'https://bollettini-en.aineva.it', [10.64,45.53,12.73,46.68]],
  ['IT-36','AINEVA', 'https://bollettini-en.aineva.it', [12.32,45.98,13.72,46.65]],
  ['IT-57','AINEVA', 'https://bollettini-en.aineva.it', [12.19,42.69,13.59,43.87]],
  ['SI',  'ARSO', 'https://meteo.arso.gov.si/met/en/weather/bulletin/mountain/avalanche/bulletin/', [13.38,45.42,16.08,46.66]],
  ['AD',  'SMA Andorra', 'https://www.meteo.ad/en/snowstate', [1.42,42.44,1.78,42.66]],
  ['ES-CT-L','Lauegi d\u2019Aran', 'https://lauegi.report/en', [0.64,42.59,1.04,42.86]],
  ['ES-CT','ICGC', 'https://bpa.icgc.cat', [0.71,42.12,2.41,42.79]],
  ['ES-AR','Aludes Aragón', 'https://aludes.aragon.es/', [-0.86,42.46,0.77,42.93]],
  ['ES',  'AEMET', 'https://www.aemet.es/es/eltiempo/prediccion/montana/boletin_peligro_aludes', [-5.12,40.72,-3.72,43.32]],
  ['GB',  'SAIS', 'https://www.sais.gov.uk', [-6.23,56.39,-2.80,57.71]],
  ['IS',  'Veðurstofa Íslands', 'https://en.vedur.is/avalanches/forecast/', [-23.83,63.94,-13.50,66.20]],
  ['CZ',  'HS ČR', 'https://www.horskasluzba.cz/cz/pocasi-na-horach/lavinova-predpoved', [15.36,49.88,17.64,50.81]],
  ['SK',  'avalanches.sk', 'https://avalanches.sk/', [18.59,48.79,20.38,49.30]],
  ['PL-12','TOPR', 'https://lawiny.topr.pl/', [19.76,49.18,20.13,49.30]],
  ['PL',  'GOPR', 'https://www.gopr.pl/en/avalanches', [15.46,49.00,22.89,50.82]],
  ['RO',  'ANM', 'https://www.meteoromania.ro/Upload-Produse/nivologie/nivologie.pdf', [22.32,45.11,26.10,47.64]],
  ['UA',  'UHMC', 'https://www.meteo.gov.ua/en/Sniholavinni-poperedzhennya', [22.43,47.72,25.52,49.33]]
].map(([id, name, url, bbox, geo])=>({id, name, url, bbox, geo: geo !== false,
  area: (bbox[2]-bbox[0])*(bbox[3]-bbox[1])}));
const SERVICE_BY_ID = new Map(SERVICES.map(s=>[s.id, s]));
/* The finest (smallest) service wins where boxes overlap, e.g. Livigno inside Lombardy. */
const SERVICES_FINE_FIRST = SERVICES.slice().sort((a,b)=>a.area - b.area);

/* ----- geometry helpers ----- */
function boxHas(b, ll){ return ll.lng >= b[0] && ll.lng <= b[2] && ll.lat >= b[1] && ll.lat <= b[3]; }
function boxMeets(b, lb){ return b[0] <= lb.getEast() && b[2] >= lb.getWest() && b[1] <= lb.getNorth() && b[3] >= lb.getSouth(); }
function inRing(x, y, r){
  let inside = false;
  for(let i=0, j=r.length-1; i<r.length; j=i++){
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(x, y, poly){
  if(!inRing(x, y, poly[0])) return false;
  for(let k=1; k<poly.length; k++) if(inRing(x, y, poly[k])) return false;
  return true;
}
function geomHas(g, ll){
  if(!g) return false;
  if(g.type === 'Polygon') return inPoly(ll.lng, ll.lat, g.coordinates);
  if(g.type === 'MultiPolygon') return g.coordinates.some(p=>inPoly(ll.lng, ll.lat, p));
  if(g.type === 'GeometryCollection') return g.geometries.some(x=>geomHas(x, ll));
  return false;
}
function geomBox(g){
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  (function walk(c){
    if(typeof c[0] === 'number'){ b[0]=Math.min(b[0],c[0]); b[1]=Math.min(b[1],c[1]); b[2]=Math.max(b[2],c[0]); b[3]=Math.max(b[3],c[1]); }
    else c.forEach(walk);
  })(g.type === 'GeometryCollection' ? g.geometries.map(x=>x.coordinates) : g.coordinates);
  return b;
}
/* Region files can hold retired regions alongside current ones. */
function currentFeatures(fc){
  return (fc.features || []).filter(f=>{
    const p = f.properties || {};
    if(!f.geometry || !p.id) return false;
    if(p.start_date && String(p.start_date).slice(0,10) > TODAY) return false;
    if(p.end_date && String(p.end_date).slice(0,10) <= TODAY) return false;
    return true;
  }).map(f=>{ f.box = geomBox(f.geometry); return f; });
}

/* ----- downloads, each cached as a promise ----- */
const regionCache = new Map(), outlineCache = new Map(), ratingCache = new Map();
let regionNames = null;
function loadRegions(id){
  if(!regionCache.has(id)){
    regionCache.set(id, fetchJson(EAWS_REGIONS + 'micro-regions/' + id + '_micro-regions.geojson.json', 30000)
      .then(currentFeatures)
      .catch(err=>{ regionCache.delete(id); throw err; }));
  }
  return regionCache.get(id);
}
function loadOutline(id){
  if(!outlineCache.has(id)){
    outlineCache.set(id, fetchJson(EAWS_REGIONS + 'outline/' + id + '_outline.geojson.json')
      .then(fc=>(fc.features || []).filter(f=>f.geometry))
      .catch(()=>null));
  }
  return outlineCache.get(id);
}
function loadNames(){
  if(!regionNames){
    regionNames = fetchJson(EAWS_REGIONS + 'micro-regions_names/en.json').catch(()=>({}));
  }
  return regionNames;
}
function levelOf(v){
  if(typeof v === 'number') return v;
  const n = parseInt(v, 10);
  if(!isNaN(n)) return n;
  return DANGER_WORDS[String(v).toLowerCase().replace(/[\s-]/g, '_')] || 0;
}
/* EAWS keys look like "FR-07", "FR-07:high", "FR-07:low:pm". */
function parseEaws(j){
  const out = new Map(), r = (j && j.maxDangerRatings) || {};
  Object.keys(r).forEach(k=>{
    const [rid, ...q] = k.split(':'), v = levelOf(r[k]);
    const o = out.get(rid) || {max:0};
    if(!q.length) o.max = Math.max(o.max, v);
    else if(q.length === 1 && q[0] === 'high') o.hi = v;
    else if(q.length === 1 && q[0] === 'low') o.lo = v;
    if(q.length && !r[rid]) o.max = Math.max(o.max, v);
    out.set(rid, o);
  });
  return out;
}
async function eawsRatings(id, date){
  /* The archive moved one folder down in 2025; try the new place first. */
  for(const base of [EAWS_STATIC + 'eaws_bulletins/' + date + '/', EAWS_STATIC + date + '/']){
    try { return parseEaws(await fetchJson(base + date + '-' + id + '.ratings.json')); }
    catch(e){ /* not there, or not published */ }
  }
  return new Map();
}
async function varsomRatings(date){
  const j = await fetchJson(VARSOM_API + 'RegionSummary/Simple/2/' + date + '/' + date);
  const out = new Map();
  (Array.isArray(j) ? j : []).forEach(r=>{
    const list = r.AvalancheWarningList || [];
    const w = list.find(x=>String(x.ValidFrom || '').slice(0,10) === date) || list[0];
    if(!w) return;
    const lvl = levelOf(w.DangerLevel);
    out.set('NO-' + (r.Id != null ? r.Id : w.RegionId),
      {max: lvl > 0 ? lvl : 0, name: r.Name || w.RegionName || '', text: w.MainText || '', src:'Varsom'});
  });
  return out;
}
function loadRatings(id, date){
  const key = id + '|' + date;
  if(!ratingCache.has(key)){
    const p = id === 'NO'
      ? varsomRatings(date)
          .then(m=>([...m.values()].some(r=>r.max) ? m : eawsRatings('NO', date)))
          .catch(()=>eawsRatings('NO', date))       // blocked or down: EAWS mirrors it
      : eawsRatings(id, date);
    ratingCache.set(key, p);
  }
  return ratingCache.get(key);
}
