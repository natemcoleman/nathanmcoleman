# Moon Rover (LRO Lunar Explorer)

Open-world Moon game at `/rover/`: fly an Apollo lunar module over real NASA terrain, drive the rover, dock with Columbia, and hunt for hidden finds.

Everything the page serves lives in `static/rover/`. There is no bundler: the browser loads the ES modules directly, so you edit a file, refresh, and you're done. Because the page uses ES modules it needs a web server (`hugo server`); opening `index.html` straight from disk won't work.

## Files

| File | What it is |
| --- | --- |
| `static/rover/index.html` | Page markup: HUD, menus, modals |
| `static/rover/css/game.css` | Hand-written game styles (HUD panels, buttons, phone layout) |
| `static/rover/css/tailwind.css` | Generated Tailwind utilities. Don't edit; run `npm run rover:css` |
| `static/rover/vendor/` | Three.js r187 and r128 (ES module builds, minified) and geotiff.js. Re-download with `npm run rover:vendor` |
| `static/rover/textures.json` + maps | NASA Moon color and 16-bit elevation maps the game loads on startup, plus optional NASA Earth maps (`earth` entry) |
| `tools/rover/make-textures.py` | Rebuilds the web maps from the NASA TIFFs (`python tools/rover/make-textures.py`, needs numpy + Pillow) |
| `tools/rover/build-css.mjs` | Builds `tailwind.css` from the classes used in the HTML and JS |
| `tools/rover/fetch-vendor.mjs` | Downloads the libraries into `vendor/` |

## Code: `static/rover/js/`

One module per part of the game. Each module imports exactly what it uses, so the imports at the top of a file show what it depends on, including `import * as THREE from 'three'` (resolved by the import map in `index.html`).

| Module | Contents |
| --- | --- |
| `main.js` | Animation loop and startup (`window.onload`) |
| `three-compat.js` | Keeps colours and lighting the same on old and new Three.js |
| `constants.js` | Moon size, gravity, real landing sites and landmarks |
| `state.js` | Game state objects: `gameState`, `lander`, `rover`, `keys`, camera state, seismic events |
| `audio.js` | Generated sound effects and soundtrack (Web Audio, no files) |
| `coords.js` | Latitude/longitude math, terrain height and collision against the Moon mesh |
| `procedural-moon.js` | Fallback color and elevation maps when the NASA maps aren't loaded |
| `nasa-maps.js` | Loading NASA maps: `textures.json` on startup, dropped `.tif`/`.jpg` files |
| `scene.js` | Three.js scene: Moon, Earth, Sun, lander, rover, Columbia, particles |
| `modes.js` | Warping to sites, deploying and boarding the rover, autopilot helpers |
| `lander.js` | Lander flight: orbital physics, attitude, landing and tipping |
| `rover.js` | Rover driving, jumps, stunts and tumbling |
| `camera.js` | Chase cameras and the orbital view |
| `scan.js` | Lidar scan and landmark discovery |
| `hud.js` | Telemetry, toasts and the mission sites list |
| `input.js` | Keyboard, mouse, touch and drag-and-drop |
| `challenges.js` | Orbit predictor ring, Hadley Rille Run, South Pole Ice |
| `apollo-ops.js` | Ascent stage separation, crashes, rendezvous and docking with Columbia, ALSEP stations, LOLA overlays |
| `context-ui.js` | Context-aware controls: shows only the buttons that matter right now |
| `save.js` | Progress saving (browser `localStorage`, versioned) |
| `finds.js` | Hidden finds, Ping, and the Field Journal |
| `apollo11.js` | Retro hold, surface temperature and solar battery, the "30 Seconds of Fuel" challenge |
| `radio.js` | Mission Control radio: Quindar tones, static and subtitles (recorded clips optional) |
| `tutorial.js` | Guided first mission for new players (land → rover → Ping → first find); skippable, replay from the menu |
| `earth.js` | Return to Earth: once docked with Columbia, Trans-Earth injection burn, coast, re-entry corridor, splashdown |

## Three.js version

The game runs on Three.js r187. The original r128 is kept next to it so the upgrade can be undone:

- **Compare:** open `/rover/?three=128` for the old version, `/rover/` for the new one.
- **Roll back for everyone:** in `static/rover/index.html`, change `THREE_DEFAULT = '187'` to `'128'`.
- `js/three-compat.js` undoes the r152 colour-management and r155 physical-lighting changes so both versions look alike. Code that creates lights or colour textures should go through its helpers (`directionalLight`, `ambientLight`, `pointLight`, `setSRGB`).

## Mission Control radio

Houston's calls show as subtitles, opened and closed by Quindar beeps over light static. There is no computer voice. Players can turn the radio on or off under Menu → Mission Control radio.

Every call has an id (`landing`, `a11Down`, `find.luna9`, `scan.tycho`, …). To play a real recording for a call:

1. In the browser console on `/rover/`, run `lroRadioLines()` to list every id and its text.
2. Save the clip as `static/rover/audio/radio/<id>.mp3` (for example `a11Down.mp3` for "We copy you on the ground…").
3. List the ids that have clips in `static/rover/audio/radio/manifest.json`: `{ "files": ["a11Down", "landing"] }`

Calls with a clip play it while the subtitle shows; calls without one show the subtitle alone. `{cs}` in a line is the callsign (Eagle, or Rover when driving).

## Commands

```sh
npm run rover:vendor   # once: download Three.js and geotiff.js into static/rover/vendor/
npm run rover:css      # after adding or changing Tailwind classes
```

`rover:css` needs the build tools installed once (they aren't saved to package.json):

```sh
npm i --no-save tailwindcss@4 esbuild
```

The generated CSS is committed, so the site build (`hugo --gc --minify`) doesn't need Node.

## Credits

Maps: NASA Scientific Visualization Studio (SVS 4720), LROC/ASU, LOLA/GSFC.
