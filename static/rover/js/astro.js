// =========================================================================
// ASTRONAUT ON FOOT (EVA) — step out of the rover, walk, and jetpack
// -------------------------------------------------------------------------
// For precise moves the rover can't make: up steep slopes, onto a crater
// rim, right onto a checkpoint or a hidden find.
//   WASD ......... walk (camera-relative) · in the air: steer the jetpack
//   SHIFT ........ run (bounding lunar lope)
//   SPACE ........ jetpack — tap to hop, hold to fly
//   CTRL / C ..... cut the jets and drop
//   V ............ step out of / back into the rover
// The backpack recharges on the ground (fast next to the rover).
// Real Apollo crews never had jetpacks on the Moon — the Manned Maneuvering
// Unit flew in Earth orbit (1984). This one is a game liberty.
// =========================================================================
import * as THREE from 'three';
import { LUNAR_MU, ROVER_SCALE } from './constants.js';
import { camCtrl, gameState, keys, rover, roverCam } from './state.js';
import { camera, scene, spawnDustBurst } from './scene.js';
import { getSurfaceNormalAtPosition, getSurfaceRadiusAtPosition, sampleTerrainAtLatLon, vec3ToLatLon } from './coords.js';
import { showToast } from './hud.js';
import { sound } from './audio.js';
import { ui } from './context-ui.js';
import { applySmoothRoverChaseCamera } from './rover.js';

// The astronaut is ~0.042 units tall; at that size one unit is about 43 m, so on-foot readouts use this human scale
export const ASTRO_M_PER_UNIT = 43;
const WALK = 0.14;           // ≈ 6 m/s on that scale (game-fast, like the rover)
const RUN = 0.5;             // bounding lope — SHIFT
const JET_UP = 1.95;         // jetpack lift — just over lunar g (≈ 1.6 here), for gentle, precise climbs
const JET_SIDE = 0.55;       // sideways jet thrust
const JET_MAX_UP = 0.2;      // climb-rate cap (u/s)
const JET_MAX_SIDE = 0.3;    // sideways speed cap under jet power
const JET_BURN_UP = 9;       // % per second → ~11 s of climbing on a full pack
const JET_BURN_SIDE = 5;
const HOP = 0.22;            // take-off kick when the jets light on the ground (a small hop on its own)
const BOARD_RANGE = 0.09;    // how close to the rover to climb aboard
const SAFE_FALL = 0.7;       // impact speed that makes you stumble

export const astro = {
  active: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  heading: new THREE.Vector3(0, 0, 1),
  quat: new THREE.Quaternion(),
  onGround: true,
  jet: 100,
  jetOn: 0,
  speed: 0,
  aglUnits: 0,
  lat: 0, lon: 0, elevKm: 0,
  walkPhase: 0,
  stumble: 0,
  airTime: 0,
  group: null,
  parts: null,
  // So the rover's chase camera can follow the astronaut too
  get forward() { return this.heading; },
  get isGrounded() { return this.onGround; },
  isTumbling: false,
};
globalThis.__lroAstro = astro;   // state.js can't import this module (it would be circular)

const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

// ---------------- Model: a white suit, gold visor and a backpack with jets ----------------
function buildAstronaut() {
  const suit = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.62, metalness: 0.06 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xf4d58d, roughness: 0.12, metalness: 0.95 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const g = new THREE.Group();
  const root = new THREE.Group();          // bobs while walking
  g.add(root);
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); root.add(m); return m; };
  // Legs pivot at the hip so they can swing
  const leg = (x) => {
    const hip = new THREE.Group(); hip.position.set(x, 0.46, 0); root.add(hip);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.12), suit); l.position.y = -0.21; hip.add(l);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.17), dark); boot.position.set(0, -0.42, 0.02); hip.add(boot);
    return hip;
  };
  const legL = leg(-0.075), legR = leg(0.075);
  box(0.28, 0.38, 0.19, suit, 0, 0.64, 0);                 // torso
  box(0.2, 0.08, 0.04, dark, 0, 0.7, 0.1);                 // chest control box
  const pack = box(0.26, 0.36, 0.15, suit, 0, 0.66, -0.17); // PLSS backpack
  box(0.27, 0.06, 0.16, dark, 0, 0.47, -0.17);             // jet manifold
  const arm = (x) => {
    const sh = new THREE.Group(); sh.position.set(x, 0.79, 0); root.add(sh);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.36, 0.085), suit); a.position.y = -0.18; sh.add(a);
    return sh;
  };
  const armL = arm(-0.18), armR = arm(0.18);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10), suit); helmet.position.set(0, 0.95, 0.01); root.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), visorMat); visor.position.set(0, 0.95, 0.055); root.add(visor);
  // Twin jet flames under the backpack
  const flames = [-0.08, 0.08].map((x) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.32, 10, 1, true), flameMat);
    f.rotation.x = Math.PI;               // point down
    f.position.set(x, 0.3, -0.17);
    root.add(f);
    return f;
  });
  g.scale.setScalar(ROVER_SCALE);
  g.visible = false;
  scene.add(g);
  astro.group = g;
  astro.parts = { root, legL, legR, armL, armR, flames, flameMat, pack };
}

