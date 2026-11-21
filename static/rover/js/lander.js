import * as THREE from 'three';
import { LANDER_SCALE, LUNAR_MU, MOON_RADIUS, MOON_REAL_KM, SPEED_TO_MS } from './constants.js';
import { sound } from './audio.js';
import { camCtrl, gameState, keys, lander, triggerSeismicEvent } from './state.js';
import { getDisplacementScale, getExactSurfaceHit, getSurfaceNormalAtPosition, sampleTerrainAtLatLon, vec3ToLatLon } from './coords.js';
import { camera, enginePlume, landerGroup, landerMeshRoot, laserBeam, spawnDustBurst, spawnParticle } from './scene.js';
import { updateAssistButtonsUI } from './modes.js';
import { showToast, triggerImpactFlash } from './hud.js';
import { LANDER_CRASH_OFFAXIS, LANDER_CRASH_SPEED, SLOPE_HAZARD_DEG, aimLanderAlong, crashLander, landerFootOffset, rdv, updateLanderCrash, updateRendezvous } from './apollo-ops.js';
import { ui } from './context-ui.js';
import { markFirst } from './save.js';
import { a11Run, fuelMul, inBoulderField } from './apollo11.js';
import { radioLanding, say } from './radio.js';

// =========================================================================
// 9. LANDER NEWTONIAN ORBITAL FLIGHT & 360° QUATERNION ATTITUDE PHYSICS
// =========================================================================
export const _shipUp = new THREE.Vector3();
export const _shipFwd = new THREE.Vector3();
export const _shipLeft = new THREE.Vector3();
export const _tmpAxis = new THREE.Vector3();
export const _tmpDeltaQ = new THREE.Quaternion();
export const _targetQ = new THREE.Quaternion();
const _tiltQ = new THREE.Quaternion();
const _tiltEuler = new THREE.Euler();
export const _basisX = new THREE.Vector3();
export const _rotMat = new THREE.Matrix4();
export const _terrainNorm = new THREE.Vector3();
export const _orbH = new THREE.Vector3();

export function computeLanderOrbitalElements() {
  const r = lander.pos.length();
  const v2 = lander.vel.lengthSq();
  lander.vCirc = Math.sqrt(LUNAR_MU / Math.max(1, r));

  if (lander.isLanded || v2 < 1e-4) {
    lander.inOrbit = false;
    lander.apKm = null;
    lander.peKm = null;
    return;
  }

  _orbH.crossVectors(lander.pos, lander.vel);
  const h = _orbH.length();
  const energy = 0.5 * v2 - LUNAR_MU / r;
  const kmPerUnit = MOON_REAL_KM / MOON_RADIUS;

  if (energy < -1e-4) {
    const a = -LUNAR_MU / (2 * energy);
    const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (LUNAR_MU * LUNAR_MU)));
    const rp = a * (1 - ecc);
    const ra = a * (1 + ecc);
    lander.peKm = (rp - MOON_RADIUS) * kmPerUnit;
    lander.apKm = (ra - MOON_RADIUS) * kmPerUnit;
    const minSafeOrbitR = MOON_RADIUS + getDisplacementScale() * 0.52;
    lander.inOrbit = (rp > minSafeOrbitR) && ecc < 1.0;
  } else {
    const ecc = Math.sqrt(Math.max(1, 1 + (2 * energy * h * h) / (LUNAR_MU * LUNAR_MU)));
    const rp = (h * h) / (LUNAR_MU * (1 + ecc));
    lander.peKm = (rp - MOON_RADIUS) * kmPerUnit;
    lander.apKm = Infinity;
    lander.inOrbit = false;
  }
}

