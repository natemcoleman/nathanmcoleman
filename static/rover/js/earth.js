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
  glow: null, alt: 0, shake: 0, fx: null, camHold: new THREE.Vector3(),
};

// ---------- Entry effects: plasma glow, trail, sparks, screen tint ----------
// What you see tells you which way you're failing:
//   too steep   → glow swells and turns white-hot, sparks peel off, the camera shakes, screen burns orange
//   too shallow → glow fades and cools to blue, Columbia lifts away from the planet
const TRAIL_N = 90;
const SPARK_N = 140;
const _hot = new THREE.Color(1.0, 0.93, 0.8);
const _warm = new THREE.Color(1.0, 0.55, 0.22);
const _cool = new THREE.Color(0.45, 0.6, 1.0);
const _c = new THREE.Color();

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
  showToast(ui.touch ? 'Eagle jettisoned. Hold BURN to fire Columbia’s engine for home' : 'Eagle jettisoned. Hold SPACE to fire Columbia’s engine for home', 'sage', { important: true });
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
  if (earthRun.glow) { resetFx(); return; }
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

  // Plasma trail: the last few seconds of Columbia's path, brightest at the capsule
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  trail.frustumCulled = false;
  scene.add(trail);

  // Sparks: bits of ablating heat shield, shed when the entry is too steep
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_N * 3), 3));
  const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: mat.map, color: 0xffb070, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  scene.add(sparks);

  // Screen tint: orange heat at the edges, or a white flash when the capsule burns up
  const tint = document.createElement('div');
  tint.id = 'entry-tint';
  tint.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:15;opacity:0;transition:opacity .15s linear';
  document.body.appendChild(tint);

  earthRun.fx = {
    trail, sparks, tint, trailLen: 0,
    sparkVel: new Float32Array(SPARK_N * 3), sparkLife: new Float32Array(SPARK_N), nextSpark: 0,
  };
  resetFx();
}

function resetFx() {
  const fx = earthRun.fx;
  if (!fx) return;
  fx.trailLen = 0;
  fx.trail.geometry.setDrawRange(0, 0);
  fx.sparkLife.fill(0);
  const sp = fx.sparks.geometry.attributes.position.array;
  sp.fill(1e6);
  fx.sparks.geometry.attributes.position.needsUpdate = true;
  fx.trail.visible = fx.sparks.visible = false;
  fx.tint.style.opacity = '0';
  earthRun.shake = 0;
  csmGroup.visible = true;
}

function hideFx() {
  if (earthRun.glow) earthRun.glow.visible = false;
  if (earthRun.fx) { earthRun.fx.trail.visible = earthRun.fx.sparks.visible = false; earthRun.fx.tint.style.opacity = '0'; }
  earthRun.shake = 0;
}

function setTint(color, edge, opacity) {
  const t = earthRun.fx.tint;
  t.style.background = edge
    ? `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, ${color} 100%)`
    : color;
  t.style.opacity = String(THREE.MathUtils.clamp(opacity, 0, 1));
}

