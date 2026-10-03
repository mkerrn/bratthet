# Runout layer: results against NVE

Measured results for the plan in [alpha-runout-plan.md](alpha-runout-plan.md). Every number here comes from `tools/runout-check/`, which runs the app's own `js/runout-core.js` in Node.

## How to reproduce

```sh
cd tools/runout-check
python3 -m venv .venv && .venv/bin/pip install numpy pillow scipy rasterio
.venv/bin/python fetch.py            # Terrarium, GLO-30, tree cover and NVE into cache/ (a few minutes)
node run.js                          # session 1 baseline -> cache/<area>/model-baseline.u8
node run.js --model app --tag app    # what the app draws now (session 2)
.venv/bin/python score.py            # baseline tables; add --tag app for the app's
.venv/bin/python view.py lyngen      # picture: blue both, red model only, orange NVE only, grey NVE >27°
```

`run.js` takes `--model app|baseline|pra`, `--dem terrarium|glo30`, `--forest 0|1`, `--forestmu a,b,c` and `--tag <name>`, plus the model knobs listed at the top of the file. `score.py`/`view.py` take the same `--tag`. `fetch.py` fetches two rings of Terrarium tiles around each area, because each tile's release areas look into its own neighbours. Test areas, and which are for calibration and which are held out, are in `areas.json`.

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

## Session 2: the NVE-style model in the app

What the app draws now, scored with `node run.js --model app` (2026-10-03):

- **Start zones (PRA)**: AutoATES v2.0 as in the plan (Cauchy slope, median wind shelter within 60 m, fuzzy AND, sieve of ≤3 cells), worked on the full-resolution z13 tile with its neighbours (`praTile`). The shelter median is taken on a 10 m lattice (NVE's grid) rounded to our pixels, which gave the same scores at half the cost. Threshold **0.25** (AutoATES default 0.15; 0.10–0.35 all score within 0.01). A block cell is a start zone when any of its 2×2 pixels is (`praBlock`).
- **Routing** (`runoutFlow`): the same energy line as before, capped at 270 m above ground (Flow-Py's `max_z_delta`), but each step is weighted by Flow-Py's `tan(β/2 + 45°)^8` times a persistence term (1 straight on, 0.71 at 45°, 0 at 90°). Each path has a spreading budget that starts at 1 and is multiplied by the step's weight relative to the best step; the path stops below **0.5**. On ground under 3° the direction is carried on unchanged. It all runs as one pass per alpha, not one simulation per start cell.
- **Bands**: one byte per cell, 0–3 (`runoutBands`). Start zones and steep ground are included (see "What the app shows" below).

Full tables:

**Short runout, α 32°**

| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) | edge model→NVE m (median / p90) |
|---|---|---|---|---|---|---|---|---|---|
| lyngen | 32° | 23.88 | 23.76 | 0.87 | 0.87 | 0.87 | 0.77 | 27 / 119 | 42 / 179 |
| narvik | 32° | 12.15 | 16.13 | 0.67 | 0.88 | 0.76 | 0.61 | 28 / 157 | 44 / 214 |
| romsdalen | 32° | 30.57 | 32.06 | 0.85 | 0.89 | 0.87 | 0.78 | 25 / 113 | 50 / 197 |
| hemsedal | 32° | 9.62 | 10.63 | 0.71 | 0.78 | 0.74 | 0.59 | 26 / 132 | 26 / 134 |
| **all calib** | 32° | 76.23 | 82.58 | 0.80 | 0.87 | 0.84 | 0.72 | 27 / 128 | 42 / 186 |
| tamok | 32° | 35.65 | 36.78 | 0.91 | 0.94 | 0.92 | 0.85 | 19 / 86 | 30 / 201 |
| senja | 32° | 23.69 | 23.57 | 0.90 | 0.89 | 0.90 | 0.81 | 13 / 67 | 30 / 153 |
| sunnmore | 32° | 34.41 | 34.97 | 0.84 | 0.85 | 0.85 | 0.73 | 36 / 144 | 56 / 221 |
| jotunheimen | 32° | 28.71 | 27.81 | 0.88 | 0.85 | 0.87 | 0.76 | 18 / 73 | 26 / 138 |
| svalbard | 32° | 5.85 | 6.96 | 0.66 | 0.79 | 0.72 | 0.56 | 8 / 60 | 39 / 583 |
| **all holdout** | 32° | 128.31 | 130.09 | 0.85 | 0.88 | 0.86 | 0.76 | 18 / 82 | 36 / 212 |

**Medium runout, α 27°**

| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) | edge model→NVE m (median / p90) |
|---|---|---|---|---|---|---|---|---|---|
| lyngen | 27° | 36.54 | 36.87 | 0.91 | 0.92 | 0.91 | 0.84 | 30 / 167 | 55 / 253 |
| narvik | 27° | 18.18 | 27.48 | 0.58 | 0.88 | 0.70 | 0.54 | 31 / 197 | 58 / 261 |
| romsdalen | 27° | 38.94 | 43.27 | 0.84 | 0.93 | 0.88 | 0.78 | 35 / 159 | 53 / 201 |
| hemsedal | 27° | 17.99 | 21.31 | 0.67 | 0.80 | 0.73 | 0.57 | 37 / 194 | 37 / 158 |
| **all calib** | 27° | 111.65 | 128.93 | 0.78 | 0.90 | 0.84 | 0.72 | 37 / 183 | 51 / 225 |
| tamok | 27° | 58.28 | 57.65 | 0.95 | 0.94 | 0.94 | 0.89 | 27 / 123 | 30 / 177 |
| senja | 27° | 33.63 | 35.06 | 0.88 | 0.91 | 0.89 | 0.81 | 27 / 115 | 48 / 204 |
| sunnmore | 27° | 47.42 | 51.58 | 0.83 | 0.90 | 0.87 | 0.76 | 40 / 215 | 64 / 248 |
| jotunheimen | 27° | 53.53 | 50.53 | 0.94 | 0.89 | 0.92 | 0.84 | 26 / 93 | 36 / 179 |
| svalbard | 27° | 17.92 | 17.44 | 0.87 | 0.85 | 0.86 | 0.76 | 11 / 77 | 32 / 487 |
| **all holdout** | 27° | 210.77 | 212.26 | 0.90 | 0.90 | 0.90 | 0.82 | 19 / 116 | 39 / 225 |

