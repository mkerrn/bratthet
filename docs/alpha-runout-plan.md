# Plan: NVE-style runout layer (median / 75th / 95th percentile alpha)

Goal: replace the current single-alpha runout layer (`js/runout.js`) with one built on the same principles NVE uses for the runout on Varsom's "Bratthet med utløp" map, check how closely it matches NVE in Norway, then extend it to the rest of Europe and find out how much accuracy drops there.

Every session working on this starts by reading this file and ends by updating **Status** at the bottom.

---

## 1. What NVE does (and what we can copy)

From NVE's description and the AutoATES papers (Larsen et al. 2020, AutoATES v1.0; Toft et al. 2024, AutoATES v2.0, `nhess-24-1779-2024.pdf` in the repo root):

1. **Terrain model.** Norway: national DTM, 10 m in most mountain areas (being replaced by 1 m lidar). Svalbard: 20 m.
2. **Potential release areas (PRA)** from slope angle and a wind-shelter index, combined with fuzzy logic. There is no forest input, because the Varsom layer ignores forest.
3. **Runout** from each PRA cell, routed downhill and stopped by an alpha angle (an energy line). NVE's text says TauDEM (D-infinity, AutoATES v1.0). The 2024 paper uses Flow-Py instead. Both stop at the same alpha criterion and differ in how the flow spreads sideways.
4. **Three alpha thresholds** from Lied & Bakkehøi (1980). NVE's own data (about 18,000 avalanches in Troms and about 19,000 in the Alps) gives nearly the same values:
   - **32°**: median avalanche → "short runout"
   - **27°**: 75th percentile → "medium runout"
   - **23°**: 95th percentile → "long runout"

Note: NVE's text points to "section 2.4.1 and 2.4.2" of the paper, but those sections don't exist. The relevant ones are **2.3.1 (PRA)** and **2.3.2 (avalanche simulation)**.

### Exact PRA parameters (from `github.com/AutoATES/AutoATES-v2.0`, `PRA/PRA_AutoATES-v2.0.py`)

The paper only shows these in a figure, so they were read from the code:

- Cauchy membership: `μ(x) = 1 / (1 + ((x − c)/a)^(2b))`
- **Slope**: a=11, b=4, c=43 (degrees). μ is 0.5 at 32° and 54°, about 1 between 34° and 52°, 0.21 at 30° and 0.08 at 28°. Cliffs above about 60° drop out.
- **Wind shelter**: for each cell, take every cell within the radius (60 m recommended, so 6 cells at 10 m), compute `atan((z_neighbour − z_centre)/distance)` and take the **median** (`prob=0.5`). All directions are used (`winddir=0, windtol=180`). The angle is in **radians**, but the Cauchy parameters are a=3, b=10, c=3. In practice that makes μ a smooth step around 0: hollows and lee pockets score about 1 and ridges about 0 (μ is 0.5 at 0 rad, 0.8 at +0.2 and 0.04 at −0.5). Copy the quirk as it is so the result matches.
- **Forest**: μ=1 when there is no forest data.
- **Fuzzy AND**: `m = min(μs, μw, μf)`, `PRA = (1 − m)·m + m·(μs + μw + μf)/3`
- **Binary PRA**: `PRA > 0.15` (v2.0 default). NVE's own threshold is not published; calibrate it (section 3).
- **Sieve**: drop PRA clusters of 3 cells or fewer (8-connected).

With no forest, a sheltered slope becomes PRA at about 28.5°. A slope on a convex ridge needs to be much steeper.

### Flow-Py stopping rule (from `FlowPy_detrainment/flow_class.py`)