// heat: 0 cool … 1 white-hot. intensity: overall brightness of the plasma
function updateFx(dt, heat, intensity, sparkRate, showTrail = true, maxGlow = 1.8, trailFloor = 0) {
  const r = earthRun, fx = r.fx;
  // Glow colour and size
  if (heat >= 0.5) _c.copy(_warm).lerp(_hot, (heat - 0.5) * 2);
  else _c.copy(_cool).lerp(_warm, heat * 2);
  r.glow.visible = intensity > 0.02;
  r.glow.material.color.copy(_c);
  r.glow.material.opacity = THREE.MathUtils.clamp(intensity, 0, 1);
  const flicker = 0.85 + Math.random() * 0.3;
  r.glow.scale.setScalar(Math.min(maxGlow, 0.3 + intensity * (0.45 + heat * 0.7)) * flicker);
  r.glow.position.copy(r.pos);

  // Trail: shift the history and add the newest point
  const tp = fx.trail.geometry.attributes.position.array;
  const tc = fx.trail.geometry.attributes.color.array;
  tp.copyWithin(3, 0, (TRAIL_N - 1) * 3);
  tp[0] = r.pos.x; tp[1] = r.pos.y; tp[2] = r.pos.z;
  fx.trailLen = Math.min(TRAIL_N, fx.trailLen + 1);
  for (let i = 0; i < fx.trailLen; i++) {
    const k = (1 - i / TRAIL_N) * Math.max(intensity, trailFloor);
    tc[i * 3] = _c.r * k; tc[i * 3 + 1] = _c.g * k; tc[i * 3 + 2] = _c.b * k;
  }
  fx.trail.geometry.attributes.position.needsUpdate = true;
  fx.trail.geometry.attributes.color.needsUpdate = true;
  fx.trail.geometry.setDrawRange(0, fx.trailLen);
  fx.trail.visible = showTrail;

  // Sparks: spawn off the heat shield, drift back along the path and fade
  const sp = fx.sparks.geometry.attributes.position.array;
  fx.nextSpark += sparkRate * dt;
  while (fx.nextSpark >= 1) {
    fx.nextSpark -= 1;
    let i = 0;
    for (let j = 0; j < SPARK_N; j++) if (fx.sparkLife[j] <= 0) { i = j; break; }
    fx.sparkLife[i] = 0.5 + Math.random() * 0.7;
    sp[i * 3] = r.pos.x + (Math.random() - 0.5) * 0.15;
    sp[i * 3 + 1] = r.pos.y + (Math.random() - 0.5) * 0.15;
    sp[i * 3 + 2] = r.pos.z + (Math.random() - 0.5) * 0.15;
    fx.sparkVel[i * 3] = -r.fwd.x * 1.5 + (Math.random() - 0.5) * 1.4;
    fx.sparkVel[i * 3 + 1] = -r.fwd.y * 1.5 + (Math.random() - 0.5) * 1.4;
    fx.sparkVel[i * 3 + 2] = -r.fwd.z * 1.5 + (Math.random() - 0.5) * 1.4;
  }
  let any = false;
  for (let i = 0; i < SPARK_N; i++) {
    if (fx.sparkLife[i] <= 0) continue;
    fx.sparkLife[i] -= dt;
    if (fx.sparkLife[i] <= 0) { sp[i * 3] = 1e6; continue; }
    any = true;
    sp[i * 3] += fx.sparkVel[i * 3] * dt;
    sp[i * 3 + 1] += fx.sparkVel[i * 3 + 1] * dt;
    sp[i * 3 + 2] += fx.sparkVel[i * 3 + 2] * dt;
  }
  fx.sparks.geometry.attributes.position.needsUpdate = true;
  fx.sparks.visible = any;
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
      showToast('TEI complete — Columbia is on her way home', 'sage', { important: true });
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
    // Ride around the planet. Steep sinks you faster into thick air; shallow lifts you back out
    const s = Math.min(1, r.t / ENTRY_SEC);
    r.alt += dt * (-0.1 / ENTRY_SEC + (r.fpa + 6.5) * 0.004);
    r.alt = THREE.MathUtils.clamp(r.alt, 0.015, 0.16);
    rideEntry(s * 0.9, r.alt);
    // How the plasma looks: a nominal entry glows orange; steep goes white-hot, shallow fades and cools
    const off = r.fpa < CORRIDOR[0] ? (CORRIDOR[0] - r.fpa) : (r.fpa > CORRIDOR[1] ? -(r.fpa - CORRIDOR[1]) : 0);
    const heatLook = THREE.MathUtils.clamp(0.62 + off * 0.18 + r.heat * 0.4 - r.skip * 0.35, 0, 1);
    const air = Math.sin(Math.PI * Math.min(1, s * 1.15));           // builds up, then dies away as you slow down
    const intensity = THREE.MathUtils.clamp(air * (1 + r.heat * 0.8 - r.skip * 0.75), 0.05, 1.6);
    updateFx(dt, heatLook, intensity, r.heat > 0.25 ? (r.heat - 0.2) * 90 : 0, false);
    r.shake = 0.004 + air * 0.01 + r.heat * r.heat * 0.06;
    if (r.heat > 0.15) setTint('rgba(255,110,30,0.9)', true, (r.heat - 0.15) * 0.9);
    else if (r.skip > 0.15) setTint('rgba(90,130,255,0.6)', true, (r.skip - 0.15) * 0.5);
    else setTint('rgba(0,0,0,0)', true, 0);
    if (r.heat >= 1) startFailure('burnup');
    else if (r.skip >= 1) startFailure('skipout');
    else if (s >= 1) { r.phase = 'chutes'; r.t = 0; hideFx(); showToast('Drogues… main chutes out!', 'sage', { important: true }); sound.playPing(660, 0.2); }
  } else if (r.phase === 'burnup') {
    // The heat shield gives out: glow balloons, a shower of sparks, then a white flash
    const k = Math.min(1, r.t / 1.6);
    r.ang += dt * 0.08;
    r.alt = Math.max(0.01, r.alt - dt * 0.01);
    rideEntry(r.ang, r.alt);
    updateFx(dt, 1, 1.4 + k * 2.5, 260, false, 1.2 + k * 3);
    r.shake = 0.05 + k * 0.08;
    if (r.t > 1.3) csmGroup.visible = false;
    setTint(r.t < 1.2 ? 'rgba(255,120,40,0.9)' : 'rgba(255,245,230,1)', r.t < 1.2, r.t < 1.2 ? 0.5 + k * 0.4 : 1 - (r.t - 1.2) * 0.35);
    if (r.t > 3.2) endEntry(false, 'Too steep: the heat shield couldn’t take it.');
  } else if (r.phase === 'skipout') {
    // Bounces off the air like a stone off a pond: the glow dies and Columbia climbs back to space
    r.ang += dt * 0.06;
    r.alt += dt * (0.012 + r.t * 0.014);
    rideEntry(r.ang, r.alt);
    updateFx(dt, 0, Math.max(0, 0.6 - r.t * 0.35), 0, true, 1.8, 0.7);
    r.shake = Math.max(0, 0.01 - r.t * 0.01);
    setTint('rgba(90,130,255,0.6)', true, Math.max(0, 0.4 - r.t * 0.15));
    if (r.t > 3.6) endEntry(false, 'Too shallow: Columbia skipped off the atmosphere back into space.');
  } else if (r.phase === 'chutes') {
    if (r.t > 2.2) endEntry(true);
  }
  render();
}

