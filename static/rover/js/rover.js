import * as THREE from 'three';
import { LUNAR_MU, MOON_RADIUS, MOON_REAL_KM, ROVER_SCALE, ROVER_WHEEL_OFFSET } from './constants.js';
import { sound } from './audio.js';
import { gameState, keys, rover, roverCam, triggerSeismicEvent } from './state.js';
import { getExactSurfaceHit, getSurfaceNormalAtPosition, sampleTerrainAtLatLon, vec3ToLatLon } from './coords.js';
import { camera, roverGroup, spawnDustBurst, spawnParticle } from './scene.js';
import { _basisX, _rotMat, _shipFwd, _targetQ, _terrainNorm, _tmpAxis, _tmpDeltaQ } from './lander.js';
import { showToast } from './hud.js';
import { iceRun } from './challenges.js';
import { ROVER_CRASH_SPEED, crashRover, updateRoverCrash } from './apollo-ops.js';
import { ui } from './context-ui.js';
import { save, scheduleSave } from './save.js';
import { power, roverPowerMul } from './apollo11.js';

// =========================================================================
// 10. APOLLO LUNAR ROVER 1/6G PHYSICS, STUNTS & TUMBLING
// =========================================================================
const _roverUp = new THREE.Vector3();
const _rcMoonUp = new THREE.Vector3();
const _rcHorizVel = new THREE.Vector3();
const _rcDesiredHead = new THREE.Vector3();
const _rcViewDir = new THREE.Vector3();
const _rcDesiredPos = new THREE.Vector3();
const _rcDesiredLook = new THREE.Vector3();

export function resetRoverStuntAccumulators() {
  const st = rover.stunt;
  st.active = false;
  st.airTime = 0;
  st.maxAgl = 0;
  st.pitchRad = 0;
  st.yawRad = 0;
  st.rollRad = 0;
}

export function resetRoverDynamics() {
  rover.vel.set(0, 0, 0);
  rover.angVel.set(0, 0, 0);
  rover.speed = 0;
  rover.steerAngle = 0;
  rover.isGrounded = true;
  rover.isTumbling = false;
  rover.selfRightTimer = 0;
  rover.flipCooldown = 0;
  rover.aglUnits = 0;
  rover.stunt.bannerTimer = 0;
  resetRoverStuntAccumulators();
  roverCam.initialized = false;
  roverCam.userYaw = 0;
  roverCam.userPitch = 0;
}

/**
 * Evaluates cumulative airborne pitch/yaw/roll rotations and air time into
 * named stunts, combo bonuses and an internal difficulty used for star ratings & best-trick records.
 */
// 1–3 stars from a trick's internal difficulty (not a score — just a feel for how wild it was)
export function stuntStars(difficulty) {
  return difficulty >= 220 ? '★★★' : (difficulty >= 100 ? '★★☆' : '★☆☆');
}

function evaluateRoverStunt(st) {
  const TWO_PI = Math.PI * 2;
  const SNAP_MARGIN = 0.85; // ~49° grace margin so near-complete flips/spins feel rewarding
  const frontFlips = st.pitchRad > 0 ? Math.floor((st.pitchRad + SNAP_MARGIN) / TWO_PI) : 0;
  const backFlips = st.pitchRad < 0 ? Math.floor((-st.pitchRad + SNAP_MARGIN) / TWO_PI) : 0;
  const barrelRolls = Math.floor((Math.abs(st.rollRad) + SNAP_MARGIN) / TWO_PI);
  const spins360 = Math.floor((Math.abs(st.yawRad) + SNAP_MARGIN) / TWO_PI);
  const spin180 = (spins360 === 0 && Math.abs(st.yawRad) >= Math.PI * 0.78) ? 1 : 0;
  const bigAir = st.airTime >= 1.6;

  const tricks = [];
  let basePts = 0;
  let trickTypes = 0;

  if (backFlips > 0) {
    tricks.push(backFlips > 1 ? `${backFlips}× BACKFLIP` : 'BACKFLIP');
    basePts += backFlips * 60;
    trickTypes++;
  }
  if (frontFlips > 0) {
    tricks.push(frontFlips > 1 ? `${frontFlips}× FRONTFLIP` : 'FRONTFLIP');
    basePts += frontFlips * 60;
    trickTypes++;
  }
  if (barrelRolls > 0) {
    tricks.push(barrelRolls > 1 ? `${barrelRolls}× BARREL ROLL` : 'BARREL ROLL');
    basePts += barrelRolls * 75;
    trickTypes++;
  }
  if (spins360 > 0) {
    tricks.push(`${spins360 * 360}° SPIN`);
    basePts += spins360 * 50;
    trickTypes++;
  } else if (spin180 > 0) {
    tricks.push('180° SPIN');
    basePts += 25;
    trickTypes++;
  }
  if (bigAir) {
    tricks.push('BIG AIR');
    basePts += Math.round(st.airTime * 15);
    trickTypes++;
  }

  // Multi-trick combo multiplier (+25% per additional trick category)
  const comboMult = trickTypes >= 2 ? (1 + (trickTypes - 1) * 0.25) : 1;
  const totalPts = Math.round(basePts * comboMult);
  return {
    tricks,
    label: tricks.join(' + '),
    points: totalPts,
    isCombo: trickTypes >= 2
  };
}

