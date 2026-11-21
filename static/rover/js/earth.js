// =========================================================================
// 23. RETURN TO EARTH — dock with Columbia, Trans-Earth injection, coast, entry, splashdown
// =========================================================================
// Only Columbia can fly home (the LM was never built to), so the trip starts from a hard dock.
//   TEI    hold the engine to burn out of lunar orbit
//   coast  three days compressed into a few seconds, Earth growing ahead
//   entry  keep the flight-path angle inside the re-entry corridor
//   splash parachutes, splashdown, Field Journal entry
import * as THREE from 'three';
import { camera, csmGroup, csmOrbitLine, earthGroup, landerGroup, scene, updateOrbitalStage } from './scene.js';
import { csm, gameState, keys, lander } from './state.js';
import { LANDMARKS } from './constants.js';
import { rdv, rdvEnd } from './apollo-ops.js';
import { showToast } from './hud.js';
import { sound } from './audio.js';
import { save, scheduleSave, markFirst } from './save.js';
import { say, stopRadio } from './radio.js';
const callHome = (id) => { stopRadio(); say(id); };   // each phase of the trip replaces older chatter
import { ui } from './context-ui.js';
import { warpLanderToLandmark } from './modes.js';
import { stopTutorial } from './tutorial.js';
import { openJournal } from './finds.js';

const EARTH_R = 42;                 // scene radius of the Earth mesh
const TEI_BURN_SEC = 3.2;           // seconds of engine needed to leave lunar orbit
const COAST_SEC = 15;               // real seconds for the ~3-day coast
const ENTRY_SEC = 11;               // real seconds of re-entry
const CORRIDOR = [-7.4, -5.4];      // flight-path angle band (deg); Apollo aimed for about −6.5°
const EARTH_MOON_KM = 384400;

export const earthRun = {
  active: false, phase: null, t: 0, burn: 0,
  p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), p3: new THREE.Vector3(),
  pos: new THREE.Vector3(), fwd: new THREE.Vector3(1, 0, 0),
  fpa: -6.5, drift: 0, heat: 0, skip: 0, inBand: 0, entryAxis: new THREE.Vector3(), entryStart: new THREE.Vector3(),
  glow: null,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();

function $(id) { return document.getElementById(id); }

export function canGoHome() {
  return rdv.active && rdv.phase === 'docked';
}

export function startEarthRun() {
  if (earthRun.active) return;
  if (!canGoHome()) {
    showToast('Only Columbia can fly home — dock with her first (K)', 'warn');
    return;
  }
  stopTutorial();
  earthRun.active = true;
  earthRun.phase = 'tei';
  earthRun.t = 0;
  earthRun.burn = 0;
  rdvEnd(true);
  lander.docked = true;
  landerGroup.visible = false;        // Eagle's ascent stage is jettisoned in lunar orbit, as on Apollo 11
  if (csmOrbitLine) csmOrbitLine.visible = false;
  if (csmGroup.userData.halo) csmGroup.userData.halo.visible = false;
  $('earth-hud').classList.remove('hidden');
  showToast(ui.touch ? 'Eagle jettisoned. Hold BURN to fire Columbia’s engine for home' : 'Eagle jettisoned. Hold SPACE to fire Columbia’s engine for home', 'sage');
  callHome('teiGo');
  sound.playStageSep();
  render();
}

function buildCoastPath() {
  const E = earthGroup.position;
  earthRun.p0.copy(csm.pos);
  const fwd = _v.copy(csm.vel).normalize();
  earthRun.p1.copy(csm.pos).addScaledVector(fwd, 260);
  // Arrive at the edge of the atmosphere, coming in from the side so the last stretch skims the planet
  const toMoon = _w.copy(csm.pos).sub(E).normalize();
  const side = new THREE.Vector3().crossVectors(toMoon, new THREE.Vector3(0, 1, 0)).normalize();
  earthRun.p3.copy(E).addScaledVector(toMoon, EARTH_R * 0.55).addScaledVector(side, EARTH_R * 0.95);
  earthRun.p3.sub(E).setLength(EARTH_R * 1.12).add(E);
  earthRun.p2.copy(E).addScaledVector(toMoon, EARTH_R * 3.4).addScaledVector(side, EARTH_R * 2.6);
}

function bezier(u, out) {
  const a = 1 - u;
  return out.set(0, 0, 0)
    .addScaledVector(earthRun.p0, a * a * a)
    .addScaledVector(earthRun.p1, 3 * a * a * u)
    .addScaledVector(earthRun.p2, 3 * a * u * u)
    .addScaledVector(earthRun.p3, u * u * u);
}

