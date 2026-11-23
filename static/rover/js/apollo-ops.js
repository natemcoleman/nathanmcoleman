import * as THREE from 'three';
import { astro, toggleEVA } from './astro.js';
import { CSM_ORBIT_RADIUS, ELEV_GRID_H, ELEV_GRID_W, LANDER_FOOT_OFFSET, LANDER_SCALE, LANDMARKS, LUNAR_MU, MOON_RADIUS, MOON_REAL_KM, ROVER_WHEEL_OFFSET, SPEED_TO_MS } from './constants.js';
import { sound } from './audio.js';
import { camCtrl, csm, gameState, keys, lander, rover, terrainState, triggerSeismicEvent } from './state.js';
import { getDisplacementScale, getExactSurfaceHit, polarSmoothedGrid, getSurfaceNormalAtPosition, getSurfaceRadiusAtLatLon, getSurfaceRadiusAtPosition, latLonToVec3, sampleTerrainAtLatLon, vec3ToLatLon } from './coords.js';
import { camera, earthGroup, enginePlume, landerDescentGroup, landerGroup, laserBeam, moonMaterial, roverGroup, scene, spawnDustBurst, spawnParticle } from './scene.js';
import { setAutoSoftLand, toggleRoverDeployment, updateAssistButtonsUI, warpLanderToLandmark } from './modes.js';
import { _basisX, _rotMat, _shipFwd, _shipLeft, _shipUp, _targetQ, _terrainNorm, _tmpAxis, _tmpDeltaQ, computeLanderOrbitalElements } from './lander.js';
import { resetRoverDynamics, resetRoverStuntAccumulators, updateRoverStuntHUD } from './rover.js';
import { triggerLidarScan } from './scan.js';
import { showToast, triggerImpactFlash } from './hud.js';
import { hadleyRun, iceRun, stopHadleyRilleRun, stopSouthPoleIceRun } from './challenges.js';
import { inputSrc, toggleMap, ui } from './context-ui.js';
import { markFirst, save, scheduleSave, updateProgressCounts } from './save.js';
import { finds, openJournal, pingFinds, seatFindMarkers } from './finds.js';
import { inBoulderField, toggleProgradeHold, toggleRetroHold } from './apollo11.js';
import { a11RunActive, say } from './radio.js';
import { pointLight, setSRGB } from './three-compat.js';
import { backToMoon, earthAction } from './earth.js';

// =========================================================================
// 16. APOLLO OPERATIONS: STAGING, CRASHES, CSM RENDEZVOUS & DOCKING,
//     ALSEP SCIENCE STATIONS, SEISMOGRAPH & LOLA MAP OVERLAYS
// =========================================================================
export const SLOPE_HAZARD_DEG = 22;        // Touchdown on steeper terrain tips the LM
export const LANDER_CRASH_SPEED = 4.2;     // ~57 m/s vertical impact = structural failure
export const LANDER_CRASH_OFFAXIS = 1.8;   // Off-axis / tipping impact limit
export const ROVER_CRASH_SPEED = 5.2;      // Rover destroyed on enormous falls
const ASCENT_FOOT_OFFSET = -0.003;  // Ascent stage rests on its cabin floor
const CSM_PROBE_TIP = 2.04 * LANDER_SCALE * 1.65; // CSM docking probe tip ahead of CSM center
const LM_DROGUE_Y = 0.058;          // LM docking drogue height above lander origin
// Rendezvous propulsion. A full ascent tank is worth RDV_DV_FULL (u/s of Δv): about 3,200 m/s,
// roughly 1.6× a real LM ascent stage (~3,500 m/s), so ordinary rendezvous never run dry but big plane changes do.
export const RDV_DV_FULL = 26;
const RDV_ENGINE_ACC = 2.75;        // ascent engine acceleration cap (u/s²) — burns take visible time
const RDV_RCS_ACC = 0.7;            // terminal-approach thruster cap
const DOCK_STANDOFF = 0.9;          // Auto-approach hold point ahead of the probe
const DOCK_M_PER_UNIT = 47;         // Vehicle-scale metres per world unit for prox-ops readouts
const RCS_ACCEL = 0.04;             // Translation RCS (u/s²)
const RCS_ROT_ACCEL = 1.4;          // Attitude RCS (rad/s²)
const DOCK_MAX_CLOSING = 0.05;      // Capture limits
const DOCK_MAX_LATERAL = 0.03;
const DOCK_MAX_ALIGN_DEG = 10;
const DOCK_CRASH_CLOSING = 0.3;
export const PROX_RANGE = 30;              // K inside this range skips straight to terminal approach
export const ALSEP_MAX = 5;                // Apollo 12, 14, 15, 16 & 17 each left one
const ALSEP_SCALE = 0.032;
const ALSEP_LRRR_LOCAL = new THREE.Vector3(0.2, 0.25, 1.3).multiplyScalar(ALSEP_SCALE);

export function landerFootOffset() {
  return lander.ascentOnly ? ASCENT_FOOT_OFFSET : LANDER_FOOT_OFFSET;
}

// ---------------- Generic action dispatcher (keys + touch buttons) ----------------
export function handleAction(action) {
  if (!gameState.started) return;
  if (action === 'dock') rdvKey();
  else if (action === 'scan') triggerLidarScan();
  else if (action === 'rover') { if (astro.active) toggleEVA(); else toggleRoverDeployment(); }
  else if (action === 'eva') toggleEVA();
  else if (action === 'autoland') setAutoSoftLand(!gameState.autoSoftLand);
  else if (action === 'map') toggleMap();
  else if (action === 'atthold') toggleDockAttitudeHold();
  else if (action === 'selfright') {
    inputSrc.touch.lift = true;
    setTimeout(() => { inputSrc.touch.lift = false; }, 160);
  }
  else if (action === 'stage') performStageSeparation(false);
  else if (action === 'alsep') deployAlsep();
  else if (action === 'overlay') cycleOverlay();
  else if (action === 'ping') pingFinds();
  else if (action === 'retro') toggleRetroHold();
  else if (action === 'prograde') toggleProgradeHold();
  else if (action === 'gohome' || action === 'earthabort') earthAction(action);
  else if (action === 'earthmoon') backToMoon();
  else if (action === 'slopemap') applyOverlayMode(2, false);
  else if (action === 'journal') openJournal();
}

// ---------------- Ascent stage separation & parked descent stages ----------------
export const parkedStages = [];   // { group, lat, lon }
const fallingStages = [];  // { group, pos, vel, quat, angVel }
const _fsNorm = new THREE.Vector3();

export function makeDescentStageClone() {
  const g = new THREE.Group();
  const root = new THREE.Group();
  root.scale.setScalar(LANDER_SCALE);
  root.add(landerDescentGroup.clone());
  g.add(root);
  return g;
}

export function restoreFullLander() {
  lander.ascentOnly = false;
  if (landerDescentGroup) landerDescentGroup.visible = true;
  if (enginePlume) enginePlume.position.y = -1.12;
}

function performStageSeparation(fromRendezvous) {
  if (gameState.mode !== 'lander' || lander.crashed) {
    if (!fromRendezvous) showToast('Stage separation is a Lunar Module command — board the LM first', 'warn');
    return false;
  }
  if (rdv.active && !fromRendezvous) {
    showToast('Stage separation is locked out during rendezvous', 'warn');
    return false;
  }
  if (lander.ascentOnly) {
    if (!fromRendezvous) showToast('Already flying the Ascent Stage — warp to a site for a fresh LM', 'warn');
    return false;
  }
  _shipUp.set(0, 1, 0).applyQuaternion(lander.quat).normalize();
  const stage = makeDescentStageClone();
  stage.position.copy(lander.pos);
  stage.quaternion.copy(lander.quat);
  scene.add(stage);

  if (lander.isLanded) {
    const ll = vec3ToLatLon(lander.pos);
    parkedStages.push({ group: stage, lat: ll.lat, lon: ll.lon });
    markFirst('stage');
    say('staging');
    scheduleSave();
    lander.isLanded = false;
    lander.vel.addScaledVector(lander.up, 1.1);
    spawnDustBurst(lander.pos.clone().addScaledVector(lander.up, -LANDER_FOOT_OFFSET), lander.up, 16, 0.6);
    triggerSeismicEvent(0.22, lander.pos.clone());
    if (!fromRendezvous) showToast(`ASCENT STAGE LIFTOFF — Descent stage #${parkedStages.length} parked on the Moon for good`, 'gold');
  } else {
    fallingStages.push({
      group: stage,
      pos: lander.pos.clone(),
      vel: lander.vel.clone().addScaledVector(_shipUp, -0.45),
      quat: lander.quat.clone(),
      angVel: new THREE.Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.4)
    });
    lander.vel.addScaledVector(_shipUp, 0.6);
    showToast('ABORT STAGE — Descent stage jettisoned! Ascent engine firing', 'warn');
  }
  lander.ascentOnly = true;
  landerDescentGroup.visible = false;
  enginePlume.position.y = -0.62;
  lander.fuel = 100;
  lander.thrustIntensity = Math.max(lander.thrustIntensity, 0.8);
  sound.playStageSep();
  updateAssistButtonsUI();
  return true;
}

export function updateFallingStages(dt) {
  for (let i = fallingStages.length - 1; i >= 0; i--) {
    const f = fallingStages[i];
    const r = Math.max(10, f.pos.length());
    f.vel.addScaledVector(f.pos, -LUNAR_MU / (r * r * r) * dt);
    f.pos.addScaledVector(f.vel, dt);
    const sp = f.angVel.length();
    if (sp > 1e-5) {
      _tmpAxis.copy(f.angVel).divideScalar(sp);
      _tmpDeltaQ.setFromAxisAngle(_tmpAxis, sp * dt);
      f.quat.multiply(_tmpDeltaQ).normalize();
    }
    f.group.position.copy(f.pos);
    f.group.quaternion.copy(f.quat);
    const surfR = getExactSurfaceHit(f.pos, _fsNorm);
    if (f.pos.length() <= surfR + 0.03) {
      f.pos.setLength(surfR + 0.01);
      spawnExplosion(f.pos.clone(), _fsNorm, 0.8);
      scene.remove(f.group);
      fallingStages.splice(i, 1);
    } else if (f.pos.length() > 900) {
      scene.remove(f.group);
      fallingStages.splice(i, 1);
    }
  }
}

// Re-seat parked descent stages & ALSEP stations when the relief exaggeration changes
export function reseatSurfaceAssets() {
  parkedStages.forEach((p) => {
    const r = getSurfaceRadiusAtLatLon(p.lat, p.lon);
    latLonToVec3(p.lat, p.lon, r + LANDER_FOOT_OFFSET, p.group.position);
    const n = getSurfaceNormalAtPosition(p.group.position, new THREE.Vector3());
    p.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  });
  alsepStations.forEach(seatAlsep);
  if (finds.markers.size) seatFindMarkers();
}

// ---------------- Crash explosions ----------------
const explosions = [];
let explosionGeo = null;
let explosionRingGeo = null;