export function updateRoverStuntHUD(dt) {
  const el = document.getElementById('stunt-hud');
  if (!el) return;

  if (!rover.deployed || gameState.mode !== 'rover') {
    el.classList.add('hidden');
    return;
  }

  const st = rover.stunt;
  if (st.bannerTimer > 0) {
    st.bannerTimer = Math.max(0, st.bannerTimer - dt);
  }

  const statusEl = document.getElementById('stunt-status-label');
  const airEl = document.getElementById('stunt-airtime');
  const tricksEl = document.getElementById('stunt-tricks-label');
  const ptsEl = document.getElementById('stunt-points-label');

  if (!rover.isGrounded && !rover.isTumbling && rover.selfRightTimer <= 0 && st.active) {
    const live = evaluateRoverStunt(st);
    const peakM = Math.round((st.maxAgl / MOON_RADIUS) * MOON_REAL_KM * 1000);
    el.classList.remove('hidden', 'border-[#7ec4a0]/65', 'border-[#d9826c]/70');
    el.classList.add('border-[#f4d58d]/55');
    statusEl.className = 'text-[#f4d58d] font-semibold';
    statusEl.textContent = live.isCombo ? 'STUNT COMBO' : 'AIRBORNE';
    airEl.textContent = `${st.airTime.toFixed(1)}s · ${peakM}m`;
    tricksEl.textContent = live.label || 'LUNAR JUMP';
    ptsEl.className = 'text-xs font-mono-tech font-semibold text-[#f4d58d] mt-0.5';
    ptsEl.textContent = live.points > 0 ? stuntStars(live.points) : 'SPIN/FLIP!';
  } else if (st.bannerTimer > 0) {
    el.classList.remove('hidden', 'border-[#f4d58d]/55', 'border-[#7ec4a0]/65', 'border-[#d9826c]/70');
    if (st.bannerKind === 'landed') {
      el.classList.add('border-[#7ec4a0]/65');
      statusEl.className = 'text-[#7ec4a0] font-semibold';
      ptsEl.className = 'text-xs font-mono-tech font-semibold text-[#7ec4a0] mt-0.5';
    } else {
      el.classList.add('border-[#d9826c]/70');
      statusEl.className = 'text-[#f8c4b4] font-semibold';
      ptsEl.className = 'text-xs font-mono-tech font-semibold text-[#f8c4b4] mt-0.5';
    }
    statusEl.textContent = st.bannerTitle;
    airEl.textContent = st.bannerSub;
    tricksEl.textContent = st.bannerPts;
    ptsEl.textContent = st.bannerKind === 'landed' ? (st.bannerStars || 'CLEAN') : 'NO LANDING';
  } else {
    el.classList.add('hidden');
  }
}

