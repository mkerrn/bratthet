"""How well each DEM lines up with NVE: slope > 27 degrees (Horn, as the app
computes it) against NVE's steepness layer, with the DEM shifted by whole
pixels. The shift with the best IoU is the registration offset.

Usage: .venv/bin/python register.py [--dem terrarium|glo30|...] [area ...]
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
R = 20037508.342789244


def tile_cell(z, y):
    n = np.pi - 2 * np.pi * (y + 0.5) / 2 ** z
    return 156543.03392 * np.cos(np.arctan(np.sinh(n))) / 2 ** z


def mosaic(dem, z, x0, y0, x1, y1, pad=0):
    """Heights over the tiles x0..x1, y0..y1, plus pad tiles on each side."""
    X0, Y0, X1, Y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    out = np.full(((Y1 - Y0 + 1) * 256, (X1 - X0 + 1) * 256), np.nan, np.float32)
    for y in range(Y0, Y1 + 1):
        for x in range(X0, X1 + 1):
            if dem == 'terrarium':
                f = os.path.join(CACHE, 'terrarium', str(z), f'{x}_{y}.rgba')
                if not os.path.exists(f):
                    continue
                a = np.fromfile(f, np.uint8).reshape(256, 256, 4).astype(np.float64)
                e = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            else:
                f = os.path.join(CACHE, dem, str(z), f'{x}_{y}.f32')
                if not os.path.exists(f):
                    continue
                e = np.fromfile(f, np.float32).reshape(256, 256)
            out[(y - Y0) * 256:(y - Y0 + 1) * 256, (x - X0) * 256:(x - X0 + 1) * 256] = e
    return out


def horn(el, cell):
    p = np.pad(el, 1, mode='edge')
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cell)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def main():
    args, dem, pick = sys.argv[1:], 'glo30', []
    while args:
        a = args.pop(0)
        if a == '--dem':
            dem = args.pop(0)
        else:
            pick.append(a)
    cfg = json.load(open(os.path.join(HERE, 'areas.json')))
    print(f'DEM {dem}: IoU of slope > 27° with NVE > 27° per shift (dx east, dy south, pixels)\n')
    for a in cfg['areas']:
        if not a.get('nve') or (pick and a['name'] not in pick):
            continue
        nve = np.load(os.path.join(CACHE, a['name'], 'nve.npz'))
        x0, y0 = int(nve['x0']), int(nve['y0'])
        steep = nve['steep'] > 0
        H, W = steep.shape
        x1, y1 = x0 + W // 256 - 1, y0 + H // 256 - 1
        el = mosaic(dem, int(nve['z']), x0, y0, x1, y1, pad=1)
        sl = horn(el, tile_cell(int(nve['z']), (y0 + y1) / 2)) > 27
        best, rows = None, []
        for dy in range(-2, 3):
            row = []
            for dx in range(-2, 3):
                # model pixel (j, i) is the DEM pixel (j - dy, i - dx): DEM moved by (dx, dy)
                m = sl[256 - dy:256 - dy + H, 256 - dx:256 - dx + W]
                iou = (m & steep).sum() / (m | steep).sum()
                row.append(iou)
                if best is None or iou > best[0]:
                    best = (iou, dx, dy)
            rows.append(row)
        px = tile_cell(int(nve['z']), (y0 + y1) / 2)
        print(f"{a['name']:12s} best dx {best[1]:+d} dy {best[2]:+d} ({px:.1f} m/px), IoU {best[0]:.3f}, "
              f"unshifted {rows[2][2]:.3f}, row dy=0: " + ' '.join(f'{v:.3f}' for v in rows[2]))


if __name__ == '__main__':
    main()
