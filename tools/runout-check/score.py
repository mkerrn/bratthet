"""Score a model run (run.js output) against NVE's runout bands.

Usage: .venv/bin/python score.py [--tag baseline] [--ref tag] [--mask name] [area ...]
Prints a markdown table per alpha class and a summary per set (calib/holdout).

--ref <tag> scores against another model run instead of NVE (for the Alps,
where there is no NVE layer, e.g. Terrarium or GLO-30 against swissALTI3D).
Nothing is left out then: both runs colour steep ground the same way. The
start zone table becomes start zone overlap with the reference run.
--mask <name> also leaves out block cells where cache/<area>/mask-<name>.npy
is false (e.g. --mask swiss: outside the swissALTI3D coverage).

Everything is compared on the app's block grid: one cell per 2x2 Terrarium
pixels, sampled at the top-left pixel as demBlock does. NVE is exported at
256 px per tile, so NVE pixel (2i, 2j) is the same spot.

Cells NVE marks as steeper than 27 degrees are left out: NVE never draws
runout on them, and they are where both models start, not where they run.
Footprints are cumulative, as an alpha cone is: medium (27) = short + medium,
long (23) = all three bands.

Edge distance: the downhill and side edges of a footprint (footprint cells
next to a cell that is neither footprint nor >27 degrees), measured from
each NVE edge cell to the nearest model edge cell ("nve->model") and back
("model->nve"), in metres.
"""
import json, os, sys
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
CLASSES = ((1, 32, 'short'), (2, 27, 'medium'), (3, 23, 'long'))
K4 = ndimage.generate_binary_structure(2, 1)


def edges(f, ignore):
    outside = ~f & ~ignore
    return f & ndimage.binary_dilation(outside, K4)


def edge_dist(a_edge, b_edge, cell):
    """Distance from each a-edge cell to the nearest b-edge cell, metres."""
    if not a_edge.any() or not b_edge.any():
        return np.array([np.nan])
    return ndimage.distance_transform_edt(~b_edge)[a_edge] * cell


def load_model(area, tag):
    meta = json.load(open(os.path.join(CACHE, area, f'model-{tag}.json')))
    mod = np.fromfile(os.path.join(CACHE, area, f'model-{tag}.u8'), np.uint8).reshape(meta['H'], meta['W'])
    return meta, mod


def load(area, tag, ref=None):
    """The model run and its reference: NVE (steepness class and band) or,
    with ref, another run (no steep ground left out, its bands and start zones)."""
    meta, mod = load_model(area, tag)
    if ref:
        _, r = load_model(area, ref)
        return meta, mod, np.zeros(r.shape, np.uint8), r & 3, (r & 4) > 0
    nve = np.load(os.path.join(CACHE, area, 'nve.npz'))
    return meta, mod, nve['steep'][::2, ::2], nve['band'][::2, ::2], None


def score_area(area, tag, ref=None, mask=None):
    meta, mod, steep, band, rstart = load(area, tag, ref)
    cell = meta['cell_m']
    ignore = steep > 0
    if mask:
        ignore = ignore | ~np.load(os.path.join(CACHE, area, f'mask-{mask}.npy'))
    mband, mstart = mod & 3, (mod & 4) > 0
    rows = []
    for k, alpha, name in CLASSES:
        n = (band > 0) & (band <= k) & ~ignore
        m = (mband > 0) & (mband <= k) & ~ignore
        tp, fp, fn = int((n & m).sum()), int((~n & m).sum()), int((n & ~m).sum())
        ne, me = edges(n, ignore), edges(m, ignore)
        d1, d2 = edge_dist(ne, me, cell), edge_dist(me, ne, cell)
        rows.append(dict(area=area, alpha=alpha, name=name, tp=tp, fp=fp, fn=fn,
                         nve_km2=n.sum() * cell * cell / 1e6, mod_km2=m.sum() * cell * cell / 1e6,
                         d_nm=d1, d_mn=d2))
    # Start zones, roughly: NVE >27 cells that touch NVE runout, against our release cells
    if rstart is not None:
        rstart, mstart = rstart & ~ignore, mstart & ~ignore
        u = int((rstart | mstart).sum())
        pra = dict(area=area, nve_start=int(rstart.sum()), covered=int((rstart & mstart).sum()),
                   ours=int(mstart.sum()), iou=(rstart & mstart).sum() / max(1, u))
        return rows, pra, meta
    nstart = ignore & ndimage.binary_dilation(band > 0, iterations=1, structure=np.ones((3, 3), bool))
    pra = dict(area=area, nve_start=int(nstart.sum()), covered=int((nstart & mstart).sum()),
               ours=int(mstart.sum()), ours_on_steep=int((mstart & ignore).sum()),
               nve30=int((steep >= 3).sum()), ours_on_nve30=int((mstart & (steep >= 3)).sum()))
    return rows, pra, meta


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else np.nan
    r = tp / (tp + fn) if tp + fn else np.nan
    f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
    iou = tp / (tp + fp + fn) if tp else 0.0
    return p, r, f1, iou


