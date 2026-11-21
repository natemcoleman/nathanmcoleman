import * as THREE from 'three';
import { ROVER_WHEEL_OFFSET } from './constants.js';
import { sound } from './audio.js';
import { camCtrl, csm, gameState, lander, rover } from './state.js';
import { getSurfaceNormalAtPosition, getSurfaceRadiusAtLatLon, getSurfaceRadiusAtPosition, latLonToVec3, sampleTerrainAtLatLon } from './coords.js';
import { landerGroup, landerMeshRoot, refreshBeaconColors, roverGroup } from './scene.js';
import { resetRoverDynamics } from './rover.js';
import { setGameMode, showToast } from './hud.js';
import { hadleyRun, iceRun, stopHadleyRilleRun, stopSouthPoleIceRun } from './challenges.js';
import { landerFootOffset, rdv, rdvEnd, restoreFullLander } from './apollo-ops.js';
import { markFirst, scheduleSave } from './save.js';
import { a11Run, power, stopA11Run, thermal } from './apollo11.js';
import { say } from './radio.js';

// =========================================================================
// 8. WARP, ROVER DEPLOYMENT & MODE / ASSIST HELPERS
// =========================================================================
export function warpLanderToLandmark(lm, switchToFlight = true) {
  if (!lm) return;
  if (rdv.active) rdvEnd(true);
  restoreFullLander();
  lander.crashed = false;
  landerGroup.visible = true;
  camCtrl.landerCamOffset = null;
  camCtrl.landerHeading = null;
  gameState.retroHold = false;
  if (a11Run.active) stopA11Run(true);
  if (hadleyRun.active) stopHadleyRilleRun(true);
  if (iceRun.active) stopSouthPoleIceRun(true);
  if (rover.deployed) {
    rover.deployed = false;
    if (roverGroup) roverGroup.visible = false;
  }
  const surfR = getSurfaceRadiusAtLatLon(lm.lat, lm.lon);
  const spawnLat = THREE.MathUtils.clamp(lm.lat - 0.28, -89.2, 89.2);
  const spawnLon = lm.lon;
  const spawnSurfR = getSurfaceRadiusAtLatLon(spawnLat, spawnLon);

  latLonToVec3(spawnLat, spawnLon, spawnSurfR + landerFootOffset() + 0.55, lander.pos);
  lander.vel.set(0, 0, 0);
  lander.angVel.set(0, 0, 0);

  lander.up.copy(lander.pos).normalize();
  const toBeacon = latLonToVec3(lm.lat, lm.lon, surfR).sub(lander.pos);
  toBeacon.addScaledVector(lander.up, -toBeacon.dot(lander.up));
  if (toBeacon.lengthSq() < 1e-5) {
    const ref = Math.abs(lander.up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    lander.forward.crossVectors(ref, lander.up).normalize();
  } else {
    lander.forward.copy(toBeacon).normalize();
  }
  lander.right.crossVectors(lander.up, lander.forward).normalize();

  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(lander.up, lander.forward).normalize(),
    lander.up,
    lander.forward
  );
  lander.quat.setFromRotationMatrix(m).normalize();
  lander.pitchTilt = 0;
  lander.rollTilt = 0;
  lander.pitchDeg = 0;
  lander.rollDeg = 0;
  lander.isInverted = false;
  lander.lat = spawnLat;
  lander.lon = spawnLon;
  lander.elevKm = sampleTerrainAtLatLon(spawnLat, spawnLon).elevKm;
  lander.aglUnits = 0.55;
  lander.fuel = 100.0;
  power.lander = 100;
  lander.isLanded = false;
  lander.inOrbit = false;
  gameState.autoSoftLand = false;
  camCtrl.chaseYaw = 0;
  updateAssistButtonsUI();

  gameState.targetLandmarkId = lm.id;
  refreshBeaconColors();
  scheduleSave();

  landerGroup.position.copy(lander.pos);
  landerGroup.quaternion.copy(lander.quat);
  landerMeshRoot.rotation.set(0, 0, 0);

  if (switchToFlight) {
    setGameMode('lander');
    showToast(`Warped Lander to ${lm.shortName}`, 'gold');
    sound.playPing(640, 0.14);
  }
}

