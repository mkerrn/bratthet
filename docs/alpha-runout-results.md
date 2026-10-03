# Runout layer: results against NVE

Measured results for the plan in [alpha-runout-plan.md](alpha-runout-plan.md). Every number here comes from `tools/runout-check/`, which runs the app's own `js/runout-core.js` in Node.

## How to reproduce

```sh
cd tools/runout-check
python3 -m venv .venv && .venv/bin/pip install numpy pillow scipy rasterio
.venv/bin/python fetch.py            # Terrarium, GLO-30 and NVE into cache/ (about 1 minute)
node run.js                          # the model over the Norwegian areas -> cache/<area>/model-baseline.u8
.venv/bin/python score.py            # the tables below
.venv/bin/python view.py lyngen      # picture: blue both, red model only, orange NVE only, grey NVE >27°
```

`run.js` takes `--dem terrarium|glo30`, `--release <deg>` and `--tag <name>`, and `score.py`/`view.py` take the same `--tag`. Test areas, and which are for calibration and which are held out, are in `areas.json`.

**Scoring grid.** Everything is compared on the app's block grid: one cell per 2×2 Terrarium z13 pixels, sampled at the top-left pixel as `demBlock` does (13 m cells at Lyngen, 19 m at Hemsedal, 8 m on Svalbard). NVE is exported at 256 px per tile on the same Web Mercator grid, so NVE pixel (2i, 2j) is the same spot. Shifting the model by one cell in any direction lowers F1 and start-zone agreement, so the grids line up.

**Metrics.** Cells that NVE marks as >27° are left out: NVE never draws runout there. Footprints are cumulative (27° = short + medium, 23° = all three bands). Edge distance looks only at the downhill and side edges of a footprint (footprint cells next to a cell that is neither footprint nor >27°). "NVE→model" is how far our edge is from each NVE edge cell, and "model→NVE" is the other way round.

## What NVE's data is (session 1)

- **Legend values "1" and "2".** These are raw pixel values, checked with `identify` at Lyngen. In each runout sublayer, 1 means "not in this band" and is drawn transparent, and 2 is the band. In the steepness sublayer, 1 is <27° (transparent) and 2–6 are the five steepness classes.
- **Bands are exclusive, almost.** The three runout bands overlap in small patches, mostly on valley floors and lakes (Lyngen: 2–4 % of the short band after eroding the edges). That looks like seams in their processing, not a different encoding. Cumulative footprints are unions, so this does not affect the scores. Runout on >27° cells only happens at resampled edges (a few thousand pixels per area).
- **Resolution: 10 m**, the same as the steepness classes. In a 0.5 m/pixel export the runs along rows come in multiples of 10 m (10, 20, 30, 40) on a grid tilted a few degrees against Web Mercator (UTM 33). So NVE ran on DTM10, not 1 m lidar. The export is resampled smoothly, so corners look rounded at high zoom.
- **Svalbard (sublayers 6–9)** also steps in 10 m units, not the 20 m their text gives. Terrarium serves **ArcticDEM 5 m** there (`pgdc_5m`, ellipsoidal heights, about 31 m above GLO-30's geoid heights, which doesn't matter for slopes). Abisko gets a Kartverket 10 m tile.
- **NVE draws runout on the sea too** (about 16,600 shared cells at ≤0 m in Lyngen), so the sea is not masked out when scoring.

## Baseline: the current model at α 32/27/23

The app's model as it is today, with only the angle changed: release where slope ≥30°, and an envelope over all paths (Dijkstra on the alpha cone). Terrarium DEM. Scored 2026-10-03.

**Short runout, α 32°**

| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) | edge model→NVE m (median / p90) |
|---|---|---|---|---|---|---|---|---|---|
| lyngen | 32° | 23.88 | 23.03 | 0.86 | 0.83 | 0.85 | 0.74 | 30 / 161 | 48 / 204 |
| narvik | 32° | 12.15 | 14.66 | 0.66 | 0.80 | 0.73 | 0.57 | 40 / 233 | 51 / 214 |
| romsdalen | 32° | 30.57 | 35.99 | 0.76 | 0.89 | 0.82 | 0.70 | 71 / 374 | 56 / 245 |
| hemsedal | 32° | 9.62 | 8.05 | 0.81 | 0.68 | 0.74 | 0.59 | 37 / 267 | 19 / 112 |
| **all calib** | 32° | 76.23 | 81.73 | 0.78 | 0.83 | 0.81 | 0.68 | 40 / 255 | 42 / 206 |
| tamok | 32° | 35.65 | 33.39 | 0.91 | 0.85 | 0.88 | 0.79 | 27 / 134 | 49 / 249 |
| senja | 32° | 23.69 | 26.22 | 0.84 | 0.92 | 0.88 | 0.78 | 27 / 115 | 38 / 179 |
| sunnmore | 32° | 34.41 | 40.82 | 0.76 | 0.90 | 0.82 | 0.70 | 50 / 209 | 64 / 232 |
| jotunheimen | 32° | 28.71 | 27.03 | 0.88 | 0.83 | 0.85 | 0.74 | 26 / 111 | 26 / 164 |
| svalbard | 32° | 5.85 | 12.15 | 0.38 | 0.79 | 0.52 | 0.35 | 11 / 97 | 47 / 1205 |
| **all holdout** | 32° | 128.31 | 139.60 | 0.72 | 0.86 | 0.79 | 0.65 | 19 / 132 | 41 / 314 |

**Medium runout, α 27°**

| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) | edge model→NVE m (median / p90) |
|---|---|---|---|---|---|---|---|---|---|
| lyngen | 27° | 36.54 | 36.38 | 0.89 | 0.88 | 0.89 | 0.80 | 40 / 227 | 78 / 288 |
| narvik | 27° | 18.18 | 28.71 | 0.52 | 0.83 | 0.64 | 0.47 | 42 / 208 | 63 / 265 |
| romsdalen | 27° | 38.94 | 46.80 | 0.75 | 0.90 | 0.82 | 0.70 | 90 / 424 | 79 / 295 |
| hemsedal | 27° | 17.99 | 19.28 | 0.68 | 0.73 | 0.71 | 0.54 | 42 / 218 | 26 / 158 |
| **all calib** | 27° | 111.65 | 131.17 | 0.74 | 0.86 | 0.79 | 0.66 | 48 / 280 | 59 / 258 |
| tamok | 27° | 58.28 | 56.76 | 0.92 | 0.90 | 0.91 | 0.83 | 38 / 189 | 68 / 293 |
| senja | 27° | 33.63 | 38.83 | 0.81 | 0.94 | 0.87 | 0.77 | 42 / 166 | 67 / 241 |
| sunnmore | 27° | 47.42 | 61.98 | 0.70 | 0.92 | 0.80 | 0.66 | 89 / 394 | 96 / 305 |
| jotunheimen | 27° | 53.53 | 51.73 | 0.92 | 0.89 | 0.90 | 0.82 | 36 / 131 | 36 / 221 |
| svalbard | 27° | 17.92 | 24.97 | 0.64 | 0.89 | 0.74 | 0.59 | 11 / 103 | 50 / 909 |
| **all holdout** | 27° | 210.77 | 234.27 | 0.78 | 0.90 | 0.84 | 0.72 | 30 / 176 | 57 / 351 |

**Long runout, α 23°**

| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) | edge model→NVE m (median / p90) |
|---|---|---|---|---|---|---|---|---|---|
| lyngen | 23° | 42.42 | 45.01 | 0.85 | 0.90 | 0.87 | 0.78 | 55 / 294 | 94 / 330 |
| narvik | 23° | 22.28 | 43.19 | 0.44 | 0.85 | 0.58 | 0.40 | 51 / 253 | 72 / 309 |
| romsdalen | 23° | 43.33 | 55.59 | 0.71 | 0.91 | 0.80 | 0.67 | 134 / 458 | 95 / 309 |
| hemsedal | 23° | 26.13 | 32.69 | 0.59 | 0.74 | 0.66 | 0.49 | 59 / 244 | 42 / 200 |
| **all calib** | 23° | 134.17 | 176.47 | 0.66 | 0.87 | 0.75 | 0.60 | 67 / 325 | 75 / 291 |
| tamok | 23° | 71.59 | 72.59 | 0.90 | 0.92 | 0.91 | 0.84 | 73 / 385 | 103 / 326 |
| senja | 23° | 38.45 | 49.55 | 0.73 | 0.94 | 0.82 | 0.70 | 72 / 284 | 98 / 322 |
| sunnmore | 23° | 51.33 | 70.85 | 0.67 | 0.93 | 0.78 | 0.64 | 120 / 564 | 108 / 375 |
| jotunheimen | 23° | 72.76 | 71.94 | 0.93 | 0.92 | 0.92 | 0.86 | 51 / 190 | 55 / 258 |
| svalbard | 23° | 28.05 | 36.46 | 0.71 | 0.92 | 0.80 | 0.67 | 17 / 141 | 70 / 913 |
| **all holdout** | 23° | 262.18 | 301.39 | 0.78 | 0.92 | 0.85 | 0.73 | 51 / 297 | 84 / 400 |