**Long runout, α 23°**

| area | α | NVE km² | model km² | precision | recall | F1 | IoU | edge NVE→model m (median / p90) | edge model→NVE m (median / p90) |
|---|---|---|---|---|---|---|---|---|---|
| lyngen | 23° | 42.42 | 44.99 | 0.88 | 0.94 | 0.91 | 0.83 | 40 / 207 | 67 / 293 |
| narvik | 23° | 22.28 | 38.77 | 0.50 | 0.88 | 0.64 | 0.47 | 51 / 253 | 80 / 324 |
| romsdalen | 23° | 43.33 | 51.17 | 0.79 | 0.93 | 0.86 | 0.75 | 50 / 225 | 73 / 245 |
| hemsedal | 23° | 26.13 | 33.24 | 0.61 | 0.78 | 0.69 | 0.52 | 56 / 237 | 42 / 208 |
| **all calib** | 23° | 134.17 | 168.17 | 0.72 | 0.90 | 0.80 | 0.67 | 53 / 233 | 67 / 273 |
| tamok | 23° | 71.59 | 72.22 | 0.94 | 0.95 | 0.95 | 0.90 | 38 / 220 | 61 / 245 |
| senja | 23° | 38.45 | 43.37 | 0.81 | 0.92 | 0.86 | 0.76 | 38 / 161 | 72 / 268 |
| sunnmore | 23° | 51.33 | 60.10 | 0.80 | 0.93 | 0.86 | 0.75 | 53 / 267 | 80 / 282 |
| jotunheimen | 23° | 72.76 | 68.59 | 0.96 | 0.90 | 0.93 | 0.87 | 36 / 127 | 41 / 255 |
| svalbard | 23° | 28.05 | 26.78 | 0.91 | 0.87 | 0.89 | 0.80 | 16 / 99 | 63 / 516 |
| **all holdout** | 23° | 262.18 | 271.06 | 0.89 | 0.91 | 0.90 | 0.82 | 30 / 164 | 63 / 297 |

**Start zones** (rough check: NVE >27° cells touching NVE runout, against our PRA cells)

