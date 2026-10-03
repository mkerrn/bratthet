"""Slope over 30 degrees from each DEM against the official slope maps the
app already shows: swisstopo's hangneigung-ueber_30 (10 m model, reaches
about 100 km past the Swiss border) and IGN's carte des pentes (BD ALTI 5 m,
France only). Both are transparent below 30 degrees, so any opaque pixel is
>30. Tiles are cached in cache/<area>/slope-<source>.npy on the z13 pixel grid.

Usage: .venv/bin/python slopecheck.py [area ...]
"""
import io, json, os, sys
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from fetch import tile_range, get, CACHE, HERE
from register import mosaic, horn, tile_cell

SOURCES = {
    'swisstopo': 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png',
    'ign': ('https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
            '&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&TILEMATRIXSET=PM'
            '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'),
}
DEMS = ('terrarium', 'glo30', 'swiss')


def official(a, z, src):
    path = os.path.join(CACHE, a['name'], f'slope-{src}.npy')
    if os.path.exists(path):
        return np.load(path)
    x0, y0, x1, y1 = tile_range(a, z)
    out = np.full(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), 255, np.uint8)   # 255: no tile

    def one(xy):
        x, y = xy
        try:
            im = np.array(Image.open(io.BytesIO(get(SOURCES[src].format(z=z, x=x, y=y)))).convert('RGBA'))
        except Exception:
            return
        out[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = im[..., 3] >= 128

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(one, [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]))
    np.save(path, out)
    return out


def main():
    pick = sys.argv[1:]
    cfg = json.load(open(os.path.join(HERE, 'areas.json')))
    z = cfg['zoom']
    print('| area | reference | ref >30° km² | DEM | DEM >30° km² | share of ref found | IoU |\n|---|---|---|---|---|---|---|')
    for a in cfg['areas']:
        if a['set'] != 'alps' or (pick and a['name'] not in pick):
            continue
        x0, y0, x1, y1 = tile_range(a, z)
        cell = tile_cell(z, (y0 + y1) / 2)
        slopes = {}
        for dem in DEMS:
            el = mosaic(dem, z, x0, y0, x1, y1, pad=1)
            if np.isnan(el).all():
                continue
            slopes[dem] = (horn(el, cell) > 30)[256:-256, 256:-256]
        for src in SOURCES:
            ref = official(a, z, src)
            have = ref != 255
            if a.get('swiss'):
                have &= np.repeat(np.repeat(np.load(os.path.join(CACHE, a['name'], 'mask-swiss.npy')), 2, 0), 2, 1)
            # France only for IGN; swisstopo fades out far from Switzerland: need some data
            if have.mean() < 0.5 or (ref[have] == 1).mean() < 0.02:
                continue
            r = (ref == 1) & have
            # swisstopo fades out far from Switzerland (the Dolomites): skip a
            # reference that has under half the steep ground GLO-30 finds
            if 'glo30' in slopes and r.sum() < 0.5 * (slopes['glo30'] & have).sum():
                continue
            km = lambda m: m.sum() * cell * cell / 1e6
            for dem, s in slopes.items():
                s = s & have
                print(f"| {a['name']} | {src} ({have.mean():.0%} covered) | {km(r):.1f} | {dem} | {km(s):.1f} "
                      f"| {(s & r).sum() / r.sum():.2f} | {(s & r).sum() / (s | r).sum():.2f} |")


if __name__ == '__main__':
    main()