// ---------------- Getting in and out ----------------
export function canStepOut() {
  return gameState.mode === 'rover' && rover.deployed && !rover.crashed && rover.isGrounded && !rover.isTumbling && rover.speed < 0.25;
}
export const nearRover = () => astro.pos.distanceTo(rover.pos) < BOARD_RANGE;

export function toggleEVA() {
  if (astro.active) { boardRover(); return; }
  if (gameState.mode !== 'rover' || !rover.deployed) return;
  if (!canStepOut()) { showToast('Stop the rover on the ground before stepping out', 'warn'); return; }
  stepOut();
}

function stepOut() {
  if (!astro.group) buildAstronaut();
  // Climb out on the left, beside the driver's seat
  _r.copy(rover.right).negate();
  astro.pos.copy(rover.pos).addScaledVector(_r, 0.045);
  astro.pos.setLength(getSurfaceRadiusAtPosition(astro.pos));
  astro.vel.set(0, 0, 0);
  astro.up.copy(astro.pos).normalize();
  astro.heading.copy(rover.forward).addScaledVector(astro.up, -rover.forward.dot(astro.up)).normalize();
  astro.onGround = true;
  astro.stumble = 0;
  astro.jetOn = 0;
  astro.active = true;
  astro.group.visible = true;
  (rover.seatedCrew || []).forEach((m) => { m.visible = false; });
  rover.vel.set(0, 0, 0);
  rover.speed = 0;
  gameState.mode = 'astro';
  showToast(ui.touch ? 'On foot. Stick to walk, hold JET to fly, tap Board to drive again' : 'EVA — WASD walk · SHIFT run · SPACE jetpack · V back in the rover', 'sage');
  sound.playPing(620, 0.1);
}

function boardRover() {
  if (!nearRover()) {
    const m = astro.pos.distanceTo(rover.pos) * ASTRO_M_PER_UNIT;
    showToast(`Walk back to the rover to climb in (${m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km'} away)`, 'warn');
    return;
  }
  endEVA();
  gameState.mode = 'rover';
  sound.playPing(760, 0.1);
}

// Leave EVA without boarding (rover stowed, warp, crash, challenge start…)
export function endEVA() {
  if (!astro.active) return;
  astro.active = false;
  if (astro.group) astro.group.visible = false;
  (rover.seatedCrew || []).forEach((m) => { m.visible = true; });
  sound.updateThruster(0, false);
}

