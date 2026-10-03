"""Fetch everything the runout harness needs into cache/ (gitignored).

For each test area in areas.json:
  - Terrarium z13 tiles (the app's elevation), kept as raw RGBA so run.js
    decodes them with the app's own terrariumDecode. Two rings of extra tiles
    around the area: the app models each tile on a 3x3 block, and the release
    areas of each of those tiles look into their own neighbours.
  - Copernicus GLO-30 resampled (bilinear) onto the same web mercator z13
    pixel grid, as float32 heights per tile. Used from session 3 on.
  - NVE "Bratthet med utlop" exports on the same grid, 256 px per tile, for
    the Norwegian and Svalbard areas: steepness class and runout band.

Usage: .venv/bin/python fetch.py [area ...]      (default: all areas)
Files that are already in the cache are skipped, so it is safe to rerun.
"""
import io, json, math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
R = 20037508.342789244
TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
NVE = 'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer'
NVE_LAYERS = {'norway': (1, 2, 3, 4), 'svalbard': (6, 7, 8, 9)}
GLO30 = ('https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/'
         'Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif')
# NVE steepness colours for pixel values 2..6 (value 1, below 27 degrees, is transparent)
STEEP_RGB = np.array([(255, 255, 0), (255, 170, 0), (255, 85, 0), (255, 0, 0), (115, 0, 0)], float)


def load_areas():
    with open(os.path.join(HERE, 'areas.json')) as f:
        cfg = json.load(f)
    return cfg['zoom'], cfg['areas']


def tile_range(a, z):
    """Tiles covering the area: (x0, y0, x1, y1), inclusive."""
    h = a['size_km'] * 500
    dlat = h / 111320
    dlon = h / (111320 * math.cos(math.radians(a['lat'])))
    n = 2 ** z
    tx = lambda lon: int((lon + 180) / 360 * n)
    ty = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return tx(a['lon'] - dlon), ty(a['lat'] + dlat), tx(a['lon'] + dlon), ty(a['lat'] - dlat)


def merc_bounds(z, x0, y0, x1, y1):
    """Web mercator bounds of a block of tiles: (xmin, ymin, xmax, ymax)."""
    s = 2 * R / 2 ** z
    return -R + x0 * s, R - (y1 + 1) * s, -R + (x1 + 1) * s, R - y0 * s


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:
            if getattr(e, 'code', None) == 404 or k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def fetch_terrarium(z, x0, y0, x1, y1):
    out = os.path.join(CACHE, 'terrarium', str(z))
    os.makedirs(out, exist_ok=True)

    def one(xy):
        x, y = xy
        path = os.path.join(out, f'{x}_{y}.rgba')
        if os.path.exists(path):
            return 0
        png = get(TERRARIUM.format(z=z, x=x, y=y))
        rgba = np.array(Image.open(io.BytesIO(png)).convert('RGBA'), np.uint8)
        rgba.tofile(path)
        return 1

    jobs = [(x, y) for x in range(x0 - 2, x1 + 3) for y in range(y0 - 2, y1 + 3)]
    with ThreadPoolExecutor(8) as ex:
        n = sum(ex.map(one, jobs))
    return n, len(jobs)