export function updateRoverPhysics(dt) {
  if (!rover.deployed) {
    const stuntEl = document.getElementById('stunt-hud');
    if (stuntEl && !stuntEl.classList.contains('hidden')) stuntEl.classList.add('hidden');
    return;
  }

  if (updateRoverCrash(dt)) return;
  const wasGrounded = rover.isGrounded;
  if (rover.flipCooldown > 0) rover.flipCooldown = Math.max(0, rover.flipCooldown - dt);
  if (rover.flipHintCooldown > 0) rover.flipHintCooldown = Math.max(0, rover.flipHintCooldown - dt);
  if (rover.selfRightTimer > 0) rover.selfRightTimer = Math.max(0, rover.selfRightTimer - dt);

  const rNow = Math.max(10, rover.pos.length());
  rover.up.copy(rover.pos).normalize();
  const GRAVITY = LUNAR_MU / (rNow * rNow);
  getSurfaceNormalAtPosition(rover.pos, _terrainNorm);

  const throttle = (keys.forward || keys.arrowUp ? 1 : 0) - (keys.backward || keys.arrowDown ? 1 : 0);
  const steerInput = (keys.left || keys.arrowLeft ? 1 : 0) - (keys.right || keys.arrowRight ? 1 : 0);
  const rollInput = (keys.yawRight ? 1 : 0) - (keys.yawLeft ? 1 : 0);
  const brake = keys.lift;
  const isBoosting = keys.boost && (iceRun.active || power.rover > 0);

  rover.steerAngle = THREE.MathUtils.lerp(rover.steerAngle, steerInput * 0.52, Math.min(1, dt * 10));
  rover.vel.addScaledVector(rover.up, -GRAVITY * dt);

  if (rover.isGrounded && !rover.isTumbling) {
    rover.forward.addScaledVector(_terrainNorm, -rover.forward.dot(_terrainNorm));
    if (rover.forward.lengthSq() < 1e-6) {
      const ref = Math.abs(_terrainNorm.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      rover.forward.crossVectors(ref, _terrainNorm);
    }
    rover.forward.normalize();
    rover.right.crossVectors(_terrainNorm, rover.forward).normalize();

    let vFwd = rover.vel.dot(rover.forward);
    let vLat = rover.vel.dot(rover.right);
    const vNorm = rover.vel.dot(_terrainNorm);

    // Turbo Boost (Shift / BOOST) gives high torque & speed to launch off hills and crater rims!
    const driveAccel = (isBoosting ? 6.8 : 1.65) * roverPowerMul();
    const maxSpd = (isBoosting ? 6.4 : 1.95) * roverPowerMul();
    const effectiveThrottle = isBoosting && throttle === 0 && !brake ? 1 : throttle;

    if (effectiveThrottle !== 0 && !brake) {
      const before = vFwd;
      vFwd += effectiveThrottle * driveAccel * dt;
      // Over the limit (e.g. just let go of turbo): coast down to it instead of snapping
      if (vFwd > maxSpd) vFwd = before > maxSpd ? Math.max(maxSpd, before - 3.2 * dt) : maxSpd;
      else if (vFwd < -maxSpd * 0.55) vFwd = before < -maxSpd * 0.55 ? Math.min(-maxSpd * 0.55, before + 3.2 * dt) : -maxSpd * 0.55;
    } else {
      const drag = brake ? 7.5 : 1.35;
      vFwd *= Math.exp(-drag * dt);
    }

    vLat *= Math.exp((isBoosting ? -3.4 : -4.6) * dt);

    const turnFactor = Math.abs(vFwd) > 0.04
      ? THREE.MathUtils.clamp(vFwd * 1.65, -2.3, 2.3)
      : (effectiveThrottle !== 0 ? effectiveThrottle * 0.65 : 0);
    if (Math.abs(rover.steerAngle) > 0.01 && Math.abs(turnFactor) > 0.01) {
      rover.forward.applyAxisAngle(_terrainNorm, rover.steerAngle * turnFactor * dt).normalize();
      rover.right.crossVectors(_terrainNorm, rover.forward).normalize();
    }

    rover.vel.copy(rover.forward).multiplyScalar(vFwd)
      .addScaledVector(rover.right, vLat)
      .addScaledVector(_terrainNorm, Math.max(0, vNorm));

    rover.speed = Math.abs(vFwd);
    rover.wheelSpin += (vFwd / 0.014) * dt;

    // Damp residual spin once wheels grip the regolith
    rover.angVel.multiplyScalar(Math.exp(-10.0 * dt));

    // Regolith rooster-tails & amber turbo boost exhaust sparks
    if ((Math.abs(vFwd) > 0.35 || isBoosting) && Math.random() < (isBoosting ? 0.92 : 0.55)) {
      const backPos = rover.pos.clone()
        .addScaledVector(rover.forward, -0.032)
        .addScaledVector(rover.right, (Math.random() > 0.5 ? 1 : -1) * 0.022);
      const sprayVel = rover.forward.clone().multiplyScalar(-Math.max(0.6, Math.abs(vFwd)) * 0.45)
        .addScaledVector(_terrainNorm, 0.28 + Math.random() * 0.28);
      spawnParticle(backPos, sprayVel, isBoosting ? 0xf6c177 : 0xbec4cf, isBoosting ? 0.32 : 0.38);
    }
  } else if (rover.isGrounded && rover.isTumbling) {
    // Resting or skidding upside-down / sideways on the lunar surface
    // Tap [SPACE] for a snappy self-righting thruster hop, or hold [A/D] / [Q/Z] to rock upright
    if (brake && rover.flipCooldown <= 0) {
      rover.vel.addScaledVector(_terrainNorm, 1.35);
      rover.angVel.multiplyScalar(0.15);
      rover.isGrounded = false;
      rover.isTumbling = false;
      rover.selfRightTimer = 0.55;
      rover.flipCooldown = 0.65;
      spawnDustBurst(rover.pos.clone(), _terrainNorm, 16, 0.65);
      sound.playPing(520, 0.14);
    } else {
      // Allow manual rocking/rolling back onto wheels with A/D or Q/Z
      const rockTorque = steerInput !== 0 ? steerInput : rollInput;
      if (rockTorque !== 0) {
        rover.angVel.z += rockTorque * 16.0 * dt;
        rover.vel.addScaledVector(_terrainNorm, 0.42 * dt);
      }
      if (throttle !== 0) {
        rover.angVel.x += throttle * 11.0 * dt;
      }
      // Regolith scrape friction while sliding on roof/side
      rover.vel.multiplyScalar(Math.exp(-3.6 * dt));
      rover.angVel.multiplyScalar(Math.exp(-4.2 * dt));
      const angSpd = rover.angVel.length();
      if (angSpd > 1e-5) {
        _tmpAxis.copy(rover.angVel).divideScalar(angSpd);
        _tmpDeltaQ.setFromAxisAngle(_tmpAxis, angSpd * dt);
        rover.quat.multiply(_tmpDeltaQ).normalize();
      }
      rover.speed = rover.vel.length();
    }
  } else {
    // Airborne in 1/6g: True 3D Angular Momentum Stunt Controls
    // W/S = Frontflip / Backflip (local X), A/D = 360° Spin (local Y), Q/Z = Barrel Roll (local Z)
    if (rover.selfRightTimer > 0) {
      // Smoothly snap upright during a self-righting hop
      rover.angVel.multiplyScalar(Math.exp(-10.0 * dt));
      const projFwd = rover.forward.clone().addScaledVector(_terrainNorm, -rover.forward.dot(_terrainNorm));
      if (projFwd.lengthSq() > 1e-6) {
        projFwd.normalize();
        _basisX.crossVectors(_terrainNorm, projFwd).normalize();
        _rotMat.makeBasis(_basisX, _terrainNorm, projFwd);
        _targetQ.setFromRotationMatrix(_rotMat).normalize();
        rover.quat.slerp(_targetQ, Math.min(1, dt * 10.5)).normalize();
      }
    } else {
      const PITCH_TORQUE = 14.5;
      const SPIN_TORQUE = 16.0;
      const ROLL_TORQUE = 13.0;
      const MAX_ROVER_ANG = 10.5;

      // Keys already held when the wheels left the ground (driving over a crest with W down)
      // don't count as stunt input: press them again in the air to flip or spin.
      const latch = rover.airLatch || (rover.airLatch = { t: 0, s: 0, r: 0 });
      if (rover.stunt.airTime === 0) { latch.t = throttle; latch.s = steerInput; latch.r = rollInput; }
      if (throttle !== latch.t) latch.t = 0;
      if (steerInput !== latch.s) latch.s = 0;
      if (rollInput !== latch.r) latch.r = 0;
      const pitchIn = throttle !== 0 && throttle !== latch.t ? throttle : 0;
      const spinIn = steerInput !== 0 && steerInput !== latch.s ? steerInput : 0;
      const rollIn = rollInput !== 0 && rollInput !== latch.r ? rollInput : 0;
      if (pitchIn !== 0) rover.angVel.x += pitchIn * PITCH_TORQUE * dt;
      if (spinIn !== 0) rover.angVel.y += spinIn * SPIN_TORQUE * dt;
      if (rollIn !== 0) rover.angVel.z += rollIn * ROLL_TORQUE * dt;

      // Light rotational drag so flips & spins carry momentum cleanly through the jump
      rover.angVel.multiplyScalar(Math.exp(-0.85 * dt));

      // Stability assist: with no stunt input, ease the chassis back towards wheels-down
      if (pitchIn === 0 && spinIn === 0 && rollIn === 0) {
        rover.angVel.multiplyScalar(Math.exp(-2.6 * dt));
        const lvlFwd = rover.forward.clone();
        _shipFwd.set(0, 0, 1).applyQuaternion(rover.quat);
        if (Math.abs(_shipFwd.dot(rover.up)) < 0.95) lvlFwd.copy(_shipFwd);
        lvlFwd.addScaledVector(rover.up, -lvlFwd.dot(rover.up));
        if (lvlFwd.lengthSq() > 1e-6) {
          lvlFwd.normalize();
          _basisX.crossVectors(rover.up, lvlFwd).normalize();
          _rotMat.makeBasis(_basisX, rover.up, lvlFwd);
          _targetQ.setFromRotationMatrix(_rotMat).normalize();
          rover.quat.slerp(_targetQ, Math.min(1, dt * 2.4)).normalize();
        }
      }
      if (rover.angVel.length() > MAX_ROVER_ANG) {
        rover.angVel.setLength(MAX_ROVER_ANG);
      }

      // Integrate local angular velocity directly into the rover's 3D quaternion
      const angSpd = rover.angVel.length();
      if (angSpd > 1e-5) {
        _tmpAxis.copy(rover.angVel).divideScalar(angSpd);
        _tmpDeltaQ.setFromAxisAngle(_tmpAxis, angSpd * dt);
        rover.quat.multiply(_tmpDeltaQ).normalize();
      }

      // Accumulate live airborne stunt telemetry
      rover.stunt.airTime += dt;
      rover.stunt.maxAgl = Math.max(rover.stunt.maxAgl, rover.aglUnits);
      rover.stunt.pitchRad += rover.angVel.x * dt;
      rover.stunt.yawRad += rover.angVel.y * dt;
      rover.stunt.rollRad += rover.angVel.z * dt;
      if (
        rover.stunt.airTime >= 0.45 ||
        Math.abs(rover.stunt.pitchRad) >= 1.4 ||
        Math.abs(rover.stunt.yawRad) >= 1.4 ||
        Math.abs(rover.stunt.rollRad) >= 1.4
      ) {
        rover.stunt.active = true;
      }
    }

    // Mid-air Turbo Boost fires along the rover's actual tilted nose direction
    _shipFwd.set(0, 0, 1).applyQuaternion(rover.quat).normalize();
    if (isBoosting) {
      rover.vel.addScaledVector(_shipFwd, 2.35 * dt);
      rover.vel.addScaledVector(rover.up, 0.3 * dt);
      if (Math.random() < 0.8) {
        const exPos = rover.pos.clone().addScaledVector(_shipFwd, -0.04);
        const exVel = _shipFwd.clone().multiplyScalar(-1.8).add(rover.vel);
        spawnParticle(exPos, exVel, 0xf6c177, 0.24);
      }
    }

    rover.speed = rover.vel.length();
    rover.wheelSpin += (rover.vel.dot(_shipFwd) / 0.014) * dt * 0.5;
  }

  rover.pos.addScaledVector(rover.vel, dt);

  const { lat, lon } = vec3ToLatLon(rover.pos);
  rover.lat = lat;
  rover.lon = lon;
  const sample = sampleTerrainAtLatLon(lat, lon);
  rover.elevKm = sample.elevKm;

  // Multi-point exact polygon contact check (center + front/rear axles) prevents clipping over sharp ridges
  const centerSurfR = getExactSurfaceHit(rover.pos, _terrainNorm);
  const axleHalfLen = 0.62 * ROVER_SCALE;
  const frontSurfR = getExactSurfaceHit(
    rover.pos.clone().addScaledVector(rover.forward, axleHalfLen),
    null
  );
  const rearSurfR = getExactSurfaceHit(
    rover.pos.clone().addScaledVector(rover.forward, -axleHalfLen),
    null
  );
  const surfR = Math.max(centerSurfR, (frontSurfR + rearSurfR) * 0.5 + 0.002);
  const contactR = surfR + ROVER_WHEEL_OFFSET + 0.002;
  const curR = rover.pos.length();
  rover.aglUnits = Math.max(0, curR - contactR);

  // Preserve upward crest momentum so fast boosted hills launch the rover cleanly into 1/6g flight!
  const vUpNormal = rover.vel.dot(_terrainNorm);
  const crestLaunching = vUpNormal > 0.34 && curR >= contactR - 0.001;   // small bumps keep the wheels down

  if (curR <= contactR + 0.004 && !crestLaunching) {
    const vIntoGround = -vUpNormal;
    if (!wasGrounded && vIntoGround > ROVER_CRASH_SPEED) {
      crashRover(_terrainNorm);
      return;
    }
    _roverUp.set(0, 1, 0).applyQuaternion(rover.quat).normalize();
    const uprightDot = _roverUp.dot(_terrainNorm);
    const wheelsDown = uprightDot >= 0.42; // Within ~65° of the slope: the suspension soaks up sloppy landings

    rover.pos.setLength(contactR);

    if (wheelsDown) {
      // Clean wheels-down landing (or rolled back onto wheels after tumbling!)
      if (!wasGrounded || rover.isTumbling) {
        _shipFwd.set(0, 0, 1).applyQuaternion(rover.quat);
        _shipFwd.addScaledVector(_terrainNorm, -_shipFwd.dot(_terrainNorm));
        if (_shipFwd.lengthSq() > 1e-4) {
          rover.forward.copy(_shipFwd).normalize();
          rover.right.crossVectors(_terrainNorm, rover.forward).normalize();
        }
        if (vIntoGround > 0.26) {
          spawnDustBurst(rover.pos.clone().addScaledVector(rover.up, -ROVER_WHEEL_OFFSET), _terrainNorm, 14, 0.55);
          triggerSeismicEvent(Math.min(0.65, vIntoGround * 0.4), rover.pos);
          sound.playTouchdown(false);
        }
        // Clean wheels-down landing: name the trick, rate it, remember personal bests
        if (!wasGrounded && !rover.isTumbling && rover.selfRightTimer <= 0) {
          const res = evaluateRoverStunt(rover.stunt);
          const recs = save.data.records;
          const newAir = rover.stunt.airTime > 0.8 && rover.stunt.airTime > recs.longestAir + 0.05;
          if (newAir) { recs.longestAir = rover.stunt.airTime; scheduleSave(); }
          if (res.points > 0) {
            const newBest = !recs.bestTrick || res.points > recs.bestTrick.difficulty;
            if (newBest) {
              recs.bestTrick = { label: res.label, difficulty: res.points, air: rover.stunt.airTime };
              scheduleSave();
            }
            rover.stunt.bannerTitle = newBest ? 'NEW BEST TRICK!' : (res.isCombo ? 'STUNT COMBO LANDED!' : 'STUNT LANDED!');
            rover.stunt.bannerSub = `${rover.stunt.airTime.toFixed(1)}s AIR${newAir ? ' · RECORD' : ''}`;
            rover.stunt.bannerPts = res.label;
            rover.stunt.bannerStars = stuntStars(res.points);
            rover.stunt.bannerKind = 'landed';
            rover.stunt.bannerTimer = 2.6;
            sound.playPing(740, 0.14);
            setTimeout(() => sound.playPing(988, 0.18), 75);
          }
        }
      }
      resetRoverStuntAccumulators();
      rover.isTumbling = false;
      // Springy lunar suspension: very hard impacts rebound slightly while keeping wheels down
      if (vIntoGround > 1.45) {
        const springRebound = Math.min(0.75, vIntoGround * 0.22);
        rover.vel.addScaledVector(_terrainNorm, vIntoGround + springRebound);
        rover.isGrounded = false;
      } else {
        if (vIntoGround > 0) {
          rover.vel.addScaledVector(_terrainNorm, vIntoGround);
        }
        rover.isGrounded = true;
        rover.aglUnits = 0;
      }
    } else {
      // Bad landing (sideways or upside-down): bouncy tumble across the regolith!
      if (!wasGrounded && rover.selfRightTimer <= 0 && (rover.stunt.active || rover.stunt.airTime > 0.6)) {
        const lost = evaluateRoverStunt(rover.stunt);
        rover.stunt.bannerTitle = 'WIPEOUT!';
        rover.stunt.bannerSub = `${rover.stunt.airTime.toFixed(1)}s AIR`;
        rover.stunt.bannerPts = lost.points > 0 ? `LOST ${lost.label}` : 'LANDED OFF-AXIS';
        rover.stunt.bannerKind = 'wipeout';
        rover.stunt.bannerTimer = 2.2;
      }
      resetRoverStuntAccumulators();
      rover.isTumbling = true;
      if (vIntoGround > 0.34) {
        const bounceSpeed = Math.min(2.4, vIntoGround * 0.52);
        rover.vel.addScaledVector(_terrainNorm, vIntoGround + bounceSpeed);
        // Scrape off a portion of tangential speed on bounce
        const vNormAfter = rover.vel.dot(_terrainNorm);
        const tangVel = rover.vel.clone().addScaledVector(_terrainNorm, -vNormAfter);
        rover.vel.copy(_terrainNorm).multiplyScalar(vNormAfter).addScaledVector(tangVel, 0.78);

        // Impart chaotic tumble spin from the impact & sliding speed
        const tumbleEnergy = Math.min(5.5, vIntoGround * 2.2 + tangVel.length() * 0.9);
        rover.angVel.x += (Math.random() - 0.5) * tumbleEnergy * 1.4;
        rover.angVel.z += (Math.random() - 0.5) * tumbleEnergy * 1.6;
        rover.angVel.y += (Math.random() - 0.5) * tumbleEnergy * 0.7;

        spawnDustBurst(rover.pos.clone(), _terrainNorm, 20, 0.85);
        triggerSeismicEvent(Math.min(0.85, vIntoGround * 0.5), rover.pos);
        sound.playTouchdown(true);

        rover.isGrounded = bounceSpeed < 0.22;
        if (rover.isGrounded) rover.aglUnits = 0;
      } else {
        if (vIntoGround > 0) {
          rover.vel.addScaledVector(_terrainNorm, vIntoGround);
        }
        rover.isGrounded = true;
        rover.aglUnits = 0;
        if (rover.flipHintCooldown <= 0 && rover.vel.length() < 0.5) {
          showToast((ui.touch ? 'Rover overturned — tap Flip upright, or rock it with the stick' : 'ROVER OVERTURNED — Press [SPACE] or hold [A/D] to self-right'), 'warn');
          rover.flipHintCooldown = 8.0;
        }
      }
    }
  } else if (curR > contactR + 0.012 || crestLaunching) {
    // Impart a natural launch pitch/spin kick when popping off a crater rim or hill crest
    if (wasGrounded && !rover.isTumbling) {
      rover.angVel.x += THREE.MathUtils.clamp(-vUpNormal * 0.5, -1.0, 0.4);
      rover.angVel.y += rover.steerAngle * Math.min(2.5, rover.speed) * 0.9;
    }
    rover.isGrounded = false;
  }

  // Only align chassis to the terrain slope when wheels are cleanly grounded; tumble & fly freely otherwise!
  if (rover.isGrounded && !rover.isTumbling) {
    const projFwd = rover.forward.clone().addScaledVector(_terrainNorm, -rover.forward.dot(_terrainNorm));
    if (projFwd.lengthSq() > 1e-6) {
      projFwd.normalize();
      _basisX.crossVectors(_terrainNorm, projFwd).normalize();
      _rotMat.makeBasis(_basisX, _terrainNorm, projFwd);
      _targetQ.setFromRotationMatrix(_rotMat).normalize();
      rover.quat.slerp(_targetQ, Math.min(1, dt * 11.0)).normalize();
    }
  }

  for (let i = 0; i < rover.frontPivots.length; i++) {
    rover.frontPivots[i].rotation.y = rover.steerAngle;
  }
  for (let i = 0; i < rover.wheels.length; i++) {
    rover.wheels[i].rotation.x = rover.wheelSpin;
  }
  // Sync the 3D model with the simulated state (missing in the broken build)
  roverGroup.position.copy(rover.pos);
  roverGroup.quaternion.copy(rover.quat);

  updateRoverStuntHUD(dt);
  roverCam.lastDt = dt;
  sound.updateThruster(isBoosting ? 0.32 : 0, isBoosting);
}


/**
 * Computes an anti-vomit, spring-damped stunt chase camera for the Lunar Rover:
 * - Horizon locked to the Moon's local radial up (never rolls during flips/tumbles)
 * - Smoothly tracks flight/driving trajectory and gently recenters user orbit while driving
 * - Dynamic distance, look-ahead, FOV kick on boost, and exact terrain clearance
 */
export function applySmoothRoverChaseCamera(dt) {
  const safeDt = THREE.MathUtils.clamp(dt || 0.016, 0.001, 0.05);
  _rcMoonUp.copy(rover.pos).normalize();

  // Compute horizontal velocity along the lunar tangent plane
  _rcHorizVel.copy(rover.vel).addScaledVector(_rcMoonUp, -rover.vel.dot(_rcMoonUp));
  const horizSpeed = _rcHorizVel.length();

  // Follow flight/travel direction when moving fast so 360° mid-air spins don't whip the camera
  if (horizSpeed > 0.45) {
    _rcDesiredHead.copy(_rcHorizVel).divideScalar(horizSpeed);
  } else {
    _rcDesiredHead.copy(rover.forward).addScaledVector(_rcMoonUp, -rover.forward.dot(_rcMoonUp));
    if (_rcDesiredHead.lengthSq() < 1e-6) {
      const ref = Math.abs(_rcMoonUp.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      _rcDesiredHead.crossVectors(ref, _rcMoonUp);
    }
    _rcDesiredHead.normalize();
  }

  if (!roverCam.initialized) {
    roverCam.baseFov = camera.fov;
    roverCam.up.copy(_rcMoonUp);
    roverCam.heading.copy(_rcDesiredHead);
  } else {
    // Smooth local horizon up (anti-vomit during flips & barrel rolls)
    roverCam.up.lerp(_rcMoonUp, 1 - Math.exp(-9.0 * safeDt)).normalize();

    // Project current heading onto new tangent plane and ease toward desired heading
    roverCam.heading.addScaledVector(roverCam.up, -roverCam.heading.dot(roverCam.up));
    if (roverCam.heading.lengthSq() < 1e-6) {
      roverCam.heading.copy(_rcDesiredHead);
    } else {
      roverCam.heading.normalize();
    }
    const headRate = rover.isGrounded && !rover.isTumbling ? 6.2 : 2.8;
    roverCam.heading.lerp(_rcDesiredHead, 1 - Math.exp(-headRate * safeDt)).normalize();

    // Gently recenter mouse-orbit yaw when driving at speed and not dragging
    if (!roverCam.dragging && horizSpeed > 0.5) {
      roverCam.userYaw *= Math.exp(-1.8 * safeDt);
    }
  }

  // Apply optional manual orbit yaw around local lunar up
  _rcViewDir.copy(roverCam.heading).applyAxisAngle(roverCam.up, roverCam.userYaw).normalize();

  const speedFactor = THREE.MathUtils.clamp(rover.speed / 6.0, 0, 1);
  const airPull = THREE.MathUtils.clamp(rover.aglUnits * 0.42, 0, 0.55);
  const boostPull = keys.boost ? 0.14 : 0;
  const dist = roverCam.zoom * (1.0 + speedFactor * 0.34) + airPull + boostPull;
  const pitch = THREE.MathUtils.clamp(
    0.26 + roverCam.userPitch + THREE.MathUtils.clamp(rover.aglUnits * 0.14, 0, 0.22),
    0.06,
    1.28
  );

  _rcDesiredPos.copy(rover.pos)
    .addScaledVector(_rcViewDir, -Math.cos(pitch) * dist)
    .addScaledVector(roverCam.up, Math.sin(pitch) * dist + 0.045);

  // Keep camera cleanly above crater walls and hill crests
  const camSurfR = getExactSurfaceHit(_rcDesiredPos, null);
  if (_rcDesiredPos.length() < camSurfR + 0.055) {
    _rcDesiredPos.setLength(camSurfR + 0.055);
  }

  // Subtle velocity look-ahead and slight downward framing during high jumps
  _rcDesiredLook.copy(rover.pos)
    .addScaledVector(_rcHorizVel, Math.min(0.065, 0.22 / Math.max(0.5, horizSpeed)))
    .addScaledVector(roverCam.up, 0.028 - THREE.MathUtils.clamp(rover.aglUnits * 0.12, 0, 0.15));

  if (!roverCam.initialized) {
    roverCam.pos.copy(_rcDesiredPos);
    roverCam.lookAt.copy(_rcDesiredLook);
    roverCam.initialized = true;
  } else {
    roverCam.pos.lerp(_rcDesiredPos, 1 - Math.exp(-11.0 * safeDt));
    roverCam.lookAt.lerp(_rcDesiredLook, 1 - Math.exp(-14.0 * safeDt));
  }

  // Subtle speed/boost FOV kick for extra sense of momentum
  const targetFov = roverCam.baseFov + speedFactor * 6.0 + (keys.boost ? 3.5 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.03) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-6.5 * safeDt));
    camera.updateProjectionMatrix();
  }

  camera.up.copy(roverCam.up);
  camera.position.copy(roverCam.pos);
  camera.lookAt(roverCam.lookAt);
}
