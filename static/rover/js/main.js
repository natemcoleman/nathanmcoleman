import * as THREE from 'three';
import { astro, updateAstro } from './astro.js';
import { sound } from './audio.js';
import { beaconMap, gameState, lander, rover, seismic } from './state.js';
import { silentlyProbeSelfHostedTextures } from './nasa-maps.js';
import { camera, earthGroup, initThreeScene, landerGroup, renderer, scene, updateOrbitalStage, updateParticles, updateSunDirection } from './scene.js';
import { updateLanderPhysics } from './lander.js';
import { updateRoverPhysics, updateRoverStuntHUD } from './rover.js';
import { updateCamera } from './camera.js';
import { updateLidarScan } from './scan.js';
import { renderSitesList, updateTelemetryHUD } from './hud.js';
import { bindInputs } from './input.js';
import { hadleyRun, iceRun, initHadleyRilleRun, initOrbitalRingVisualizer, initSouthPoleIceRun, orbitRingState, updateHadleyRilleRun, updateOrbitalRingVisualizer, updateSouthPoleIceRun } from './challenges.js';
import { bindRdvPlan, initSeismograph, maybeRebuildOverlay, rdv, updateAlsep, updateDockHUD, updateExplosions, updateFallingStages, updateSeismograph } from './apollo-ops.js';
import { mergeInputs, updateContextUI } from './context-ui.js';
import { applySave, loadSave } from './save.js';
import { bindJournal, initFinds, updateFinds } from './finds.js';
import { a11Run, bindA11, updateA11Run, updatePower } from './apollo11.js';
import './constants.js';
import './coords.js';
import './procedural-moon.js';
import './modes.js';
import { initRadio, updateRadio } from './radio.js';
import { bindEarth, earthRun, updateEarthCamera, updateEarthRun } from './earth.js';
import { bindTutorial, updateTutorial } from './tutorial.js';
import { initVR, isVR, updateVRInput, updateVRRig, vrCamera } from './vr.js';

// =========================================================================
// 17. MAIN ANIMATION LOOP
// =========================================================================
let lastTime = performance.now();