function placeCsm(pos, fwd) {
  csm.pos.copy(pos);
  csmGroup.position.copy(pos);
  csmGroup.up.copy(_w.copy(pos).sub(earthGroup.position).normalize());
  csmGroup.lookAt(_v.copy(pos).add(fwd));
  if (earthRun.glow) earthRun.glow.position.copy(pos);
}

function ensureGlow() {
  if (earthRun.glow) return;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,150,60,0.75)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  earthRun.glow = new THREE.Sprite(mat);
  earthRun.glow.scale.set(0.9, 0.9, 1);
  earthRun.glow.visible = false;
  scene.add(earthRun.glow);
}

export function updateEarthRun(dt) {
  if (!earthRun.active) return;
  earthRun.t += dt;
  const r = earthRun;

  if (r.phase === 'tei') {
    updateOrbitalStage(dt);                   // still in lunar orbit until the burn is done
    const burning = keys.lift || keys.boost;
    sound.updateThruster(burning ? 1 : 0, burning);
    if (burning) r.burn += dt;
    if (r.burn >= TEI_BURN_SEC) {
      sound.updateThruster(0, false);
      buildCoastPath();
      r.phase = 'coast';
      r.t = 0;
      callHome('teiDone');
      showToast('TEI complete — Columbia is on her way home', 'sage');
      sound.playScanComplete();
    }
  } else if (r.phase === 'coast') {
    const s = Math.min(1, r.t / COAST_SEC);
    // Slow climbing away from the Moon, falling faster and faster toward Earth
    const u = s * s * (1.75 - 0.75 * s);
    bezier(u, r.pos);
    bezier(Math.min(1, u + 0.002), _look);
    r.fwd.copy(_look).sub(r.pos).normalize();
    placeCsm(r.pos, r.fwd);
    if (s >= 1) startEntry();
  } else if (r.phase === 'entry') {
    // Flight-path angle wanders (winds of the upper atmosphere); pitch to hold it in the corridor
    r.drift += (Math.random() - 0.5) * dt * 1.6;
    r.drift = THREE.MathUtils.clamp(r.drift * Math.exp(-0.4 * dt), -1.2, 1.2);
    const pitch = (keys.forward || keys.arrowUp ? 1 : 0) - (keys.backward || keys.arrowDown ? 1 : 0);
    r.fpa += (r.drift * 0.9 + pitch * 1.6) * dt;
    r.fpa = THREE.MathUtils.clamp(r.fpa, -12, -1);
    if (r.fpa < CORRIDOR[0]) r.heat += dt * (0.08 + (CORRIDOR[0] - r.fpa) * 0.14);
    else if (r.fpa > CORRIDOR[1]) r.skip += dt * (0.08 + (r.fpa - CORRIDOR[1]) * 0.14);
    else { r.inBand += dt; r.heat = Math.max(0, r.heat - dt * 0.05); r.skip = Math.max(0, r.skip - dt * 0.05); }
    // Ride around the planet, sinking into the atmosphere
    const s = Math.min(1, r.t / ENTRY_SEC);
    const ang = s * 0.9;
    r.pos.copy(r.entryStart).sub(earthGroup.position).applyAxisAngle(r.entryAxis, ang)
      .setLength(EARTH_R * (1.12 - 0.1 * s)).add(earthGroup.position);
    _v.copy(r.entryStart).sub(earthGroup.position).applyAxisAngle(r.entryAxis, ang + 0.02).setLength(EARTH_R * (1.12 - 0.1 * s)).add(earthGroup.position);
    r.fwd.copy(_v).sub(r.pos).normalize();
    placeCsm(r.pos, r.fwd);
    r.glow.visible = true;
    const flicker = 0.85 + Math.random() * 0.3;
    r.glow.scale.setScalar((0.5 + 0.9 * Math.sin(Math.PI * Math.min(1, s * 1.2))) * flicker);
    if (r.heat >= 1) endEntry(false, 'Too steep: the heat shield couldn’t take it.');
    else if (r.skip >= 1) endEntry(false, 'Too shallow: Columbia skipped off the atmosphere back into space.');
    else if (s >= 1) { r.phase = 'chutes'; r.t = 0; r.glow.visible = false; showToast('Drogues… main chutes out!', 'sage'); sound.playPing(660, 0.2); }
  } else if (r.phase === 'chutes') {
    if (r.t > 2.2) endEntry(true);
  }
  render();
}