function spawnExplosion(pos, normal, scale = 1) {
  if (!explosionGeo) {
    explosionGeo = new THREE.SphereGeometry(1, 18, 12);
    explosionRingGeo = new THREE.RingGeometry(0.72, 1.0, 40);
  }
  const n = (normal ? normal.clone() : pos.clone()).normalize();
  const mk = (hex, op, side) => new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: op, depthWrite: false,
    blending: THREE.AdditiveBlending, side: side || THREE.FrontSide
  });
  const core = new THREE.Mesh(explosionGeo, mk(0xfff1b8, 1.0));
  const shell = new THREE.Mesh(explosionGeo, mk(0xff7a2f, 0.85));
  const ring = new THREE.Mesh(explosionRingGeo, mk(0xffb36b, 0.8, THREE.DoubleSide));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const light = pointLight(0xff9a3c, 3.5, 3.2 * scale, 1.6);
  light.userData.base = light.intensity;
  const group = new THREE.Group();
  group.position.copy(pos);
  group.add(core, shell, ring, light);
  scene.add(group);
  explosions.push({ group, core, shell, ring, light, t: 0, life: 1.3, scale });

  // Burning debris + ballistic regolith spray
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(n, ref).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const cols = [0xffd27a, 0xff8a3d, 0xf4d58d, 0x9ca3af, 0x6b7280];
  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2;
    const lift = 0.2 + Math.random() * 0.9;
    const spd = (0.5 + Math.random() * 1.7) * scale;
    const v = new THREE.Vector3()
      .addScaledVector(t1, Math.cos(a))
      .addScaledVector(t2, Math.sin(a))
      .addScaledVector(n, lift)
      .normalize()
      .multiplyScalar(spd);
    spawnParticle(pos.clone().addScaledVector(n, 0.01), v, cols[i % cols.length], 0.6 + Math.random() * 0.9);
  }
  spawnDustBurst(pos.clone(), n, 18, 0.9 * scale);
  sound.playExplosion();
  triggerSeismicEvent(Math.min(1, 0.65 * scale + 0.25), pos.clone());
  if (camera.position.distanceTo(pos) < 6 * scale) triggerImpactFlash();
}

export function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.t += dt;
    const k = e.t / e.life;
    if (k >= 1) {
      scene.remove(e.group);
      e.core.material.dispose();
      e.shell.material.dispose();
      e.ring.material.dispose();
      explosions.splice(i, 1);
      continue;
    }
    const ease = 1 - Math.pow(1 - k, 3);
    const s = e.scale;
    e.core.scale.setScalar(Math.max(0.001, s * (0.05 + 0.13 * ease) * (1 - k * 0.6)));
    e.core.material.opacity = Math.max(0, 1 - k * 1.7);
    e.shell.scale.setScalar(Math.max(0.001, s * 0.36 * ease));
    e.shell.material.opacity = 0.85 * (1 - k) * (1 - k);
    e.shell.material.color.setHex(k < 0.35 ? 0xff7a2f : 0x9a3412);
    e.ring.scale.setScalar(Math.max(0.001, s * 1.0 * ease));
    e.ring.material.opacity = 0.8 * (1 - k);
    e.light.intensity = e.light.userData.base * (1 - k) * (1 - k);
  }
}

export function crashLander(normal) {
  if (lander.crashed) return;
  if (!a11RunActive()) say('crash');
  spawnExplosion(lander.pos.clone(), normal, 1.0);
  lander.crashed = true;
  lander.crashTimer = 2.8;
  lander.isLanded = false;
  lander.vel.set(0, 0, 0);
  lander.angVel.set(0, 0, 0);
  lander.thrustIntensity = 0;
  landerGroup.visible = false;
  enginePlume.material.opacity = 0;
  laserBeam.visible = false;
  gameState.autoSoftLand = false;
  if (rdv.active) rdvEnd(true);
  sound.updateThruster(0, false);
  showToast('LM DESTROYED — Impact exceeded structural limits. Dispatching a new Lunar Module...', 'warn');
}

export function updateLanderCrash(dt) {
  if (!lander.crashed) return false;
  lander.crashTimer -= dt;
  sound.updateThruster(0, false);
  if (lander.crashTimer <= 0) {
    lander.crashed = false;
    const lm = LANDMARKS.find((l) => l.id === gameState.targetLandmarkId) || LANDMARKS[0];
    warpLanderToLandmark(lm, gameState.mode === 'lander');
  }
  return true;
}

export function crashRover(normal) {
  if (rover.crashed) return;
  spawnExplosion(rover.pos.clone(), normal, 0.45);
  rover.crashed = true;
  rover.crashTimer = 2.2;
  roverGroup.visible = false;
  rover.vel.set(0, 0, 0);
  rover.angVel.set(0, 0, 0);
  rover.stunt.bannerTimer = 0;
  resetRoverStuntAccumulators();
  showToast('LRV DESTROYED — Massive impact! Rolling out a spare rover...', 'warn');
}

export function updateRoverCrash(dt) {
  if (!rover.crashed) return false;
  rover.crashTimer -= dt;
  rover.speed = 0;
  sound.updateThruster(0, false);
  updateRoverStuntHUD(dt);
  if (rover.crashTimer <= 0) {
    rover.crashed = false;
    const fwd = rover.forward.clone();
    resetRoverDynamics();
    const surfR = getSurfaceRadiusAtPosition(rover.pos);
    rover.pos.setLength(surfR + ROVER_WHEEL_OFFSET + 0.004);
    rover.up.copy(rover.pos).normalize();
    const n = getSurfaceNormalAtPosition(rover.pos, new THREE.Vector3());
    rover.forward.copy(fwd).addScaledVector(n, -fwd.dot(n));
    if (rover.forward.lengthSq() < 1e-6) rover.forward.crossVectors(new THREE.Vector3(0, 1, 0), n);
    rover.forward.normalize();
    rover.right.crossVectors(n, rover.forward).normalize();
    _basisX.crossVectors(n, rover.forward).normalize();
    _rotMat.makeBasis(_basisX, n, rover.forward);
    rover.quat.setFromRotationMatrix(_rotMat).normalize();
    roverGroup.position.copy(rover.pos);
    roverGroup.quaternion.copy(rover.quat);
    roverGroup.visible = true;
    showToast('Spare LRV ready — drive carefully!', 'sage');
  }
  return true;
}

// ---------------- Hohmann rendezvous & 6-DOF RCS docking with CSM Columbia ----------------
export const rdv = {
  active: false,
  phase: 'idle',   // ascent → plane → phasing → coast → approach → manual → docked
  warp: 1,
  timer: 0,
  r1: 105,
  transferA: 0,
  transferT: 0,
  prevVr: 0,
  prevDiff: 0,
  info: '',
  thrust: 0,
  attHold: true,
  dockedOnce: false,
  contactCooldown: 0,
  rel: new THREE.Vector3(),      // LM origin relative to CSM center, CSM LVLH frame (x = side, y = radial up, z = prograde)
  relVel: new THREE.Vector3(),
  relQ: new THREE.Quaternion(),  // LM attitude expressed in the LVLH frame
  port: new THREE.Vector3(),     // LM drogue relative to CSM center (LVLH)
  along: 0,
  lateral: 0,
  alignDeg: 0,
  closing: 0
};
const _rS = new THREE.Vector3();
const _rU = new THREE.Vector3();
const _rF = new THREE.Vector3();
const _rFrameQ = new THREE.Quaternion();
const _rFrameInv = new THREE.Quaternion();
const _rMat = new THREE.Matrix4();
const _rHat = new THREE.Vector3();
const _rN = new THREE.Vector3();
const _rT = new THREE.Vector3();
const _rH = new THREE.Vector3();
const _rA = new THREE.Vector3();
const _rTmp = new THREE.Vector3();
const _rTmp2 = new THREE.Vector3();
const _rLmY = new THREE.Vector3();
const _rQ = new THREE.Quaternion();
// LM docking attitude in LVLH: LM +Y (drogue) faces back down −F toward the CSM probe, LM +Z (windows) faces radial up
const DOCK_Q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _Y = new THREE.Vector3(0, 1, 0);

function csmFrame() {
  _rU.copy(csm.pos).normalize();
  _rF.copy(csm.vel).addScaledVector(_rU, -csm.vel.dot(_rU)).normalize();
  _rS.crossVectors(_rU, _rF).normalize(); // = CSM orbit normal
  _rMat.makeBasis(_rS, _rU, _rF);
  _rFrameQ.setFromRotationMatrix(_rMat).normalize();
  _rFrameInv.copy(_rFrameQ).conjugate();
}

function toLVLH(v, out) { return out.set(v.dot(_rS), v.dot(_rU), v.dot(_rF)); }
function fromLVLH(l, out) { return out.copy(_rS).multiplyScalar(l.x).addScaledVector(_rU, l.y).addScaledVector(_rF, l.z); }

// Ω × x for Columbia's orbital rotation (the LVLH frame rotates once per CSM orbit)
const _rOm = new THREE.Vector3();
function omegaCross(x, out) {
  return out.crossVectors(_rS, x).multiplyScalar(csm.omega);
}

function anyPerp(v, out) {
  out.crossVectors(v, Math.abs(v.y) < 0.9 ? _Y : new THREE.Vector3(1, 0, 0));
  return out.normalize();
}

function rdvKey() {
  if (rdv.pendingPlan) { closeRdvPlan(); return; }
  if (!rdv.active) { rdvStart(); return; }
  if (rdv.phase === 'docked') {
    rdv.phase = 'manual';
    rdv.relVel.set(0, 0, 0.035);
    rdv.contactCooldown = 1.5;
    lander.docked = false;
    sound.playStageSep();
    showToast((ui.touch ? 'Undocked — backing away · tap Release to fly free' : 'UNDOCKED — RCS backing away from Columbia · [K] again to release to free flight'), 'sage');
    updateAssistButtonsUI();
    return;
  }
  rdvEnd(false);
}

// ---------------- Launch planning: can we reach Columbia from here, and when should we lift off? ----------------
// Measured from the guidance itself (see tools/rover tests): a powered ascent takes about RDV_ASC_TIME s of game time,
// carries the LM RDV_ASC_ANGLE radians downrange and burns about RDV_DV_ASCENT u/s.
const RDV_ASC_TIME = 7.3;
const RDV_ASC_ANGLE = 0.51;
const RDV_DV_ASCENT = 14.5;
const RDV_DV_MARGIN = 2.5;          // Hohmann transfer + terminal approach + reserve
const RDV_WINDOW_MARGIN = 0.08;     // aim to reach the transfer point just before the ideal moment (rad)

// Plane through this point that is closest to Columbia's orbital plane (normal = Columbia's normal, levelled)
function ascentPlaneNormal(pos, out) {
  _rTmp.copy(pos).normalize();
  out.copy(_rS).addScaledVector(_rTmp, -_rS.dot(_rTmp));
  if (out.lengthSq() < 1e-6) anyPerp(_rTmp, out); else out.normalize();
  return out;
}