// ---------------- Movement ----------------
export function updateAstro(dt) {
  if (!astro.active) return;
  const r = astro.pos.length();
  astro.up.copy(astro.pos).normalize();
  const up = astro.up;
  const g = LUNAR_MU / (r * r);
  getSurfaceNormalAtPosition(astro.pos, _n);

  // Camera-relative directions on the local horizon
  camera.getWorldDirection(_f);
  _f.addScaledVector(up, -_f.dot(up));
  if (_f.lengthSq() < 1e-8) _f.copy(astro.heading);
  _f.normalize();
  _r.crossVectors(_f, up).normalize();
  const mf = (keys.forward || keys.arrowUp ? 1 : 0) - (keys.backward || keys.arrowDown ? 1 : 0);
  const ms = (keys.right || keys.arrowRight ? 1 : 0) - (keys.left || keys.arrowLeft ? 1 : 0);
  _d.set(0, 0, 0).addScaledVector(_f, mf).addScaledVector(_r, ms);
  const moving = _d.lengthSq() > 0.01;
  if (moving) _d.normalize();

  const jetHeld = keys.lift && astro.jet > 0.5 && astro.stumble <= 0;
  let jet = 0;
  if (astro.stumble > 0) astro.stumble -= dt;

  if (astro.onGround) {
    astro.jet = Math.min(100, astro.jet + (nearRover() ? 45 : 14) * dt);
    if (jetHeld) {
      // Light the jets: a kick off the ground
      astro.onGround = false;
      astro.vel.addScaledVector(up, HOP);
      astro.airTime = 0;
      spawnDustBurst(astro.pos.clone(), up, 6, 0.25);
    } else {
      // Walking: steer the ground velocity toward the stick, slide on steep slopes
      const vN = astro.vel.dot(_n);
      _t.copy(astro.vel).addScaledVector(_n, -vN);
      const top = (keys.boost ? RUN : WALK) * (astro.stumble > 0 ? 0.2 : 1);
      _d.addScaledVector(_n, -_d.dot(_n));
      const target = moving ? _d.normalize().multiplyScalar(top) : _d.set(0, 0, 0);
      const slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_n.dot(up), -1, 1)));
      _t.lerp(target, Math.min(1, dt * (moving ? 7 : 10)));
      astro.vel.copy(_t);
      if (slopeDeg > 32) {
        // Too steep to stand on: slide downhill
        _r.copy(up).addScaledVector(_n, -up.dot(_n)).negate().normalize();
        astro.vel.addScaledVector(_r, 0.12);
      }
    }
  }

  if (!astro.onGround) {
    astro.airTime += dt;
    astro.vel.addScaledVector(up, -g * dt);
    if (jetHeld && astro.vel.dot(up) < JET_MAX_UP) {
      astro.vel.addScaledVector(up, JET_UP * dt);
      astro.jet = Math.max(0, astro.jet - JET_BURN_UP * dt);
      jet = 1;
    }
    if (keys.down) astro.vel.addScaledVector(up, -g * 0.8 * dt);   // dive
    if (moving && astro.jet > 0.5) {
      // Sideways jets: push toward the stick, capped so you can line up precisely
      const along = astro.vel.dot(_d);
      if (along < JET_MAX_SIDE) astro.vel.addScaledVector(_d, JET_SIDE * dt);
      astro.jet = Math.max(0, astro.jet - JET_BURN_SIDE * dt);
      jet = Math.max(jet, 0.55);
    } else if (jetHeld) {
      // Station-keeping: with the jets lit and no stick, the pack trims sideways drift (MMU-style)
      _t.copy(astro.vel).addScaledVector(up, -astro.vel.dot(up));
      astro.vel.addScaledVector(_t, -Math.min(1, 1.6 * dt));
    }
  }

  astro.pos.addScaledVector(astro.vel, dt);

  // Ground contact
  const surfR = getSurfaceRadiusAtPosition(astro.pos);
  astro.aglUnits = Math.max(0, astro.pos.length() - surfR);
  if (astro.pos.length() <= surfR) {
    astro.pos.setLength(surfR);
    getSurfaceNormalAtPosition(astro.pos, _n);
    const impact = -astro.vel.dot(_n);
    if (!astro.onGround) {
      if (impact > SAFE_FALL) {
        astro.stumble = 0.9;
        showToast('Oof — hard landing. Take it easy with the jets', 'warn');
        sound.playTouchdown(true);
      } else if (astro.airTime > 0.25) sound.playTouchdown(false);
      if (astro.airTime > 0.25) spawnDustBurst(astro.pos.clone(), _n, 8, 0.3);
    }
    astro.onGround = true;
    if (impact > 0) astro.vel.addScaledVector(_n, impact);
    astro.vel.multiplyScalar(Math.exp(-3 * dt));
  } else if (astro.onGround) {
    if (astro.aglUnits > 0.03) {
      astro.onGround = false;          // walked off a ledge
      astro.airTime = 0;
    } else {
      astro.pos.setLength(surfR);      // small bumps: keep the boots on the ground
      astro.aglUnits = 0;
    }
  }

  astro.jetOn = THREE.MathUtils.lerp(astro.jetOn, jet, Math.min(1, dt * 14));
  sound.updateThruster(astro.jetOn * 0.45, false);
  astro.speed = astro.vel.length();
  const ll = vec3ToLatLon(astro.pos);
  astro.lat = ll.lat; astro.lon = ll.lon;
  astro.elevKm = sampleTerrainAtLatLon(ll.lat, ll.lon).elevKm;

  // Face where we're going
  _t.copy(astro.vel).addScaledVector(up, -astro.vel.dot(up));
  if (_t.lengthSq() > 0.0004) astro.heading.lerp(_t.normalize(), Math.min(1, dt * 8));
  else if (moving) astro.heading.lerp(_d.addScaledVector(up, -_d.dot(up)).normalize(), Math.min(1, dt * 8));
  astro.heading.addScaledVector(up, -astro.heading.dot(up)).normalize();
  poseModel(dt);
}

function poseModel(dt) {
  const { group, parts } = astro;
  group.position.copy(astro.pos);
  _r.crossVectors(astro.up, astro.heading).normalize();
  _m.makeBasis(_r, astro.up, astro.heading);
  _q.setFromRotationMatrix(_m);
  group.quaternion.slerp(_q, Math.min(1, dt * 12));
  astro.quat.copy(group.quaternion);
  // Lunar lope: legs swing and the body bobs; arms counter-swing
  const ground = astro.onGround ? astro.speed : 0;
  astro.walkPhase += dt * (3 + ground * 40);
  const swing = astro.onGround ? Math.min(0.7, ground * 4.5) : 0.25;
  const s = Math.sin(astro.walkPhase);
  parts.legL.rotation.x = s * swing;
  parts.legR.rotation.x = -s * swing;
  parts.armL.rotation.x = -s * swing * 0.6;
  parts.armR.rotation.x = s * swing * 0.6;
  parts.root.position.y = astro.onGround ? Math.abs(Math.sin(astro.walkPhase)) * Math.min(0.08, ground * 0.5) : 0;
  parts.root.rotation.x = astro.stumble > 0 ? 0.5 : (astro.onGround ? Math.min(0.15, ground * 0.8) : 0.12);
  const flick = 0.75 + Math.random() * 0.5;
  parts.flameMat.opacity = astro.jetOn * 0.85;
  parts.flames.forEach((f) => { f.scale.set(1, Math.max(0.01, astro.jetOn * flick), 1); });
}

// ---------------- Camera: exactly the rover's chase camera (same distance, drag and zoom) ----------------
export function updateAstroCamera(dt) {
  applySmoothRoverChaseCamera(dt, astro);
}