// Place Columbia around the planet: ang along the entry arc, alt above the surface (in Earth radii)
function rideEntry(ang, alt) {
  const r = earthRun, E = earthGroup.position;
  r.ang = ang;
  r.pos.copy(r.entryStart).sub(E).applyAxisAngle(r.entryAxis, ang).setLength(EARTH_R * (1 + alt)).add(E);
  _v.copy(r.entryStart).sub(E).applyAxisAngle(r.entryAxis, ang + 0.02).setLength(EARTH_R * (1 + alt)).add(E);
  r.fwd.copy(_v).sub(r.pos).normalize();
  placeCsm(r.pos, r.fwd);
}

function startFailure(kind) {
  const r = earthRun;
  r.phase = kind;
  r.lastFail = kind;
  r.t = 0;
  r.camHold.copy(camera.position);        // skip-out: the camera stays put and watches her climb away
  if (kind === 'burnup') { sound.playStageSep(); showToast('Heat shield failing!', 'warn'); }
  else showToast('Skipping off the atmosphere!', 'warn');
  render();
}

function startEntry() {
  const r = earthRun;
  ensureGlow();
  r.alt = 0.12; r.ang = 0; r.lastFail = null;
  r.phase = 'entry';
  r.t = 0;
  r.fpa = -6.5 + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6);
  r.drift = 0; r.heat = 0; r.skip = 0; r.inBand = 0;
  r.entryStart.copy(r.pos);
  _v.copy(r.pos).sub(earthGroup.position).normalize();
  r.entryAxis.crossVectors(_v, r.fwd).normalize();
  if (r.entryAxis.lengthSq() < 0.5) r.entryAxis.set(0, 1, 0);
  callHome('entry');
  showToast(ui.touch ? 'ENTRY INTERFACE — thumbstick up/down to keep the angle in the green' : 'ENTRY INTERFACE — W/S to keep the flight-path angle in the green', 'gold', { important: true });
}

function endEntry(success, why = '') {
  const r = earthRun;
  r.phase = 'done';
  hideFx();
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
  resetFx();
  restoreFov();
  earthRun.pos.copy(earthRun.p3);
  earthRun.fwd.copy(earthRun.p3).sub(earthRun.p2).normalize();   // arrival direction of the coast
  startEntry();
}