function csmDirAt(angle, out) {
  const inc = Math.sin(csm.inclination);
  return out.set(Math.cos(angle), Math.sin(angle) * inc, -Math.sin(angle)).normalize();
}

// Signed angle from a to b about axis (−π…π)
function angleAbout(a, b, axis) {
  return Math.atan2(_rTmp2.crossVectors(a, b).dot(axis), a.dot(b));
}

const TWO_PI = Math.PI * 2;
const mod2pi = (x) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

export function planRendezvous() {
  csmFrame();
  const scale = getDisplacementScale();
  const r1 = THREE.MathUtils.clamp(MOON_RADIUS + scale * 0.5 + 1.6, 105, 111.5);
  const p = lander.pos.clone().normalize();
  const N = ascentPlaneNormal(lander.pos, new THREE.Vector3());
  const offPlane = Math.asin(THREE.MathUtils.clamp(Math.abs(p.dot(_rS)), 0, 1));   // angular distance from Columbia's plane
  const vc1 = Math.sqrt(LUNAR_MU / r1);
  const dvPlane = offPlane > THREE.MathUtils.degToRad(0.6) ? 2 * vc1 * Math.sin(offPlane / 2) : 0;
  const fromSurface = lander.isLanded;
  const dvNeed = (fromSurface ? RDV_DV_ASCENT : RDV_DV_ASCENT * 0.6) + dvPlane + RDV_DV_MARGIN;
  const dvHave = (fromSurface && !lander.ascentOnly) ? RDV_DV_FULL : rdvDvLeft();
  // Largest plane offset this tank can fix, and which way to go to get under Columbia's orbit
  const spare = dvHave - (dvNeed - dvPlane);
  const maxOff = spare <= 0 ? 0 : 2 * Math.asin(Math.min(1, spare / (2 * vc1)));
  const towardSouth = p.dot(_rS) * _rS.y > 0;

  // Timing: where will the LM reach Columbia's plane, and where will Columbia be then?
  const pIns = p.clone().applyAxisAngle(N, RDV_ASC_ANGLE);
  const tIns = new THREE.Vector3().crossVectors(N, pIns).normalize();
  let alpha = 0;
  if (dvPlane > 0) { alpha = Math.atan2(-pIns.dot(_rS), tIns.dot(_rS)); if (alpha < 0) alpha += Math.PI; }
  const n1 = Math.sqrt(LUNAR_MU / (r1 * r1 * r1));
  const tPre = RDV_ASC_TIME + alpha / n1 + dvPlane / RDV_ENGINE_ACC / 2;
  const xNode = pIns.clone().applyAxisAngle(N, alpha);
  const cThen = csmDirAt(csm.angle + csm.omega * tPre, new THREE.Vector3());
  const lead = angleAbout(xNode, cThen, _rS);
  const r2 = CSM_ORBIT_RADIUS;
  const aT = (r1 + r2) / 2;
  const tH = Math.PI * Math.sqrt(aT * aT * aT / LUNAR_MU);
  const leadReq = Math.PI - csm.omega * tH;
  const rate = n1 - csm.omega;
  const diff = mod2pi(lead - leadReq);
  const orbitWait = diff / rate;                                    // catching up in orbit (LM gains slowly)
  const surfaceWait = mod2pi(RDV_WINDOW_MARGIN - diff) / csm.omega; // waiting on the ground (Columbia comes round fast)
  const leadNow = mod2pi(angleAbout(p, _rTmp.copy(csm.pos).normalize(), _rS));
  const leadAtLiftoff = mod2pi(leadNow + csm.omega * surfaceWait);
  return {
    r1, offPlaneDeg: THREE.MathUtils.radToDeg(offPlane), maxOffDeg: THREE.MathUtils.radToDeg(maxOff),
    dvPlane, dvNeed, dvHave, ok: dvNeed <= dvHave, towardSouth,
    moveKm: Math.max(0, offPlane - maxOff + THREE.MathUtils.degToRad(1.5)) * MOON_REAL_KM,
    orbitWait, surfaceWait, leadNowDeg: THREE.MathUtils.radToDeg(leadNow), leadAtLiftoffDeg: THREE.MathUtils.radToDeg(leadAtLiftoff),
    goodNow: orbitWait < 25 || surfaceWait < 2 || orbitWait <= surfaceWait + 10,
  };
}

const ms = (dv) => `${Math.round(dv * SPEED_TO_MS).toLocaleString()} m/s`;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

function rdvPlanModal(plan) {
  const m = document.getElementById('rdv-plan-modal');
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  if (!plan.ok) {
    $('rdv-plan-badge').textContent = 'OUT OF REACH';
    $('rdv-plan-title').textContent = 'Columbia’s orbit is too far away';
    $('rdv-plan-stats').innerHTML =
      `You are ${plan.offPlaneDeg.toFixed(0)}° from Columbia’s orbital plane · plane change ${ms(plan.dvPlane)}<br>` +
      `Rendezvous needs ${ms(plan.dvNeed)} · your ascent stage has ${ms(plan.dvHave)}`;
    $('rdv-plan-body').innerHTML = plan.maxOffDeg > 0.5
      ? `Columbia orbits close to the equator. Tilting an orbit is one of the most expensive moves in spaceflight, which is why real missions placed the command module’s orbit right over the landing site. Your tank can fix about <strong class="text-white">${plan.maxOffDeg.toFixed(0)}°</strong>. Fly about <strong class="text-white">${Math.round(plan.moveKm / 10) * 10} km ${plan.towardSouth ? 'south' : 'north'}</strong>, toward the equator, and try again — or warp to a site near the equator.`
      : `There isn’t enough propellant left to reach orbit and catch Columbia. Warp to a site for a fresh Lunar Module.`;
    show('rdv-plan-wait', false); show('rdv-plan-now', false); show('rdv-plan-map', true);
    $('rdv-plan-cancel').textContent = 'OK';
  } else {
    $('rdv-plan-badge').textContent = 'LAUNCH WINDOW';
    $('rdv-plan-title').textContent = `Columbia overhead in ${mmss(plan.surfaceWait)}`;
    $('rdv-plan-stats').innerHTML =
      `Columbia is ${plan.leadNowDeg.toFixed(0)}° ahead · ideal at liftoff: ${plan.leadAtLiftoffDeg.toFixed(0)}°` +
      (plan.dvPlane > 0 ? `<br>Plane change ${plan.offPlaneDeg.toFixed(1)}° · ${ms(plan.dvPlane)}` : '') +
      `<br>Δv needed ${ms(plan.dvNeed)} of ${ms(plan.dvHave)}`;
    $('rdv-plan-body').innerHTML =
      `Apollo crews didn’t launch whenever they liked: they lifted off when Columbia was the right distance ahead, so one short transfer brought them together. ` +
      `Waiting on the ground works fast because Columbia laps the Moon once a minute here. Launch now and you’ll spend about <strong class="text-white">${mmss(plan.orbitWait)}</strong> slowly catching up in orbit instead (sped up).`;
    $('rdv-plan-wait').textContent = `Wait for window (${mmss(plan.surfaceWait)})`;
    show('rdv-plan-wait', true); show('rdv-plan-now', true); show('rdv-plan-map', false);
    $('rdv-plan-cancel').textContent = 'Cancel';
  }
  rdv.pendingPlan = plan;
  m.classList.remove('hidden');
}

function closeRdvPlan() {
  document.getElementById('rdv-plan-modal').classList.add('hidden');
  rdv.pendingPlan = null;
}

export function bindRdvPlan() {
  const $ = (id) => document.getElementById(id);
  $('rdv-plan-cancel').addEventListener('click', closeRdvPlan);
  $('rdv-plan-now').addEventListener('click', () => { closeRdvPlan(); armRendezvous('now'); });
  $('rdv-plan-wait').addEventListener('click', () => { const pl = rdv.pendingPlan; closeRdvPlan(); armRendezvous('wait', pl); });
  $('rdv-plan-map').addEventListener('click', () => { closeRdvPlan(); toggleMap(); });
}

function rdvStart() {
  if (gameState.mode !== 'lander' || lander.crashed) {
    showToast('Rendezvous with Columbia is flown from the Lunar Module — board the LM first', 'warn');
    return;
  }
  // Straight to terminal approach only when already up in orbit near Columbia (not hovering under her)
  const vOrb = Math.sqrt(LUNAR_MU / lander.pos.length());
  const inOrbit = lander.pos.length() > MOON_RADIUS + 5 && lander.vel.length() > vOrb * 0.75;
  if (!lander.isLanded && inOrbit && lander.pos.distanceTo(csm.pos) < PROX_RANGE) { armRendezvous('approach'); return; }
  const plan = planRendezvous();
  if (!plan.ok) { rdvPlanModal(plan); sound.playPing(420, 0.12); return; }
  if (!lander.isLanded || plan.goodNow) {
    if (lander.isLanded) showToast('Good timing — Columbia is in the launch window', 'sage');
    armRendezvous('now');
    return;
  }
  rdvPlanModal(plan);
}

function armRendezvous(mode, plan) {
  if (hadleyRun.active) stopHadleyRilleRun(true);
  if (iceRun.active) stopSouthPoleIceRun(true);
  gameState.autoSoftLand = false;
  say('rendezvous');
  rdv.active = true;
  rdv.warp = 1;
  rdv.warpTarget = 1;
  rdv.aimDir = null;
  rdv.ascN = null;
  rdv.attHold = true;
  rdv.thrust = 0;
  lander.docked = false;
  camCtrl.landerCamOffset = null;
  const scale = getDisplacementScale();
  rdv.r1 = THREE.MathUtils.clamp(MOON_RADIUS + scale * 0.5 + 1.6, 105, 111.5);

  if (mode === 'approach') {
    rdvSetPhase('approach');
    showToast((ui.touch ? 'Columbia in range — guidance is flying the approach' : 'Columbia in range — terminal approach guidance engaged · [K] abort'), 'sage');
  } else if (mode === 'wait') {
    rdvSetPhase('window');
    rdv.windowT = plan.surfaceWait;
    showToast(`Holding on the surface for the launch window · liftoff in ${mmss(plan.surfaceWait)}`, 'sage');
  } else {
    beginAscent();
  }
  document.getElementById('dock-hud').classList.remove('hidden');
  sound.playPing(700, 0.14);
  setTimeout(() => sound.playPing(940, 0.16), 100);
  updateAssistButtonsUI();
}

function beginAscent() {
  if (lander.isLanded && !lander.ascentOnly) performStageSeparation(true);
  lander.isLanded = false;
  rdv.ascN = null;
  rdvSetPhase('ascent');
  showToast((ui.touch ? 'Liftoff — climbing to orbit, then a transfer to Columbia' : 'LIFTOFF — Powered ascent to parking orbit, then Hohmann transfer to Columbia · [K] abort'), 'sage');
}