| area | NVE start cells covered by ours | our start cells on NVE >27° | our start cells on NVE >30° | NVE >30° cells that are ours |
|---|---|---|---|---|
| lyngen | 0.67 | 0.89 | 0.68 | 0.91 |
| narvik | 0.75 | 0.85 | 0.56 | 0.89 |
| romsdalen | 0.80 | 0.91 | 0.70 | 0.79 |
| hemsedal | 0.71 | 0.79 | 0.51 | 0.90 |
| tamok | 0.74 | 0.87 | 0.61 | 0.93 |
| senja | 0.80 | 0.90 | 0.62 | 0.82 |
| sunnmore | 0.76 | 0.91 | 0.70 | 0.85 |
| jotunheimen | 0.75 | 0.88 | 0.60 | 0.91 |
| svalbard | 0.70 | 0.89 | 0.46 | 0.87 |

### Against the baseline

| | calib F1 32° / 27° / 23° | holdout F1 32° / 27° / 23° | holdout edge NVE→model p90 (m) | holdout edge model→NVE p90 (m) |
|---|---|---|---|---|
| baseline (slope ≥30°, envelope) | 0.81 / 0.79 / 0.75 | 0.79 / 0.84 / 0.85 | 132 / 176 / 297 | 314 / 351 / 400 |
| **app (PRA, flow)** | **0.84 / 0.84 / 0.80** | **0.86 / 0.90 / 0.90** | **82 / 116 / 164** | **212 / 225 / 297** |

The held-out areas were not used for any choice. Svalbard gains the most (F1 0.52 → 0.72 at 32°): the sieve removes the ArcticDEM spikes that each grew a cone. Tamok, Jotunheimen, Lyngen and Senja are at F1 0.86–0.95 in all three bands.

### What was tried (calibration areas, pooled)

| variant | F1 32° / 27° / 23° | model km² at 23° (NVE 134) | edge NVE→model p90 at 23° |
|---|---|---|---|
| baseline | 0.81 / 0.79 / 0.75 | 176 | 325 |
| PRA 0.15, envelope, start cells left out of the footprint | 0.77 / 0.76 / 0.73 | 169 | 283 |
| PRA 0.15, envelope | 0.83 / 0.82 / 0.78 | 193 | 1127 |
| + energy cap 270 m | 0.84 / 0.83 / 0.80 | 188 | 777 |
| flow, budget 0.3, flat rule, cap 270 (rows below: these settings unless named) | 0.84 / 0.84 / 0.80 | 182 | 361 |
| PRA 0.25 | 0.85 / 0.84 / 0.80 | 178 | 353 |
| **flow, budget 0.5, PRA 0.25 (app)** | **0.84 / 0.84 / 0.80** | **168** | **231** |
| PRA 0.25, budget 0.15 | 0.85 / 0.84 / 0.80 | 182 | 564 |
| PRA 0.25, no persistence | 0.85 / 0.84 / 0.80 | 169 | 320 |
| app settings without the flat rule | 0.84 / 0.84 / 0.80 | 171 | 258 |
| energy cap 120 m | 0.80 / 0.82 / 0.81 | 162 | 288 |
| alphas 34/29/25 instead of 32/27/23 | 0.81 / 0.83 / 0.81 | 160 | 330 |
| alpha distance along the surface, not horizontal | 0.55 / 0.78 / 0.81 | 154 | 294 |

