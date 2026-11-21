import * as THREE from 'three';
import { MOON_RADIUS } from './constants.js';
import { sound } from './audio.js';
import { gameState, lander, rover } from './state.js';
import { formatLat, formatLon, getSurfaceNormalAtPosition, getSurfaceRadiusAtLatLon, latLonToVec3 } from './coords.js';
import { camera, scene, sunLight } from './scene.js';
import { warpLanderToLandmark } from './modes.js';
import { showToast } from './hud.js';
import { rdv, rdvEnd } from './apollo-ops.js';
import { save, scheduleSave } from './save.js';
import { say } from './radio.js';

// =========================================================================
// 20. HIDDEN FINDS & FIELD JOURNAL
//     Real places. Coordinates: NASA NSSDC "Anthropogenic Impacts and Spacecraft
//     on the Moon" (LROC-measured), LROC Pits Atlas, IAU / NASA feature centres.
// =========================================================================
const FIND_CATS = {
  craft: { label: 'Spacecraft', color: '#7dd3fc' },
  human: { label: 'Human stories', color: '#f4d58d' },
  geology: { label: 'Geology', color: '#c4b5fd' },
  moment: { label: 'Moments', color: '#7ec4a0' }
};
// mode: 'ground' = on the surface within r · 'near' = within r below ~100 km · 'orbit' = within r at any height · 'cond' = a moment
export const FINDS = [
  // ---------------- Spacecraft ----------------
  { id: 'luna9', cat: 'craft', name: 'Luna 9', lat: 7.13, lon: -64.37, mode: 'ground', r: 0.4,
    hint: 'On the western shore of Oceanus Procellarum, the very first spacecraft to land gently on the Moon.',
    hook: 'First soft landing on any world (February 1966).',
    body: 'The Soviet Luna 9 thumped down inside a cushioned capsule, then opened like a flower and sent back the first pictures ever taken from the surface of another world. They settled a big worry: the Moon was not covered in deep, swallowing dust.' },
  { id: 'surveyor1', cat: 'craft', name: 'Surveyor 1', lat: -2.4745, lon: -43.3398, mode: 'ground', r: 0.4,
    hint: 'In Oceanus Procellarum, America’s first robot to touch down — sent to check the ground would hold astronauts.',
    hook: 'America’s first soft landing (June 1966).',
    body: 'Before Apollo could risk people, NASA had to know the dust would hold a spacecraft’s weight. Surveyor 1 settled down gently and sent home more than 11,000 pictures, proving the surface was firm.' },
  { id: 'surveyor3', cat: 'craft', name: 'Surveyor 3', lat: -3.0162, lon: -23.4180, mode: 'ground', r: 0.3,
    hint: 'In Oceanus Procellarum, a robot that waited two and a half years for visitors.',
    hook: 'The only robot ever visited by humans on another world.',
    body: 'Apollo 12 landed so precisely that Pete Conrad and Alan Bean walked over to Surveyor 3, which had arrived in April 1967. They cut off its camera and brought it home so engineers could study what 31 months on the Moon does to hardware.' },
  { id: 'surveyor7', cat: 'craft', name: 'Surveyor 7', lat: -40.9812, lon: -11.5127, mode: 'ground', r: 0.4,
    hint: 'On the rough slopes just north of bright young Tycho, the last of NASA’s robot scouts.',
    hook: 'The last Surveyor — sent somewhere purely for science (1968).',
    body: 'With the Apollo landing zones scouted, NASA aimed its final Surveyor at the rugged highlands beside Tycho. It analysed the soil’s chemistry — and even photographed laser beams fired at it from observatories on Earth.' },
  { id: 'ranger7', cat: 'craft', name: 'Ranger 7 impact', lat: -10.634, lon: -20.677, mode: 'near', r: 0.8,
    hint: 'South of Copernicus, a probe filmed the Moon all the way down — until it hit.',
    hook: 'The first close-up photos of the Moon (1964).',
    body: 'Ranger 7 had one job: take pictures while falling. It sent 4,308 images in its last 17 minutes, the final ones showing craters about a metre wide. The sea where it crashed was renamed Mare Cognitum — “the Sea that has become known.”' },
  { id: 'lunokhod1', cat: 'craft', name: 'Lunokhod 1', lat: 38.315, lon: -35.0081, mode: 'ground', r: 0.4,
    hint: 'On the western plains of Mare Imbrium, a robot car that drove the Moon months before any astronaut did.',
    hook: 'The first robot rover on another world (1970).',
    body: 'Steered by a team in the Soviet Union through a radio delay of a few seconds, Lunokhod 1 roamed for about ten months and over 10 km. Its laser reflector was “lost” for decades until LRO photos found it in 2010 — scientists bounce lasers off it again today.' },
  { id: 'lunokhod2', cat: 'craft', name: 'Lunokhod 2', lat: 25.8323, lon: 30.9222, mode: 'ground', r: 0.4,
    hint: 'In a crater-walled bay on the eastern edge of Mare Serenitatis, a rover set a distance record that stood for 40 years.',
    hook: 'The off-Earth driving champion until 2014.',
    body: 'Lunokhod 2 drove about 39 km in four months inside Le Monnier crater. No rover anywhere beat that until NASA’s Opportunity, on Mars, in 2014.' },
  { id: 'change3', cat: 'craft', name: 'Chang’e 3 & Yutu', lat: 44.1214, lon: -19.5117, mode: 'ground', r: 0.4,
    hint: 'In northern Mare Imbrium, the first soft landing on the Moon in 37 years.',
    hook: 'China’s first lander and its “Jade Rabbit” rover (2013).',
    body: 'Chang’e 3 ended a 37-year gap in lunar landings. Its rover Yutu is named after the rabbit that lives on the Moon in Chinese legend — and it used radar to see layers of old lava buried beneath its wheels.' },
  { id: 'change4', cat: 'craft', name: 'Chang’e 4 & Yutu-2', lat: -45.4561, lon: 177.5885, mode: 'ground', r: 0.4,
    hint: 'On the far side, inside Von Kármán crater, something landed where nothing had landed before.',
    hook: 'The first landing on the Moon’s far side (January 2019).',
    body: 'The far side never faces Earth, so Chang’e 4 talked home through a relay satellite parked beyond the Moon. Its rover, Yutu-2, went on to become the longest-working rover in lunar history.' },
  { id: 'change5', cat: 'craft', name: 'Chang’e 5', lat: 43.0576, lon: -51.9161, mode: 'ground', r: 0.4,
    hint: 'Near Mons Rümker in northern Oceanus Procellarum, a robot dug into some of the Moon’s youngest lava — and flew it home.',
    hook: 'The first Moon samples brought to Earth in 44 years (2020).',
    body: 'Chang’e 5 returned 1,731 grams of rock and soil. They turned out to be about 2 billion years old — much younger than Apollo’s samples — proving lunar volcanoes kept erupting far longer than expected.' },
  { id: 'change6', cat: 'craft', name: 'Chang’e 6', lat: -41.6385, lon: -153.9852, mode: 'ground', r: 0.4,
    hint: 'In the far side’s Apollo crater, inside the gigantic South Pole–Aitken basin, someone scooped up the far side’s first souvenir.',
    hook: 'The first samples ever returned from the far side (2024).',
    body: 'Chang’e 6 brought home about 1.9 kg from the far side. That hemisphere has a thicker crust and almost no dark lava seas — nobody is sure why, and these rocks are new clues.' },
  { id: 'beresheet', cat: 'craft', name: 'Beresheet', lat: 32.5956, lon: 19.3496, mode: 'near', r: 0.6,
    hint: 'In Mare Serenitatis, a small privately built lander that almost made it.',
    hook: 'Israel’s tiny lander — and its secret passengers (2019).',
    body: 'SpaceIL’s Beresheet crashed when its main engine cut out during descent. Aboard was a “lunar library” of human knowledge — and thousands of dried tardigrades, the famously tough micro-animals.' },
  { id: 'lcross', cat: 'craft', name: 'LCROSS impact', lat: -84.6796, lon: -48.7093, mode: 'near', r: 1.0,
    hint: 'In the permanent darkness of Cabeus crater near the south pole, NASA crashed a rocket on purpose to see what splashed up.',
    hook: 'The crash that found water (2009).',
    body: 'LCROSS drove a spent rocket stage into Cabeus at about 2.5 km/s, then flew through the debris cloud. Its instruments detected water — proof that shadowed polar craters really do trap ice.' },
  { id: 'grail', cat: 'craft', name: 'GRAIL Ebb & Flow', lat: 75.6088, lon: -26.594, mode: 'near', r: 0.8,
    hint: 'On a mountain near the north pole, twin spacecraft ended their mission side by side.',
    hook: 'The gravity-mapping twins (2012).',
    body: 'GRAIL’s two spacecraft flew in formation, measuring the gap between them so precisely they could feel the tug of mountains and buried mass. Their crash site is named for Sally Ride, the first American woman in space, who ran GRAIL’s student camera project.' },
  { id: 'vikram', cat: 'craft', name: 'Chandrayaan-3 Vikram', lat: -69.3741, lon: 32.32, mode: 'ground', r: 0.4,
    hint: 'Far into the southern highlands, India set a lander down closer to the pole than anyone had before.',
    hook: 'The first soft landing near the south pole (August 2023).',
    body: 'Vikram and its little rover Pragyan measured the temperature of the topsoil and detected sulphur in it. India named the landing spot “Shiv Shakti point.”' },
  { id: 'slim', cat: 'craft', name: 'SLIM “Moon Sniper”', lat: -13.316, lon: 25.251, mode: 'ground', r: 0.4,
    hint: 'On the slope of tiny Shioli crater near Mare Nectaris, a lander came down on its nose — and kept working.',
    hook: 'Japan’s pinpoint lander (January 2024).',
    body: 'SLIM’s job was to land within 100 m of its target — and it did. An engine problem tipped it onto its nose with its solar panels facing the wrong way, yet it woke up again after several freezing lunar nights.' },
  { id: 'odysseus', cat: 'craft', name: 'Odysseus (IM-1)', lat: -80.13, lon: 1.44, mode: 'ground', r: 0.4,
    hint: 'Near the south pole’s Malapert region, a privately built lander resting on its side.',
    hook: 'The first commercial soft landing (February 2024).',
    body: 'Intuitive Machines’ Odysseus came in too fast, snapped a leg and ended up leaning over — but it kept sending data for days. It was also the first American landing on the Moon since Apollo 17 in 1972.' },
  { id: 'blueghost', cat: 'craft', name: 'Blue Ghost 1', lat: 18.562, lon: 61.81, mode: 'ground', r: 0.4,
    hint: 'In Mare Crisium, a lander that stayed to watch the Sun go down.',
    hook: 'The first fully successful commercial Moon landing (March 2025).',
    body: 'Firefly’s Blue Ghost landed upright and ran its whole mission, drilling to measure heat flowing out of the Moon and filming a lunar sunset — including a glow from floating dust that Apollo astronauts once sketched.' },

  // ---------------- Human stories ----------------
  { id: 'tranquility', cat: 'human', name: 'Tranquility Base', lat: 0.67416, lon: 23.47314, mode: 'ground', r: 0.3,
    hint: 'Where it all began: a plaque on a landing leg, in the Sea of Tranquility.',
    hook: 'The first human landing (July 20, 1969).',
    body: 'Eagle’s descent stage still stands here, a plaque on its leg reading “We came in peace for all mankind.” The laser reflector Armstrong and Aldrin set up nearby is still used to measure the Earth–Moon distance to within millimetres.' },
  { id: 'apollo12', cat: 'human', name: 'Apollo 12 “Intrepid”', lat: -3.0128, lon: -23.4219, mode: 'ground', r: 0.3,
    hint: 'A mission struck by lightning on launch still landed within walking distance of its target.',
    hook: 'Pinpoint landing — after lightning (November 1969).',
    body: 'Apollo 12’s rocket was hit by lightning twice during launch and its instruments went haywire. Flight controller John Aaron saved the mission with a famously obscure call: “Try SCE to Aux.” Four days later Intrepid landed a short walk from Surveyor 3.' },
  { id: 'golf', cat: 'human', name: 'Shepard’s golf shots', lat: -3.64589, lon: -17.47194, mode: 'ground', r: 0.3,
    hint: 'In the Fra Mauro highlands, a commander once played the first sport on another world.',
    hook: 'Golf on the Moon (Apollo 14, 1971).',
    body: 'At the end of his last moonwalk, Alan Shepard clipped a 6-iron head onto a sample-scoop handle and hit two balls one-handed in his stiff suit. Decades later, photo analysis showed the best shot went about 40 yards — not the “miles and miles” he joked about.' },
  { id: 'fallen', cat: 'human', name: 'Fallen Astronaut', lat: 26.13222, lon: 3.63386, mode: 'ground', r: 0.12,
    hint: 'Near Hadley Rille, a quiet memorial was left without any announcement.',
    hook: 'The only sculpture on the Moon (Apollo 15, 1971).',
    body: 'David Scott placed a 9-cm aluminium figure beside a plaque naming 14 astronauts and cosmonauts — eight American, six Soviet — who had died. A tribute across the Space Race, revealed only after the crew got home.' },
  { id: 'apollo16', cat: 'human', name: 'Charlie Duke’s family photo', lat: -8.9734, lon: 15.5011, mode: 'ground', r: 0.3,
    hint: 'In the Descartes highlands, a family photograph lies face-up in the dust.',
    hook: 'A note from home (Apollo 16, 1972).',
    body: 'Charlie Duke left a photo of his wife and two sons on the surface, with a message on the back. It’s still there — though decades of unfiltered sunlight have almost certainly bleached it white.' },
  { id: 'apollo17', cat: 'human', name: 'The last footsteps', lat: 20.1911, lon: 30.7723, mode: 'ground', r: 0.3,
    hint: 'In the Taurus–Littrow valley, the last human footprints on the Moon — so far.',
    hook: 'Where people last walked on the Moon (December 1972).',
    body: 'Gene Cernan’s final words before climbing the ladder: “We leave as we came and, God willing, as we shall return, with peace and hope for all mankind.” Nobody has walked on the Moon since.' },

  // ---------------- Geology ----------------
  { id: 'tranqpit', cat: 'geology', name: 'Mare Tranquillitatis pit', lat: 8.3355, lon: 33.222, mode: 'ground', r: 0.4, pit: true,
    hint: 'East of where Apollo 11 landed, the ground of the Sea of Tranquility just… stops.',
    hook: 'A skylight into a possible lava tube.',
    body: 'This hole is about 100 m across and over 100 m deep, with overhangs on several sides — its floor runs back under the surface like a cave. Lava tubes could one day shelter astronauts from radiation, meteorites and the Moon’s wild temperature swings.' },
  { id: 'mariuspit', cat: 'geology', name: 'Marius Hills pit', lat: 14.0917, lon: -56.7701, mode: 'ground', r: 0.4, pit: true,
    hint: 'Among the volcanic domes of the Marius Hills, a hole sits in the middle of an old lava channel.',
    hook: 'The first lunar pit ever discovered (2009).',
    body: 'Japan’s Kaguya orbiter spotted this ~50 m hole sitting inside a winding lava channel — exactly where a collapsed lava-tube roof would be. Radar data hint at hollow tubes that may run for kilometres underground.' },
  { id: 'ingeniipit', cat: 'geology', name: 'Mare Ingenii pit', lat: -35.9494, lon: 166.0559, mode: 'ground', r: 0.4, pit: true,
    hint: 'On the far side’s “Sea of Cleverness,” between bright swirls, a hole with layered walls.',
    hook: 'A far-side pit in swirl country.',
    body: 'This pit is about 130 m wide, and its walls show stacked layers of old lava flows like pages in a book. The same sea is painted with bright lunar swirls — two mysteries in one neighbourhood.' },
  { id: 'reinergamma', cat: 'geology', name: 'Reiner Gamma', lat: 7.5, lon: -59.0, mode: 'orbit', r: 2.2,
    hint: 'On Oceanus Procellarum, a bright tadpole-shaped marking that casts no shadow.',
    hook: 'A lunar swirl — painted by a magnetic field.',
    body: 'Reiner Gamma isn’t a hill or a crater: it’s a pattern of bright soil about 70 km long. It sits on one of the Moon’s strongest local magnetic fields, which may shield the ground from the solar wind that darkens soil everywhere else.' },
  { id: 'aristarchus', cat: 'geology', name: 'Aristarchus', lat: 23.7, lon: -47.4, mode: 'orbit', r: 1.6,
    hint: 'In northwest Oceanus Procellarum, the brightest large crater on the Moon.',
    hook: 'You can see it from Earth without a telescope.',
    body: 'Aristarchus is so bright it shows up even when it’s lit only by earthshine. Its walls expose fresh, reflective rock, and the plateau around it is covered in volcanic glass beads from ancient fire-fountain eruptions.' },
  { id: 'ina', cat: 'geology', name: 'Ina', lat: 18.65, lon: 5.30, mode: 'near', r: 0.6,
    hint: 'In Lacus Felicitatis, a small D-shaped hollow that might be one of the youngest volcanic features on the Moon.',
    hook: 'Volcanism that might be surprisingly recent.',
    body: 'Ina’s smooth mounds have so few craters that some scientists think they erupted less than 100 million years ago — while dinosaurs walked the Earth. Others think it’s billions of years old. NASA plans to land there to find out.' },
  { id: 'schrodinger', cat: 'geology', name: 'Schrödinger basin', lat: -75.0, lon: 132.4, mode: 'orbit', r: 4.0,
    hint: 'Near the south pole on the far side, a 312 km bullseye.',
    hook: 'The Moon’s best-preserved peak-ring basin.',
    body: 'Schrödinger is one of the youngest big impact basins, so its inner ring of mountains is still crisp. It lies inside the even larger South Pole–Aitken basin and may expose rock from deep inside the Moon.' },
  { id: 'malapert', cat: 'geology', name: 'Peak of near-eternal light', lat: -86.0, lon: 0.0, mode: 'near', r: 1.5,
    hint: 'Near the south pole, a ridge where the sunlight almost never stops.',
    hook: 'Artemis country.',
    body: 'The Moon’s axis is tilted only about 1.5°, so some polar ridges stay sunlit most of the year while craters a few kilometres away never see the Sun. Constant solar power right next to frozen water — that’s why Artemis is heading here.' },

  // ---------------- Moments ----------------
  { id: 'earthrise', cat: 'moment', name: 'Earthrise', mode: 'cond',
    hint: 'For someone standing in the middle of the near side, Earth never rises. Go to the edge.',
    hook: 'Earth on the horizon.',
    body: 'The Moon always keeps the same face toward us, so from most of the near side Earth hangs almost still in the sky. Only near the edge — or from orbit — does it rise and set. Apollo 8’s “Earthrise” photo (1968) became one of the most famous pictures ever taken.' },
  { id: 'farside', cat: 'moment', name: 'The far side', mode: 'cond',
    hint: 'Half the Moon can never be seen from Earth. Go and look.',
    hook: 'Not dark — just never facing us.',
    body: 'The far side gets just as much sunlight as the near side. We never see it because the Moon turns exactly once for every trip around Earth. Nobody saw it at all until Luna 3 photographed it in 1959.' },
  { id: 'eternalshadow', cat: 'moment', name: 'Into eternal shadow', mode: 'cond',
    hint: 'Find somewhere the Sun has not shone for billions of years.',
    hook: 'One of the coldest places in the Solar System.',
    body: 'Some crater floors near the poles haven’t seen sunlight in billions of years. Measured below −230 °C in places, they are cold enough to hold water ice delivered by comets and the solar wind.' },
  { id: 'firstorbit', cat: 'moment', name: 'Falling around the Moon', mode: 'cond',
    hint: 'Go sideways so fast you never come down.',
    hook: 'Your first stable orbit.',
    body: 'An orbit is just falling sideways fast enough to keep missing the ground — about 1.6 km/s at the height where Apollo’s command modules circled the Moon.' },
  { id: 'rendezvous', cat: 'moment', name: 'Lunar orbit rendezvous', mode: 'cond',
    hint: 'Meet the ship that’s waiting overhead.',
    hook: 'The trick that made Apollo possible.',
    body: 'Apollo sent only a small lander down and back up to meet the mother ship in orbit. Engineer John Houbolt fought for this risky plan — it saved so much weight that it made the 1960s landings possible.' }
];
FINDS.forEach((f) => {
  if (f.mode !== 'cond') f.unit = latLonToVec3(f.lat, f.lon, 1.0);
});
const FIND_DETECT_RANGE = 40; // world units (~700 km) for an untracked ping