function rdvSetPhase(p) {
  rdv.phase = p;
  rdv.timer = 0;
  rdv.prevVr = 0;
  rdv.prevDiff = 0;
  rdv.burning = false;
  if (p === 'approach' || p === 'manual' || p === 'docked') { rdv.warp = 1; rdv.warpTarget = 1; }
  camCtrl.landerCamOffset = null;
  updateAssistButtonsUI();
}

export function rdvEnd(silent) {
  if (!rdv.active) return;
  rdv.active = false;
  rdv.phase = 'idle';
  rdv.warp = 1;
  rdv.warpTarget = 1;
  rdv.aimDir = null;
  lander.docked = false;
  camCtrl.chaseYaw = 0;
  camCtrl.landerHeading = null;
  gameState.hoverAssist = false;  // Keep the orbit: no hover thrust fighting Newtonian coasting
  gameState.autoGyro = true;
  camCtrl.landerCamOffset = null;
  document.getElementById('dock-hud').classList.add('hidden');
  updateAssistButtonsUI();
  if (!silent) showToast('Guidance released — Free Newtonian coasting (Hover OFF)', 'gold');
}

export function toggleDockAttitudeHold() {
  rdv.attHold = !rdv.attHold;
  showToast(rdv.attHold ? 'RCS ATTITUDE HOLD ON — auto-aligning drogue to probe' : 'ATTITUDE HOLD OFF — full manual 6-DOF (↑↓←→ pitch/yaw · Q/Z roll)', rdv.attHold ? 'sage' : 'gold');
  sound.playPing(rdv.attHold ? 660 : 480, 0.1);
}

// Slerp the LM so its +Y axis follows a thrust direction, windows toward a reference
export function aimLanderAlong(dir, ref, rate, dt) {
  _rTmp.copy(dir).normalize();
  _rTmp2.copy(ref).addScaledVector(_rTmp, -ref.dot(_rTmp));
  if (_rTmp2.lengthSq() < 1e-6) anyPerp(_rTmp, _rTmp2); else _rTmp2.normalize();
  _basisX.crossVectors(_rTmp, _rTmp2).normalize();
  _rotMat.makeBasis(_basisX, _rTmp, _rTmp2);
  _targetQ.setFromRotationMatrix(_rotMat).normalize();
  let t = Math.min(1, dt * rate);
  // During a rendezvous, never slew faster than ~90° per second of real (on-screen) time,
  // even under time warp: big attitude changes swing round smoothly instead of snapping
  if (rdv.active) {
    const q = lander.quat;
    const dot = Math.min(1, Math.abs(q.x * _targetQ.x + q.y * _targetQ.y + q.z * _targetQ.z + q.w * _targetQ.w));
    const ang = 2 * Math.acos(dot);
    const maxStep = (Math.PI / 2) * dt / Math.max(1, rdv.warp);
    if (ang * t > maxStep && ang > 1e-6) t = maxStep / ang;
  }
  lander.quat.slerp(_targetQ, t).normalize();
}

// Spend ascent propellant for a Δv (u/s). Returns false when the tank is empty.
function spendDv(dv) {
  lander.fuel = Math.max(0, lander.fuel - Math.abs(dv) * 100 / RDV_DV_FULL);
  if (lander.fuel <= 0 && rdv.active && rdv.phase !== 'manual' && rdv.phase !== 'docked') {
    rdvEnd(true);
    showToast('OUT OF PROPELLANT — the ascent stage is coasting. Guidance off', 'warn');
    return false;
  }
  return true;
}
export const rdvDvLeft = () => lander.fuel / 100 * RDV_DV_FULL;

// Finite burn toward a target velocity at the engine's acceleration. Returns the Δv still to go.
function burnToward(target, dt) {
  _rBurn.copy(target).sub(lander.vel);
  const left = _rBurn.length();
  const step = Math.min(left, RDV_ENGINE_ACC * dt);
  if (step > 0) {
    lander.vel.addScaledVector(_rBurn, step / left);
    rdv.thrust = 1;
    if (!spendDv(step)) return 0;
    // Point the engine along the burn
    aimLanderAlong(_rBurn, _rHat, 2.5, dt);
  }
  return left - step;
}
const _rBurn = new THREE.Vector3();

function fmtSec(t) {
  if (!Number.isFinite(t)) return '--';
  if (t >= 60) return `${Math.floor(t / 60)}m ${Math.round(t % 60)}s`;
  return `${t.toFixed(t < 10 ? 1 : 0)}s`;
}
const toKm = (u) => u * (MOON_REAL_KM / MOON_RADIUS);

export function updateRendezvous(dt) {
  rdv.timer += dt;
  rdv.thrust = 0;
  csmFrame();
  const p = rdv.phase;
  if (p === 'window') { updateLaunchWindow(dt); return; }   // still sitting on the pad: normal landed state
  if (p === 'manual' || p === 'docked') {
    updateProxOps(dt);
  } else {
    updateRendezvousNewtonian(dt);
  }
  finalizeRendezvousFrame(dt);
}

// Sitting on the pad while Columbia comes round (time sped up)
function updateLaunchWindow(dt) {
  rdv.windowT -= dt;
  lander.vel.set(0, 0, 0);
  rdv.warpTarget = THREE.MathUtils.clamp(rdv.windowT / 0.8, 1, 30);
  csmFrame();
  const lead = mod2pi(angleAbout(_rTmp.copy(lander.pos).normalize(), _rTmp3.copy(csm.pos).normalize(), _rS));
  rdv.info = `Launch window · liftoff in ${fmtSec(Math.max(0, rdv.windowT))} · Columbia ${THREE.MathUtils.radToDeg(lead).toFixed(0)}° ahead`;
  if (rdv.windowT <= 0) { rdv.warp = 1; rdv.warpTarget = 1; beginAscent(); }
}
const _rTmp3 = new THREE.Vector3();