- **Leaving start cells out lost recall.** NVE leaves out ground over 27°, not start zones, and its runout covers 27–30° ground in the tracks. Including start cells in the footprint (and letting the scorer skip NVE's >27° cells) was the biggest single gain.
- **Routing hardly changes F1 but halves the edge error.** The envelope encloses NVE's footprint with a wide margin (NVE→model p90 0.8–1.1 km at 23°). Routing keeps the footprint close to NVE's edges, and the area comes down from 193 to 168 km².
- **F1 has a ceiling around 0.80 at 23° on the calibration set** whatever the routing, cap or angles. Shrinking the footprint costs as much recall as it gains precision, because the remaining error is not in the routing (next section).
- Surface distance and steeper alphas were rejected. They shorten the long band but make the short band too short. The plan's angles stay.

### Why Narvik and Hemsedal score lower: NVE appears to account for forest

Most of the remaining false positives are below the treeline. Share of model runout cells that NVE does not have, by elevation (23° band):

| area | 0–200 m | 200–400 m | 400–600 m | 600–800 m | 800–1000 m | 1000–1200 m |
|---|---|---|---|---|---|---|
| Narvik | 0.79 | 0.68 | 0.29 | 0.08 | 0.08 | 0.08 |
| Romsdalen | 0.33 | 0.43 | 0.28 | 0.04 | 0.04 | 0.06 |
| Hemsedal | – | – | – | 0.53 | 0.65 | 0.20 |
| Lyngen | 0.26 | 0.12 | 0.05 | 0.04 | 0.04 | 0.13 |

That alone could be runout tails on valley floors. NVE's own data settles it: take the <27° cells right below NVE's own >30° ground (2 cells, lower than the steep ground) and count how often NVE draws runout there:

| area | 0–200 m | 200–400 m | 400–600 m | 600–800 m | 800–1000 m | 1000–1200 m | 1200–1400 m |
|---|---|---|---|---|---|---|---|
| Narvik | 0.36 | 0.44 | 0.74 | 0.95 | 0.96 | 0.86 | 0.72 |
| Hemsedal | – | – | – | 0.56 | 0.57 | 0.86 | 0.93 |
| Lyngen | 0.71 | 0.81 | 0.95 | 0.96 | 0.84 | 0.68 | 0.44 |
| Tamok | 0.83 | 0.97 | 0.97 | 0.96 | 0.92 | 0.81 | 0.44 |

Below about 400 m at Narvik and 1000 m at Hemsedal, NVE leaves out the runout under half of its own steep ground. Wind shelter does not depend on elevation, so NVE's start zones seem to be thinned by forest (session 3 tested this with real tree cover data: forest explains only part of it, see the next section) (the drop at the highest band is small summit cliffs). The plan assumed "no forest input". NVE's public description doesn't say either way, and AutoATES v2.0 does take forest density as an input. **Not changed in this session**: adding forest needs a forest data source (for example SR16 in Norway or Copernicus tree cover density), which is a separate decision. Until then, the layer over-warns below the treeline, and the panel note says forest is ignored.

The sea is a smaller part. NVE does draw runout over water (p90 about 300 m from shore), and the model goes further over open fjords (Narvik: 46,000 cells on flat sea against NVE's 8,000 with the first routed version). The cap and the flat-ground rule took some of it off.

### What the app shows

- Bands on all ground the snow reaches, start zones included. Leaving out ground over 27° as NVE does (`--maxslope 27`) dropped calibration F1 to 0.74 / 0.75 / 0.73: our slope from the 7–9 m Terrarium pixels runs steeper than NVE's 10 m classes and cut holes in a fifth of NVE's bands. Leaving out only our start zones did about as badly (0.79 / 0.79 / 0.76).
- **Speed**: Node on an M1 Pro, one process, for the three bands of one tile including its share of release areas: 270 ms at Lyngen (76 ms of it PRA), 110 ms at Hemsedal and on Svalbard, against 50–120 ms for the old single-alpha model. In the browser the work runs in up to four Web Workers (`js/runout-worker.js`, the same `runout-core.js`). A 1200×900 screen at Lyngen (20 tiles, release areas for the ring around them, DEM downloads included) fills in about 8 s in headless Chrome with 4 workers, and 18 s with no worker (the fallback). Expect a phone to take two to four times that.

## Session 3: forest in the start zones

Mads asked for forest if it was feasible. It is, and the app now uses it.

**Data.** The Copernicus High Resolution Layer *Tree Cover Density 2018* (10 m, 0–100 % canopy cover) is on EEA's ArcGIS image server (`image.discomap.eea.europa.eu/.../HRL_TreeCoverDensity_2018/ImageServer`). It covers Europe up to about 72°N (all of mainland Norway and the Alps, not Svalbard). Checked on 2026-10-03:

- It sends CORS headers, so the page can read it directly.
- `exportImage` with `format=bip` returns the raw values: the first 256×256 bytes are the tree cover per pixel, followed by an 8 KB validity mask. No decoder is needed, unlike TIFF or LERC. The PNG output is colour-mapped and can't be read as values.
- One 256 px tile takes 0.2–0.9 s. Values over 100 mean no data.
- NIBIO's SR16 and AR5 WMS also send CORS headers, but they cover Norway only and are rendered maps, so they were not used.

**Model.** AutoATES v2.0's forest membership for percent canopy cover (`pcc`: a 40, b 3.5, c −15, read from `PRA_AutoATES-v2.0.py`) enters the fuzzy AND as its third term. μ is 1 on open ground, 0.5 at 25 % cover and under 0.1 above 40 %. `fetch.py` caches the tree cover per Terrarium tile with the same request the app makes, and `js/runout.js` `loadForest` fetches it per tile next to the DEM. A tile whose tree cover fails is computed without forest. In headless Chrome the browser's bands for two Narvik tiles are identical to the harness's (0 of 16,384 cells differ).

**Scores** (calibration areas, pooled; F1 at 32° / 27° / 23°):

| variant | calib F1 | holdout F1 | holdout edge NVE→model p90 (m) |
|---|---|---|---|
| no forest (session 2) | 0.84 / 0.84 / 0.80 | 0.86 / 0.90 / 0.90 | 82 / 116 / 164 |
| **forest in the start zones, AutoATES pcc (app)** | **0.85 / 0.85 / 0.82** | **0.86 / 0.90 / 0.90** | **87 / 111 / 147** |
| pcc curve with c 0, 15 or 30 (weaker) | 0.84–0.85 / 0.84–0.85 / 0.80–0.82 | | |
| sen2cc curve (a 50, b 1.5, c 0) | 0.84 / 0.84 / 0.80 | | |
| stronger: a 30 or 20, a step at 10 % | 0.84–0.85 / 0.85 / 0.82 | | |
| + forest friction in the runout, +5° at full cover | 0.85 / 0.86 / 0.84 | 0.84 / 0.89 / 0.90 | 94 / 115 / 139 |
| + forest friction, +8° | 0.84 / 0.87 / 0.85 | 0.83 / 0.89 / 0.90 | 106 / 125 / 143 |
| + forest friction, +10° only while the energy line is under 30–120 m (Flow-Py's idea) | 0.84–0.85 / 0.86–0.87 / 0.83–0.84 | | |

- Forest in the start zones helps where there is forest (Narvik 23° F1 0.64 → 0.68, Hemsedal 0.69 → 0.71) and changes nothing above the treeline. The held-out areas are mostly above it.
- **Forest friction in the runout was not adopted.** It trades the short band for the long one, and on the held-out set it lowers the 32° F1. NVE's description mentions only slope, wind shelter, TauDEM and the alpha angle, and a large avalanche breaks trees anyway.
- **Forest explains only part of NVE's gaps below the treeline.** Share of model runout that NVE does not have at 23°, by elevation, before and after forest:

  | area | 0–200 m | 200–400 m | 400–600 m |
  |---|---|---|---|
  | Narvik, no forest → forest | 0.77 → 0.73 | 0.66 → 0.57 | 0.27 → 0.21 |
  | Romsdalen | 0.31 → 0.28 | 0.41 → 0.35 | 0.26 → 0.21 |

  | area | 600–800 m | 800–1000 m |
  |---|---|---|
  | Hemsedal, no forest → forest | 0.51 → 0.44 | 0.64 → 0.59 |

  Per connected patch of NVE ground over 27° (below 400 m, or 1000 m at Hemsedal), the patches with no NVE runout have 10–20 points more tree cover than those with runout (Narvik 63 against 53 % for patches of 1–10 cells). Patch size matters more, though: at Narvik 37 % of the 1–10-cell patches have runout, against 82 % of the 50–200-cell ones. NVE's start zones may come from a different forest input (for example SR16 stem density) or from a bigger minimum release area. With the data we have, we can't tell which.
- Our start zones lose more of NVE's steep ground at low elevation than before (NVE >30° cells that are ours: Narvik 0.89 → 0.47), but the runout footprints match better. So TCD 2018 thins in the right places and also in some wrong ones.

Full tables for the app as it is now: `node run.js --model app --tag app && .venv/bin/python score.py --tag app`. Calibration pooled: precision 0.84 / 0.82 / 0.76, recall 0.85 / 0.88 / 0.89. Held out: precision 0.85 / 0.91 / 0.90, recall 0.86 / 0.89 / 0.90.

Tree cover attribution: Copernicus Land Monitoring Service, High Resolution Layer Tree Cover Density 2018, © European Union.

## Notes for session 3 (GLO-30)

- GLO-30 crops are already cached for all 16 areas (`cache/glo30/13/`), resampled bilinearly to the z13 pixel grid.
- Against Terrarium, the median absolute height difference on land is 1.5–4 m in Norway and Arlberg, but 7–10 m at Davos and Chamonix (EU-DEM in Terrarium).
- **Check the registration first.** In Norway, GLO-30 matches Terrarium best when moved 1 Terrarium pixel east (7–9 m, about half a GLO-30 cell, in x only). At Arlberg it needs no shift, and on Svalbard under 1 pixel. Find out whether this is the PixelIsPoint convention or a property of Terrarium before calling any difference a "30 m penalty". An offset of 7–9 m alone moves edges by about half a block cell.

GLO-30 attribution: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA. NVE data: "Bratthet med utløp" © NVE.
