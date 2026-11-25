import * as THREE from 'three';
import { ELEV_GRID_H, ELEV_GRID_W, SPEED_TO_MS } from './constants.js';
import { sound } from './audio.js';
import { camCtrl, gameState, lander, rover, terrainState } from './state.js';
import { applyTerrainRelief, getSurfaceNormalAtPosition, getSurfaceRadiusAtLatLon, latLonToVec3 } from './coords.js';
import { valueNoise3 } from './procedural-moon.js';
import { landerGroup, sunLight } from './scene.js';
import { updateAssistButtonsUI, warpLanderToLandmark } from './modes.js';
import { _rotMat } from './lander.js';
import { setGameMode, showToast } from './hud.js';
import { formatHadleyTime, hadleyRun, iceRun, stopHadleyRilleRun, stopSouthPoleIceRun } from './challenges.js';
import { applyOverlayMode, landerFootOffset, overlayState, rdv, rdvEnd } from './apollo-ops.js';
import { ui } from './context-ui.js';
import { save, scheduleSave } from './save.js';
import { say, unlockRadio } from './radio.js';
import { stopTutorial } from './tutorial.js';

// =========================================================================
// 21. RETRO HOLD, SURFACE TEMPERATURE & SOLAR BATTERY,
//     APOLLO 11 "30 SECONDS OF FUEL" CHALLENGE
// =========================================================================

// ---------------- Prograde hold (the opposite of retro: speed up along your path) ----------------
function noAutopilot() {
  if (!a11Run.active) return false;
  showToast('No autopilot on this one — Armstrong flew the last part by hand', 'warn');
  return true;
}

export function toggleProgradeHold() {
  if (gameState.mode !== 'lander' || rdv.active || lander.crashed) return;
  if (noAutopilot()) return;
  if (lander.isLanded && !gameState.progradeHold) {
    showToast('Prograde hold is for speeding up in flight — lift off first', 'warn');
    return;
  }
  gameState.progradeHold = !gameState.progradeHold;
  if (gameState.progradeHold) { gameState.autoSoftLand = false; gameState.retroHold = false; }
  showToast(gameState.progradeHold
    ? (ui.touch ? 'PROGRADE HOLD — engine points along your motion. Hold ENGINE to speed up' : 'PROGRADE HOLD — engine points along your motion. Hold SPACE to speed up')
    : 'Prograde hold off', gameState.progradeHold ? 'sage' : 'gold');
  sound.playPing(gameState.progradeHold ? 760 : 480, 0.1);
}

// ---------------- Retrograde hold ----------------
export function toggleRetroHold() {
  if (gameState.mode !== 'lander' || rdv.active || lander.crashed) return;
  if (noAutopilot()) return;
  if (lander.isLanded && !gameState.retroHold) {
    showToast('Retro hold is for braking in flight — lift off first', 'warn');
    return;
  }
  gameState.retroHold = !gameState.retroHold;
  if (gameState.retroHold) { gameState.autoSoftLand = false; gameState.progradeHold = false; }
  showToast(gameState.retroHold
    ? (ui.touch ? 'RETRO HOLD — engine points against your motion. Hold ENGINE to brake' : 'RETRO HOLD — engine points against your motion. Hold SPACE to brake')
    : 'Retro hold off', gameState.retroHold ? 'sage' : 'gold');
  sound.playPing(gameState.retroHold ? 700 : 480, 0.1);
}

// ---------------- Surface temperature & solar battery ----------------
export const power = { lander: 100, rover: 100, roverWarned: false, landerWarned: false };
export const thermal = { lander: 20, rover: 20 };
const _pSun = new THREE.Vector3();
const _pN = new THREE.Vector3();

function inEternalShadow(craft) {
  return Math.abs(craft.lat) > 87.5;
}
// Radiative-equilibrium-style estimate: ~120 °C under a high Sun, ~−178 °C at night, colder still in polar cold traps
function surfaceTempC(craft) {
  getSurfaceNormalAtPosition(craft.pos, _pN);
  const c = _pN.dot(_pSun);
  if (inEternalShadow(craft) && c < 0.25) return -233;
  const k = c > 0 ? Math.max(95, 392 * Math.pow(c, 0.25)) : 95;
  return k - 273.15;
}