function updateRendezvousNewtonian(dt) {
  const r = Math.max(10, lander.pos.length());
  _rHat.copy(lander.pos).divideScalar(r);
  const g = LUNAR_MU / (r * r);
  const v = lander.vel;
  _rA.set(0, 0, 0);

  if (rdv.phase === 'ascent') {
    // Target plane: locked at liftoff to the plane through the site closest to Columbia's orbit.
    // (Recomputing it every frame made the target plane swing as the LM climbed, so the ascent never settled.)
    if (!rdv.ascN) rdv.ascN = ascentPlaneNormal(lander.pos, new THREE.Vector3());
    _rN.copy(rdv.ascN);
    _rT.crossVectors(_rN, _rHat).normalize();
    const vr = v.dot(_rHat), vt = v.dot(_rT), vn = v.dot(_rN);
    const surfR = getExactSurfaceHit(lander.pos, null);
    const clearance = r - surfR;
    const vc1 = Math.sqrt(LUNAR_MU / rdv.r1);
    const vrDes = THREE.MathUtils.clamp((rdv.r1 - r) * 0.55, -1.2, 3.2);
    const aR = THREE.MathUtils.clamp(g - (vt * vt) / r + (vrDes - vr) * 2.2, -2, 8);
    const aT = clearance > 0.6 ? THREE.MathUtils.clamp((vc1 - vt) * 0.9, -3, 4.5) : 0;
    const aN = THREE.MathUtils.clamp(-vn * 1.6, -2.5, 2.5);
    _rA.copy(_rHat).multiplyScalar(aR).addScaledVector(_rT, aT).addScaledVector(_rN, aN);
    if (_rA.length() > RDV_ENGINE_ACC) _rA.setLength(RDV_ENGINE_ACC);   // ~1.7 lunar g
    v.addScaledVector(_rA, dt).addScaledVector(_rHat, -g * dt);
    if (!spendDv(_rA.length() * dt)) return;
    lander.pos.addScaledVector(v, dt);
    rdv.thrust = Math.min(1, _rA.length() / RDV_ENGINE_ACC);
    // Point along a smoothed thrust direction so guidance corrections don't whip the LM around
    if (!rdv.aimDir) rdv.aimDir = _rHat.clone();
    rdv.aimDir.lerp(_rA.lengthSq() > 0.04 ? _rTmp.copy(_rA).normalize() : _rHat, Math.min(1, dt * 1.5)).normalize();
    aimLanderAlong(rdv.aimDir, _rT, 1.8, dt);
    rdv.info = `Powered ascent → ${toKm(rdv.r1 - MOON_RADIUS).toFixed(0)} km parking orbit · ${(vt * SPEED_TO_MS).toFixed(0)} / ${(vc1 * SPEED_TO_MS).toFixed(0)} m/s`;
    const done = Math.abs(r - rdv.r1) < 0.5 && Math.abs(vr) < 0.2 && Math.abs(vt - vc1) < 0.2 && Math.abs(vn) < 0.15;
    if ((done && rdv.timer > 2) || rdv.timer > 60) {
      rdv.ascentTime = rdv.timer;
      v.copy(_rT).multiplyScalar(Math.sqrt(LUNAR_MU / r));
      rdvSetPhase('plane');
      showToast('PARKING ORBIT ACHIEVED — Coasting to the node for plane alignment', 'sage');
      sound.playPing(820, 0.12);
    }
    return;
  }

  // Unpowered coasting under inverse-square gravity
  v.addScaledVector(_rHat, -g * dt);
  lander.pos.addScaledVector(v, dt);
  const rr = lander.pos.length();
  _rHat.copy(lander.pos).divideScalar(rr);
  _rH.crossVectors(lander.pos, v).normalize();       // LM orbit normal
  _rT.crossVectors(_rH, _rHat).normalize();           // LM prograde
  const vr = v.dot(_rHat);
  const vt = v.dot(_rT);
  // Coasting: hold attitude level with the horizon, nose along the orbit (otherwise the LM stays fixed
  // in space while orbiting under time warp, and looks like it's tumbling)
  if (rdv.phase !== 'approach') aimLanderAlong(_rHat, _rT, 3.0, dt);

  if (rdv.phase === 'plane') {
    const incDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_rH.dot(_rS), -1, 1)));
    const nodeDist = _rHat.dot(_rS);  // 0 when crossing Columbia's orbital plane
    const omega = vt / rr;
    const tNode = Math.abs(Math.asin(THREE.MathUtils.clamp(nodeDist, -1, 1))) / Math.max(1e-4, omega);
    // Plane change Δv = 2 v sin(Δi/2); the burn is centred on the node, so it starts half a burn early
    const dvPlane = 2 * vt * Math.sin(THREE.MathUtils.degToRad(incDeg) / 2);
    const tLead = dvPlane / RDV_ENGINE_ACC / 2;
    if (rdv.burning) {
      _rT.crossVectors(_rS, _rHat).normalize();
      const left = burnToward(_rTmp.copy(_rT).multiplyScalar(Math.sqrt(LUNAR_MU / rr)), dt);
      rdv.warpTarget = 1;
      rdv.info = `Plane change burn · ${(left * SPEED_TO_MS).toFixed(0)} m/s to go`;
      if (!rdv.active) return;
      if (left < 0.01) {
        rdv.burning = false;
        rdvSetPhase('phasing');
        showToast(`PLANE CHANGE BURN — ${rdv.planeDeg.toFixed(1)}° corrected · now coplanar with Columbia`, 'sage');
        sound.playPing(760, 0.12);
      }
      return;
    }
    rdv.warpTarget = incDeg < 0.6 ? 1 : THREE.MathUtils.clamp((tNode - tLead) / 1.0, 1, 60);
    rdv.info = `Plane mismatch ${incDeg.toFixed(1)}° · burn ${(dvPlane * SPEED_TO_MS).toFixed(0)} m/s at the node in ${fmtSec(Math.max(0, tNode - tLead))}`;
    const crossed = rdv.timer > dt * 1.5 && Math.sign(nodeDist) !== Math.sign(rdv.prevDiff || nodeDist);
    rdv.prevDiff = nodeDist;
    if (incDeg < 0.6) { rdvSetPhase('phasing'); return; }
    if (crossed || tNode <= tLead || Math.abs(nodeDist) < 0.0015) {
      rdv.burning = true;
      rdv.planeDeg = incDeg;
      rdv.warp = 1;
      sound.playPing(700, 0.12);
    }
    return;
  }

  if (rdv.phase === 'phasing') {
    _rTmp.copy(csm.pos).normalize();
    const theta = Math.atan2(_rTmp2.crossVectors(_rHat, _rTmp).dot(_rH), _rHat.dot(_rTmp)); // CSM lead angle
    const r2 = csm.pos.length();
    const a = (rr + r2) * 0.5;
    const tH = Math.PI * Math.sqrt((a * a * a) / LUNAR_MU);
    const thetaReq = Math.PI - csm.omega * tH;
    const rate = Math.sqrt(LUNAR_MU / (rr * rr * rr)) - csm.omega;
    const diff = (((theta - thetaReq) % TWO_PI) + TWO_PI) % TWO_PI;
    const wait = diff / Math.max(1e-5, rate);
    const vPeri = Math.sqrt(LUNAR_MU * (2 / rr - 1 / a));
    rdv.warpTarget = THREE.MathUtils.clamp(wait / 1.0, 1, 150);
    rdv.info = `Phasing · Columbia leads ${THREE.MathUtils.radToDeg(theta).toFixed(1)}° (need ${THREE.MathUtils.radToDeg(thetaReq).toFixed(1)}°) · TIG ${fmtSec(wait)} · Δv ${((vPeri - vt) * SPEED_TO_MS).toFixed(0)} m/s`;
    const wrapped = rdv.timer > dt * 1.5 && rdv.prevDiff < 0.6 && diff > TWO_PI - 0.6;
    // Arrived just after the ideal moment (a degree or two late): burn now instead of waiting a whole lap
    const justMissed = rdv.timer < dt * 2.5 && diff > TWO_PI - 0.09;
    if (rdv.timer < dt * 1.5) rdv.dbgDiff = diff > Math.PI ? diff - TWO_PI : diff;   // timing error on arrival (tests)
    rdv.prevDiff = diff;
    if (diff < rate * dt * 1.5 + 1e-4 || wrapped || justMissed) {
      spendDv(vPeri - vt);
      if (!rdv.active) return;
      v.copy(_rT).multiplyScalar(vPeri);
      rdv.transferA = a;
      rdv.transferT = tH;
      rdv.thrust = 1;
      rdvSetPhase('coast');
      showToast(`TPI BURN — Hohmann transfer injection +${((vPeri - vt) * SPEED_TO_MS).toFixed(0)} m/s · coasting to apolune`, 'sage');
      sound.playPing(880, 0.14);
    }
    return;
  }

  if (rdv.phase === 'coast') {
    const remaining = rdv.transferT - rdv.timer;
    rdv.warpTarget = THREE.MathUtils.clamp(remaining / 1.0, 1, 40);
    rdv.info = `Hohmann transfer coast · apolune ${toKm(csm.pos.length() - MOON_RADIUS).toFixed(0)} km in ${fmtSec(Math.max(0, remaining))} · range ${toKm(lander.pos.distanceTo(csm.pos)).toFixed(0)} km`;
    const atApo = rdv.prevVr > 0 && vr <= 0 && rdv.timer > rdv.transferT * 0.5;
    rdv.prevVr = vr;
    if (atApo || rdv.timer > rdv.transferT * 1.2) {
      spendDv(Math.sqrt(LUNAR_MU / rr) - vt);
      if (!rdv.active) return;
      v.copy(_rT).multiplyScalar(Math.sqrt(LUNAR_MU / rr));
      rdv.thrust = 1;
      rdvSetPhase('approach');
      showToast(`CIRCULARIZATION BURN — Matched Columbia's orbit · range ${toKm(lander.pos.distanceTo(csm.pos)).toFixed(1)} km · terminal approach`, 'sage');
      sound.playPing(940, 0.14);
    }
    return;
  }

  // 'approach': closed-loop terminal guidance to the standoff point on the probe axis
  // (feed-forward Columbia's own gravity so only the relative motion is controlled)
  const lmOriginStandoff = CSM_PROBE_TIP + DOCK_STANDOFF + LM_DROGUE_Y;
  _rTmp.copy(csm.pos).addScaledVector(_rF, lmOriginStandoff);       // target LM origin
  _rTmp2.copy(_rTmp).sub(lander.pos);                              // error vector
  const d = _rTmp2.length();
  // Velocity relative to the (rotating) hold point, not Columbia's centre
  omegaCross(_rOm.copy(_rF).multiplyScalar(lmOriginStandoff), _rOm);
  const vRel = _rA.copy(v).sub(csm.vel).sub(_rOm);
  const vMax = d > 8 ? 3.2 : 1.8;   // ~430 / 240 m/s closing: fast enough to be quick, slow enough to follow
  const vDesMag = Math.min(vMax, Math.sqrt(2 * 2.0 * d) * 0.7, 0.55 * d); // braking-limited, linear near the hold point
  const vDes = _rN.copy(_rTmp2).multiplyScalar(d > 1e-6 ? vDesMag / d : 0);
  const aCmd = vDes.sub(vRel).multiplyScalar(1.6);
  if (aCmd.length() > RDV_RCS_ACC) aCmd.setLength(RDV_RCS_ACC);
  // Undo the gravity applied above and replace it with Columbia's (relative frame stays inertial-consistent)
  const rc = csm.pos.length();
  v.addScaledVector(_rHat, g * dt).addScaledVector(csm.pos, -LUNAR_MU / (rc * rc * rc) * dt);
  v.addScaledVector(aCmd, dt);
  if (!spendDv(aCmd.length() * dt)) return;
  // Terrain keep-out for long-range approaches
  const minR = MOON_RADIUS + getDisplacementScale() * 0.6 + 1.5;
  if (rr < minR) {
    v.addScaledVector(_rHat, (minR - rr) * 4 * dt);
    const vIn = v.dot(_rHat);
    if (vIn < 0) v.addScaledVector(_rHat, -vIn * Math.min(1, 6 * dt));
  }
  rdv.thrust = Math.min(0.45, aCmd.length() / (RDV_RCS_ACC * 3));
  // Swing the LM into docking attitude on the way in
  if (d < 6) {
    _rQ.multiplyQuaternions(_rFrameQ, DOCK_Q0);
    lander.quat.slerp(_rQ, Math.min(1, dt * 1.2)).normalize();
  } else {
    aimLanderAlong(_rHat, _rT, 2.0, dt);   // level flight until close
  }
  const relSpd = vRel.length();
  rdv.info = d > 3
    ? `Terminal phase · braking gates · range ${toKm(d).toFixed(1)} km · ${(relSpd * SPEED_TO_MS).toFixed(0)} m/s relative`
    : `Station-keeping approach · ${(d * DOCK_M_PER_UNIT).toFixed(0)} m to standoff · ${(relSpd * DOCK_M_PER_UNIT).toFixed(2)} m/s`;
  if (d < 0.05 && relSpd < 0.04) {
    // Hand over to the pilot in Columbia's LVLH frame
    _rTmp.copy(lander.pos).sub(csm.pos);
    toLVLH(_rTmp, rdv.rel);
    omegaCross(_rTmp, _rOm);
    toLVLH(_rTmp.copy(v).sub(csm.vel).sub(_rOm), rdv.relVel);
    rdv.relVel.set(0, 0, 0);   // autopilot nulls residual rates before handing over (station-keeping)
    rdv.relQ.multiplyQuaternions(_rFrameInv, lander.quat).normalize();
    lander.angVel.set(0, 0, 0);
    rdvSetPhase('manual');
    showToast((ui.touch ? 'Your turn: hold CLOSER to approach, use the stick to keep the dot centered' : 'STANDOFF HOLD — Your controls: RCS dock with Columbia (W close · A/D · SPACE/C · T att-hold)'), 'gold');
    sound.playPing(980, 0.16);
  }
}