function startEntry() {
  const r = earthRun;
  ensureGlow();
  r.phase = 'entry';
  r.t = 0;
  r.fpa = -6.5 + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6);
  r.drift = 0; r.heat = 0; r.skip = 0; r.inBand = 0;
  r.entryStart.copy(r.pos);
  _v.copy(r.pos).sub(earthGroup.position).normalize();
  r.entryAxis.crossVectors(_v, r.fwd).normalize();
  if (r.entryAxis.lengthSq() < 0.5) r.entryAxis.set(0, 1, 0);
  callHome('entry');
  showToast(ui.touch ? 'ENTRY INTERFACE — thumbstick up/down to keep the angle in the green' : 'ENTRY INTERFACE — W/S to keep the flight-path angle in the green', 'gold');
}

function endEntry(success, why = '') {
  const r = earthRun;
  r.phase = 'done';
  if (r.glow) r.glow.visible = false;
  const pct = Math.round((r.inBand / ENTRY_SEC) * 100);
  $('earth-result-title').textContent = success ? 'Splashdown!' : 'Re-entry failed';
  $('earth-result-medal').textContent = success ? (pct >= 85 ? 'BULLSEYE ENTRY' : (pct >= 60 ? 'IN THE CORRIDOR' : 'MADE IT HOME')) : 'LOST ON ENTRY';
  $('earth-result-stats').textContent = success
    ? `${pct}% of the entry inside the corridor`
    : `${why} ${pct}% of the entry was inside the corridor.`;
  $('earth-result-body').classList.toggle('hidden', !success);
  $('earth-retry-btn').classList.toggle('hidden', success);
  $('earth-result-modal').classList.remove('hidden');
  if (success) {
    save.data.records.earthReturns = (save.data.records.earthReturns || 0) + 1;
    save.data.records.earthBest = Math.max(save.data.records.earthBest || 0, pct);
    gameState.splashedDown = true;
    markFirst('earth');
    scheduleSave();
    callHome('splashdown');
    sound.playScanComplete();
  } else {
    callHome('entryFail');
    sound.playStageSep();
  }
}

function retryEntry() {
  $('earth-result-modal').classList.add('hidden');
  earthRun.pos.copy(earthRun.p3);
  earthRun.fwd.copy(earthRun.p3).sub(earthRun.p2).normalize();   // arrival direction of the coast
  startEntry();
}

// Back to a fresh LM at Tranquility Base, a new mission
export function backToMoon() {
  $('earth-result-modal').classList.add('hidden');
  $('earth-hud').classList.add('hidden');
  if (earthRun.glow) earthRun.glow.visible = false;
  sound.updateThruster(0, false);
  earthRun.active = false;
  earthRun.phase = null;
  lander.docked = false;
  landerGroup.visible = true;
  if (csmOrbitLine) csmOrbitLine.visible = true;
  if (csmGroup.userData.halo) csmGroup.userData.halo.visible = true;
  gameState.hoverAssist = true;
  gameState.autoGyro = true;
  csm.angle = 0.32;
  updateOrbitalStage(0);
  warpLanderToLandmark(LANDMARKS[0], true);
  showToast('New mission: a fresh Eagle over the Sea of Tranquility', 'sage');
}

function abortHome() {
  if (earthRun.phase !== 'tei') return;
  sound.updateThruster(0, false);
  earthRun.active = false;
  earthRun.phase = null;
  $('earth-hud').classList.add('hidden');
  lander.docked = false;
  landerGroup.visible = true;
  if (csmOrbitLine) csmOrbitLine.visible = true;
  if (csmGroup.userData.halo) csmGroup.userData.halo.visible = true;
  gameState.hoverAssist = true;
  warpLanderToLandmark(LANDMARKS[0], true);
  showToast('Staying at the Moon — a fresh Eagle is ready over Tranquility', 'gold');
}

export function earthAction(act) {
  if (act === 'gohome') startEarthRun();
  else if (act === 'earthabort') abortHome();
}