export const finds = {
  markers: new Map(),   // id -> { pin, glint?, decal? }
  lastPing: 0,
  lastDist: new Map(),  // id -> last pinged distance (warmer / colder)
  signalTimer: 0,
  cardTimer: 0,
  filter: 'all',
  detailId: null,
  pinTex: null,
  glintTex: null
};

function isFound(id) {
  return !!save.data.journal[id];
}
export function foundCount() {
  return FINDS.reduce((n, f) => n + (isFound(f.id) ? 1 : 0), 0);
}

function makeSpriteTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  return new THREE.CanvasTexture(c);
}

export function initFinds() {
  finds.pinTex = makeSpriteTexture((ctx) => {
    ctx.fillStyle = 'rgba(126,196,160,0.25)';
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7ec4a0'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(32, 32, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ecfdf5';
    ctx.beginPath(); ctx.arc(32, 32, 8, 0, Math.PI * 2); ctx.fill();
  });
  finds.glintTex = makeSpriteTexture((ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,250,220,0.9)');
    g.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(30, 2, 4, 60); ctx.fillRect(2, 30, 60, 4);
  });
  const pitMat = new THREE.MeshBasicMaterial({ color: 0x020304, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const pitGeo = new THREE.CircleGeometry(0.07, 20);
  FINDS.forEach((f) => {
    if (f.mode === 'cond') return;
    const m = {};
    m.pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: finds.pinTex, transparent: true, depthWrite: false, depthTest: true }));
    m.pin.center.set(0.5, 0.5);
    m.pin.visible = false;
    scene.add(m.pin);
    if (f.cat === 'craft' || f.cat === 'human') {
      m.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: finds.glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.glint.visible = false;
      m.phase = Math.random() * 10;
      scene.add(m.glint);
    }
    if (f.pit) {
      m.decal = new THREE.Mesh(pitGeo, pitMat);
      scene.add(m.decal);
    }
    finds.markers.set(f.id, m);
  });
  seatFindMarkers();
}