function updateProxOps(dt) {
  if (rdv.contactCooldown > 0) rdv.contactCooldown -= dt;
  if (rdv.phase === 'docked') {
    rdv.rel.set(0, 0, CSM_PROBE_TIP + LM_DROGUE_Y);
    rdv.relVel.set(0, 0, 0);
    rdv.relQ.copy(DOCK_Q0);
    lander.angVel.set(0, 0, 0);
    rdv.info = 'Hard dock · crew transfer · [K] undock';
  } else {
    // Translation (camera frame: W/S along the probe axis, A/D lateral, SPACE/C vertical)
    const tx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const ty = (keys.lift ? 1 : 0) - (keys.down ? 1 : 0);
    const tz = (keys.backward ? 1 : 0) - (keys.forward ? 1 : 0);
    const acc = RCS_ACCEL * (keys.boost ? 3 : 1);
    rdv.relVel.x += tx * acc * dt;
    rdv.relVel.y += ty * acc * dt;
    rdv.relVel.z += tz * acc * dt;
    if (tx || ty || tz) rdv.thrust = 0.25;

    // Attitude (body axes: ↑↓ pitch, ←→ yaw, Q/Z roll)
    const pitch = (keys.arrowUp ? 1 : 0) - (keys.arrowDown ? 1 : 0);
    const yaw = (keys.arrowLeft ? 1 : 0) - (keys.arrowRight ? 1 : 0);
    const roll = (keys.yawLeft ? 1 : 0) - (keys.yawRight ? 1 : 0);
    const rotInput = pitch || yaw || roll;
    lander.angVel.x += pitch * RCS_ROT_ACCEL * dt;
    lander.angVel.z += yaw * RCS_ROT_ACCEL * dt;   // LM +Z faces radial-up when docked-aligned: yaw about it
    lander.angVel.y += roll * RCS_ROT_ACCEL * dt;  // roll about the docking axis (LM +Y)
    if (rdv.attHold && !rotInput) {
      rdv.relQ.slerp(DOCK_Q0, Math.min(1, dt * 1.6)).normalize();
      lander.angVel.multiplyScalar(Math.exp(-5 * dt));
    } else {
      lander.angVel.multiplyScalar(Math.exp(-0.35 * dt));
    }
    const angSpd = lander.angVel.length();
    if (angSpd > 1e-5) {
      _tmpAxis.copy(lander.angVel).divideScalar(angSpd);
      _tmpDeltaQ.setFromAxisAngle(_tmpAxis, angSpd * dt);
      rdv.relQ.multiply(_tmpDeltaQ).normalize();
    }
    rdv.rel.addScaledVector(rdv.relVel, dt);
  }

  // Docking geometry (LVLH): drogue position vs probe tip on the +F axis
  _rLmY.set(0, 1, 0).applyQuaternion(rdv.relQ);
  rdv.port.copy(rdv.rel).addScaledVector(_rLmY, LM_DROGUE_Y);
  rdv.along = rdv.port.z - CSM_PROBE_TIP;
  rdv.lateral = Math.hypot(rdv.port.x, rdv.port.y);
  rdv.alignDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-_rLmY.z, -1, 1)));
  rdv.closing = -rdv.relVel.z;

  if (rdv.phase === 'manual') {
    rdv.info = ui.touch
      ? 'Hold CLOSER to approach slowly · stick moves you sideways / up-down · keep the dot centered'
      : rdv.attHold
      ? 'MANUAL RCS · W/S close/open · A/D lateral · SPACE/C up/down · SHIFT coarse · T att-hold ON'
      : 'MANUAL 6-DOF · translate W/S A/D SPACE/C · rotate ↑↓ ←→ Q/Z · T att-hold OFF';
    if (rdv.along <= 0.012 && rdv.lateral < 0.12 && rdv.contactCooldown <= 0) {
      const okLat = rdv.lateral < DOCK_MAX_LATERAL;
      const okAlign = rdv.alignDeg < DOCK_MAX_ALIGN_DEG;
      const okRate = rdv.closing < DOCK_MAX_CLOSING;
      if (rdv.closing > DOCK_CRASH_CLOSING) {
        // Collision with Columbia
        fromLVLH(rdv.port, _rTmp).add(csm.pos);
        lander.pos.copy(_rTmp);
        crashLander(_rF.clone());
        return;
      } else if (okLat && okAlign && okRate) {
        rdv.phase = 'docked';
        lander.docked = true;
        lander.fuel = 100;
        sound.playScanComplete();
        triggerSeismicEvent(0.12, null);
        save.data.records.dockings += 1;
        markFirst('docking');
        say('docking');
        scheduleSave();
        if (!rdv.dockedOnce) {
          rdv.dockedOnce = true;
          showToast((ui.touch ? 'CONTACT & CAPTURE — your first docking with Columbia! Propellant topped off' : 'CONTACT & CAPTURE — first hard dock with Columbia! Propellant topped off · [K] undock'), 'sage');
        } else {
          showToast((ui.touch ? 'CAPTURE — docked with Columbia' : 'CAPTURE — Hard dock with Columbia · [K] undock'), 'sage');
        }
        updateAssistButtonsUI();
      } else {
        // Off-nominal contact: probe deflects the LM away
        rdv.relVel.z = Math.abs(rdv.relVel.z) * 0.5 + 0.012;
        rdv.relVel.x *= 0.4;
        rdv.relVel.y *= 0.4;
        rdv.rel.z += Math.max(0, 0.014 - rdv.along);
        rdv.contactCooldown = 0.7;
        sound.playTouchdown(true);
        triggerSeismicEvent(0.18, null);
        const why = !okRate
          ? `closing ${(rdv.closing * DOCK_M_PER_UNIT).toFixed(2)} m/s > ${(DOCK_MAX_CLOSING * DOCK_M_PER_UNIT).toFixed(1)}`
          : (!okLat ? `${(rdv.lateral * DOCK_M_PER_UNIT).toFixed(1)} m off-axis` : `misaligned ${rdv.alignDeg.toFixed(0)}°`);
        showToast(`PROBE CONTACT — no capture (${why}) · bounced`, 'warn');
      }
    }
  }

  // Rebuild world state from the LVLH frame
  fromLVLH(rdv.rel, _rTmp);
  lander.pos.copy(csm.pos).add(_rTmp);
  omegaCross(_rTmp, _rOm);
  fromLVLH(rdv.relVel, _rTmp);
  lander.vel.copy(csm.vel).add(_rTmp).add(_rOm);   // inertial velocity (so release keeps the orbit)
  lander.quat.multiplyQuaternions(_rFrameQ, rdv.relQ).normalize();
}

function finalizeRendezvousFrame(dt) {
  if (lander.crashed) return;
  const r = lander.pos.length();
  lander.up.copy(lander.pos).divideScalar(r);
  _shipFwd.set(0, 0, 1).applyQuaternion(lander.quat);
  lander.forward.copy(_shipFwd).addScaledVector(lander.up, -_shipFwd.dot(lander.up));
  if (lander.forward.lengthSq() < 1e-6) lander.forward.copy(_rF).addScaledVector(lander.up, -_rF.dot(lander.up));
  lander.forward.normalize();
  lander.right.crossVectors(lander.up, lander.forward).normalize();
  lander.isLanded = false;

  const ll = vec3ToLatLon(lander.pos);
  lander.lat = ll.lat;
  lander.lon = ll.lon;
  lander.elevKm = sampleTerrainAtLatLon(ll.lat, ll.lon).elevKm;
  const surfR = getExactSurfaceHit(lander.pos, _terrainNorm);
  lander.aglUnits = Math.max(0, r - surfR - landerFootOffset());
  lander.slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_terrainNorm.dot(lander.up), -1, 1)));
  if (r < surfR + landerFootOffset()) {
    lander.pos.setLength(surfR + landerFootOffset());
    const vIn = lander.vel.dot(lander.up);
    if (vIn < 0) lander.vel.addScaledVector(lander.up, -vIn);
  }

  _shipUp.set(0, 1, 0).applyQuaternion(lander.quat).normalize();
  _shipLeft.set(1, 0, 0).applyQuaternion(lander.quat).normalize();
  const upDot = THREE.MathUtils.clamp(_shipUp.dot(lander.up), -1, 1);
  lander.pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(_shipFwd.dot(lander.up), upDot));
  lander.rollDeg = THREE.MathUtils.radToDeg(Math.atan2(_shipLeft.dot(lander.up), upDot));
  lander.isInverted = upDot < -0.12;
  computeLanderOrbitalElements();

  lander.thrustIntensity = THREE.MathUtils.lerp(lander.thrustIntensity, rdv.thrust, Math.min(1, dt * 10));
  landerGroup.position.copy(lander.pos);
  landerGroup.quaternion.copy(lander.quat);
  if (lander.thrustIntensity > 0.04) {
    const flicker = 0.82 + Math.random() * 0.36;
    enginePlume.scale.set(0.9, (0.4 + lander.thrustIntensity * 0.9) * flicker, 0.9);
    enginePlume.material.opacity = Math.min(0.9, lander.thrustIntensity * 0.9);
    enginePlume.material.color.setHex(0xf4d58d);
  } else {
    enginePlume.material.opacity = 0;
  }
  laserBeam.visible = false;
  sound.updateThruster(gameState.mode === 'lander' ? lander.thrustIntensity * 0.8 : 0, false);
}

export function updateDockingCamera(dt) {
  csmFrame();
  _rTmp.copy(_rF).applyAxisAngle(_rU, camCtrl.chaseYaw);
  const pitch = THREE.MathUtils.clamp((camCtrl.chasePitch - 0.34) * 0.9 + 0.2, -1.2, 1.3);
  _rTmp.multiplyScalar(Math.cos(pitch)).addScaledVector(_rU, Math.sin(pitch)).normalize();
  const offset = _rTmp.multiplyScalar(camCtrl.dockDist);
  if (!camCtrl.landerCamOffset) camCtrl.landerCamOffset = offset.clone();
  else camCtrl.landerCamOffset.lerp(offset, Math.min(1, dt * 6));
  camera.position.copy(lander.pos).add(camCtrl.landerCamOffset);
  _rTmp2.copy(csm.pos).addScaledVector(_rF, CSM_PROBE_TIP);
  camCtrl.dockLookBlend = THREE.MathUtils.lerp(camCtrl.dockLookBlend, rdv.phase === 'docked' ? 0.55 : 0, Math.min(1, dt * 3));
  const look = _rTmp2.sub(lander.pos).multiplyScalar(camCtrl.dockLookBlend).add(lander.pos);
  camera.up.lerp(_rU, Math.min(1, dt * 6)).normalize();
  camera.lookAt(look);
}

const RDV_LABELS = {
  window: 'WAITING FOR LAUNCH WINDOW',
  ascent: 'POWERED ASCENT',
  plane: 'PLANE ALIGNMENT COAST',
  phasing: 'PHASING ORBIT',
  coast: 'HOHMANN TRANSFER',
  approach: 'TERMINAL APPROACH · AUTO',
  manual: 'RCS DOCKING · MANUAL 6-DOF',
  docked: 'DOCKED WITH COLUMBIA'
};

export function updateDockHUD() {
  if (!rdv.active) return;
  const set = (id, txt, color) => {
    const el = document.getElementById(id);
    el.textContent = txt;
    el.style.color = color || '';
  };
  set('dock-phase-label', RDV_LABELS[rdv.phase] || 'RENDEZVOUS');
  set('dock-info', rdv.info);
  const warpEl = document.getElementById('dock-warp');
  warpEl.classList.toggle('hidden', rdv.warp < 1.05);
  warpEl.textContent = `WARP ×${Math.round(rdv.warp)}`;
  document.getElementById('dock-abort-btn').textContent = rdv.phase === 'docked' ? '[K] UNDOCK' : (rdv.phase === 'manual' ? '[K] RELEASE' : '[K] ABORT');

  const prox = rdv.phase === 'manual' || rdv.phase === 'docked';
  const dot = document.getElementById('dock-dot');
  if (prox) {
    set('dock-lateral-lbl', 'LATERAL');
    set('dock-align-lbl', 'ALIGN');
    const rangeM = Math.max(0, rdv.along) * DOCK_M_PER_UNIT;
    const closeM = rdv.closing * DOCK_M_PER_UNIT;
    set('dock-range', `${rangeM.toFixed(1)} m`);
    set('dock-closing', `${closeM.toFixed(2)} m/s`,
      rdv.closing > DOCK_CRASH_CLOSING * 0.6 ? '#f8c4b4' : (rdv.closing > DOCK_MAX_CLOSING ? '#f4d58d' : '#7ec4a0'));
    set('dock-lateral', `${(rdv.lateral * DOCK_M_PER_UNIT).toFixed(1)} m`, rdv.lateral > DOCK_MAX_LATERAL ? '#f4d58d' : '#7ec4a0');
    set('dock-align', `${rdv.alignDeg.toFixed(1)}°`, rdv.alignDeg > DOCK_MAX_ALIGN_DEG ? '#f4d58d' : '#7ec4a0');
    const k = 18 / 0.12;
    dot.setAttribute('cx', THREE.MathUtils.clamp(rdv.port.x * k, -18, 18).toFixed(1));
    dot.setAttribute('cy', THREE.MathUtils.clamp(-rdv.port.y * k, -18, 18).toFixed(1));
    dot.setAttribute('fill', rdv.lateral < DOCK_MAX_LATERAL && rdv.alignDeg < DOCK_MAX_ALIGN_DEG ? '#7ec4a0' : '#f4d58d');
  } else {
    const d = lander.pos.distanceTo(csm.pos);
    omegaCross(_rTmp2.copy(lander.pos).sub(csm.pos), _rOm);
    const rel = _rTmp.copy(lander.vel).sub(csm.vel).sub(_rOm).length();
    set('dock-range', d > 3 ? `${toKm(d).toFixed(0)} km` : `${(d * DOCK_M_PER_UNIT).toFixed(0)} m`);
    set('dock-closing', d > 3 ? `${(rel * SPEED_TO_MS).toFixed(0)} m/s` : `${(rel * DOCK_M_PER_UNIT).toFixed(1)} m/s`);
    // Far from Columbia: show propellant instead of docking alignment
    set('dock-lateral-lbl', 'Δv LEFT');
    set('dock-align-lbl', 'FUEL');
    set('dock-lateral', `${Math.round(rdvDvLeft() * SPEED_TO_MS)} m/s`, lander.fuel < 15 ? '#f8c4b4' : '');
    set('dock-align', `${Math.round(lander.fuel)}%`, lander.fuel < 15 ? '#f8c4b4' : '');
    dot.setAttribute('cx', '0');
    dot.setAttribute('cy', '0');
    dot.setAttribute('fill', '#475569');
  }
}