export function toggleRoverDeployment() {
  if (gameState.mode === 'rover') {
    if (hadleyRun.active) stopHadleyRilleRun(false);
    if (iceRun.active) stopSouthPoleIceRun(false);
    rover.deployed = false;
    if (roverGroup) roverGroup.visible = false;
    setGameMode('lander');
    showToast('Boarded Lunar Module — Rover Stowed', 'sage');
    sound.playPing(620, 0.14);
    return;
  }
  if (!lander.isLanded) {
    showToast('Touch down on the lunar surface first to deploy the Rover!', 'warn');
    return;
  }
  if (lander.ascentOnly) {
    showToast('The LRV rides in the descent stage — warp to a site for a fresh LM', 'warn');
    return;
  }

  const sideDir = new THREE.Vector3(1, 0, 0).applyQuaternion(lander.quat).normalize();
  const deployPos = lander.pos.clone().addScaledVector(sideDir, 0.24);
  const surfR = getSurfaceRadiusAtPosition(deployPos);
  deployPos.setLength(surfR + ROVER_WHEEL_OFFSET);

  resetRoverDynamics();
  power.rover = 100;
  thermal.rover = thermal.lander;
  rover.pos.copy(deployPos);
  rover.up.copy(deployPos).normalize();
  const tNorm = getSurfaceNormalAtPosition(deployPos);
  rover.forward.set(0, 0, 1).applyQuaternion(lander.quat);
  rover.forward.addScaledVector(tNorm, -rover.forward.dot(tNorm));
  if (rover.forward.lengthSq() < 1e-5) rover.forward.copy(lander.forward);
  rover.forward.normalize();
  rover.right.crossVectors(tNorm, rover.forward).normalize();

  const rm = new THREE.Matrix4().makeBasis(rover.right, tNorm, rover.forward);
  rover.quat.setFromRotationMatrix(rm).normalize();
  rover.deployed = true;
  say(markFirst('rover') ? 'roverFirst' : 'rover');

  roverGroup.position.copy(rover.pos);
  roverGroup.quaternion.copy(rover.quat);
  roverGroup.visible = true;

  camCtrl.chaseYaw = 0;
  setGameMode('rover');
  showToast('Apollo LRV Deployed — WASD Drive · Shift Turbo · Space Brake · E Scan · R Board', 'sage');
  sound.playPing(760, 0.16);
}

export function focusOrbitOnLandmark(lm) {
  csm.tracking = false;
  gameState.targetLandmarkId = lm.id;
  refreshBeaconColors();
  scheduleSave();
  setGameMode('orbital');
  camCtrl.targetOrbitLatDeg = THREE.MathUtils.clamp(lm.lat, -85, 85);
  camCtrl.targetOrbitLonDeg = lm.lon;
  camCtrl.targetOrbitDist = 178;
  showToast(`Orbital Recon: ${lm.name}`, 'gold');
}

export function setAutoGyro(enabled) {
  gameState.autoGyro = enabled;
  if (!enabled) {
    gameState.hoverAssist = false;
    gameState.autoSoftLand = false;
    showToast('Auto-Gyro OFF — Free 360° Attitude & Zero-Drag Orbital Flight', 'gold');
  } else {
    showToast('Auto-Gyro ON — Stabilized SAS Attitude Control', 'sage');
  }
  updateAssistButtonsUI();
  sound.playPing(enabled ? 680 : 480, 0.12);
}

export function setHoverAssist(enabled) {
  gameState.hoverAssist = enabled;
  if (enabled && !gameState.autoGyro) gameState.autoGyro = true;
  if (enabled) gameState.autoSoftLand = false;
  updateAssistButtonsUI();
  showToast(enabled ? 'Hover Assist ON' : 'Hover Assist OFF — Free Newtonian Coasting', enabled ? 'sage' : 'gold');
  sound.playPing(enabled ? 620 : 460, 0.1);
}

export function setAutoSoftLand(enabled) {
  if (lander.isLanded && enabled) return;
  if (enabled && a11Run.active) {
    showToast('No autopilot here — Armstrong flew this one by hand!', 'warn');
    return;
  }
  gameState.autoSoftLand = enabled;
  if (enabled) {
    gameState.autoGyro = true;   // hover stays on: autopilot takes priority while it flies, hover is back after touchdown
    showToast('Auto-Soft-Land Engaged', 'gold');
  }
  updateAssistButtonsUI();
  sound.playPing(enabled ? 580 : 420, 0.12);
}

export function updateAssistButtonsUI() {
  // Context buttons re-render on their own (see section 18); here we only sync menu toggle states.
  const isRover = gameState.mode === 'rover';
  const gyroState = document.getElementById('autogyro-state');
  const hoverState = document.getElementById('hover-state');
  if (gyroState) {
    gyroState.textContent = gameState.autoGyro ? 'ON' : 'OFF · FREE 360°';
    gyroState.style.color = gameState.autoGyro ? '#7ec4a0' : '#f4d58d';
  }
  if (hoverState) {
    hoverState.textContent = gameState.hoverAssist ? 'ON' : 'OFF';
    hoverState.style.color = gameState.hoverAssist ? '#7ec4a0' : '#94a3b8';
  }
  const gyroBadge = document.getElementById('gyro-status-badge');
  if (gyroBadge) {
    gyroBadge.textContent = isRover ? 'LRV SUSPENSION' : (gameState.autoGyro ? 'AUTO-GYRO ON' : 'AUTO-GYRO OFF');
    gyroBadge.className = (isRover || gameState.autoGyro) ? 'text-[#7ec4a0] font-semibold' : 'text-[#f4d58d] font-semibold';
  }
}