export function seatFindMarkers() {
  FINDS.forEach((f) => {
    const m = finds.markers.get(f.id);
    if (!m) return;
    const r = getSurfaceRadiusAtLatLon(f.lat, f.lon);
    m.surface = latLonToVec3(f.lat, f.lon, r);
    m.pin.position.copy(m.surface).setLength(r + 0.06);
    if (m.glint) m.glint.position.copy(m.surface).setLength(r + 0.015);
    if (m.decal) {
      const n = getSurfaceNormalAtPosition(m.surface, new THREE.Vector3());
      m.decal.position.copy(m.surface).setLength(r + 0.004);
      m.decal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    }
  });
}

const _fSun = new THREE.Vector3();
function updateFindMarkers(now) {
  if (!sunLight) return;
  _fSun.copy(sunLight.position).normalize();
  for (const f of FINDS) {
    const m = finds.markers.get(f.id);
    if (!m) continue;
    const found = isFound(f.id);
    const camD = camera.position.distanceTo(m.pin.position);
    // Found: a small pin you can see from anywhere (your map of discoveries)
    m.pin.visible = found && gameState.started;
    if (m.pin.visible) m.pin.scale.setScalar(THREE.MathUtils.clamp(camD * 0.022, 0.03, 4));
    // Undiscovered hardware glints when sunlit and you're close
    if (m.glint) {
      const lit = f.unit.dot(_fSun) > 0.05;
      const show = !found && gameState.started && lit && camD < 3.2;
      m.glint.visible = show;
      if (show) {
        const tw = Math.pow(Math.max(0, Math.sin(now * 0.0021 + m.phase)), 10);
        m.glint.material.opacity = 0.25 + 0.75 * tw;
        m.glint.scale.setScalar(THREE.MathUtils.clamp(camD * 0.035, 0.012, 0.16) * (0.7 + tw * 0.8));
      }
    }
  }
}