function stepPower(key, craft, dt, drive) {
  const target = surfaceTempC(craft);
  thermal[key] += (target - thermal[key]) * (1 - Math.exp(-0.8 * dt));
  const sunCos = inEternalShadow(craft) ? 0 : Math.max(0, craft.up.dot(_pSun));
  const t = thermal[key];
  const heater = t < -60 ? 0.9 * Math.min(1, (-60 - t) / 120) : 0;
  const rate = 7 * sunCos - 0.35 - heater - drive;
  power[key] = THREE.MathUtils.clamp(power[key] + rate * dt, 0, 100);
}

export function updatePower(dt) {
  if (!gameState.started || !sunLight) return;
  _pSun.copy(sunLight.position).normalize();
  stepPower('lander', lander, dt, 0);
  if (rover.deployed && !rover.crashed) stepPower('rover', rover, dt, rover.speed * 0.35);
  if (rover.deployed && !iceRun.active) {
    if (power.rover <= 0 && !power.roverWarned) {
      power.roverWarned = true;
      showToast('LRV battery flat — sunlight will recharge it', 'warn');
    } else if (power.rover > 12) power.roverWarned = false;
  }
  if (power.lander <= 5 && !power.landerWarned && gameState.mode === 'lander') {
    power.landerWarned = true;
    showToast('LM battery low — wait for sunlight to recharge', 'warn');
  } else if (power.lander > 15) power.landerWarned = false;
  const v = (gameState.mode === 'rover' || gameState.mode === 'astro') && rover.deployed ? 'rover' : 'lander';
  const r = vehicleThermal(v);
  document.getElementById('tel-temp').textContent = `${r.t > 0 ? '+' : ''}${Math.round(r.t)}°C`;
  document.getElementById('tel-batt').textContent = `${Math.round(r.b)}%`;
}

export function vehicleThermal(v) {
  if (v === 'rover' && iceRun.active) return { t: iceRun.tempC, b: iceRun.battery };
  return { t: thermal[v], b: power[v] };
}

// No limp mode: a flat battery no longer slows the rover (the readout is informational)
export function roverPowerMul() {
  return 1;
}

// ---------------- Apollo 11: "30 Seconds of Fuel" ----------------
// West Crater (real: ~190 m, Eagle landed ~550 m west of it) — scaled up here so it's visible at game scale
const WEST_CRATER = { lat: 0.67, lon: 25.95, r: 0.026, depth: 0.12, rim: 0.05 };
const A11_FUEL_SEC = 28;               // hover-equivalent seconds of fuel at the start (Eagle had about a minute at the 60 s call)
const A11_HOVER_BURN = 100 / A11_FUEL_SEC;
const A11_FIELD = 2.0;                  // boulder field radius, in West Crater radii (it was 1.4)
// Touchdown limits (LM design limits were ~3 m/s down, ~1.2 m/s sideways, 12° tilt). In game units:
const A11_MAX_VDOWN = 0.25;             // ≈ 3.4 m/s
const A11_MAX_VSIDE = 0.12;             // ≈ 1.6 m/s
const A11_MAX_SLOPE = 10;
const A11_DRIFT_ACC = 0.07;             // wandering sideways push (attitude/slosh disturbances) to keep correcting
const A11_FUEL_MUL = A11_HOVER_BURN / 0.45;
export const a11Run = {
  active: false,
  elapsed: 0,
  landedFor: 0,
  callouts: {},
  bestFuel: null
};

const _wcC = latLonToVec3(WEST_CRATER.lat, WEST_CRATER.lon, 1.0);
// Boulders & steep walls of West Crater (and its ejecta) — finer than the Moon mesh can show, so flagged explicitly
export function inBoulderField(unitDir) {
  // Only the Apollo 11 challenge treats the (greatly enlarged) boulder field as deadly
  if (!terrainState.westCraterCarved || !a11Run.active) return false;
  return Math.acos(THREE.MathUtils.clamp(unitDir.dot(_wcC), -1, 1)) / WEST_CRATER.r < A11_FIELD;
}

export { noAutopilot };

