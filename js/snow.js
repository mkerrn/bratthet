/* ETRS89 / UTM zone 33N (EPSG:25833), the grid NVE serves seNorge in.
   Krüger series to third order: millimetre agreement with PROJ across Norway. */
function toUTM33(lat, lon){
  const a = 6378137, f = 1/298.257222101, k0 = 0.9996;
  const n = f/(2-f), A = a/(1+n)*(1 + n*n/4 + n*n*n*n/64);
  const al = [n/2 - 2*n*n/3 + 5*n*n*n/16, 13*n*n/48 - 3*n*n*n/5, 61*n*n*n/240];
  const e = Math.sqrt(f*(2-f));
  const phi = lat*Math.PI/180, lam = (lon - 15)*Math.PI/180;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e*Math.atanh(e*Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam)/Math.sqrt(1+t*t));
  let E = eta, N = xi;
  for(let j=1; j<=3; j++){
    E += al[j-1]*Math.cos(2*j*xi)*Math.sinh(2*j*eta);
    N += al[j-1]*Math.sin(2*j*xi)*Math.cosh(2*j*eta);
  }
  return [500000 + k0*A*E, k0*A*N];
}

/* ---------- snow right now ----------
   seNorge (NVE) is only published in UTM, never in web mercator. Each map tile
   therefore asks NVE for the UTM rectangle around it and draws that image back
   with an affine transform, which absorbs the few degrees of grid rotation
   between the two projections. Over one tile the rest of the difference is far
   below the model's 1 km cells. */
const NVE_WMS = 'https://kart.nve.no/enterprise/services/seNorgeGrid_png/ImageServer/WMSServer';
const NVE_LEGEND = 'https://nve-skytjenester-prod-imagemanager.s3.eu-north-1.amazonaws.com/static/seNorgeGridLegend/';
let snowErrors = 0, snowLoads = 0;

const SeNorgeLayer = L.GridLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const m = this._map, sz = 256;
    const at = (dx, dy)=> m.unproject(L.point((coords.x+dx)*sz, (coords.y+dy)*sz), coords.z);
    const nw = at(0,0), ne = at(1,0), sw = at(0,1), se = at(1,1);
    const nb = REGIONS[0].bounds;                       // [south, west, north, east]
    if(se.lat > nb[2] || nw.lat < nb[0] || se.lng < nb[1] || nw.lng > nb[3]){
      setTimeout(()=>done(null, tile), 0);
      return tile;
    }
    const P = [nw, ne, sw, se].map(p=>toUTM33(p.lat, p.lng));
    const Es = P.map(p=>p[0]), Ns = P.map(p=>p[1]);
    const minE = Math.min(...Es), maxE = Math.max(...Es), minN = Math.min(...Ns), maxN = Math.max(...Ns);
    const W = 256, H = 256, sx = (maxE-minE)/W, sy = (maxN-minN)/H;

    /* UTM -> tile pixels, from three corners of the tile */
    const [E0, N0] = P[0];
    const e1 = [P[1][0]-E0, P[1][1]-N0], e2 = [P[2][0]-E0, P[2][1]-N0];
    const det = e1[0]*e2[1] - e2[0]*e1[1];
    const a11 = sz*e2[1]/det, a12 = -sz*e2[0]/det, a21 = -sz*e1[1]/det, a22 = sz*e1[0]/det;
    const dE0 = minE-E0, dN0 = maxN-N0;

    const url = NVE_WMS + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=' +
      '&LAYERS=' + this.options.variable + '&SRS=EPSG:25833' +
      '&BBOX=' + [minE, minN, maxE, maxN].map(v=>v.toFixed(1)).join(',') +
      '&WIDTH=' + W + '&HEIGHT=' + H + '&FORMAT=image/png&TRANSPARENT=TRUE&TIME=' + this.options.date;
    const img = new Image();
    img.onload = ()=>{
      const ctx = tile.getContext('2d');
      ctx.imageSmoothingEnabled = false;                 // keep the 1 km cells honest
      ctx.setTransform(a11*sx, a21*sx, -a12*sy, -a22*sy, a11*dE0 + a12*dN0, a21*dE0 + a22*dN0);
      ctx.drawImage(img, 0, 0);
      snowLoads++; snowTileNews();
      done(null, tile);
    };
    img.onerror = ()=>{ snowErrors++; snowTileNews(); done(null, tile); };
    img.src = url;
    return tile;
  }
});