// Back to a fresh LM at Tranquility Base, a new mission
export function backToMoon() {
  $('earth-result-modal').classList.add('hidden');
  $('earth-hud').classList.add('hidden');
  hideFx();
  restoreFov();
  csmGroup.visible = true;
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
  showToast('New mission: a fresh Eagle over the Sea of Tranquility', 'sage', { important: true });
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
  showToast('Staying at the Moon — a fresh Eagle is ready over Tranquility', 'gold', { important: true });
}

export function earthAction(act) {
  if (act === 'gohome') startEarthRun();
  else if (act === 'earthabort') abortHome();
}

function restoreFov() {
  if (!earthRun.fovHold) return;
  camera.fov = earthRun.fovHold;
  camera.updateProjectionMatrix();
  earthRun.fovHold = 0;
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
  } else if (r.phase === 'skipout' || (r.phase === 'done' && r.lastFail === 'skipout')) {
    // Hang back at the old height and frame both Columbia climbing away and Earth's horizon below her
    const holdR = r.camHold.distanceTo(E);
    const tt = r.phase === 'skipout' ? r.t : 3.6;
    const lag = 0.035 + 0.17 * THREE.MathUtils.smoothstep(tt, 0, 1.6);
    camera.position.copy(r.entryStart).sub(E).applyAxisAngle(r.entryAxis, r.ang - lag).setLength(holdR).add(E);
    const camR = camera.position.distanceTo(E);
    // Earth's limb as seen from the camera: the tangent point ahead along the arc
    _look.copy(camera.position).sub(E).applyAxisAngle(r.entryAxis, Math.acos(Math.min(1, EARTH_R / camR))).setLength(EARTH_R).add(E)
      .sub(camera.position).normalize();
    _v.copy(pos).sub(camera.position).normalize();
    _look.multiplyScalar(0.7).add(_v).normalize().add(camera.position);
    if (!r.fovHold) { r.fovHold = camera.fov; }
    camera.fov = THREE.MathUtils.lerp(camera.fov, 70, 0.1);
    camera.updateProjectionMatrix();
    camera.up.copy(_w.copy(camera.position).sub(E).normalize());
    camera.lookAt(_look);
    return;
  }
  restoreFov();
  if (r.phase === 'entry' || r.phase === 'burnup' || r.phase === 'chutes' || r.phase === 'done') {
    back = 1.1; lift = 0.45;                     // close behind, Earth's horizon filling the view
  }
  // Follow exactly: Columbia moves far too fast near Earth for an eased camera to keep up
  _camPos.copy(pos).addScaledVector(fwd, -back).addScaledVector(up, lift);
  camera.position.copy(_camPos);
  if (r.phase === 'coast') _look.copy(pos).lerp(E, 0.25 + 0.5 * Math.min(1, r.t / COAST_SEC));
  else if (r.phase === 'tei') _look.copy(pos).addScaledVector(fwd, 1.2);
  else _look.copy(pos).addScaledVector(fwd, 3).addScaledVector(up, -0.6);   // a little down: the planet below
  if (r.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * r.shake;
    camera.position.y += (Math.random() - 0.5) * r.shake;
    camera.position.z += (Math.random() - 0.5) * r.shake;
  }
  camera.up.copy(up);
  camera.lookAt(_look);
}

function render() {
  const r = earthRun;
  const label = { tei: 'TRANS-EARTH INJECTION', coast: 'COASTING HOME', entry: 'RE-ENTRY', burnup: 'HEAT SHIELD FAILURE', skipout: 'SKIP-OUT', chutes: 'PARACHUTES', done: 'RECOVERY' }[r.phase] || '';
  $('earth-phase').textContent = label;
  const bar = $('earth-bar');
  const barRow = $('earth-bar-row');
  const corr = $('earth-corridor');
  const hint = $('earth-hint');
  barRow.classList.toggle('hidden', !(r.phase === 'tei' || r.phase === 'coast'));
  corr.classList.toggle('hidden', !(r.phase === 'entry' || r.phase === 'burnup' || r.phase === 'skipout'));
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
  } else if (r.phase === 'burnup') {
    hint.textContent = 'Came in too steep — the air is too thick, too fast';
  } else if (r.phase === 'skipout') {
    hint.textContent = 'Came in too shallow — bouncing back out to space';
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