export function updateLanderPhysics(dt) {
  if (updateLanderCrash(dt)) return;
  if (rdv.active) { updateRendezvous(dt); return; }
  const stageMul = lander.ascentOnly ? 1.3 : 1.0;   // Lighter ascent stage climbs harder
  const footOffset = landerFootOffset();
  const rNow = Math.max(10, lander.pos.length());
  lander.up.copy(lander.pos).normalize();
  lander.forward.addScaledVector(lander.up, -lander.forward.dot(lander.up)).normalize();
  lander.right.crossVectors(lander.up, lander.forward).normalize();

  // True Newtonian inverse-square lunar gravity: g(r) = MU / r^2
  const GRAVITY = LUNAR_MU / (rNow * rNow);
  // In hover, SHIFT climbs and CTRL/C descends at a steady rate instead of boosting
  const hoverHold = gameState.autoGyro && gameState.hoverAssist && !gameState.retroHold && !gameState.autoSoftLand && !lander.isLanded && !rdv.active;
  const isBoosting = keys.boost && !hoverHold && lander.fuel > 0.5;
  const mainEngineOn = (keys.lift || (keys.boost && !hoverHold)) && lander.fuel > 0.5;
  lander.hoverHold = hoverHold;
  lander.isBoosting = isBoosting;
  let thrustMag = 0;

  const vRad = lander.vel.dot(lander.up);
  if (!lander.isLanded || mainEngineOn) {
    lander.vel.addScaledVector(lander.up, -GRAVITY * dt);
  }

  if (gameState.retroHold && !lander.isLanded) {
    // RETROGRADE HOLD: descent engine points against the direction of travel → ENGINE brakes;
    // blends back to upright as you slow so you arrive ready to touch down
    const moveInput = keys.forward || keys.backward || keys.left || keys.right || keys.arrowUp || keys.arrowDown || keys.arrowLeft || keys.arrowRight;
    if (moveInput) {
      gameState.retroHold = false;
    } else {
      const spd = lander.vel.length();
      const w = THREE.MathUtils.clamp((spd - 0.03) / 0.5, 0, 1);
      _tmpAxis.copy(lander.vel).multiplyScalar(-1 / Math.max(spd, 1e-6)).multiplyScalar(w).addScaledVector(lander.up, 1 - w);
      if (_tmpAxis.lengthSq() < 1e-8) _tmpAxis.copy(lander.up);
      aimLanderAlong(_tmpAxis.normalize(), camCtrl.landerHeading || lander.forward, 5.0, dt);
      lander.angVel.multiplyScalar(Math.exp(-8 * dt));
      if (mainEngineOn) {
        _shipUp.set(0, 1, 0).applyQuaternion(lander.quat).normalize();
        let dv = (isBoosting ? 10.5 : 5.0) * stageMul * dt;
        // While braking, only cancel the motion along the engine axis — never push you back the other way
        if (w > 0.05) dv = Math.min(dv, Math.max(0, -lander.vel.dot(_shipUp)));
        lander.vel.addScaledVector(_shipUp, dv);
        lander.fuel = Math.max(0, lander.fuel - fuelMul() * (isBoosting ? 2.4 : 1.1) * dt);
        thrustMag = Math.max(thrustMag, isBoosting ? 1.0 : 0.85);
      }
    }
  }
  if (gameState.retroHold && !lander.isLanded) {
    // handled above
  } else if (gameState.autoGyro) {
    // MODE A: AUTO-GYRO ON (Stabilized SAS Upright + Orbital-Capable Burn)
    const camFwd = new THREE.Vector3();
    camera.getWorldDirection(camFwd);
    camFwd.addScaledVector(lander.up, -camFwd.dot(lander.up));
    if (camFwd.lengthSq() < 1e-5) camFwd.copy(lander.forward);
    else camFwd.normalize();
    const camRight = new THREE.Vector3().crossVectors(camFwd, lander.up).normalize();

    const moveFwd = (keys.forward || keys.arrowUp ? 1 : 0) - (keys.backward || keys.arrowDown ? 1 : 0);
    const moveStrafe = (keys.right || keys.arrowRight ? 1 : 0) - (keys.left || keys.arrowLeft ? 1 : 0);
    const yawInput = (keys.yawLeft ? 1 : 0) - (keys.yawRight ? 1 : 0);
    const manualThrustInput = keys.lift || keys.boost || moveFwd !== 0 || moveStrafe !== 0;

    if (manualThrustInput && gameState.autoSoftLand) {
      gameState.autoSoftLand = false;
      updateAssistButtonsUI();
    }

    if (yawInput !== 0) {
      // Q/Z turn the LM and the view together (movement is view-relative)
      lander.forward.applyAxisAngle(lander.up, yawInput * 1.9 * dt).normalize();
      lander.right.crossVectors(lander.up, lander.forward).normalize();
      if (camCtrl.landerHeading) camCtrl.landerHeading.applyAxisAngle(lander.up, yawInput * 1.9 * dt).normalize();
    }

    if (mainEngineOn) {
      const liftAccel = (isBoosting ? 9.5 : 4.8) * stageMul;
      lander.vel.addScaledVector(lander.up, liftAccel * dt);
      lander.fuel = Math.max(0, lander.fuel - fuelMul() * (isBoosting ? 2.4 : 1.1) * dt);
      lander.isLanded = false;
      thrustMag = Math.max(thrustMag, isBoosting ? 1.0 : 0.78);
    } else if (gameState.autoSoftLand && !lander.isLanded && lander.fuel > 0.5) {
      const targetDescent = lander.aglUnits > 2.5 ? -1.4 : (lander.aglUnits > 0.6 ? -0.6 : -0.22);
      const vErr = targetDescent - vRad;
      const autoAccel = THREE.MathUtils.clamp(GRAVITY + vErr * 3.4, 0, 7.2);
      lander.vel.addScaledVector(lander.up, autoAccel * dt);
      const curTan = lander.vel.clone().addScaledVector(lander.up, -lander.vel.dot(lander.up));
      lander.vel.addScaledVector(curTan, -Math.min(1, 2.5 * dt));
      lander.fuel = Math.max(0, lander.fuel - fuelMul() * 0.8 * dt);
      thrustMag = Math.max(thrustMag, 0.55);
    } else if (gameState.hoverAssist && !lander.isLanded && lander.fuel > 0.5) {
      // RISE (SHIFT) and LOWER (CTRL/C) turn hover into a rate-of-descent control, slowing near the ground — like Apollo's ROD switch
      const hoverTarget = keys.boost ? 0.7 : (keys.down ? (lander.aglUnits > 0.8 ? -0.7 : -0.22) : 0);
      const hoverErr = hoverTarget - vRad;
      const hoverAccel = THREE.MathUtils.clamp(GRAVITY + hoverErr * 3.2, 0, 6.2);
      lander.vel.addScaledVector(lander.up, hoverAccel * dt);
      lander.fuel = Math.max(0, lander.fuel - fuelMul() * 0.45 * dt);
      thrustMag = Math.max(thrustMag, 0.35);
    }

    const desiredDir = new THREE.Vector3()
      .addScaledVector(camFwd, moveFwd)
      .addScaledVector(camRight, moveStrafe);

    let localPitch = 0;
    let localRoll = 0;

    if (desiredDir.lengthSq() > 0.01 && lander.fuel > 0.5) {
      desiredDir.normalize();
      if (lander.isLanded) {
        lander.vel.addScaledVector(lander.up, 1.4);
        lander.isLanded = false;
      }
      const horizAccel = (isBoosting ? 9.2 : 4.2) * stageMul;
      lander.vel.addScaledVector(desiredDir, horizAccel * dt);
      lander.fuel = Math.max(0, lander.fuel - fuelMul() * (isBoosting ? 2.1 : 0.85) * dt);
      thrustMag = Math.max(thrustMag, isBoosting ? 1.0 : 0.62);

      lander.forward.lerp(desiredDir, Math.min(1, dt * 3.8));
      lander.forward.addScaledVector(lander.up, -lander.forward.dot(lander.up)).normalize();
      lander.right.crossVectors(lander.up, lander.forward).normalize();

      localPitch = 0.22;
      localRoll = -moveStrafe * 0.14;
    }

    lander.pitchTilt = THREE.MathUtils.lerp(lander.pitchTilt, localPitch, Math.min(1, dt * 7));
    lander.rollTilt = THREE.MathUtils.lerp(lander.rollTilt, localRoll, Math.min(1, dt * 7));
    lander.angVel.multiplyScalar(Math.exp(-8.0 * dt));

    if (!lander.isLanded) {
      _basisX.crossVectors(lander.up, lander.forward).normalize();
      _rotMat.makeBasis(_basisX, lander.up, lander.forward);
      _targetQ.setFromRotationMatrix(_rotMat);
      _tiltEuler.set(lander.pitchTilt, 0, lander.rollTilt, 'YXZ');
      _tiltQ.setFromEuler(_tiltEuler);
      _targetQ.multiply(_tiltQ).normalize();
      lander.quat.slerp(_targetQ, Math.min(1, dt * 7.5)).normalize();
    }

    if (lander.isLanded) {
      lander.vel.multiplyScalar(Math.exp(-8.0 * dt));
    } else if (gameState.hoverAssist && desiredDir.lengthSq() < 0.01) {
      const curVRad = lander.vel.dot(lander.up);
      const curTan = lander.vel.clone().addScaledVector(lander.up, -curVRad);
      curTan.multiplyScalar(Math.exp(-1.15 * dt));
      lander.vel.copy(curTan).addScaledVector(lander.up, curVRad);
    }

  } else {
    // MODE B: AUTO-GYRO OFF (Unrestricted 360° + True Zero-Drag Orbital Flight)
    const pitchInput = (keys.forward || keys.arrowUp ? 1 : 0) - (keys.backward || keys.arrowDown ? 1 : 0);
    const rollInput = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const yawInput = (keys.yawLeft || keys.arrowLeft ? 1 : 0) - (keys.yawRight || keys.arrowRight ? 1 : 0);

    const ROT_TORQUE = 8.2;
    const MAX_ANG_SPEED = 5.6;

    if (!lander.isLanded && (pitchInput !== 0 || rollInput !== 0 || yawInput !== 0)) {
      lander.angVel.x += pitchInput * ROT_TORQUE * dt;
      lander.angVel.z += rollInput * ROT_TORQUE * dt;
      lander.angVel.y += yawInput * ROT_TORQUE * dt;
    }

    const rotDamp = lander.isLanded ? 12.0 : 2.1;
    lander.angVel.multiplyScalar(Math.exp(-rotDamp * dt));
    if (lander.angVel.length() > MAX_ANG_SPEED) {
      lander.angVel.setLength(MAX_ANG_SPEED);
    }

    if (!lander.isLanded) {
      const angSpeed = lander.angVel.length();
      if (angSpeed > 1e-5) {
        _tmpAxis.copy(lander.angVel).divideScalar(angSpeed);
        _tmpDeltaQ.setFromAxisAngle(_tmpAxis, angSpeed * dt);
        lander.quat.multiply(_tmpDeltaQ).normalize();
      }
    }

    _shipUp.set(0, 1, 0).applyQuaternion(lander.quat).normalize();
    if (mainEngineOn) {
      const engineAccel = (isBoosting ? 10.5 : 5.0) * stageMul;
      lander.vel.addScaledVector(_shipUp, engineAccel * dt);
      lander.fuel = Math.max(0, lander.fuel - fuelMul() * (isBoosting ? 2.4 : 1.1) * dt);
      if (_shipUp.dot(lander.up) > 0.15 || lander.vel.dot(lander.up) > 0.1) {
        lander.isLanded = false;
      }
      thrustMag = Math.max(thrustMag, isBoosting ? 1.0 : 0.85);
    }

    if (lander.isLanded) {
      lander.vel.multiplyScalar(Math.exp(-8.0 * dt));
    }
  }

  // Integrate position
  lander.pos.addScaledVector(lander.vel, dt);

  const maxR = 850.0;
  if (lander.pos.length() > maxR) {
    lander.pos.setLength(maxR);
    const vr = lander.vel.dot(lander.up);
    if (vr > 0) lander.vel.addScaledVector(lander.up, -vr);
  }

  _shipUp.set(0, 1, 0).applyQuaternion(lander.quat).normalize();
  _shipFwd.set(0, 0, 1).applyQuaternion(lander.quat).normalize();
  _shipLeft.set(1, 0, 0).applyQuaternion(lander.quat).normalize();

  const upDot = THREE.MathUtils.clamp(_shipUp.dot(lander.up), -1, 1);
  lander.pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(_shipFwd.dot(lander.up), upDot));
  lander.rollDeg = THREE.MathUtils.radToDeg(Math.atan2(_shipLeft.dot(lander.up), upDot));
  lander.isInverted = upDot < -0.12;

  // Exact Terrain Collision, Elevation & Local Slope Normal Sampling
  // Exact Terrain Collision, Elevation & Local Slope Normal Sampling (against rendered polygons)
  const { lat, lon } = vec3ToLatLon(lander.pos);
  lander.lat = lat;
  lander.lon = lon;
  const sample = sampleTerrainAtLatLon(lat, lon);
  lander.elevKm = sample.elevKm;

  const surfR = getExactSurfaceHit(lander.pos, _terrainNorm);
  const contactR = surfR + footOffset;
  const curR = lander.pos.length();
  lander.aglUnits = Math.max(0, curR - contactR);
  lander.slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_terrainNorm.dot(lander.up), -1, 1)));

  if (curR <= contactR) {
    lander.pos.setLength(contactR);
    const impactSpeed = -lander.vel.dot(_terrainNorm);
    const slopeUpDot = THREE.MathUtils.clamp(_shipUp.dot(_terrainNorm), -1, 1);
    const boulders = inBoulderField(lander.up);
    const slopeHazard = lander.slopeDeg > SLOPE_HAZARD_DEG || boulders;
    const uprightLanding = slopeUpDot > 0.52 && !(slopeHazard && !lander.isLanded && (impactSpeed > 0.35 || boulders));

    // CRASH: structural limit exceeded (very fast, or fast & off-axis / tipping on a hazard slope)
    if (!lander.isLanded && (impactSpeed > LANDER_CRASH_SPEED || (!uprightLanding && impactSpeed > LANDER_CRASH_OFFAXIS))) {
      crashLander(_terrainNorm);
      return;
    }

    if (!lander.isLanded) lander.touchdownSpeed = Math.max(0, impactSpeed);
    if (!lander.isLanded && (impactSpeed > 0.35 || boulders)) {
      triggerSeismicEvent(Math.min(0.7, impactSpeed * 0.22), lander.pos.clone());
      if (impactSpeed > 2.4 || !uprightLanding) {
        triggerImpactFlash();
        sound.playTouchdown(true);
        showToast(
          uprightLanding
            ? `Hard Touchdown (${(impactSpeed * SPEED_TO_MS * 0.1).toFixed(1)} m/s) — Absorbing Shock`
            : (slopeHazard
              ? (boulders ? 'BOULDER FIELD — a footpad hit a rock and the LM is tipping!' : `SLOPE HAZARD ${Math.round(lander.slopeDeg)}° — LM tipping! Use the slope map to pick a flat site`)
              : 'Off-Axis Impact — Tumbling Off Regolith!'),
          'warn'
        );
        if (!uprightLanding) say('tipped');
        spawnDustBurst(lander.pos.clone().addScaledVector(lander.up, -footOffset), _terrainNorm, 18, 0.85);
        lander.vel.addScaledVector(_terrainNorm, Math.max(impactSpeed * 1.15, 0.9));
        if (!gameState.autoGyro && !uprightLanding) {
          lander.angVel.x += (Math.random() - 0.5) * 2.2;
          lander.angVel.z += (Math.random() - 0.5) * 2.2;
        }
      } else {
        lander.isLanded = true;
        gameState.autoSoftLand = false;
        updateAssistButtonsUI();
        radioLanding(markFirst('landing'));
        lander.vel.multiplyScalar(0.1);
        sound.playTouchdown(false);
        showToast((ui.touch ? 'Safe touchdown — tap Deploy Rover to explore' : 'Safe Touchdown — Press [R] to Deploy Lunar Rover'), 'sage');
        spawnDustBurst(lander.pos.clone().addScaledVector(lander.up, -footOffset), _terrainNorm, 12, 0.5);
      }
    } else {
      if (uprightLanding || lander.isLanded) {
        const wasLanded = lander.isLanded;
        lander.isLanded = true;
        if (!wasLanded || gameState.autoSoftLand) {
          gameState.autoSoftLand = false;
          updateAssistButtonsUI();
        }
        if (!wasLanded) radioLanding(markFirst('landing'));
      }
      const vrNow = lander.vel.dot(lander.up);
      if (vrNow < 0) lander.vel.addScaledVector(lander.up, -vrNow);
      lander.vel.multiplyScalar(Math.exp(-8.5 * dt));
    }
    lander.aglUnits = 0;
  }

  // TERRAIN-NORMAL RESTING ATTITUDE: Even when Auto-Gyro is OFF, sit flush on the local lunar slope!
  if (lander.isLanded) {
    getSurfaceNormalAtPosition(lander.pos, _terrainNorm);
    const projFwd = _shipFwd.clone().addScaledVector(_terrainNorm, -_shipFwd.dot(_terrainNorm));
    if (projFwd.lengthSq() < 1e-5) {
      projFwd.copy(lander.forward).addScaledVector(_terrainNorm, -lander.forward.dot(_terrainNorm));
    }
    projFwd.normalize();
    _basisX.crossVectors(_terrainNorm, projFwd).normalize();
    _rotMat.makeBasis(_basisX, _terrainNorm, projFwd);
    _targetQ.setFromRotationMatrix(_rotMat).normalize();
    lander.quat.slerp(_targetQ, Math.min(1, dt * 8.0)).normalize();
    lander.angVel.multiplyScalar(Math.exp(-12.0 * dt));
  }

  computeLanderOrbitalElements();

  if (lander.isLanded) gameState.retroHold = false;
  if (a11Run.active) {
    // No refuelling during "30 Seconds of Fuel"
  } else if (lander.isLanded) {
    lander.fuel = Math.min(100, lander.fuel + 24.0 * dt);
  } else if (thrustMag === 0) {
    lander.fuel = Math.min(100, lander.fuel + 1.5 * dt);
  }

  lander.thrustIntensity = THREE.MathUtils.lerp(lander.thrustIntensity, thrustMag, Math.min(1, dt * 12));
  landerGroup.position.copy(lander.pos);
  landerGroup.quaternion.copy(lander.quat);
  landerMeshRoot.rotation.set(0, 0, 0);

  if (lander.thrustIntensity > 0.04) {
    const flicker = 0.82 + Math.random() * 0.36;
    const plumeLen = (0.45 + lander.thrustIntensity * (isBoosting ? 1.45 : 0.92)) * flicker;
    enginePlume.scale.set(isBoosting ? 1.25 : 1.0, plumeLen, isBoosting ? 1.25 : 1.0);
    enginePlume.material.opacity = Math.min(0.92, lander.thrustIntensity * 0.92);
    enginePlume.material.color.setHex(isBoosting ? 0xf6c177 : 0xf4d58d);

    if (Math.random() < 0.65) {
      const exPos = lander.pos.clone().addScaledVector(_shipUp, -0.055);
      const exVel = _shipUp.clone().multiplyScalar(-1.35 - Math.random() * 0.7).add(lander.vel);
      spawnParticle(exPos, exVel, isBoosting ? 0xf6c177 : 0xe8d7ad, 0.22);
    }
    if (lander.aglUnits < 0.9 && upDot > 0.35 && Math.random() < 0.72) {
      const gPos = lander.pos.clone().normalize().multiplyScalar(surfR + 0.015);
      spawnDustBurst(gPos, lander.up, 2, 0.55);
    }
  } else {
    enginePlume.material.opacity = 0;
  }

  const beamLen = Math.min((lander.aglUnits + 0.05) / LANDER_SCALE, 34.0);
  laserBeam.scale.set(1, Math.max(0.05, beamLen), 1);
  laserBeam.visible = gameState.mode === 'lander' && lander.aglUnits > 0.03 && upDot > 0.45;

  sound.updateThruster(gameState.mode === 'lander' && gameState.started ? lander.thrustIntensity : 0, isBoosting);
}