// ---------------- Discovery ----------------
function activeCraftForFinds() {
  if (gameState.mode === 'rover' && rover.deployed) return { craft: rover, by: 'rover', onGround: rover.isGrounded, agl: rover.aglUnits };
  return { craft: lander, by: lander.isLanded ? 'lander' : (lander.aglUnits > 6 ? 'orbit' : 'lander'), onGround: lander.isLanded || lander.aglUnits < 0.3, agl: lander.aglUnits };
}

const MOMENTS = {
  earthrise: (c) => Math.abs(c.craft.lon) > 82 && Math.abs(c.craft.lon) < 98 && Math.abs(c.craft.lat) < 55,
  farside: (c) => Math.abs(c.craft.lon) > 100,
  eternalshadow: (c) => c.craft.lat < -87.5 && c.agl < 1.5,
  firstorbit: () => lander.inOrbit && !lander.isLanded,
  rendezvous: () => rdv.active && rdv.phase === 'docked'
};

function checkDiscoveries() {
  if (!gameState.started || lander.crashed || rover.crashed) return;
  if (gameState.mode === 'orbital' && !rdv.active) return;
  const c = activeCraftForFinds();
  const up = c.craft.up;
  for (const f of FINDS) {
    if (isFound(f.id)) continue;
    let hit = false;
    if (f.mode === 'cond') {
      hit = MOMENTS[f.id] ? MOMENTS[f.id](c) : false;
    } else {
      const d = Math.acos(THREE.MathUtils.clamp(up.dot(f.unit), -1, 1)) * MOON_RADIUS;
      if (f.mode === 'ground') hit = d < f.r && c.onGround;
      else if (f.mode === 'near') hit = d < f.r && c.agl < 6;
      else hit = d < f.r;
    }
    if (hit) discoverFind(f, c.by);
  }
}

