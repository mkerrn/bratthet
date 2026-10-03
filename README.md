# Bratthet

A map for getting ideas for ski tours in Norway and the Alps. It is a GitHub Pages site, so open it on your phone or laptop. There is nothing to install.

> Bratthet is only for inspiration and planning. It does not replace the avalanche forecast, a proper route plan or your own judgement in the field.

## What it can do

- **Angle classes.** Colours slopes by steepness, worked out from elevation data. You set your own angle ranges, and you can limit each one to certain directions (the compass dial) and heights.
- **Official steepness.** NVE's avalanche terrain layer in Norway, swisstopo's slope classes in the Alps and IGN's slope map in France. The app picks the right one for where you are looking.
- **Avalanche runout (alpha).** How far avalanches from the slopes above could run, in three bands (32°, 27°, 23°) built the way NVE builds the runout on Varsom's steepness map, and in NVE's colours. Computed in the browser, so it works outside Norway too.
- **Hillshading.** Shading from the same elevation data. You can turn the light direction.
- **Snow condition.** seNorge snow depth and new snow (Norway), plus MODIS and Sentinel satellite snow images for a chosen date.
- **Avalanche forecast.** Danger levels by region from Varsom (Norway) and EAWS (the Alps and the rest of Europe), with a link to the local forecast service.
- **Heatmap.** Where people ski, from the Strava winter heatmap.
- **Tap the map** to see slope angle, elevation, aspect and the forecast for that spot.
- **Measuring tape.** Draw a line to get the distance, ascent and descent, the steepest ground it crosses, a Munter time estimate, and an elevation profile you can drag along. You can save the line as a GPX file for your watch or GPS.
- **My position.** Shows where you are and which way the phone points.
- **Layer order.** Choose which layers are drawn on top, and turn each one on or off.

## Running it locally

The site is plain HTML, CSS and JavaScript, with no build step. Browsers won't load the scripts from a `file://` page reliably, so serve the folder instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

`tools/smoke-test.sh` loads the page in headless Chrome and reports any JavaScript errors.

## How the code is organised

```
index.html        page markup (panel, buttons, cards) and the list of scripts
css/              styles, split by area of the screen
js/               one file per feature, loaded in order by index.html
  route/          measuring tape: elevation, stats, profile chart, GPX
  avalanche/      forecast regions and danger levels
tools/            smoke test
```

[CLAUDE.md](CLAUDE.md) has the detailed map of which file does what.

## Data sources

Kartverket and OpenTopoMap (base maps), AWS Terrain Tiles (elevation), NVE (steepness, seNorge snow, Varsom), swisstopo, IGN, NASA GIBS and EOX (satellite snow), EAWS and the national avalanche services, and Strava (heatmap). Every source keeps its own copyright and terms.
