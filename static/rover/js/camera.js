import * as THREE from 'three';
import { astro, updateAstroCamera } from './astro.js';
import { camCtrl, csm, gameState, lander, rover, roverCam } from './state.js';
import { getSurfaceRadiusAtPosition, latLonToVec3 } from './coords.js';
import { camera, csmGroup } from './scene.js';
import { applySmoothRoverChaseCamera } from './rover.js';
import { rdv, updateDockingCamera } from './apollo-ops.js';

// =========================================================================
// 11. CAMERA CONTROLLER (CHASE, ROVER, ORBITAL RECON & CSM TRACKING)
// =========================================================================
export function updateCamera(dt) {
  if (!gameState.started) {
    const t = performance.now() * 0.00012;
    const r = 220;
    camera.position.set(Math.cos(t) * r, 34, Math.sin(t) * r);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    return;
  }

  // Leaving the rover chase cam: restore the base FOV & re-seed next time
  if (roverCam.wasActive && gameState.mode !== 'rover') {
    if (Math.abs(camera.fov - roverCam.baseFov) > 0.01) {
      camera.fov = roverCam.baseFov;
      camera.updateProjectionMatrix();
    }
    roverCam.wasActive = false;
    roverCam.initialized = false;
  }

  if (gameState.mode === 'lander' && rdv.active && (rdv.phase === 'approach' || rdv.phase === 'manual' || rdv.phase === 'docked')) {
    updateDockingCamera(dt);
  } else if (gameState.mode === 'lander') {
    // Heading lives on the Moon's surface (parallel-transported), not on the LM — spinning the LM never spins the view
    if (!camCtrl.landerHeading) camCtrl.landerHeading = lander.forward.clone();
    const hd = camCtrl.landerHeading;
    hd.addScaledVector(lander.up, -hd.dot(lander.up));
    if (hd.lengthSq() < 1e-6) hd.copy(lander.forward);
    hd.normalize();
    if (camCtrl.chaseYaw !== 0) {
      hd.applyAxisAngle(lander.up, camCtrl.chaseYaw).normalize();
      camCtrl.chaseYaw = 0;
    }
    const horizBack = hd.clone().negate();

    const pitch = THREE.MathUtils.clamp(camCtrl.chasePitch, 0.08, 1.25);
    const dist = camCtrl.chaseDist;

    const desired = lander.pos.clone()
      .addScaledVector(horizBack, Math.cos(pitch) * dist)
      .addScaledVector(lander.up, Math.sin(pitch) * dist + 0.09);

    const offset = desired.sub(lander.pos);
    if (!camCtrl.landerCamOffset) camCtrl.landerCamOffset = offset.clone();
    else camCtrl.landerCamOffset.lerp(offset, Math.min(1, dt * 8.5));
    camera.position.copy(lander.pos).add(camCtrl.landerCamOffset);
    const minCamR = getSurfaceRadiusAtPosition(camera.position) + 0.14;
    if (camera.position.length() < minCamR) camera.position.setLength(minCamR);
    camera.up.lerp(lander.up, Math.min(1, dt * 6.5)).normalize();
    camera.lookAt(lander.pos.clone().addScaledVector(hd, 0.12));
  } else if (gameState.mode === 'astro' && astro.active) {
    updateAstroCamera(dt);
  } else if (gameState.mode === 'rover' && rover.deployed) {
    applySmoothRoverChaseCamera(dt);
    roverCam.wasActive = true;
  } else {
    if (csm.tracking && csmGroup) {
      const csmUp = csm.pos.clone().normalize();
      const csmBack = csm.vel.clone().normalize().negate();
      const csmSide = new THREE.Vector3().crossVectors(csmUp, csmBack).normalize();
      const desired = csm.pos.clone()
        .addScaledVector(csmBack, 1.9)
        .addScaledVector(csmSide, 1.1)
        .addScaledVector(csmUp, 0.75);
      camera.position.lerp(desired, Math.min(1, dt * 6.5));
      camera.up.lerp(csmUp, Math.min(1, dt * 5.0)).normalize();
      camera.lookAt(csm.pos);
      return;
    }
    const smooth = Math.min(1, dt * 7.5);
    camCtrl.orbitDist = THREE.MathUtils.lerp(camCtrl.orbitDist, camCtrl.targetOrbitDist, smooth);
    camCtrl.orbitLatDeg = THREE.MathUtils.lerp(camCtrl.orbitLatDeg, camCtrl.targetOrbitLatDeg, smooth);
    let dLon = ((camCtrl.targetOrbitLonDeg - camCtrl.orbitLonDeg + 540) % 360) - 180;
    camCtrl.orbitLonDeg += dLon * smooth;

    latLonToVec3(camCtrl.orbitLatDeg, camCtrl.orbitLonDeg, camCtrl.orbitDist, camera.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  }
}