`z_delta_next = z_delta + z_gamma − ds·cell·tan(α)`, clamped to `[0, max_z_delta]`. Flow stops where it reaches 0. This is the same energy-line cone `runout.js` already computes (`P − el` is `z_delta`). The differences are in routing:
- Flow-Py splits flux to neighbours weighted by `tan(β/2)^exp` (exp = 8, so strongly towards the steepest descent) plus a persistence term, and drops branches whose flux falls below a threshold. This limits sideways spreading.
- `runout.js` takes the **envelope of all paths** (Dijkstra, highest energy line wins, any direction). Expect it to be **wider** than NVE on fans and flat valley floors, and about right in length.
- Flow-Py runs a separate simulation for each start cell (Norway took 30 days on a 64-core machine). That is impossible in a browser, so we keep one combined propagation per alpha and add a cheap rule that limits spreading (section 4, step 2.3).

---

## 2. The reference data: NVE runout rasters, per class

Checked during planning:

- Service: `https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer` (Web Mercator, `supportsDynamicLayers: true`)
- Sublayers: `1` slope classes (>27°), `2` runout **short**, `3` **medium**, `4` **long** (Norway); `6–9` are the same for Svalbard.
- Any area can be exported pixel-exact as PNG per sublayer:
  `.../export?bbox=xmin,ymin,xmax,ymax&bboxSR=3857&imageSR=3857&size=1000,1000&format=png32&transparent=true&layers=show:3&f=image`
- **Encoding (verified over Lyngen):** the three runout layers are **exclusive bands**. They don't overlap each other or the >27° slope layer:
  - NVE runout(32°) = short
  - NVE runout(27°) = short ∪ medium
  - NVE runout(23°) = short ∪ medium ∪ long
  - all three exclude cells that are >27° themselves
- Colours: short `#004DA8`, medium `#4C9BFF`, long `#9AB1E6`. The legend lists values "1" and "2" per runout layer, but only one colour appears in practice. Check what value 2 means (an `identify` call) in session 1.
- Still unknown: whether NVE ran the runout on DTM10 or on 1 m data. Session 1 measures the step size along its edges in a high-resolution export.

### Our DEM, per region (checked from the `x-amz-meta-x-imagery-sources` header of Terrarium z13 tiles)