def line(label, alpha, tp, fp, fn, nkm, mkm, d1, d2):
    p, r, f1, iou = prf(tp, fp, fn)
    q = lambda d, x: f'{np.nanpercentile(d, x):.0f}'
    return (f'| {label} | {alpha}° | {nkm:.2f} | {mkm:.2f} | {p:.2f} | {r:.2f} | {f1:.2f} | {iou:.2f} '
            f'| {q(d1, 50)} / {q(d1, 90)} | {q(d2, 50)} / {q(d2, 90)} |')


HEAD_NVE = ('| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) '
        '| edge model→NVE m (median / p90) |\n|---|---|---|---|---|---|---|---|---|---|')


def main():
    args, tag, ref, mask, pick = sys.argv[1:], 'baseline', None, None, []
    while args:
        a = args.pop(0)
        if a == '--tag':
            tag = args.pop(0)
        elif a == '--ref':
            ref = args.pop(0)
        elif a == '--mask':
            mask = args.pop(0)
        else:
            pick.append(a)
    areas = json.load(open(os.path.join(HERE, 'areas.json')))['areas']
    have = lambda a, t: os.path.exists(os.path.join(CACHE, a['name'], f'model-{t}.u8'))
    areas = [a for a in areas if (a.get('nve') or ref) and (not pick or a['name'] in pick)
             and have(a, tag) and (not ref or have(a, ref))]
    res = {a['name']: score_area(a['name'], tag, ref, mask) for a in areas}
    sets = {a['name']: a['set'] for a in areas}
    meta0 = next(iter(res.values()))[2]
    if ref:
        print(f"Model `{tag}` ({meta0['dem']} DEM) against model `{ref}`, all cells\n")
    elif meta0.get('model', 'baseline') == 'baseline':
        print(f"Model `{tag}`: {meta0['dem']} DEM, release slope ≥ {meta0['release']}°, envelope\n")
    else:
        print(f"Model `{tag}`: {meta0['dem']} DEM, `{meta0['model']}`, PRA {meta0.get('pra')}, "
              f"route {meta0.get('route') if meta0['model'] != 'app' else 'flow'} {meta0.get('flow')}, "
              f"leaving out slopes over {meta0.get('maxslope')}°\n")
    for k, alpha, name in CLASSES:
        head = HEAD_NVE.replace('NVE', 'ref') if ref else HEAD_NVE
        print(f'**{name.capitalize()} runout, α {alpha}°**\n\n{head}')
        for s in ('calib', 'holdout', 'alps'):
            group = [res[n][0][k - 1] for n in res if sets[n] == s]
            for r in group:
                print(line(r['area'], alpha, r['tp'], r['fp'], r['fn'], r['nve_km2'], r['mod_km2'], r['d_nm'], r['d_mn']))
            if group:
                tot = lambda f: sum(r[f] for r in group)
                cat = lambda f: np.concatenate([r[f] for r in group])
                print(line(f'**all {s}**', alpha, tot('tp'), tot('fp'), tot('fn'), tot('nve_km2'), tot('mod_km2'),
                           cat('d_nm'), cat('d_mn')))
        print()
    if ref:
        print(f'**Start zones** against `{ref}`\n')
        print('| area | reference start cells that are ours | our start cells that are the reference\'s | IoU |'
              '\n|---|---|---|---|')
        for n, (_, p, meta) in res.items():
            print(f"| {n} | {p['covered'] / max(1, p['nve_start']):.2f} | {p['covered'] / max(1, p['ours']):.2f} "
                  f"| {p['iou']:.2f} |")
        return
    print('**Start zones** (rough check: NVE >27° cells touching NVE runout, against our start cells)\n')
    print('| area | NVE start cells covered by ours | our start cells on NVE >27° | our start cells on NVE >30° '
          '| NVE >30° cells that are ours | ms per tile |\n|---|---|---|---|---|---|')
    for n, (_, p, meta) in res.items():
        print(f"| {n} | {p['covered'] / max(1, p['nve_start']):.2f} | {p['ours_on_steep'] / max(1, p['ours']):.2f} "
              f"| {p['ours_on_nve30'] / max(1, p['ours']):.2f} | {p['ours_on_nve30'] / max(1, p['nve30']):.2f} "
              f"| {meta['ms'] / max(1, meta['tiles']):.0f} |")


if __name__ == '__main__':
    main()