// Camera: behind and above Columbia, looking where she is going (Earth ahead during the coast)
export function updateEarthCamera(dt) {
  if (!earthRun.active || earthRun.phase === null) return;
  const r = earthRun;
  const E = earthGroup.position;
  const pos = r.phase === 'tei' ? csm.pos : r.pos;
  const fwd = r.phase === 'tei' ? _v.copy(csm.vel).normalize() : r.fwd;
  const up = _w.copy(pos).sub(r.phase === 'tei' ? _look.set(0, 0, 0) : E).normalize();
  let back = 1.0, lift = 0.4;
  if (r.phase === 'coast') {
    const s = Math.min(1, r.t / COAST_SEC);
    back = 1.0 + Math.sin(Math.PI * s) * 14;    // pull out mid-coast to see the Moon shrink and Earth grow
    lift = 0.4 + Math.sin(Math.PI * s) * 5;
  } else if (r.phase === 'entry' || r.phase === 'chutes' || r.phase === 'done') {
    back = 1.1; lift = 0.45;                     // close behind, Earth's horizon filling the view
  }
  // Follow exactly: Columbia moves far too fast near Earth for an eased camera to keep up
  _camPos.copy(pos).addScaledVector(fwd, -back).addScaledVector(up, lift);
  camera.position.copy(_camPos);
  if (r.phase === 'coast') _look.copy(pos).lerp(E, 0.25 + 0.5 * Math.min(1, r.t / COAST_SEC));
  else if (r.phase === 'tei') _look.copy(pos).addScaledVector(fwd, 1.2);
  else _look.copy(pos).addScaledVector(fwd, 3).addScaledVector(up, -0.6);   // a little down: the planet below
  camera.up.copy(up);
  camera.lookAt(_look);
}

function render() {
  const r = earthRun;
  const label = { tei: 'TRANS-EARTH INJECTION', coast: 'COASTING HOME', entry: 'RE-ENTRY', chutes: 'PARACHUTES', done: 'RECOVERY' }[r.phase] || '';
  $('earth-phase').textContent = label;
  const bar = $('earth-bar');
  const barRow = $('earth-bar-row');
  const corr = $('earth-corridor');
  const hint = $('earth-hint');
  barRow.classList.toggle('hidden', !(r.phase === 'tei' || r.phase === 'coast'));
  corr.classList.toggle('hidden', r.phase !== 'entry');
  $('earth-abort-btn').classList.toggle('hidden', r.phase !== 'tei');
  if (r.phase === 'tei') {
    bar.style.width = `${Math.min(100, (r.burn / TEI_BURN_SEC) * 100)}%`;
    $('earth-bar-label').textContent = `BURN ${Math.min(100, Math.round((r.burn / TEI_BURN_SEC) * 100))}%`;
    hint.textContent = ui.touch ? 'Hold BURN to leave lunar orbit' : 'Hold SPACE to leave lunar orbit';
  } else if (r.phase === 'coast') {
    const s = Math.min(1, r.t / COAST_SEC);
    const u = s * s * (1.75 - 0.75 * s);
    bar.style.width = `${Math.round(u * 100)}%`;
    $('earth-bar-label').textContent = `${Math.round((1 - u) * EARTH_MOON_KM).toLocaleString()} km to go`;
    hint.textContent = `Day ${Math.min(3, 1 + Math.floor(s * 3))} of 3 · time compressed`;
  } else if (r.phase === 'entry') {
    // Gauge spans −11° … −2°; the green band is the corridor
    const toPct = (deg) => THREE.MathUtils.clamp(((deg + 11) / 9) * 100, 0, 100);
    $('earth-band').style.left = `${toPct(CORRIDOR[0])}%`;
    $('earth-band').style.width = `${toPct(CORRIDOR[1]) - toPct(CORRIDOR[0])}%`;
    $('earth-marker').style.left = `${toPct(r.fpa)}%`;
    $('earth-fpa').textContent = `${r.fpa.toFixed(1)}°`;
    $('earth-heat').style.width = `${Math.min(100, r.heat * 100)}%`;
    $('earth-skip').style.width = `${Math.min(100, r.skip * 100)}%`;
    const steep = r.fpa < CORRIDOR[0], shallow = r.fpa > CORRIDOR[1];
    hint.textContent = steep ? (ui.touch ? 'Too steep! Thumbstick up' : 'Too steep! Hold W to pull up')
      : (shallow ? (ui.touch ? 'Too shallow! Thumbstick down' : 'Too shallow! Hold S to dip') : 'In the corridor — hold it there');
  } else if (r.phase === 'chutes') {
    hint.textContent = 'Drogues… mains… stand by for splashdown';
  }
}

export function bindEarth() {
  $('earth-abort-btn').addEventListener('click', () => earthAction('earthabort'));
  $('earth-moon-btn').addEventListener('click', backToMoon);
  $('earth-retry-btn').addEventListener('click', retryEntry);
  $('earth-journal-btn').addEventListener('click', () => {
    $('earth-result-modal').classList.add('hidden');
    openJournal();
  });
}