export function fuelMul() {
  return a11Run.active ? A11_FUEL_MUL : 1;
}
export function a11FuelSeconds() {
  return lander.fuel / A11_HOVER_BURN;
}

export function carveWestCrater(grid) {
  const W = ELEV_GRID_W, H = ELEV_GRID_H;
  const c = latLonToVec3(WEST_CRATER.lat, WEST_CRATER.lon, 1.0);
  const span = THREE.MathUtils.radToDeg(WEST_CRATER.r * 1.5);
  const y0 = Math.max(0, Math.floor(((90 - (WEST_CRATER.lat + span)) / 180) * (H - 1)));
  const y1 = Math.min(H - 1, Math.ceil(((90 - (WEST_CRATER.lat - span)) / 180) * (H - 1)));
  const x0 = Math.floor(((WEST_CRATER.lon - span + 180) / 360) * (W - 1));
  const x1 = Math.ceil(((WEST_CRATER.lon + span + 180) / 360) * (W - 1));
  const p = new THREE.Vector3();
  for (let y = y0; y <= y1; y++) {
    const lat = THREE.MathUtils.degToRad(90 - (y / (H - 1)) * 180);
    for (let xx = x0; xx <= x1; xx++) {
      const x = ((xx % W) + W) % W;
      const lon = THREE.MathUtils.degToRad((x / (W - 1)) * 360 - 180);
      p.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
      const q = Math.acos(THREE.MathUtils.clamp(p.dot(c), -1, 1)) / WEST_CRATER.r;
      if (q > 1.4) continue;
      const rough = valueNoise3(p.x * 900, p.y * 900, p.z * 900) - 0.5;   // boulder field
      let d;
      if (q < 1) d = -WEST_CRATER.depth * (1 - Math.pow(q, 4)) + WEST_CRATER.depth * 0.35 * rough;
      else {
        const t = 1 - (q - 1) / 0.4;
        d = WEST_CRATER.rim * t * t + WEST_CRATER.rim * 0.7 * rough * t;
      }
      const i = y * W + x;
      grid[i] = THREE.MathUtils.clamp(grid[i] + d, 0.01, 0.99);
    }
  }
}

function ensureWestCrater() {
  if (terrainState.westCraterCarved) return;
  carveWestCrater(terrainState.elevGrid);
  terrainState.westCraterCarved = true;
  applyTerrainRelief(terrainState.reliefExaggeration);
}

function startA11Run() {
  stopTutorial();
  sound.init();
  unlockRadio();
  setTimeout(() => say('a11Start'), 900);
  if (hadleyRun.active) stopHadleyRilleRun(true);
  if (iceRun.active) stopSouthPoleIceRun(true);
  if (rdv.active) rdvEnd(true);
  document.getElementById('a11-result-modal').classList.add('hidden');
  document.getElementById('start-overlay').classList.add('hidden');
  document.getElementById('hud-root').classList.remove('hidden');
  gameState.started = true;
  ensureWestCrater();

  // Start inside the crater's eastern half, flying west, ~20 km up — exactly where Eagle's computer was taking it
  const lat = WEST_CRATER.lat, lon = WEST_CRATER.lon + 0.6;
  warpLanderToLandmark({ id: gameState.targetLandmarkId, lat: lat + 0.28, lon, shortName: 'West Crater' }, false, false);
  const surfR = getSurfaceRadiusAtLatLon(lat, lon);
  latLonToVec3(lat, lon, surfR + landerFootOffset() + 1.2, lander.pos);
  lander.up.copy(lander.pos).normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(lander.up).normalize();   // +lon direction
  const west = east.clone().negate();
  lander.forward.copy(west);
  lander.right.crossVectors(lander.up, lander.forward).normalize();
  _rotMat.makeBasis(new THREE.Vector3().crossVectors(lander.up, west).normalize(), lander.up, west);
  lander.quat.setFromRotationMatrix(_rotMat).normalize();
  lander.vel.copy(west).multiplyScalar(1.0).addScaledVector(lander.up, -0.25);   // already moving fast and sinking
  lander.isLanded = false;
  lander.fuel = 100;
  landerGroup.position.copy(lander.pos);
  landerGroup.quaternion.copy(lander.quat);
  gameState.autoGyro = true;
  gameState.hoverAssist = true;
  gameState.autoSoftLand = false;
  gameState.retroHold = false;
  gameState.progradeHold = false;
  camCtrl.landerHeading = west.clone();
  camCtrl.landerCamOffset = null;
  camCtrl.chaseYaw = 0;
  setGameMode('lander');
  updateAssistButtonsUI();

  a11Run.active = true;
  a11Run.elapsed = 0;
  a11Run.landedFor = 0;
  a11Run.callouts = {};
  a11Run.drift = new THREE.Vector3();
  a11Run.failReason = null;
  lander.worstDown = 0; lander.worstSide = 0;
  document.getElementById('a11-hud').classList.remove('hidden');
  sound.playPing(587, 0.14);
  setTimeout(() => sound.playPing(784, 0.18), 120);
  showToast('PROGRAM ALARM 1202… GO! The computer is steering you into a boulder field. Take over.', 'warn');
}