function discoverFind(f, by) {
  say(`find.${f.id}`);
  save.data.journal[f.id] = { t: Date.now(), by: f.mode === 'cond' ? 'moment' : by };
  if (save.data.tracking === f.id) save.data.tracking = null;
  scheduleSave();
  updateJournalBadge();
  showFindCard(f);
  sound.playScanComplete();
  setTimeout(() => sound.playPing(1318.5, 0.3), 380);
  if (finds.detailId === null && !document.getElementById('journal-modal').classList.contains('hidden')) renderJournal();
}

function showFindCard(f) {
  const cat = FIND_CATS[f.cat];
  document.getElementById('find-card-cat').textContent = `NEW ${cat.label.toUpperCase()} FIND · ${foundCount()}/${FINDS.length}`;
  document.getElementById('find-card-cat').style.color = cat.color;
  document.getElementById('find-card-name').textContent = f.name;
  document.getElementById('find-card-hook').textContent = f.hook;
  document.getElementById('find-card').dataset.id = f.id;
  document.getElementById('find-card').classList.remove('hidden');
  finds.cardTimer = 8;
}

// ---------------- Ping (sonar-style signal) ----------------
const BEARINGS = ['ahead', 'ahead-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'ahead-left'];
export function pingFinds() {
  const now = performance.now();
  if (now - finds.lastPing < 1500) return;
  finds.lastPing = now;
  const c = activeCraftForFinds();
  const up = c.craft.up;
  let target = null, dist = Infinity, tracked = false;
  const tId = save.data.tracking;
  if (tId && !isFound(tId)) {
    target = FINDS.find((f) => f.id === tId);
    if (target && target.unit) {
      dist = Math.acos(THREE.MathUtils.clamp(up.dot(target.unit), -1, 1)) * MOON_RADIUS;
      tracked = true;
    } else target = null;
  }
  if (!target) {
    for (const f of FINDS) {
      if (f.mode === 'cond' || isFound(f.id)) continue;
      const d = Math.acos(THREE.MathUtils.clamp(up.dot(f.unit), -1, 1)) * MOON_RADIUS;
      if (d < dist) { dist = d; target = f; }
    }
    if (dist > FIND_DETECT_RANGE) target = null;
  }
  const pill = document.getElementById('signal-pill');
  const bars = document.getElementById('signal-bars');
  const txt = document.getElementById('signal-text');
  pill.classList.remove('hidden');
  finds.signalTimer = 9;
  if (!target) {
    bars.textContent = '▯▯▯▯▯';
    txt.textContent = 'No signal within 700 km — try another region, or track a find from the Journal';
    sound.playPing(300, 0.25);
    return;
  }
  const n = dist < 1 ? 5 : dist < 3 ? 4 : dist < 8 ? 3 : dist < 18 ? 2 : dist < FIND_DETECT_RANGE ? 1 : 0;
  bars.textContent = '▮'.repeat(n) + '▯'.repeat(5 - n);
  const prev = finds.lastDist.get(target.id);
  finds.lastDist.set(target.id, dist);
  let trend = '';
  if (prev !== undefined) trend = dist < prev - 0.05 ? 'stronger ↑' : (dist > prev + 0.05 ? 'weaker ↓' : 'steady');
  // Bearing relative to the camera (same frame as the waypoint arrow)
  let bearing = '';
  const to = target.unit.clone().sub(up);
  to.addScaledVector(up, -to.dot(up));
  const camFwd = new THREE.Vector3();
  camera.getWorldDirection(camFwd);
  camFwd.addScaledVector(up, -camFwd.dot(up));
  if (to.lengthSq() > 1e-10 && camFwd.lengthSq() > 1e-8) {
    to.normalize(); camFwd.normalize();
    const right = new THREE.Vector3().crossVectors(camFwd, up).normalize();
    const deg = THREE.MathUtils.radToDeg(Math.atan2(to.dot(right), to.dot(camFwd)));
    bearing = BEARINGS[((Math.round(deg / 45) % 8) + 8) % 8];
  }
  const parts = [];
  if (tracked) parts.push('tracked signal');
  if (dist < 1) parts.push('very close — look around');
  else if (bearing) parts.push(`strongest ${bearing}`);
  if (trend) parts.push(trend);
  txt.textContent = parts.join(' · ');
  sound.playPing(380 + n * 140, 0.22);
  if (n >= 4) setTimeout(() => sound.playPing(520 + n * 140, 0.16), 140);
}

function trackFind(id) {
  save.data.tracking = save.data.tracking === id ? null : id;
  scheduleSave();
  showToast(save.data.tracking ? 'Tracking this signal — use Ping to follow it' : 'Stopped tracking', 'sage');
  renderJournal();
}

export function updateFinds(dt, now) {
  checkDiscoveries();
  updateFindMarkers(now);
  if (finds.signalTimer > 0) {
    finds.signalTimer -= dt;
    if (finds.signalTimer <= 0) document.getElementById('signal-pill').classList.add('hidden');
  }
  if (finds.cardTimer > 0) {
    finds.cardTimer -= dt;
    if (finds.cardTimer <= 0) document.getElementById('find-card').classList.add('hidden');
  }
}

// ---------------- Field Journal UI ----------------
function updateJournalBadge() {
  document.getElementById('journal-count').textContent = `${foundCount()}/${FINDS.length}`;
}

export function openJournal(detailId = null) {
  finds.detailId = detailId;
  document.getElementById('journal-modal').classList.remove('hidden');
  renderJournal();
}
export function closeJournal() {
  document.getElementById('journal-modal').classList.add('hidden');
  finds.detailId = null;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderJournal() {
  const n = foundCount();
  document.getElementById('journal-progress-text').textContent = `${n} / ${FINDS.length} found`;
  document.getElementById('journal-progress-bar').style.width = `${(n / FINDS.length) * 100}%`;
  const body = document.getElementById('journal-body');
  const tabs = document.getElementById('journal-tabs');
  body.replaceChildren();
  tabs.classList.toggle('hidden', finds.detailId !== null);
  if (finds.detailId) { renderJournalDetail(body, FINDS.find((f) => f.id === finds.detailId)); return; }

  tabs.querySelectorAll('[data-filter]').forEach((b) => {
    const on = b.dataset.filter === finds.filter;
    b.className = `journal-tab${on ? ' on' : ''}`;
    const cat = b.dataset.filter;
    const total = FINDS.filter((f) => cat === 'all' || f.cat === cat).length;
    const got = FINDS.filter((f) => (cat === 'all' || f.cat === cat) && isFound(f.id)).length;
    b.querySelector('.jt-count').textContent = `${got}/${total}`;
  });

  const grid = el('div', 'journal-grid');
  FINDS.filter((f) => finds.filter === 'all' || f.cat === finds.filter).forEach((f) => {
    const cat = FIND_CATS[f.cat];
    const found = isFound(f.id);
    const card = el('div', `journal-card${found ? ' found' : ''}`);
    card.style.setProperty('--cat', cat.color);
    card.appendChild(el('div', 'jc-cat', cat.label.toUpperCase()));
    if (found) {
      card.appendChild(el('div', 'jc-name', f.name));
      card.appendChild(el('div', 'jc-hook', f.hook));
      const by = save.data.journal[f.id].by;
      card.appendChild(el('div', 'jc-meta', by === 'moment' ? 'Experienced' : `Found by ${by}`));
      card.addEventListener('click', () => { finds.detailId = f.id; renderJournal(); });
      card.tabIndex = 0;
    } else {
      card.appendChild(el('div', 'jc-name unknown', '???'));
      card.appendChild(el('div', 'jc-hint', f.hint));
      if (f.mode !== 'cond') {
        const tracking = save.data.tracking === f.id;
        const b = el('button', `jc-track${tracking ? ' on' : ''}`, tracking ? '◉ Tracking signal' : 'Track signal');
        b.type = 'button';
        b.addEventListener('click', (e) => { e.stopPropagation(); trackFind(f.id); });
        card.appendChild(b);
      }
    }
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

function renderJournalDetail(body, f) {
  const cat = FIND_CATS[f.cat];
  const rec = save.data.journal[f.id];
  const wrap = el('div', 'journal-detail');
  wrap.style.setProperty('--cat', cat.color);
  const back = el('button', 'jc-back', '← All finds');
  back.type = 'button';
  back.addEventListener('click', () => { finds.detailId = null; renderJournal(); });
  wrap.appendChild(back);
  wrap.appendChild(el('div', 'jc-cat', cat.label.toUpperCase()));
  wrap.appendChild(el('h3', 'jd-name', f.name));
  wrap.appendChild(el('div', 'jd-hook', f.hook));
  wrap.appendChild(el('p', 'jd-body', f.body));
  const meta = [];
  if (f.mode !== 'cond') meta.push(`${formatLat(f.lat)}, ${formatLon(f.lon)}`);
  if (rec) {
    meta.push(rec.by === 'moment' ? 'Experienced' : `Found by ${rec.by}`);
    meta.push(new Date(rec.t).toLocaleDateString());
  }
  wrap.appendChild(el('div', 'jd-meta', meta.join(' · ')));
  if (f.mode !== 'cond') {
    const go = el('button', 'jd-go', 'Fly the LM here');
    go.type = 'button';
    go.addEventListener('click', () => {
      closeJournal();
      if (rdv.active) rdvEnd(true);
      warpLanderToLandmark({ id: gameState.targetLandmarkId, lat: f.lat, lon: f.lon, shortName: f.name }, true);
    });
    wrap.appendChild(go);
  }
  body.appendChild(wrap);
}

export function bindJournal() {
  document.getElementById('journal-btn').addEventListener('click', () => { sound.init(); openJournal(); });
  document.getElementById('journal-menu-btn').addEventListener('click', () => openJournal());
  document.getElementById('journal-close-btn').addEventListener('click', closeJournal);
  document.getElementById('journal-modal').addEventListener('click', (e) => { if (e.target.id === 'journal-modal') closeJournal(); });
  document.querySelectorAll('#journal-tabs [data-filter]').forEach((b) => {
    b.addEventListener('click', () => { finds.filter = b.dataset.filter; renderJournal(); });
  });
  document.getElementById('find-card-open').addEventListener('click', () => {
    const id = document.getElementById('find-card').dataset.id;
    document.getElementById('find-card').classList.add('hidden');
    openJournal(id || null);
  });
  updateJournalBadge();
}