// ---------------- ALSEP science stations + laser retroreflector beams ----------------
export const alsepStations = [];
let alsepPulseGeo = null;

function buildAlsepMesh() {
  const g = new THREE.Group();
  const root = new THREE.Group();
  root.scale.setScalar(ALSEP_SCALE);
  g.add(root);
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a84e, roughness: 0.35, metalness: 0.8 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xdbe2ec, roughness: 0.3, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.08, metalness: 0.95, emissive: 0x14532d, emissiveIntensity: 0.6 });

  // Central Station + thermal sunshield on posts
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.7), gold);
  base.position.y = 0.14;
  root.add(base);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.03, 0.85), silver);
  shield.position.y = 0.64;
  root.add(shield);
  [[-0.48, -0.38], [0.48, -0.38], [-0.48, 0.38], [0.48, 0.38]].forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), dark);
    post.position.set(x, 0.46, z);
    root.add(post);
  });
  // Antenna mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), silver);
  mast.position.set(0.3, 0.95, -0.2);
  root.add(mast);
  // RTG power source with cooling fins
  const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), dark);
  rtg.position.set(-1.15, 0.25, 0.3);
  root.add(rtg);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.02), dark);
    fin.position.copy(rtg.position);
    fin.rotation.y = (i * Math.PI) / 4;
    root.add(fin);
  }
  // Passive Seismic Experiment (thermal shroud dome)
  const pse = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), silver);
  pse.position.set(1.05, 0.02, -0.55);
  root.add(pse);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 16), gold);
  skirt.position.set(1.05, 0.015, -0.55);
  root.add(skirt);
  // Laser Ranging Retro-Reflector array (tilted toward Earth = +Z)
  const lrrr = new THREE.Group();
  lrrr.position.set(0.2, 0.12, 1.3);
  lrrr.rotation.x = 0.35;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.06), dark);
  stand.position.y = -0.05;
  lrrr.add(stand);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.6), dark);
  panel.position.y = 0.09;
  lrrr.add(panel);
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 3; iz++) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.14), glass);
      cube.position.set(-0.27 + ix * 0.18, 0.13, -0.18 + iz * 0.18);
      lrrr.add(cube);
    }
  }
  root.add(lrrr);
  return { group: g, glass };
}

function seatAlsep(st) {
  const surfR = getSurfaceRadiusAtLatLon(st.lat, st.lon);
  const pos = latLonToVec3(st.lat, st.lon, surfR + 0.002);
  const n = getSurfaceNormalAtPosition(pos, new THREE.Vector3());
  st.group.position.copy(pos);
  const toEarth = earthGroup.position.clone().sub(pos);
  const f = toEarth.clone().addScaledVector(n, -toEarth.dot(n));
  if (f.lengthSq() < 1e-6) anyPerp(n, f); else f.normalize();
  _basisX.crossVectors(n, f).normalize();
  _rotMat.makeBasis(_basisX, n, f);
  st.group.quaternion.setFromRotationMatrix(_rotMat).normalize();
  st.lrrrWorld.copy(ALSEP_LRRR_LOCAL).applyQuaternion(st.group.quaternion).add(st.group.position);
  st.hasLOS = toEarth.normalize().dot(pos.clone().normalize()) > 0.02;
  const arr = st.beam.geometry.attributes.position.array;
  arr[0] = st.lrrrWorld.x; arr[1] = st.lrrrWorld.y; arr[2] = st.lrrrWorld.z;
  arr[3] = earthGroup.position.x; arr[4] = earthGroup.position.y; arr[5] = earthGroup.position.z;
  st.beam.geometry.attributes.position.needsUpdate = true;
  st.beam.visible = st.hasLOS;
  st.pulse.visible = st.hasLOS;
}

function deployAlsep() {
  let basePos;
  if (gameState.mode === 'lander') {
    if (rdv.active || !lander.isLanded || lander.crashed) {
      showToast('Land the LM first to unload the science station', 'warn');
      return;
    }
    if (lander.ascentOnly) {
      showToast('ALSEP was stowed in the descent stage — warp to a site for a fresh LM', 'warn');
      return;
    }
    const side = new THREE.Vector3(-1, 0, 0).applyQuaternion(lander.quat).normalize();
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(lander.quat).normalize();
    basePos = lander.pos.clone().addScaledVector(side, 0.24).addScaledVector(back, 0.12);
  } else if (gameState.mode === 'rover' && rover.deployed) {
    if (!rover.isGrounded || rover.isTumbling || rover.crashed || rover.speed > 0.4) {
      showToast('Stop the LRV on stable ground to set up the ALSEP', 'warn');
      return;
    }
    basePos = rover.pos.clone().addScaledVector(rover.forward, -0.1).addScaledVector(rover.right, 0.06);
  } else {
    showToast('ALSEP deploys from the surface (Lander or Rover mode)', 'warn');
    return;
  }
  if (alsepStations.length >= ALSEP_MAX) {
    showToast(`All ${ALSEP_MAX} ALSEP stations deployed — the full Apollo network is online`, 'warn');
    return;
  }
  let nearest = Infinity, nearestId = 0;
  alsepStations.forEach((s) => {
    const d = s.group.position.distanceTo(basePos);
    if (d < nearest) { nearest = d; nearestId = s.id; }
  });
  if (nearest < 2.5) {
    showToast(`Too close to ALSEP-${nearestId} (${toKm(nearest).toFixed(0)} km) — spread out for a wider seismic network (≥ 45 km)`, 'warn');
    return;
  }

  const ll = vec3ToLatLon(basePos);
  const st = createAlsepStation(ll.lat, ll.lon);
  markFirst('alsep');
  say('alsep');
  scheduleSave();
  sound.playScanComplete();
  showToast(st.hasLOS
    ? `ALSEP-${st.id} ONLINE · seismometer listening · laser reflector ranging Earth`
    : `ALSEP-${st.id} ONLINE · seismometer listening · far side: no Earth line-of-sight for the laser`, 'sage');
  triggerSeismicEvent(0.08, st.group.position.clone());
}