export function stopA11Run(silent) {
  a11Run.active = false;
  document.getElementById('a11-hud').classList.add('hidden');
  if (!silent) showToast('Exited Apollo 11: 30 Seconds of Fuel', 'gold');
}

function finishA11Run(success) {
  const fuelLeft = a11FuelSeconds();
  const td = (lander.touchdownSpeed || 0) * SPEED_TO_MS * 0.1;
  stopA11Run(true);
  if (success) { say('eagleLanded', null, { force: true }); say('a11Down'); } else say('a11Fail');
  const medalEl = document.getElementById('a11-medal');
  const pill = (bg, fg, bd) => `px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold ${bg} ${fg} ${bd}`;
  let newBest = false;
  if (success) {
    const recs = save.data.records;
    newBest = !Number.isFinite(recs.a11Best) || fuelLeft > recs.a11Best;
    if (newBest) {
      recs.a11Best = fuelLeft;
      scheduleSave();
      document.getElementById('a11-best-badge').textContent = `BEST ${fuelLeft.toFixed(0)} s LEFT`;
    }
    if (fuelLeft >= 10) { medalEl.textContent = 'GOLD · ARMSTRONG-GRADE'; medalEl.className = pill('bg-[#f4d58d]/22', 'text-[#f4d58d]', 'border border-[#f4d58d]/55'); }
    else if (fuelLeft >= 4) { medalEl.textContent = 'SILVER · THE EAGLE HAS LANDED'; medalEl.className = pill('bg-slate-200/18', 'text-slate-100', 'border border-slate-300/50'); }
    else { medalEl.textContent = 'BRONZE · RUNNING ON FUMES'; medalEl.className = pill('bg-[#d9826c]/20', 'text-[#f8c4b4]', 'border border-[#d9826c]/50'); }
    document.getElementById('a11-title').textContent = 'Tranquility Base here — the Eagle has landed.';
    sound.playScanComplete();
  } else {
    medalEl.textContent = 'ABORT · EAGLE LOST';
    medalEl.className = pill('bg-[#d9826c]/22', 'text-[#f8c4b4]', 'border border-[#d9826c]/55');
    document.getElementById('a11-title').textContent = a11Run.failReason || 'Eagle didn’t make it down safely.';
  }
  document.getElementById('a11-fuel-left').textContent = success ? `${fuelLeft.toFixed(1)} s${newBest ? ' ★' : ''}` : '—';
  document.getElementById('a11-td').textContent = success ? `${td.toFixed(1)} m/s` : '—';
  document.getElementById('a11-time').textContent = formatHadleyTime(a11Run.elapsed);
  document.getElementById('a11-result-modal').classList.remove('hidden');
}

