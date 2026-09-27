# CLAUDE.md

Bratthet is a static GitHub Pages site (a Leaflet map for planning ski tours). It has no build step, no package.json and no framework. Friends use it on their laptops and phones, so mobile layout and touch input matter.

## Working efficiently here

- **Don't read the whole repo.** Use the file map below to find the one or two files a task touches, then `grep -rn` for the function or element id you need.
- `index.html` holds only the markup: the panel sections, map buttons and cards. Element ids in the JS match ids there, so `grep -n 'id="snowDate"' index.html` finds the markup.
- **Verify with `tools/smoke-test.sh`.** It takes about 10 seconds, loads the page in headless Chrome and prints any JS error with its file:line. Run it after every JS change. It only catches errors that happen while the page loads, so check click handlers by reading the code.
- Commit messages are short and in the imperative ("Add X", "Fix Y"). Pushing to `main` deploys the site.
- Commit and push code after finishing a task.

## How the scripts fit together (important)

- All JS files are **classic `<script>` tags, not ES modules**, listed at the bottom of `index.html`. They share one global scope: a top-level `const`/`let`/`function` in one file is visible in all the others.
- **Load order matters.** Top-level code that runs while a file loads (e.g. `renderBands()`, `debounce(...)`, `map.on(...)`) can only use names from files loaded *earlier*. Code inside functions and event handlers can use anything. If you add a new file, put its `<script>` tag in the right spot. Shared helpers go in `js/util.js`, which loads early.
- Don't turn the files into modules and don't add a bundler or npm unless the user asks.
- Never declare the same top-level name in two files (that throws a SyntaxError and that whole file stops running).
- GitHub Pages serves the files as they are. External libraries come from cdnjs (Leaflet 1.9.4 only).

## File map

| File | What's in it |
|---|---|
| `index.html` | Markup: bottom-left cards (scale, measure, readout), profile box, map buttons, the layers panel with one `<section>` per layer, and the script list |
| `css/base.css` | `:root` colour variables, page shell, panel frame, the "explanations" toggle rules, light dial |
| `css/panel.css` | Slope class rows, direction compass dial, inputs/buttons, layer-order list |
| `css/map-ui.css` | Bottom-left cards, measuring tape, elevation profile, measure/locate buttons |
| `css/controls.css` | Selects, date input, status lines, danger legend, **phone `@media` rules** |
| `js/config.js` | `HEATMAP_URL` (empty string hides the heatmap entirely) |
| `js/util.js` | `isoDay`, `addDays`, `TODAY`, `niceDate`, `esc`, `debounce`, `fetchJson` |
| `js/bands.js` | Slope angle classes (`DEFAULT_BANDS`, `bands`) and their editor UI with the aspect dial |
| `js/map.js` | Base maps (`bases`: Kartverket, OpenTopoMap, swisstopo, IGN, basemap.at), the `map` object, layer panes, `LAYER_GROUPS`, `LAYER_TOGGLES`, layer-order list |
| `js/steepness.js` | Official steepness layers (NVE/swisstopo/IGN), `REGIONS` (which base map and steepness layer each area gets) |
| `js/heatmap.js` | Strava heatmap, detecting how far it zooms |
| `js/pistes.js` | OpenSnowMap ski piste overlay |
| `js/gpxtrack.js` | Uploaded GPX files (tracks, routes, waypoints) shown as an overlay |
| `js/huts.js` | DNT and other huts from the `data/huts.json` OpenStreetMap snapshot (refresh with `tools/update-huts.py`) |
| `js/slope.js` | Terrarium DEM tile loading/cache (`loadDem`, `demCache`), `demBlock` (a tile plus its 8 neighbours at half resolution) and the computed slope layer |
| `js/hillshade.js` | Hillshade layer and the sun-direction dial |
| `js/runout.js` | Alpha-angle runout model layer; `applySlopeVisible`; first `applySteep()` |
| `js/exposure.js` | Sun exposure (solar position, cast shadows, sun hours/time of day) and wind exposure (Winstral shelter index, Open-Meteo wind of the last 3 days, wind dial); `exposureLine` for the readout |
| `js/readout.js` | Tap the map → slope/elevation/aspect readout |
| `js/scale.js` | Scale bar and the base map's contour interval |
| `js/route/elevation.js` | Measuring state (`measuring`, `mpts`), DOM refs for the measure card/profile, `sampleLine`, `elevationProfile` |
| `js/route/stats.js` | Munter time, steepness colours, ascent/descent/steep/time text, steep stretches drawn on the map |
| `js/route/profile.js` | Elevation profile SVG chart and the scrubber |
| `js/route/sunwind.js` | Sun and wind along the measured line: arrival times from Munter, sun/shade as you pass (shadow rays), sun before arrival, lee/exposed and steep-and-loaded stretches, the strips under the profile |
| `js/route/gpx.js` | GPX export |
| `js/route/measure.js` | Drawing the line, the tool on/off, Undo/Clear/Done |
| `js/locate.js` | GPS position, accuracy circle, compass heading ray |
| `js/snow.js` | UTM33 conversion, seNorge layer, `SNOW_SOURCES` (seNorge, MODIS, Sentinel…), date stepper |
| `js/avalanche/data.js` | `SERVICES` (every forecast service: link, bbox, EAWS or not), geometry helpers, fetching and caching regions/ratings (EAWS + Varsom) |
| `js/avalanche/layer.js` | Danger-level map layer, forecast line in the readout, "which service" link |
| `js/controls.js` | Wires up the remaining panel controls, base-map auto switching (`setBase`, `autoBase`), panel collapse. Runs last. |
| `tools/smoke-test.sh` | Headless Chrome load test |
| `tools/update-huts.py` | Rebuilds `data/huts.json` from Overpass |

## Common changes

- **New overlay layer:** add a pane entry in `LAYER_GROUPS` and a get/set in `LAYER_TOGGLES` (`js/map.js`), add it to `layerOrder`, add a panel `<section>` with `<h2 data-layer="key">` in `index.html`, and create the Leaflet layer with `pane:'<key>Pane'` in its own `js/<feature>.js`.
- **New country or region:** add a row to `REGIONS` (and a layer in `steepLayers` if it has its own steepness service) in `js/steepness.js`.
- **New avalanche service:** add a row to `SERVICES` in `js/avalanche/data.js`.
- **New snow source:** add an entry to `SNOW_SOURCES` in `js/snow.js` and an `<option>` in `#snowSrc` in `index.html`.
- **Phone layout:** the `@media (max-width:640px)` blocks in `css/controls.css` and `css/map-ui.css`.

## Conventions

- Style is compact vanilla JS: 2-space indent, `const` by default, arrow functions for handlers, and element lookups with `document.getElementById`.
- Comments are `/* ... */` blocks written in plain English that explain *why*. Sections start with `/* ---------- name ---------- */`. Keep that voice.
- Async layers use a "token" counter (`heatToken`, `gainToken`, `linkToken`, `dangerState.token`) to drop out-of-date responses. Follow the same pattern.
- localStorage keys are prefixed `bratthet.` and always wrapped in `try/catch`.
- Colours come from the CSS variables in `css/base.css` (`--snow`, `--muted`, `--line`, `--panel-2`, ...).
- UI text is English. Keep safety wording (the "Before you use this" section, forecast warnings) intact.