function animate(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  updateContextUI();
  updateVRInput();
  mergeInputs();

  if (gameState.sunAutoCycle) {
    const nextAngle = (gameState.sunAngleDeg + dt * 8.0) % 360;
    updateSunDirection(nextAngle);
    document.getElementById('sun-angle-slider').value = Math.round(nextAngle);
    document.getElementById('sun-angle-val').textContent = `${Math.round(nextAngle)}°`;
  }

  if (earthGroup && earthGroup.userData.earthMesh) {
    earthGroup.userData.earthMesh.rotation.y += dt * 0.015;
  }

  // Advance CSM "Columbia" + Lander in sub-steps (time warp only during rendezvous coast phases)
  // Ease time warp up and down instead of jumping (sudden ×1 → ×40 changes feel like violent accelerations)
  if (rdv.active && rdv.warpTarget != null) {
    const k = rdv.warpTarget > rdv.warp ? 1.6 : 5;
    rdv.warp += (rdv.warpTarget - rdv.warp) * Math.min(1, dt * k);
    if (Math.abs(rdv.warpTarget - rdv.warp) < 0.05) rdv.warp = rdv.warpTarget;
  }
  const warp = (gameState.started && rdv.active) ? rdv.warp : 1;
  const simDt = dt * warp;
  const nSub = Math.max(1, Math.ceil(simDt / 0.025));
  const subDt = simDt / nSub;
  const flyLander = gameState.started && !earthRun.active && (gameState.mode === 'lander' || rdv.active || lander.crashed);
  if (earthRun.active) updateEarthRun(dt);   // Columbia flies home on her own script
  else for (let i = 0; i < nSub; i++) {
    updateOrbitalStage(subDt);
    if (flyLander) updateLanderPhysics(subDt);
  }

  const pulse = 1.0 + Math.sin(now * 0.0032) * 0.15;
  beaconMap.forEach(({ group, pillar, ring, diamond, lm }) => {
    // Beacons are sized for orbit; near the ground the flat ring slices through terrain and the pillar fills the view
    const near = THREE.MathUtils.clamp((camera.position.distanceTo(group.position) - 3) / 9, 0, 1);
    ring.material.opacity = 0.78 * near;
    ring.visible = near > 0.02;
    pillar.material.opacity = 0.14 + 0.46 * near;
    diamond.rotation.y += dt * 1.25;
    diamond.position.y = 5.3 + Math.sin(now * 0.0024 + lm.lat) * 0.4;
    const s = gameState.targetLandmarkId === lm.id ? pulse * 1.22 : 0.96 + Math.sin(now * 0.002) * 0.07;
    ring.scale.set(s, s, 1);
  });

  if (gameState.started) {
    if (gameState.mode === 'rover') {
      updateRoverPhysics(dt);
    } else if (gameState.mode === 'astro') {
      updateAstro(dt);
    } else if (!flyLander) {
      sound.updateThruster(0, false);
    }
    updateDockHUD();
    updateLidarScan(dt);
    updateTelemetryHUD();
    updateHadleyRilleRun();
    updateSouthPoleIceRun();
    if (gameState.mode !== 'rover') updateRoverStuntHUD(dt);
  } else {
    landerGroup.position.copy(lander.pos);
  }

  const runActive = hadleyRun.active || iceRun.active || rdv.active || a11Run.active;
  document.getElementById('waypoint-chip').classList.toggle('hidden', runActive);

  updateFallingStages(dt);
  updateExplosions(dt);
  updateAlsep(dt);
  updateSeismograph(dt);
  updateFinds(dt, now);
  if (gameState.started) { updateA11Run(dt); updatePower(dt); updateRadio(); updateTutorial(); }
  maybeRebuildOverlay(now);

  updateParticles(dt);
  updateCamera(dt);
  if (earthRun.active) {
    updateEarthCamera(dt);
    if (orbitRingState.group) orbitRingState.group.visible = false;
    document.getElementById('orbit-ring-hud').classList.add('hidden');
  } else updateOrbitalRingVisualizer();

  // Seismic camera shake applied around the render only (never accumulates into camera state)
  let shakeX = 0, shakeY = 0, shakeZ = 0;
  if (seismic.intensity > 0.002 && gameState.started && !isVR()) {   // no shaking in a headset
    const craftPos = gameState.mode === 'astro' ? astro.pos : ((gameState.mode === 'rover' && rover.deployed) ? rover.pos : lander.pos);
    const amp = seismic.intensity * 0.016 * Math.max(0.5, camera.position.distanceTo(craftPos));
    shakeX = (Math.random() - 0.5) * amp; shakeY = (Math.random() - 0.5) * amp; shakeZ = (Math.random() - 0.5) * amp;
    camera.position.x += shakeX; camera.position.y += shakeY; camera.position.z += shakeZ;
  }
  seismic.intensity *= Math.exp(-6.5 * dt);
  updateVRRig();
  renderer.render(scene, vrCamera());
  camera.position.x -= shakeX; camera.position.y -= shakeY; camera.position.z -= shakeZ;
}

// Boot on Window Load
window.onload = function () {
  initThreeScene();
  renderSitesList();
  bindInputs();
  initOrbitalRingVisualizer();
  initHadleyRilleRun();
  initSouthPoleIceRun();
  initSeismograph();
  loadSave();
  applySave();
  initFinds();
  bindJournal();
  bindA11();
  initRadio();
  bindTutorial();
  bindEarth();
  bindRdvPlan();
  silentlyProbeSelfHostedTextures();
  initVR();
  lastTime = performance.now();
  renderer.setAnimationLoop(animate);   // drives both the normal page and a VR headset
};