// Builds a station (mesh, Earth laser beam, pulse) — used for new deployments and restored saves
export function createAlsepStation(lat, lon) {
  const { group, glass } = buildAlsepMesh();
  scene.add(group);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
    color: 0x4ade80, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  beam.frustumCulled = false;
  scene.add(beam);
  if (!alsepPulseGeo) alsepPulseGeo = new THREE.SphereGeometry(1, 10, 8);
  const pulse = new THREE.Mesh(alsepPulseGeo, new THREE.MeshBasicMaterial({
    color: 0xbbf7d0, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  pulse.frustumCulled = false;
  scene.add(pulse);
  const st = {
    id: alsepStations.length + 1,
    group, glass, beam, pulse,
    lat, lon,
    hasLOS: false,
    phase: Math.random(),
    lrrrWorld: new THREE.Vector3()
  };
  alsepStations.push(st);
  seatAlsep(st);
  document.getElementById('seismo-panel').classList.remove('hidden');
  updateProgressCounts();
  return st;
}

export function updateAlsep(dt) {
  for (const st of alsepStations) {
    if (!st.hasLOS) continue;
    // Earth fires → retroreflector returns it: 1.28 s each way in reality, compressed here
    st.phase = (st.phase + dt / 3.2) % 1;
    const t = st.phase < 0.5 ? 1 - st.phase * 2 : (st.phase - 0.5) * 2; // 1 = Earth, 0 = Moon
    st.pulse.position.copy(st.lrrrWorld).lerp(earthGroup.position, t);
    const camD = camera.position.distanceTo(st.pulse.position);
    st.pulse.scale.setScalar(THREE.MathUtils.clamp(camD * 0.006, 0.004, 6));
    const atMoon = Math.max(0, 1 - t * 8);
    st.beam.material.opacity = 0.28 + 0.55 * atMoon;
    st.glass.emissiveIntensity = 0.5 + 2.5 * atMoon;
  }
}

// ---------------- Passive Seismic Experiment: live HUD seismograph ----------------
export const seismo = {
  buf: new Float32Array(230),
  head: 0,
  acc: 0,
  events: [],
  nextThermal: 6,
  peak: 0,
  ctx: null,
  canvas: null
};

export function initSeismograph() {
  seismo.canvas = document.getElementById('seismo-canvas');
  seismo.ctx = seismo.canvas ? seismo.canvas.getContext('2d') : null;
}

// Seismic waves reach the nearest station with distance-based delay & attenuation (the Moon "rings like a bell")
export function recordSeismicArrival(intensity, origin) {
  if (!alsepStations.length) return;
  let dMin = Infinity;
  for (const st of alsepStations) dMin = Math.min(dMin, st.group.position.distanceTo(origin));
  const amp = intensity / (1 + dMin / 6);
  if (amp < 0.008) return;
  seismo.events.push({ t: -Math.min(3.5, dMin * 0.06), amp, f: 4 + Math.random() * 4, ph: Math.random() * 6.28 });
  if (seismo.events.length > 24) seismo.events.shift();
}

export function updateSeismograph(dt) {
  if (!alsepStations.length || !seismo.ctx) return;
  seismo.nextThermal -= dt;
  if (seismo.nextThermal <= 0) {
    // Thermal moonquakes & micrometeoroid hits keep the trace alive
    seismo.events.push({ t: 0, amp: 0.04 + Math.random() * 0.1, f: 6 + Math.random() * 5, ph: Math.random() * 6.28 });
    seismo.nextThermal = 4 + Math.random() * 9;
  }
  seismo.acc += dt;
  while (seismo.acc >= 0.02) {
    seismo.acc -= 0.02;
    let v = (Math.random() - 0.5) * 0.03;
    for (let i = seismo.events.length - 1; i >= 0; i--) {
      const e = seismo.events[i];
      e.t += 0.02;
      if (e.t < 0) continue;
      if (e.t > 7) { seismo.events.splice(i, 1); continue; }
      const env = (1 - Math.exp(-e.t * 14)) * Math.exp(-e.t * 0.75);
      v += e.amp * env * Math.sin(e.t * e.f * Math.PI * 2 + e.ph) * (0.75 + Math.random() * 0.25);
    }
    seismo.buf[seismo.head] = THREE.MathUtils.clamp(v, -1, 1);
    seismo.head = (seismo.head + 1) % seismo.buf.length;
  }

  const ctx = seismo.ctx;
  const W = seismo.canvas.width, H = seismo.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  for (let x = 0; x < W; x += W / 8) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  ctx.stroke();
  let peak = 0;
  const n = seismo.buf.length;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(seismo.buf[i]));
  seismo.peak = peak;
  ctx.strokeStyle = peak > 0.35 ? '#f8c4b4' : (peak > 0.12 ? '#f4d58d' : '#7ec4a0');
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const val = seismo.buf[(seismo.head + i) % n];
    const x = (i / (n - 1)) * W;
    const y = H / 2 - val * (H * 0.46);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  document.getElementById('seismo-stations').textContent = `${alsepStations.length} STN`;
  const pk = document.getElementById('seismo-peak');
  pk.textContent = peak > 0.35 ? `QUAKE ${(peak * 10).toFixed(1)}` : (peak > 0.12 ? `EVENT ${(peak * 10).toFixed(1)}` : 'QUIET');
  pk.style.color = peak > 0.35 ? '#f8c4b4' : (peak > 0.12 ? '#f4d58d' : '');
}

// ---------------- LOLA elevation & landing slope-hazard overlays ----------------
export const overlayState = {
  mode: 0, // 0 = albedo, 1 = elevation, 2 = slope hazard
  dirty: true,
  lastBuild: 0,
  elevCanvas: null,
  slopeCanvas: null,
  elevTex: null,
  slopeTex: null
};
const OVERLAY_LABELS = ['Albedo', 'LOLA Elevation', 'Slope Hazard'];
const ELEV_STOPS = [
  [0.0, 30, 27, 75], [0.18, 37, 99, 235], [0.36, 6, 182, 212], [0.5, 34, 197, 94],
  [0.64, 234, 179, 8], [0.8, 249, 115, 22], [0.92, 220, 38, 38], [1.0, 250, 250, 250]
];

export function markOverlayDirty() {
  overlayState.dirty = true;
}

function rampElev(t, out) {
  for (let i = 1; i < ELEV_STOPS.length; i++) {
    const b = ELEV_STOPS[i];
    if (t <= b[0]) {
      const a = ELEV_STOPS[i - 1];
      const k = (t - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * k;
      out[1] = a[2] + (b[2] - a[2]) * k;
      out[2] = a[3] + (b[3] - a[3]) * k;
      return out;
    }
  }
  out[0] = 250; out[1] = 250; out[2] = 250;
  return out;
}

function slopeColor(deg, out) {
  if (deg < 4) { out[0] = 22; out[1] = 163; out[2] = 74; }
  else if (deg < 8) { out[0] = 132; out[1] = 204; out[2] = 22; }
  else if (deg < 14) { out[0] = 250; out[1] = 204; out[2] = 21; }
  else if (deg < SLOPE_HAZARD_DEG) { out[0] = 249; out[1] = 115; out[2] = 22; }
  else { out[0] = 220; out[1] = 38; out[2] = 38; }
  return out;
}

const _ovP = new THREE.Vector3();
function buildOverlayTextures() {
  const W = ELEV_GRID_W, H = ELEV_GRID_H, g = polarSmoothedGrid();   // same smoothing as the Moon mesh
  const scale = getDisplacementScale();
  if (!overlayState.elevCanvas) {
    overlayState.elevCanvas = document.createElement('canvas');
    overlayState.slopeCanvas = document.createElement('canvas');
    overlayState.elevCanvas.width = overlayState.slopeCanvas.width = W;
    overlayState.elevCanvas.height = overlayState.slopeCanvas.height = H;
  }
  const eCtx = overlayState.elevCanvas.getContext('2d');
  const sCtx = overlayState.slopeCanvas.getContext('2d');
  const eImg = eCtx.createImageData(W, H);
  const sImg = sCtx.createImageData(W, H);
  const ed = eImg.data, sd = sImg.data;
  const K = 3; // ≈ one Moon-mesh quad, so the map matches the physics triangles
  const col = [0, 0, 0];
  const pxH = (Math.PI * MOON_RADIUS) / H;
  for (let y = 0; y < H; y++) {
    const lat = THREE.MathUtils.degToRad(90 - (y / (H - 1)) * 180);
    const pxW = (2 * Math.PI * MOON_RADIUS * Math.max(1e-3, Math.cos(lat))) / W;
    // East–west stencil spans the same ground distance as north–south, so polar slopes aren't exaggerated
    const KX = Math.min(W >> 2, Math.max(K, Math.round(K / Math.max(1e-3, Math.cos(lat)))));
    const ym = Math.max(0, y - K), yp = Math.min(H - 1, y + K);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xm = (x - KX + W) % W, xp = (x + KX) % W;
      const dzdx = ((g[y * W + xp] - g[y * W + xm]) * scale) / (2 * KX * pxW);
      const dzdy = ((g[yp * W + x] - g[ym * W + x]) * scale) / (Math.max(1, yp - ym) * pxH);
      const slope = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(dzdx, dzdy)));
      const shade = THREE.MathUtils.clamp(0.88 + (-dzdx + dzdy) * 1.4, 0.55, 1.18);
      rampElev(g[i], col);
      const pi = i * 4;
      ed[pi] = Math.min(255, col[0] * shade);
      ed[pi + 1] = Math.min(255, col[1] * shade);
      ed[pi + 2] = Math.min(255, col[2] * shade);
      ed[pi + 3] = 255;
      const lonR = THREE.MathUtils.degToRad((x / (W - 1)) * 360 - 180);
      _ovP.set(Math.cos(lat) * Math.cos(lonR), Math.sin(lat), -Math.cos(lat) * Math.sin(lonR));
      if (inBoulderField(_ovP)) slopeColor(SLOPE_HAZARD_DEG + 1 + ((x * 7 + y * 13) % 5) * 3, col);
      else slopeColor(slope, col);
      sd[pi] = Math.min(255, col[0] * shade);
      sd[pi + 1] = Math.min(255, col[1] * shade);
      sd[pi + 2] = Math.min(255, col[2] * shade);
      sd[pi + 3] = 255;
    }
  }
  eCtx.putImageData(eImg, 0, 0);
  sCtx.putImageData(sImg, 0, 0);
  if (!overlayState.elevTex) {
    overlayState.elevTex = new THREE.CanvasTexture(overlayState.elevCanvas);
    overlayState.slopeTex = new THREE.CanvasTexture(overlayState.slopeCanvas);
    setSRGB(overlayState.elevTex);
    setSRGB(overlayState.slopeTex);
    overlayState.elevTex.anisotropy = 8;
    overlayState.slopeTex.anisotropy = 8;
  } else {
    overlayState.elevTex.needsUpdate = true;
    overlayState.slopeTex.needsUpdate = true;
  }
  overlayState.dirty = false;
  overlayState.lastBuild = performance.now();
}

export function refreshMoonMap() {
  if (!moonMaterial) return;
  if (overlayState.mode === 0) {
    moonMaterial.map = terrainState.baseColorMap;
    moonMaterial.emissiveMap = null;
    moonMaterial.emissive.setHex(0x000000);
  } else {
    if (overlayState.dirty || !overlayState.elevTex) buildOverlayTextures();
    const tex = overlayState.mode === 1 ? overlayState.elevTex : overlayState.slopeTex;
    moonMaterial.map = tex;
    moonMaterial.emissiveMap = tex;
    moonMaterial.emissive.setHex(0x4a4a4a); // readable on the night side too
  }
  moonMaterial.needsUpdate = true;
}

export function maybeRebuildOverlay(now) {
  if (overlayState.mode !== 0 && overlayState.dirty && now - overlayState.lastBuild > 350) {
    buildOverlayTextures();
    refreshMoonMap();
  }
}

function cycleOverlay() {
  applyOverlayMode((overlayState.mode + 1) % 3, false);
}

export function applyOverlayMode(mode, silent) {
  overlayState.mode = mode;
  refreshMoonMap();
  document.getElementById('overlay-btn-label').textContent = `[L] Map: ${OVERLAY_LABELS[overlayState.mode]}`;
  document.getElementById('overlay-legend').classList.toggle('hidden', overlayState.mode === 0);
  document.getElementById('legend-elev').classList.toggle('hidden', overlayState.mode !== 1);
  document.getElementById('legend-slope').classList.toggle('hidden', overlayState.mode !== 2);
  const fmt = (km) => `${km >= 0 ? '+' : ''}${km.toFixed(1)} km`;
  document.getElementById('legend-min').textContent = fmt(terrainState.minElevKm);
  document.getElementById('legend-max').textContent = fmt(terrainState.maxElevKm);
  if (silent) return;
  scheduleSave();
  showToast(overlayState.mode === 0
    ? 'Map: LROC albedo'
    : (overlayState.mode === 1 ? 'Map: LOLA elevation (blue = low · red/white = high)' : `Map: landing slope hazard (red > ${SLOPE_HAZARD_DEG}° tips the LM)`), 'gold');
  sound.playPing(600 + overlayState.mode * 120, 0.1);
}

const _slopeN = new THREE.Vector3();
export function updateSlopeReadout(craft) {
  const el = document.getElementById('tel-slope');
  const cls = document.getElementById('tel-slope-class');
  if (rdv.active && (rdv.phase !== 'ascent')) {
    el.textContent = '--';
    cls.textContent = 'IN ORBIT';
    cls.style.color = '#94a3b8';
    return;
  }
  getSurfaceNormalAtPosition(craft.pos, _slopeN);
  const deg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_slopeN.dot(craft.up), -1, 1)));
  el.textContent = `${deg.toFixed(0)}°`;
  let label = 'SAFE', color = '#7ec4a0';
  if (inBoulderField(craft.up)) {
    cls.textContent = 'BOULDERS';
    cls.style.color = '#f8c4b4';
    return;
  }
  if (deg >= SLOPE_HAZARD_DEG) { label = 'HAZARD'; color = '#f8c4b4'; }
  else if (deg >= 14) { label = 'ROUGH'; color = '#f6a96b'; }
  else if (deg >= 8) { label = 'CAUTION'; color = '#f4d58d'; }
  cls.textContent = label;
  cls.style.color = color;
}