def fetch_glo30(z, x0, y0, x1, y1):
    """Mosaic the GLO-30 1x1 degree tiles over the block (with the margin
    ring), read only the window needed over HTTP, and resample bilinearly to
    the z13 web mercator pixel grid, the way Terrarium is built."""
    import rasterio
    from rasterio.merge import merge
    from rasterio.warp import reproject, Resampling, transform_bounds
    from rasterio.transform import from_bounds

    out = os.path.join(CACHE, 'glo30', str(z))
    os.makedirs(out, exist_ok=True)
    X0, Y0, X1, Y1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
    want = [(x, y) for x in range(X0, X1 + 1) for y in range(Y0, Y1 + 1)]
    if all(os.path.exists(os.path.join(out, f'{x}_{y}.f32')) for x, y in want):
        return 0
    mb = merc_bounds(z, X0, Y0, X1, Y1)
    lon0, lat0, lon1, lat1 = transform_bounds('EPSG:3857', 'EPSG:4326', *mb)
    pad = 0.01
    lon0, lat0, lon1, lat1 = lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad
    srcs = []
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', AWS_NO_SIGN_REQUEST='YES',
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
        for la in range(math.floor(lat0), math.floor(lat1) + 1):
            for lo in range(math.floor(lon0), math.floor(lon1) + 1):
                url = GLO30.format(ns='N' if la >= 0 else 'S', lat=abs(la),
                                   ew='E' if lo >= 0 else 'W', lon=abs(lo))
                try:
                    srcs.append(rasterio.open('/vsicurl/' + url))
                except rasterio.errors.RasterioIOError:
                    pass                      # all-sea tiles do not exist
        if not srcs:
            raise RuntimeError('no GLO-30 tiles here')
        mosaic, mt = merge(srcs, bounds=(lon0, lat0, lon1, lat1), nodata=np.nan, dtype='float32')
        crs = srcs[0].crs
        for s in srcs:
            s.close()
    W, H = (X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256
    dst = np.full((H, W), np.nan, np.float32)
    reproject(mosaic[0], dst, src_transform=mt, src_crs=crs, src_nodata=np.nan,
              dst_transform=from_bounds(*mb, W, H), dst_crs='EPSG:3857', dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    for x, y in want:
        i, j = (x - X0) * 256, (y - Y0) * 256
        np.ascontiguousarray(dst[j:j + 256, i:i + 256]).tofile(os.path.join(out, f'{x}_{y}.f32'))
    return len(want)


def nve_export(layer, bbox, w, h):
    url = (f'{NVE}/export?bbox={",".join(f"{v:.3f}" for v in bbox)}&bboxSR=3857&imageSR=3857'
           f'&size={w},{h}&format=png32&transparent=true&layers=show:{layer}&f=image')
    return np.array(Image.open(io.BytesIO(get(url))).convert('RGBA'))


def fetch_nve(a, z, x0, y0, x1, y1):
    """NVE layers on the area's own tiles (no margin), 256 px per tile, so
    pixel (2i, 2j) of a tile is exactly the cell demBlock samples.
    steep: 0 below 27 degrees, else NVE's value 2..6.
    band: 0 no runout, 1 short (32), 2 medium (27), 3 long (23)."""
    path = os.path.join(CACHE, a['name'], 'nve.npz')
    if os.path.exists(path):
        return 0
    os.makedirs(os.path.dirname(path), exist_ok=True)
    w, h = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    assert max(w, h) <= 4096, 'area too large for one NVE export'
    bbox = merc_bounds(z, x0, y0, x1, y1)
    ls, lsh, lme, llo = NVE_LAYERS[a['nve']]
    img = nve_export(ls, bbox, w, h)
    on = img[..., 3] >= 128
    d = ((img[..., None, :3].astype(float) - STEEP_RGB) ** 2).sum(-1)
    steep = np.where(on, d.argmin(-1) + 2, 0).astype(np.uint8)
    band = np.zeros((h, w), np.uint8)
    overlap = 0
    for k, layer in ((3, llo), (2, lme), (1, lsh)):
        m = nve_export(layer, bbox, w, h)[..., 3] >= 128
        overlap += int((m & (band > 0)).sum())
        band[m] = k
    overlap_steep = int(((band > 0) & (steep > 0)).sum())
    np.savez_compressed(path, steep=steep, band=band, x0=x0, y0=y0, z=z)
    print(f'    nve: {w}x{h}, band overlaps {overlap} px, band on >27 deg {overlap_steep} px')
    return 1


def main():
    z, areas = load_areas()
    pick = set(sys.argv[1:])
    for a in areas:
        if pick and a['name'] not in pick:
            continue
        x0, y0, x1, y1 = tile_range(a, z)
        print(f"{a['name']}: tiles x {x0}-{x1}, y {y0}-{y1} ({(x1 - x0 + 1) * (y1 - y0 + 1)} scored)")
        n, tot = fetch_terrarium(z, x0, y0, x1, y1)
        print(f'    terrarium: {n} new of {tot}')
        print(f'    glo30: {fetch_glo30(z, x0, y0, x1, y1)} tiles written')
        if a.get('nve'):
            fetch_nve(a, z, x0, y0, x1, y1)


if __name__ == '__main__':
    main()
