"""Derived DEMs for the harness, written like the GLO-30 tiles
(cache/<name>/13/<x>_<y>.f32, float32 on the z13 web mercator pixel grid).

  terr30   Terrarium averaged over blocks of about 30 m on the ground, then
           resampled bilinearly back to the z13 pixels: what a 30 m DEM of
           the same data would look like to the app. Separates the cost of
           coarser resolution from the errors of a particular 30 m DEM.

Usage: .venv/bin/python derive.py terr30 [area ...]
"""
import json, os, sys
import numpy as np
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine
from register import mosaic, tile_cell
from fetch import tile_range

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')


def terr30(a, z, target=30.0):
    x0, y0, x1, y1 = tile_range(a, z)
    pad = 2                                   # run.js reads two rings of tiles
    el = mosaic('terrarium', z, x0, y0, x1, y1, pad=pad).astype(np.float64)
    px = tile_cell(z, (y0 + y1) / 2)
    k = max(1, round(target / px))
    H, W = el.shape
    Hc, Wc = H // k, W // k
    coarse = el[:Hc * k, :Wc * k].reshape(Hc, k, Wc, k).mean(axis=(1, 3))
    fine_t = Affine(1, 0, 0, 0, 1, 0)        # pixel units are enough here
    coarse_t = Affine(k, 0, 0, 0, k, 0)
    out = np.full((H, W), np.nan, np.float64)
    reproject(coarse, out, src_transform=coarse_t, dst_transform=fine_t, src_crs='EPSG:3857',
              dst_crs='EPSG:3857', resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
    d = os.path.join(CACHE, 'terr30', str(z))
    os.makedirs(d, exist_ok=True)
    for y in range(y0 - pad, y1 + pad + 1):
        for x in range(x0 - pad, x1 + pad + 1):
            j, i = (y - y0 + pad) * 256, (x - x0 + pad) * 256
            t = out[j:j + 256, i:i + 256].astype(np.float32)
            if np.isnan(t).all():
                continue
            np.ascontiguousarray(t).tofile(os.path.join(d, f'{x}_{y}.f32'))
    return k, k * px


def main():
    kind, pick = sys.argv[1], sys.argv[2:]
    cfg = json.load(open(os.path.join(HERE, 'areas.json')))
    for a in cfg['areas']:
        if pick and a['name'] not in pick:
            continue
        if kind == 'terr30':
            k, m = terr30(a, cfg['zoom'])
            print(f"{a['name']}: blocks of {k} px = {m:.0f} m")


if __name__ == '__main__':
    main()