function gibsLayer(id, level, ext, date){
  return L.tileLayer('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + id + '/default/' + date +
    '/GoogleMapsCompatible_Level' + level + '/{z}/{y}/{x}.' + ext,
    {maxZoom:22, maxNativeZoom:level, pane:'snowPane', attribution:'Imagery NASA EOSDIS GIBS'});
}
const SNOW_SOURCES = {
  sd:      {nve:true, variable:'sd',
            text: d=>'seNorge snow depth for ' + niceDate(d) + ', modelled on a 1 km grid. Norway only.'},
  sdfsw3d: {nve:true, variable:'sdfsw3d',
            text: d=>'seNorge new snow in the three days up to ' + niceDate(d) + ', 1 km grid. Norway only.'},
  ndsi:    {make: d=>gibsLayer('MODIS_Terra_NDSI_Snow_Cover', 8, 'png', d),
            text: d=>'MODIS snow cover for ' + niceDate(d) + ', 500 m. Cloud and night are left blank.'},
  modis:   {make: d=>gibsLayer('MODIS_Terra_CorrectedReflectance_TrueColor', 9, 'jpg', d),
            text: d=>'MODIS Terra photo for ' + niceDate(d) + ', 250 m. If it is white everywhere it is probably cloud: step back a day.'},
  viirs:   {make: d=>gibsLayer('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 9, 'jpg', d),
            text: d=>'VIIRS NOAA-20 photo for ' + niceDate(d) + ', 375 m, a different overpass time from MODIS.'},
  s2c:     {undated:true,
            make: ()=>L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg',
              {maxZoom:22, maxNativeZoom:14, pane:'snowPane',
               attribution:'Sentinel-2 cloudless 2023 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2023)'}),
            text: ()=>'Cloud-free mosaic of 2023, 10 m. Built mostly from summer scenes, so it shows glaciers, not this week\u2019s snowline.'},
  custom:  {make: d=>{
              const tmpl = document.getElementById('snowUrl').value.trim();
              if(!tmpl) return null;
              return L.tileLayer(tmpl.split('{date}').join(d), {maxZoom:22, pane:'snowPane', attribution:'Your imagery'});
            },
            text: d=>document.getElementById('snowUrl').value.trim()
              ? 'Your tiles for ' + niceDate(d) + '.'
              : 'Paste a tile URL with {z}, {x}, {y} and {date} in it, for example a Sentinel Hub WMTS layer.'}
};

const snowOn = document.getElementById('snowOn');
const snowSrcEl = document.getElementById('snowSrc');
const snowDateEl = document.getElementById('snowDate');
const snowStatus = document.getElementById('snowStatus');
snowDateEl.value = TODAY;
snowDateEl.max = addDays(TODAY, 9);                   // seNorge runs nine days ahead
let snowLayer = null, snowKey = '', snowSrcNow = '';

function snowSource(){
  const c = snowSrcEl.value;
  if(c !== 'auto') return c;
  return regionFor(map.getCenter()).key === 'no' ? 'sd' : 'modis';
}
function snowTileNews(){
  const src = SNOW_SOURCES[snowSrcNow];
  if(!src || !src.nve || !snowOn.checked) return;   // late tiles after switching off
  if(snowErrors && !snowLoads){
    snowStatus.classList.add('warn');
    snowStatus.textContent = 'NVE sent no image for ' + niceDate(snowDateEl.value) +
      '. The day may not be computed yet, or the service is down; try the day before.';
  } else {
    snowStatus.classList.remove('warn');
    snowStatus.textContent = src.text(snowDateEl.value);
  }
}
function updateS2Link(){
  const c = map.getCenter(), d = snowDateEl.value || TODAY;
  document.getElementById('s2Link').href = 'https://browser.dataspace.copernicus.eu/?zoom=' + map.getZoom() +
    '&lat=' + c.lat.toFixed(4) + '&lng=' + c.lng.toFixed(4) +
    '&datasetId=S2_L2A_CDAS&layerId=1_TRUE_COLOR' +
    '&fromTime=' + d + 'T00:00:00.000Z&toTime=' + d + 'T23:59:59.999Z';
}
function applySnow(){
  const on = snowOn.checked, key = snowSource(), src = SNOW_SOURCES[key];
  const date = snowDateEl.value || TODAY;
  document.getElementById('snowUrl').hidden = key !== 'custom';
  document.getElementById('snowDateRow').style.display = src.undated ? 'none' : '';
  const leg = document.getElementById('snowLegend');
  leg.hidden = !(on && src.nve);
  if(on && src.nve){
    leg.onerror = ()=>{ leg.hidden = true; };          // no legend beats a broken image
    leg.src = NVE_LEGEND + src.variable + '.png';
  }
  updateS2Link();

  const want = on ? key + '|' + date + '|' + (key === 'custom' ? document.getElementById('snowUrl').value : '') : '';
  if(want === snowKey) return;
  snowKey = want;
  if(snowLayer){ map.removeLayer(snowLayer); snowLayer = null; }
  snowStatus.classList.remove('warn');
  if(!on){ snowStatus.textContent = ''; return; }

  snowSrcNow = key; snowErrors = 0; snowLoads = 0;
  snowLayer = src.nve
    ? new SeNorgeLayer({variable:src.variable, date:date, pane:'snowPane', maxZoom:22,
                        attribution:'Snow © NVE / seNorge, NLOD'})
    : src.make(date);
  snowStatus.textContent = src.text(date);
  if(!snowLayer) return;
  snowLayer.setOpacity(+document.getElementById('snowOpacity').value/100);
  snowLayer.addTo(map);
  if(src.nve && regionFor(map.getCenter()).key !== 'no'){
    snowStatus.textContent += ' Pan to Norway to see it.';
  }
}
function stepSnowDate(n){
  snowDateEl.value = addDays(snowDateEl.value || TODAY, n);
  if(!snowOn.checked){ snowOn.checked = true; }
  applySnow();
}
snowOn.onchange = applySnow;
snowSrcEl.onchange = ()=>{ if(!snowOn.checked) snowOn.checked = true; applySnow(); };
snowDateEl.onchange = applySnow;
document.getElementById('snowPrev').onclick = ()=>stepSnowDate(-1);
document.getElementById('snowNext').onclick = ()=>stepSnowDate(1);
document.getElementById('snowToday').onclick = ()=>{ snowDateEl.value = TODAY; applySnow(); };
document.getElementById('snowUrl').onchange = applySnow;
document.getElementById('snowOpacity').oninput = e=>{ if(snowLayer) snowLayer.setOpacity(e.target.value/100); };
updateS2Link();