**Start zones** (rough check: NVE >27° cells touching NVE runout, against our slope ≥ release cells)

| area | NVE start cells covered by ours | our start cells on NVE >27° | our start cells on NVE >30° | NVE >30° cells that are ours | ms per tile |
|---|---|---|---|---|---|
| lyngen | 0.60 | 0.92 | 0.73 | 0.94 | 111 |
| narvik | 0.67 | 0.90 | 0.63 | 0.95 | 56 |
| romsdalen | 0.74 | 0.94 | 0.78 | 0.97 | 141 |
| hemsedal | 0.64 | 0.87 | 0.59 | 0.92 | 42 |
| tamok | 0.66 | 0.90 | 0.65 | 0.96 | 118 |
| senja | 0.72 | 0.95 | 0.70 | 0.97 | 98 |
| sunnmore | 0.68 | 0.94 | 0.76 | 0.97 | 143 |
| jotunheimen | 0.67 | 0.92 | 0.66 | 0.95 | 90 |
| svalbard | 0.58 | 0.90 | 0.48 | 0.89 | 53 |

Timing is Node on an Apple M1 Pro, for all three alphas on one tile's 3×3 block (147k cells). A phone is likely 3–5 times slower.

### Reading the baseline

- **It is already close in length.** The median edge distance is 20–70 m (2–5 cells) in most areas, F1 is 0.8–0.9 in the big alpine areas (Lyngen, Tamok, Jotunheimen, Senja), and recall is high everywhere (0.83–0.92 on the combined sets).
- **The error is mostly over-warning, and it grows as alpha falls.** Precision drops from 0.78 (32°) to 0.66 (23°) on the calibration set. The worst cases are Narvik (0.44 at 23°) and Hemsedal (0.59). In the pictures it is a red belt on gentle valley floors, plateaus and over fjords, with octagonal cones where the envelope spreads freely on flat ground. This is the sideways spreading that Flow-Py's exp-8 weighting limits (plan, step 2.3).
- **Hemsedal has the lowest recall at 32° (0.68).** That fits its rounder terrain: NVE's PRA starts at about 28.5° on sheltered slopes, while the baseline needs 30°.
- **Start zones.** Of our ≥30° cells, 87–95 % are >27° at NVE, and we cover 89–97 % of NVE's >30° cells, so the slopes agree well on the same 10 m data. Only 58–74 % of NVE's "start cells" (>27° cells touching runout) are ours, because 27–30° cells can be PRA for NVE.
- **Svalbard is dominated by DEM artefacts.** ArcticDEM has noise and a stepped data edge over Isfjorden/Adventfjorden, and isolated height spikes each become a ≥30° "start zone" with a large octagonal cone around it. That gives precision 0.38 at 32° and a model→NVE p90 of 1.2 km. The PRA sieve (dropping clusters of ≤3 cells) should remove the spikes. Consider masking ArcticDEM water as well.

## Notes for session 3 (GLO-30)

- GLO-30 crops are already cached for all 16 areas (`cache/glo30/13/`), resampled bilinearly to the z13 pixel grid.
- Against Terrarium, the median absolute height difference on land is 1.5–4 m in Norway and Arlberg, but 7–10 m at Davos and Chamonix (EU-DEM in Terrarium).
- **Check the registration first.** In Norway, GLO-30 matches Terrarium best when moved 1 Terrarium pixel east (7–9 m, about half a GLO-30 cell, in x only). At Arlberg it needs no shift, and on Svalbard under 1 pixel. Find out whether this is the PixelIsPoint convention or a property of Terrarium before calling any difference a "30 m penalty". An offset of 7–9 m alone moves edges by about half a block cell.

GLO-30 attribution: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA. NVE data: "Bratthet med utløp" © NVE.