| Area | Terrarium source at z10–15 | Native resolution |
|---|---|---|
| Norway (Lyngen, Romsdalen, Hemsedal) | **Kartverket DTM10** | 10 m (the same family of data as NVE's) |
| Abisko, Sweden | Kartverket tile (check the coverage across the border) | 10 m? |
| Austria (Arlberg) | data.gv.at | 10 m |
| Chamonix, Davos, Dolomites, Pyrenees, Tatra, Scotland, Sierra Nevada | **EU-DEM** | about 25–30 m, SRTM/ASTER hybrid, smooths ridges and gullies |
| Iceland | ArcticDEM 5 m + EU-DEM | mixed |

At z13 a Terrarium pixel is about 9.6 m at 60°N and 13.5 m at 45°N. `demBlock` halves that, giving 18–27 m cells. **In Norway our input is essentially NVE's own 10 m DTM**, which is why Norway is the right place to calibrate. In most of the Alps the input is about 2.5 times coarser and smoothed.

---

## 3. How to check "how well does it match Varsom"

A command-line harness. It needs no browser, and it must not drift from the app's code:

- Move the pure maths out of `js/runout.js` into **`js/runout-core.js`**: PRA, wind shelter and the per-alpha propagation, with no DOM or Leaflet. It stays a classic script that only defines globals, so it loads in `index.html` as before. Node (v25, installed) can run it with `vm.runInThisContext` for the harness, so **the harness runs the exact code the app runs**.
- **`tools/runout-check/`**
  - `fetch.py` (Python venv with numpy, pillow, scipy in `tools/runout-check/.venv`, which is gitignored). For each test area it saves Terrarium z13 tiles, decoded to Float32 elevation on the app's 3×3-block grid, and NVE exports of sublayers 1–4 on the **same Web Mercator grid**. Cache everything under `tools/runout-check/cache/` (also gitignored).
  - `run.js` (Node) loads `util.js` and `runout-core.js` and writes model masks for α 32/27/23.
  - `score.py` compares the model with NVE for each class and writes a markdown table.
- **Metrics**, for each alpha class and area, only on cells NVE does not mark as >27°:
  - precision, recall, F1/IoU on the cumulative footprints
  - **edge distance in metres**: for each NVE runout edge pixel, how far away the model's edge is (via a distance transform), reported as the median and 90th percentile. This is the number friends will understand ("our long runout ends within ~40 m of NVE's").
  - separately, PRA agreement: our PRA versus "start cells" implied by NVE (slope >27° cells that have runout below them). This is a rough check only.
- **Test areas** (about 10 × 10 km each, varied terrain and climate): Lyngen, Tamok/Lyngsdalen inland, Senja (coastal), Narvik, Romsdalen, Sunnmøre (Hjørundfjord), Hemsedal (rounder terrain, forest), Jotunheimen, and Svalbard (Longyearbyen, which uses the separate NVE sublayers 6–9). Check what DEM Terrarium serves on Svalbard.
- **Calibrate** on half the areas and report on the other half, so the numbers aren't tuned to the test.

---

## 4. Work breakdown

### Session 1: harness and baseline (no UI change)
1. Create `js/runout-core.js` holding the existing propagation, unchanged. `runout.js` calls it. Run the smoke test and commit.
2. Build `tools/runout-check/` (fetch, run, score). Add a `.gitignore` for the venv and cache.
3. Settle the open questions about NVE's data: what legend value 2 means, the resolution of their runout, and Svalbard.
4. **Baseline**: the current model (release = slope ≥30°, envelope routing) at α 32/27/23 against NVE in all areas. Save the results to `docs/alpha-runout-results.md`.
5. Update Status here. Commit and push.

### Session 2: NVE-style model in the app, calibrated in Norway
1. **PRA** in `runout-core.js`: Cauchy slope + wind shelter (median elevation angle within 60 m) + fuzzy AND + 0.15 threshold + sieve. Compute it on the full-resolution z13 tile (about 10 m in Norway, the same as AutoATES), with a margin from the neighbour tiles, then reduce it to the block grid. Time it on a phone-sized budget. If it is too slow, use 16 sampled directions instead of the full disc, or a radius-3 window on the half-resolution block.
2. **Three alphas in one go**: run 23° first, then 27° and 32°, either restricted to the cells reached at 23° or as three plain passes on 147k cells. Cache one mask per tile with values 0–3 (none/short/medium/long) instead of three masks.
3. **Routing variants**, picked using the harness:
   a. current envelope (baseline)
   b. envelope + "no step to a neighbour more than X° flatter than the steepest descent unless the energy line is high", a cheap stand-in for Flow-Py's exp-8 weighting
   c. a crude flux version: each cell passes on a share weighted by `tan(β/2)^8`, and branches below a flux threshold die out
   Choose by F1 and edge distance on the calibration areas, and accept extra cost only if it clearly helps. Also tune the PRA threshold (0.10–0.30) and `c` for slope, which the paper says are the most effective knobs.
4. **Layer and UI** (`index.html` runout section, `js/runout.js`, `js/controls.js`). **The NVE-style bands replace the current layer entirely.** There is no custom-alpha mode.
   - **Remove**: the `runAlpha`, `runRelease` and `runColor` inputs in `index.html`, their handlers in `js/controls.js` (lines 31–33 today), and the `runAlpha`/`runRelease` globals in `runout.js`. Release comes from the PRA now, and the angles are fixed at 32/27/23.
   - **Keep**: `runOn`, `runOpacity`, the `runout` entry in `LAYER_GROUPS`/`LAYER_TOGGLES`/`layerOrder` (`js/map.js`) and the `runoutPane`. Rename the layer to something like "Avalanche runout (alpha)" in both `map.js` and the `<h2>`.
   - **Colours: the same as NVE's layer**, fixed (no colour picker): short `#004DA8`, medium `#4C9BFF`, long `#9AB1E6`. Draw the bands nested, with the longest underneath, so each cell shows the shortest class that reaches it, as NVE does. Start the opacity slider at 55 to match the NVE layer's 0.55. The panel gets a small legend: three swatches, each with a checkbox (short/medium/long, 32°/27°/23°) so one band can be hidden.
   - Because the colours are the same, our layer and NVE's look alike when both are on in Norway. The note should say to switch one off to compare.
   - **Off by default everywhere.** That is already the case: `runOn` starts unchecked and layer state is not saved between visits. Don't tie it to `REGIONS`/auto mode and don't switch it on anywhere.
   - Rewrite the note in the existing voice: what the percentiles mean (a median avalanche from a path reaches 32°, one in four reaches 27°, one in twenty reaches 23°); that the data comes from avalanche paths and is dominated by large natural avalanches; that forest is ignored; and that it is an indication, not a hazard map. Drop the old "18° field rule" sentence along with the control. Keep the safety wording.
   - If it is still slow on phones after step 1, consider a Web Worker that loads `util.js` and `runout-core.js` with `importScripts` (still no modules or bundler).
5. Run the final harness numbers on the **held-out** areas and write them to the results file. Smoke test, commit, push.

### Session 3: the rest of Europe, and how accurate it is there
Same algorithm, no code changes needed to "extend" it, since Terrarium covers Europe. The work is finding out how far to trust it:
1. **The cost of a coarser DEM, measured in Norway** (the most valuable test, because NVE is the reference there). Run the model on **EU-DEM over the Norwegian test areas**, i.e. the exact terrain data the app gets in the Alps, and score it against NVE. The drop in F1 and edge distance relative to the Terrarium 10 m run is the **"Europe penalty"** that comes from the DEM alone. Before scoring, resample the EU-DEM onto the same Web Mercator z13 grid with bilinear interpolation, the way Terrarium does, then send it through `demBlock`'s halving, so the test sees what the app would see.
2. **Alpine check with a good reference DEM.** In the Alps the app already gets EU-DEM from Terrarium, so what is missing there is a *better* DEM to compare against:
   - Austria (Terrarium is 10 m there): Arlberg, Ötztal and Hohe Tauern, model on Terrarium 10 m versus on the downloaded EU-DEM.
   - Switzerland: swissALTI3D (free, no login; 2 m tiles of 1 km² from the swisstopo STAC API, a few MB each, so about 100 tiles per 10 × 10 km area) resampled to 10 m as the reference run, compared with the Terrarium (EU-DEM) run. Davos and the Valais.
   - Slope check: our slope >30° from Terrarium versus `ch.swisstopo.hangneigung-ueber_30` and IGN's carte des pentes (Chamonix/Écrins; both already in the app). This shows directly how many release cells EU-DEM misses in steep, narrow terrain.
   - Qualitative cross-check against `ch.bafu.silvaprotect-lawinen` (SilvaProtect-CH, a modelled avalanche process layer with different assumptions, so it serves as a sanity check rather than ground truth).

   **Getting the EU-DEM data (decided: download it rather than use GLO-30).** EU-DEM v1.1 comes in 1000 × 1000 km tiles in EPSG:3035, named after their south-west corner. Every test area falls in just **three tiles** (checked with pyproj):

   | Tile | Covers | Test areas |
   |---|---|---|
   | **E40N20** | the whole Alps, from the Maritime Alps (44°N) to the Julian Alps | Chamonix, Écrins, Davos, Arlberg, Ötztal, Dolomites, Hohe Tauern |
   | **E40N40** | southern Norway | Romsdalen, Sunnmøre, Jotunheimen, Hemsedal |
   | **E40N50** | northern Norway | Lyngen, Tamok, Senja, Narvik |
   | *E30N20* (optional) | Western Alps edge (Vercors, Chartreuse), Pyrenees | only if the Pyrenees are tested |

   About 350–400 MB each, so roughly 1.2 GB for the three (1.6 GB with the optional one). That is easily feasible, and the six to eight tiles once considered aren't needed.
   - Mads downloads the tiles from the Copernicus Land Monitoring Service (free login) and puts the zips in `tools/runout-check/dem/` (gitignored). Check first that EU-DEM v1.1 is still offered there, because it has been marked as superseded by the Copernicus DEM. If it is gone, GLO-30 (open on AWS, `s3://copernicus-dem-30m`, no login) is the fallback.
   - `fetch.py` reads only a window of each test area out of the GeoTIFF (with rasterio windowed reads, without loading the whole tile), reprojects it to Web Mercator, and saves a small crop (a few MB) to the cache. After that the full tiles can be deleted.
   - Do this download while session 2 is running, so it is ready when session 3 starts.
3. **Things a DEM can't fix**, from the literature and written up briefly:
   - Alpha statistics in the Alps (NVE's 19k-avalanche check, plus published alpha–beta fits for Austria and Switzerland)
   - Forest: the treeline is at about 2000 m in the Alps versus 600–1000 m in Norway, so far more steep forest will be marked as release area (the same simplification Varsom makes, but it matters more there)
   - Glaciers and seasonal DEM change
   - Snow climate and its effect on wind shelter
4. **Show the uncertainty in the app**: a short regional note under the runout layer (in the same way `steepNotes` works), e.g. Norway and Austria "10 m terrain, close to NVE's", rest of Europe "30 m terrain: misses narrow gullies, expect shorter and fewer runout zones from small start zones", with the measured numbers where we have them.
5. Write the Europe results into `docs/alpha-runout-results.md`. Commit and push.

---

## 5. Expected accuracy (hypotheses for the sessions to confirm or reject)

- **Norway**: the DEM is effectively the same, so the remaining differences come from the PRA threshold, routing (envelope versus D-inf/Flow-Py) and our half-resolution grid. After calibration, expect a good match in runout **length** (edge distance a few cells) and a somewhat **wider** footprint on fans and valley floors.
- **Austria**: about as good as Norway, apart from forest.
- **Rest of the Alps, Pyrenees, Tatra, Scotland (EU-DEM)**: slopes are underestimated in steep, narrow terrain, so small couloir and gully release areas are missed. Their runouts disappear or come out short. Big open faces should still look reasonable. Below the treeline the layer over-warns because it has no forest data. The size of this penalty is what session 3 measures. It is likely to be large enough that the region note should say so plainly.
- Everywhere: alpha statistics describe what avalanches in known paths did, mostly large natural ones. They say nothing about whether a slope will release today.

---

## 6. One session or several?

**Recommendation: three sessions, run one after another**, as in section 4.

- Each has a clear, testable result and a commit (harness + baseline → calibrated app layer → Europe study), and this file passes the state between them.
- Session 2 is an iterative calibration loop and session 3 is mostly data-heavy research (downloads, resampling, literature). Running them in one session would mean carrying large, unrelated context and risks the Europe work being rushed.
- Session 1 is a hard prerequisite for both: without the harness there is no way to say what "matches Varsom" means.
- Some parallelism is possible: the data work in session 3 (the EU-DEM download, swissALTI3D for the test areas, the slope comparison against swisstopo/IGN) only needs the session 1 harness and could run alongside session 2. Its final numbers must still be produced with session 2's calibrated model.

---

## 7. Decisions (Mads, 2026-10-03)

1. **The NVE-style bands replace the custom single-alpha layer.** There is no custom alpha or release input, and no colour picker.
2. **The new layer is off by default everywhere**, Norway included. It is never switched on automatically.
3. **EU-DEM will be downloaded** (three tiles, about 1.2 GB; see session 3) instead of using GLO-30 as a stand-in.
4. **Colours match NVE's layer**: `#004DA8` / `#4C9BFF` / `#9AB1E6` for short / medium / long.

## Status

- 2026-10-03: decisions added (section 7): replace the custom mode, off by default, NVE colours, EU-DEM tiles E40N20/E40N40/E40N50. Still no code changed.
- 2026-10-01: plan written. Checked during planning: the NVE per-class export and its band encoding, the Terrarium source per region, and the PRA and Flow-Py parameters from the AutoATES v2.0 code. No code changed yet.
