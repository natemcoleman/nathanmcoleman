import * as THREE from 'three';
import { LANDMARKS, SCAN_DURATION_SEC, SCAN_RANGE_UNITS } from './constants.js';
import { sound } from './audio.js';
import { beaconMap, gameState, lander, rover } from './state.js';
import { getSurfaceRadiusAtPosition } from './coords.js';
import { refreshBeaconColors, scanRingMesh } from './scene.js';
import { openDossierModal, renderSitesList, showToast } from './hud.js';
import { ui } from './context-ui.js';
import { markFirst, scheduleSave, updateProgressCounts } from './save.js';
import { say } from './radio.js';

// =========================================================================
// 12. LIDAR SCAN & LANDMARK DISCOVERY LOOP
// =========================================================================
function getActiveCraft() {
  return gameState.mode === 'rover' ? rover : lander;
}

function findNearbyLandmark() {
  const craft = getActiveCraft();
  let best = null, bestD = Infinity;
  for (const lm of LANDMARKS) {
    const b = beaconMap.get(lm.id);
    if (!b) continue;
    const d = craft.pos.distanceTo(b.group.position);
    if (d < SCAN_RANGE_UNITS && d < bestD) {
      best = lm;
      bestD = d;
    }
  }
  return best;
}

export function triggerLidarScan() {
  if ((gameState.mode !== 'lander' && gameState.mode !== 'rover') || gameState.activeScan.inProgress) return;
  const nearby = findNearbyLandmark();
  if (!nearby) {
    showToast('Move closer to a lunar beacon to run a LOLA Lidar Scan.', 'warn');
    return;
  }
  gameState.activeScan.inProgress = true;
  gameState.activeScan.landmarkId = nearby.id;
  gameState.activeScan.progress = 0;
  gameState.activeScan.lastTick = 0;
  scanRingMesh.visible = true;
  sound.playPing(780, 0.14);
}

function completeLidarScan(lm) {
  gameState.activeScan.inProgress = false;
  scanRingMesh.visible = false;
  document.getElementById('scan-progress-wrap').classList.add('hidden');

  const firstTime = !gameState.surveyed.has(lm.id);
  if (firstTime) {
    gameState.surveyed.add(lm.id);
    refreshBeaconColors();
    renderSitesList();
    updateProgressCounts();
    markFirst('scan');
    scheduleSave();
    say(gameState.surveyed.size === LANDMARKS.length ? 'allSites' : `scan.${lm.id}`);
  }
  document.getElementById('dossier-badge').textContent = firstTime
    ? `NEW SITE SURVEYED · ${gameState.surveyed.size}/${LANDMARKS.length}`
    : 'SITE RE-SCANNED';

  sound.playScanComplete();
  openDossierModal(lm);

  if (gameState.surveyed.size === LANDMARKS.length && !gameState.allCelebrated) {
    gameState.allCelebrated = true;
    showToast('ALL 10 LUNAR SITES SURVEYED — MISSION COMPLETE!', 'sage');
  }
}

export function updateLidarScan(dt) {
  const canScan = gameState.mode === 'lander' || gameState.mode === 'rover';
  const craft = getActiveCraft();
  const nearby = canScan ? findNearbyLandmark() : null;
  const ctaWrap = document.getElementById('scan-cta-wrapper');
  const scanLabel = document.getElementById('scan-btn-label');
  const progWrap = document.getElementById('scan-progress-wrap');
  const progBar = document.getElementById('scan-progress-bar');

  if (gameState.activeScan.inProgress) {
    const lm = LANDMARKS.find(x => x.id === gameState.activeScan.landmarkId);
    const b = beaconMap.get(lm.id);
    const dist = craft.pos.distanceTo(b.group.position);

    if (dist > SCAN_RANGE_UNITS * 1.45 || !canScan) {
      gameState.activeScan.inProgress = false;
      scanRingMesh.visible = false;
      progWrap.classList.add('hidden');
      showToast('Lidar Sweep Aborted — Stay within site perimeter.', 'warn');
      return;
    }

    gameState.activeScan.progress += dt / SCAN_DURATION_SEC;
    const p = Math.min(1, gameState.activeScan.progress);
    ctaWrap.classList.remove('hidden');
    progWrap.classList.remove('hidden');
    scanLabel.textContent = `SCANNING ${lm.shortName.toUpperCase()}...`;
    progBar.style.width = `${Math.round(p * 100)}%`;

    if (p - gameState.activeScan.lastTick > 0.24) {
      gameState.activeScan.lastTick = p;
      sound.playPing(660 + p * 340, 0.08);
    }

    const surfR = getSurfaceRadiusAtPosition(craft.pos) + 0.18;
    scanRingMesh.position.copy(craft.up).multiplyScalar(surfR);
    scanRingMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), craft.up);
    const sc = 0.8 + p * 8.8;
    scanRingMesh.scale.set(sc, sc, 1);
    scanRingMesh.material.opacity = (1 - p) * 0.85;

    if (p >= 1) completeLidarScan(lm);
  } else {
    ctaWrap.classList.add('hidden');
  }
  ui.nearbyLandmark = (!gameState.activeScan.inProgress && nearby) ? nearby : null;
}