export function updateA11Run(dt) {
  if (!a11Run.active) return;
  a11Run.elapsed += dt;
  const secs = a11FuelSeconds();
  document.getElementById('a11-timer').textContent = formatHadleyTime(a11Run.elapsed);
  const bar = document.getElementById('a11-fuel-bar');
  bar.style.width = `${Math.max(0, Math.min(100, lander.fuel))}%`;
  bar.style.backgroundColor = secs <= 10 ? '#d9826c' : (secs <= 20 ? '#f4d58d' : '#7ec4a0');
  document.getElementById('a11-fuel-sec').textContent = `${secs.toFixed(0)} s`;
  const hint = document.getElementById('a11-hint');
  const slopeBtn = document.getElementById('a11-slope-btn');
  slopeBtn.classList.toggle('hidden', overlayState.mode === 2);
  if (overlayState.mode !== 2) hint.textContent = 'Switch on the Slope Map — red is boulders and steep crater walls';
  else if (!lander.isLanded) hint.textContent = inBoulderField(lander.up) ? 'Below you: BOULDERS. Keep flying west until the ground turns green' : 'Over green: kill your sideways drift, then come down slowly (under 3 m/s)';
  // Mission Control fuel calls, as Charlie Duke made them
  [[20, '20 SECONDS of fuel — Houston'], [10, '10 SECONDS — get it down!'], [0, 'FUEL DEPLETED — engine out!']].forEach(([s, msg]) => {
    if (secs <= s && !a11Run.callouts[s]) {
      a11Run.callouts[s] = true;
      showToast(msg, 'warn');
      sound.playPing(s ? 880 : 300, 0.25);
      setTimeout(() => sound.playPing(s ? 880 : 240, 0.25), 220);
    }
  });
  if (lander.crashed) { a11Run.failReason = a11Run.failReason || 'Eagle crashed.'; finishA11Run(false); return; }
  if (lander.isLanded) {
    if (a11Run.landedFor === 0) {
      // Judge the touchdown against the LM's limits
      const down = lander.worstDown || 0, side = lander.worstSide || 0;
      const toMs = (v) => (v * SPEED_TO_MS * 0.1).toFixed(1);
      if (inBoulderField(lander.up)) a11Run.failReason = 'Landed in the boulder field — a footpad came down on a rock.';
      else if (down > A11_MAX_VDOWN) a11Run.failReason = `Touchdown too hard: ${toMs(down)} m/s down (limit ${toMs(A11_MAX_VDOWN)}).`;
      else if (side > A11_MAX_VSIDE) a11Run.failReason = `Still sliding sideways at ${toMs(side)} m/s (limit ${toMs(A11_MAX_VSIDE)}) — a leg could buckle.`;
      else if (lander.slopeDeg > A11_MAX_SLOPE) a11Run.failReason = `Ground too steep: ${lander.slopeDeg.toFixed(0)}° (limit ${A11_MAX_SLOPE}°).`;
      if (a11Run.failReason) { finishA11Run(false); return; }
    }
    a11Run.landedFor += dt;
    if (a11Run.landedFor > 0.6) finishA11Run(true);
  } else {
    a11Run.landedFor = 0;
    if (lander.aglUnits > 0.25) { lander.worstDown = 0; lander.worstSide = 0; }   // clean slate until the next touchdown
    // A slow, wandering sideways push: you have to keep flying it all the way down
    if (lander.fuel > 0) {
      const up = lander.up;
      a11Run.drift.x += (Math.random() - 0.5) * dt * 0.8;
      a11Run.drift.y += (Math.random() - 0.5) * dt * 0.8;
      a11Run.drift.z += (Math.random() - 0.5) * dt * 0.8;
      a11Run.drift.addScaledVector(up, -a11Run.drift.dot(up)).multiplyScalar(Math.exp(-0.15 * dt));
      if (a11Run.drift.length() > 1) a11Run.drift.setLength(1);
      lander.vel.addScaledVector(a11Run.drift, A11_DRIFT_ACC * dt);
    }
  }
}

export function bindA11() {
  document.getElementById('a11-run-btn').addEventListener('click', startA11Run);
  document.getElementById('a11-abort-btn').addEventListener('click', () => stopA11Run(false));
  document.getElementById('a11-slope-btn').addEventListener('click', () => applyOverlayMode(2, false));
  document.getElementById('a11-retry-btn').addEventListener('click', startA11Run);
  const close = () => document.getElementById('a11-result-modal').classList.add('hidden');
  document.getElementById('a11-close-btn').addEventListener('click', close);
  document.getElementById('a11-freeroam-btn').addEventListener('click', close);
  const best = save.data.records.a11Best;
  if (Number.isFinite(best)) document.getElementById('a11-best-badge').textContent = `BEST ${best.toFixed(0)} s LEFT`;
}
