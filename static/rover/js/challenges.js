import * as THREE from 'three';
import { LANDER_FOOT_OFFSET, LUNAR_MU, MOON_RADIUS, MOON_REAL_KM, ROVER_WHEEL_OFFSET } from './constants.js';
import { sound } from './audio.js';
import { gameState, lander, rover, roverCam } from './state.js';
import { getExactSurfaceHit, latLonToVec3 } from './coords.js';
import { camera, landerGroup, roverGroup, scanRingMesh, scene, spawnDustBurst } from './scene.js';
import { _orbH } from './lander.js';
import { resetRoverDynamics } from './rover.js';
import { setGameMode, showToast } from './hud.js';
import { rdv, rdvEnd, restoreFullLander } from './apollo-ops.js';
import { save, scheduleSave } from './save.js';
import { a11Run, stopA11Run } from './apollo11.js';
import { say } from './radio.js';

// =========================================================================
// 15. ORBIT RING PREDICTOR & ROVER CHALLENGE RUNS
// =========================================================================
// =========================================================================
// 3D ORBITAL RING VISUALIZER (KEPLERIAN TWO-BODY PREDICTOR + AP/PE/IMP)
// =========================================================================
export const orbitRingState = {
  enabled: true,
  initialized: false,
  group: null,
  line: null,
  lineGeo: null,
  positions: null,
  colors: null,
  apSprite: null,
  peSprite: null,
  impSprite: null,
  maxSegments: 184
};

// Scratch vectors to avoid per-frame GC allocations (_orbH is shared with computeLanderOrbitalElements)
const _orbVxh = new THREE.Vector3();
const _orbE = new THREE.Vector3();
const _orbP = new THREE.Vector3();
const _orbQ = new THREE.Vector3();
const _orbW = new THREE.Vector3();
const _orbPt = new THREE.Vector3();
const _orbRhat = new THREE.Vector3();
const _orbColA = new THREE.Color();
const _orbColB = new THREE.Color();

/**
 * Creates a crisp high-DPI badge sprite texture for 3D AP / PE / IMP markers.
 */
function createOrbitMarkerSprite(label, accentHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');

  // Rounded dark pill background
  const r = 16;
  ctx.fillStyle = 'rgba(7, 11, 20, 0.9)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(r + 6, 8);
  ctx.lineTo(154 - r, 8);
  ctx.quadraticCurveTo(154, 8, 154, 8 + r);
  ctx.lineTo(154, 54 - r);
  ctx.quadraticCurveTo(154, 54, 154 - r, 54);
  ctx.lineTo(88, 54);
  ctx.lineTo(80, 66);
  ctx.lineTo(72, 54);
  ctx.lineTo(r + 6, 54);
  ctx.quadraticCurveTo(6, 54, 6, 54 - r);
  ctx.lineTo(6, 8 + r);
  ctx.quadraticCurveTo(6, 8, r + 6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Crisp monospace label
  ctx.fillStyle = accentHex;
  ctx.font = '700 28px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 80, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0.0); // Anchor bottom pointer directly onto the orbital ring
  sprite.visible = false;
  return sprite;
}

/**
 * Scales a 3D marker sprite smoothly with camera distance so it remains
 * legible both in close Lander flight and zoomed-out Orbital Recon.
 */
function placeOrbitMarker(sprite, worldPos) {
  sprite.position.copy(worldPos);
  const camDist = camera ? camera.position.distanceTo(worldPos) : 30;
  const s = THREE.MathUtils.clamp(camDist * 0.052, 0.28, 7.5);
  sprite.scale.set(s * 2.1, s * 0.95, 1);
  sprite.visible = true;
}

/**
 * Syncs the top-left Orbit Ring toggle button styling.
 */
export function syncOrbitRingToggleUI() {
  const btn = document.getElementById('orbit-ring-toggle-btn');
  if (!btn) return;
  const on = orbitRingState.enabled;
  btn.classList.toggle('text-[#7ec4a0]', on);
  btn.classList.toggle('border-[#7ec4a0]/45', on);
  btn.classList.toggle('text-slate-500', !on);
  btn.classList.toggle('border-slate-700', !on);
  btn.title = on ? '3D Orbital Ring: ON [V]' : '3D Orbital Ring: OFF [V]';
}

function toggleOrbitRingVisualizer() {
  orbitRingState.enabled = !orbitRingState.enabled;
  syncOrbitRingToggleUI();
  scheduleSave();
  if (!orbitRingState.enabled) {
    if (orbitRingState.group) orbitRingState.group.visible = false;
    const hud = document.getElementById('orbit-ring-hud');
    if (hud) hud.classList.add('hidden');
  }
  if (typeof showToast === 'function') {
    showToast(
      orbitRingState.enabled ? '3D Orbital Ring Visualizer: ON' : '3D Orbital Ring Visualizer: OFF',
      'info'
    );
  }
}

/**
 * Computes real-time two-body Keplerian orbital elements from the Lander's
 * state vector (r, v) around the Moon and updates the 3D path & AP/PE/IMP sprites.
 */
export function updateOrbitalRingVisualizer() {
  const hud = document.getElementById('orbit-ring-hud');
  if (
    !orbitRingState.initialized ||
    !orbitRingState.group ||
    !orbitRingState.enabled ||
    !gameState.started ||
    !lander.pos ||
    !lander.vel
  ) {
    if (orbitRingState.group) orbitRingState.group.visible = false;
    if (hud) hud.classList.add('hidden');
    return;
  }

  // Hide when parked on the surface or driving the rover on the ground
  const isAirborne = !lander.isLanded && ((lander.aglUnits || 0) > 0.14 || lander.inOrbit || lander.docked);
  const inRoverSurfaceMode = gameState.mode === 'rover';
  if (!isAirborne || inRoverSurfaceMode) {
    orbitRingState.group.visible = false;
    if (hud) hud.classList.add('hidden');
    return;
  }

  const rVec = lander.pos;
  const vVec = lander.vel;
  const r = rVec.length();
  const vSq = vVec.lengthSq();
  if (!Number.isFinite(r) || r < MOON_RADIUS * 0.5 || !Number.isFinite(vSq)) {
    orbitRingState.group.visible = false;
    if (hud) hud.classList.add('hidden');
    return;
  }

  // Specific angular momentum h = r x v
  _orbH.crossVectors(rVec, vVec);
  const h = _orbH.length();
  if (h < 0.08) {
    // Pure vertical hop with near-zero horizontal velocity: wait until slight lateral velocity exists
    orbitRingState.group.visible = false;
    if (hud) hud.classList.add('hidden');
    return;
  }

  // Eccentricity vector e = (v x h) / mu - r / |r|
  _orbVxh.crossVectors(vVec, _orbH);
  _orbRhat.copy(rVec).divideScalar(r);
  _orbE.copy(_orbVxh).divideScalar(LUNAR_MU).sub(_orbRhat);
  const e = _orbE.length();
  const p = (h * h) / LUNAR_MU; // Semi-latus rectum

  // Perifocal frame: W = orbit normal, P = periapsis direction, Q = W x P
  _orbW.copy(_orbH).divideScalar(h);
  if (e > 1e-4) {
    _orbP.copy(_orbE).divideScalar(e);
  } else {
    _orbP.copy(_orbRhat);
  }
  _orbQ.crossVectors(_orbW, _orbP).normalize();

  // Current true anomaly nu0 of the Lander
  const nu0 = Math.atan2(_orbRhat.dot(_orbQ), _orbRhat.dot(_orbP));

  const rp = p / (1 + e);
  const isEscape = e >= 0.995;
  const ra = isEscape ? Infinity : (p / (1 - e));
  const surfaceCutoff = MOON_RADIUS * 1.002;
  const isStable = !isEscape && rp > surfaceCutoff;

  // Choose color palette by trajectory class
  if (isEscape) {
    _orbColA.setHex(0x7dd3fc); // Sky cyan (Escape)
    _orbColB.setHex(0x1d4ed8);
  } else if (isStable) {
    _orbColA.setHex(0x7ec4a0); // Emerald (Stable Closed Orbit)
    _orbColB.setHex(0x1e4d3b);
  } else {
    _orbColA.setHex(0xf4d58d); // Amber (Sub-Orbital Arc)
    _orbColB.setHex(0xd9826c); // Coral toward impact
  }

  const N = orbitRingState.maxSegments;
  const posArr = orbitRingState.positions;
  const colArr = orbitRingState.colors;
  let vertexCount = 0;

  orbitRingState.apSprite.visible = false;
  orbitRingState.peSprite.visible = false;
  orbitRingState.impSprite.visible = false;

  if (isStable) {
    // Full closed 360° elliptical ring sweeping forward from the Lander's current true anomaly
    for (let i = 0; i <= N; i++) {
      const frac = i / N;
      const nu = nu0 + frac * Math.PI * 2;
      const rad = p / (1 + e * Math.cos(nu));
      const c = Math.cos(nu);
      const s = Math.sin(nu);
      _orbPt.copy(_orbP).multiplyScalar(rad * c).addScaledVector(_orbQ, rad * s);

      posArr[vertexCount * 3] = _orbPt.x;
      posArr[vertexCount * 3 + 1] = _orbPt.y;
      posArr[vertexCount * 3 + 2] = _orbPt.z;

      // Bright leading edge fading gently behind the ship to communicate direction of travel
      const mix = Math.pow(frac, 0.75);
      colArr[vertexCount * 3] = THREE.MathUtils.lerp(_orbColA.r, _orbColB.r, mix);
      colArr[vertexCount * 3 + 1] = THREE.MathUtils.lerp(_orbColA.g, _orbColB.g, mix);
      colArr[vertexCount * 3 + 2] = THREE.MathUtils.lerp(_orbColA.b, _orbColB.b, mix);
      vertexCount++;
    }

    // Place AP (nu = PI) and PE (nu = 0) 3D markers
    _orbPt.copy(_orbP).multiplyScalar(-ra);
    placeOrbitMarker(orbitRingState.apSprite, _orbPt);
    _orbPt.copy(_orbP).multiplyScalar(rp);
    placeOrbitMarker(orbitRingState.peSprite, _orbPt);
  } else if (!isEscape) {
    // Sub-orbital ballistic arc: clip cleanly at the lunar surface so the ring never dives inside the Moon
    const cosHit = THREE.MathUtils.clamp((p / surfaceCutoff - 1) / Math.max(e, 1e-5), -1, 1);
    const nuHit = Math.acos(cosHit); // Ascent surface crossing in [0, PI]
    const nuStart = nuHit;
    const nuEnd = Math.PI * 2 - nuHit; // Future descent impact point

    if (nuEnd > nuStart + 0.01) {
      for (let i = 0; i <= N; i++) {
        const frac = i / N;
        const nu = THREE.MathUtils.lerp(nuStart, nuEnd, frac);
        const rad = p / (1 + e * Math.cos(nu));
        const c = Math.cos(nu);
        const s = Math.sin(nu);
        _orbPt.copy(_orbP).multiplyScalar(rad * c).addScaledVector(_orbQ, rad * s);

        posArr[vertexCount * 3] = _orbPt.x;
        posArr[vertexCount * 3 + 1] = _orbPt.y;
        posArr[vertexCount * 3 + 2] = _orbPt.z;

        colArr[vertexCount * 3] = THREE.MathUtils.lerp(_orbColA.r, _orbColB.r, frac);
        colArr[vertexCount * 3 + 1] = THREE.MathUtils.lerp(_orbColA.g, _orbColB.g, frac);
        colArr[vertexCount * 3 + 2] = THREE.MathUtils.lerp(_orbColA.b, _orbColB.b, frac);
        vertexCount++;
      }

      // Place AP at apex (nu = PI) and IMP at surface intersection (nu = nuEnd)
      if (ra > surfaceCutoff) {
        _orbPt.copy(_orbP).multiplyScalar(-ra);
        placeOrbitMarker(orbitRingState.apSprite, _orbPt);
      }
      const cImp = Math.cos(nuEnd);
      const sImp = Math.sin(nuEnd);
      _orbPt.copy(_orbP).multiplyScalar(surfaceCutoff * cImp).addScaledVector(_orbQ, surfaceCutoff * sImp);
      placeOrbitMarker(orbitRingState.impSprite, _orbPt);
    }
  } else {
    // Hyperbolic / Escape trajectory
    const maxPlotR = MOON_RADIUS * 5.2;
    const cosLim = THREE.MathUtils.clamp((p / maxPlotR - 1) / Math.max(e, 1e-5), -0.999, 0.999);
    const nuAsym = e > 1.0001 ? Math.acos(-1 / e) - 0.08 : Math.PI - 0.12;
    const nuLim = Math.min(Math.acos(cosLim), nuAsym);
    const nuStart = Math.max(-nuLim, nu0 - 0.4);
    const nuEnd = nuLim;

    if (nuEnd > nuStart + 0.01) {
      for (let i = 0; i <= N; i++) {
        const frac = i / N;
        const nu = THREE.MathUtils.lerp(nuStart, nuEnd, frac);
        const denom = 1 + e * Math.cos(nu);
        if (denom <= 0.01) continue;
        const rad = p / denom;
        if (rad < surfaceCutoff || rad > maxPlotR * 1.15) continue;

        const c = Math.cos(nu);
        const s = Math.sin(nu);
        _orbPt.copy(_orbP).multiplyScalar(rad * c).addScaledVector(_orbQ, rad * s);

        posArr[vertexCount * 3] = _orbPt.x;
        posArr[vertexCount * 3 + 1] = _orbPt.y;
        posArr[vertexCount * 3 + 2] = _orbPt.z;

        colArr[vertexCount * 3] = THREE.MathUtils.lerp(_orbColA.r, _orbColB.r, frac);
        colArr[vertexCount * 3 + 1] = THREE.MathUtils.lerp(_orbColA.g, _orbColB.g, frac);
        colArr[vertexCount * 3 + 2] = THREE.MathUtils.lerp(_orbColA.b, _orbColB.b, frac);
        vertexCount++;
      }
      if (rp > surfaceCutoff) {
        _orbPt.copy(_orbP).multiplyScalar(rp);
        placeOrbitMarker(orbitRingState.peSprite, _orbPt);
      }
    }
  }

  if (vertexCount < 2) {
    orbitRingState.group.visible = false;
    if (hud) hud.classList.add('hidden');
    return;
  }

  orbitRingState.lineGeo.setDrawRange(0, vertexCount);
  orbitRingState.lineGeo.attributes.position.needsUpdate = true;
  orbitRingState.lineGeo.attributes.color.needsUpdate = true;
  orbitRingState.group.visible = true;

  // Update top-center Keplerian Orbital Telemetry Pill
  if (hud) {
    const toAltKm = (radUnits) => Math.round(((radUnits - MOON_RADIUS) / MOON_RADIUS) * MOON_REAL_KM);
    const statusEl = document.getElementById('orbit-ring-status');
    const dotEl = document.getElementById('orbit-ring-dot');
    const apEl = document.getElementById('orbit-ring-ap');
    const peEl = document.getElementById('orbit-ring-pe');
    const eccEl = document.getElementById('orbit-ring-ecc');
    const perEl = document.getElementById('orbit-ring-period');
    const perWrap = document.getElementById('orbit-ring-period-wrap');

    if (isEscape) {
      statusEl.textContent = 'ESCAPE TRAJECTORY';
      statusEl.className = 'font-semibold tracking-wider text-[#7dd3fc]';
      dotEl.className = 'w-2 h-2 rounded-full bg-[#7dd3fc]';
      apEl.textContent = '∞';
      peEl.textContent = rp > surfaceCutoff ? `${toAltKm(rp)} km` : 'IMPACT';
      if (perWrap) perWrap.classList.add('hidden');
    } else if (isStable) {
      statusEl.textContent = 'STABLE ORBIT';
      statusEl.className = 'font-semibold tracking-wider text-[#7ec4a0]';
      dotEl.className = 'w-2 h-2 rounded-full bg-[#7ec4a0]';
      apEl.textContent = `${toAltKm(ra)} km`;
      peEl.textContent = `${toAltKm(rp)} km`;
      const a = p / (1 - e * e);
      const periodSec = 2 * Math.PI * Math.sqrt((a * a * a) / LUNAR_MU);
      if (perEl && Number.isFinite(periodSec)) {
        const mins = Math.floor(periodSec / 60);
        const secs = Math.round(periodSec % 60);
        perEl.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        if (perWrap) perWrap.classList.remove('hidden');
      }
    } else {
      statusEl.textContent = 'SUB-ORBITAL';
      statusEl.className = 'font-semibold tracking-wider text-[#f4d58d]';
      dotEl.className = 'w-2 h-2 rounded-full bg-[#f4d58d]';
      apEl.textContent = `${Math.max(0, toAltKm(ra))} km`;
      peEl.textContent = 'SURFACE';
      if (perWrap) perWrap.classList.add('hidden');
    }

    if (eccEl) eccEl.textContent = e.toFixed(2);
    hud.classList.remove('hidden');
  }
}

/**
 * Self-bootstrapping initializer that attaches the 3D Orbital Ring group
 * to the Three.js scene and hooks renderer.render cleanly.
 */
export function initOrbitalRingVisualizer() {
  if (orbitRingState.initialized) return;
  orbitRingState.initialized = true;

  const maxVerts = orbitRingState.maxSegments + 1;
  const positions = new Float32Array(maxVerts * 3);
  const colors = new Float32Array(maxVerts * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false
  });

  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;

  const group = new THREE.Group();
  group.visible = false;
  group.add(line);

  const apSprite = createOrbitMarkerSprite('AP', '#f4d58d');
  const peSprite = createOrbitMarkerSprite('PE', '#7ec4a0');
  const impSprite = createOrbitMarkerSprite('IMP', '#d9826c');
  group.add(apSprite, peSprite, impSprite);
  scene.add(group);

  orbitRingState.group = group;
  orbitRingState.line = line;
  orbitRingState.lineGeo = geo;
  orbitRingState.positions = positions;
  orbitRingState.colors = colors;
  orbitRingState.apSprite = apSprite;
  orbitRingState.peSprite = peSprite;
  orbitRingState.impSprite = impSprite;

  // Wire HUD toggle button & [V] hotkey
  const toggleBtn = document.getElementById('orbit-ring-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleOrbitRingVisualizer);
  }
  syncOrbitRingToggleUI();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      toggleOrbitRingVisualizer();
    }
  });

}


// =========================================================================
// APOLLO 15 — HADLEY RILLE ROVER RUN (TIMED GEOLOGY CHECKPOINT CHALLENGE)
// =========================================================================
export const hadleyRun = {
  active: false,
  initialized: false,
  step: 0, // 0, 1, 2 = 3 Geology Samples; 3 = Return to LM Falcon
  elapsed: 0,
  bestTime: null,
  lastPerfMs: 0,
  group: null,
  beamMesh: null,
  ringMesh: null,
  innerRingMesh: null,
  labelSprite: null,
  checkpoints: [],
  captureRadius: 0.42
};

const HADLEY_ORIGIN = { lat: 26.13, lon: 3.63 }; // Real Apollo 15 LM "Falcon" coordinates
const HADLEY_STATIONS = [
  {
    short: '1. Basalt',
    beacon: 'STN 1 · ELBOW CRATER',
    name: 'STN 1 · Elbow Crater (Mare Basalt)',
    hint: '3.3-billion-year-old volcanic flood basalt along Palus Putredinis',
    fact: 'SAMPLE 1 COLLECTED: Mare Basalt — ancient lava flood that filled the Imbrium basin 3.3 billion years ago!',
    dLat: -4.2,
    dLon: 1.4,
    color: 0xf4d58d,
    hex: '#f4d58d'
  },
  {
    short: '2. Rille',
    beacon: 'STN 2 · HADLEY RILLE',
    name: 'STN 2 · Hadley Rille Rim (Lava Channel)',
    hint: 'Layered bedrock exposed along a 1.5 km-wide collapsed lava tube',
    fact: 'SAMPLE 2 COLLECTED: Hadley Rille Outcrop — exposed lava flow layers lining a sinuous lunar valley!',
    dLat: -1.8,
    dLon: -4.6,
    color: 0x7dd3fc,
    hex: '#7dd3fc'
  },
  {
    short: '3. Genesis',
    beacon: 'STN 3 · GENESIS ROCK',
    name: 'STN 3 · Spur Crater (Genesis Rock)',
    hint: 'Climb Mons Hadley Delta to recover 4.1-billion-year-old highland crust',
    fact: 'SAMPLE 3 COLLECTED: The Genesis Rock (Anorthosite) — 4.1-billion-year-old piece of the Moon’s original crust!',
    dLat: 3.8,
    dLon: -2.4,
    color: 0xc4b5fd,
    hex: '#c4b5fd'
  },
  {
    short: '4. Falcon',
    beacon: 'LM FALCON · FINISH',
    name: 'FINAL LEG · Return to LM "Falcon"',
    hint: 'Race all 3 lunar rock samples back to the Lunar Module!',
    fact: 'APOLLO 15 COMPLETE: All samples stowed aboard LM Falcon!',
    dLat: 0,
    dLon: 0,
    color: 0x7ec4a0,
    hex: '#7ec4a0'
  }
];

const _hrUp = new THREE.Vector3();
const _hrToTarget = new THREE.Vector3();
const _hrFwd = new THREE.Vector3();
const _hrRight = new THREE.Vector3();
const _hrNorm = new THREE.Vector3();
const _hrBasisX = new THREE.Vector3();
const _hrMat = new THREE.Matrix4();

function hadleyLatLonToVec3(latDeg, lonDeg, radius) {
  if (typeof latLonToVec3 === 'function') {
    return latLonToVec3(latDeg, lonDeg, radius);
  }
  const phi = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

export function formatHadleyTime(sec) {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  const mm = String(mins).padStart(2, '0');
  const ss = rem < 10 ? `0${rem.toFixed(1)}` : rem.toFixed(1);
  return `${mm}:${ss}`;
}

/**
 * Generates a crisp floating 3D sprite texture for the active Hadley Rille waypoint.
 */
function setHadleyBeaconLabel(text, accentHex) {
  if (!hadleyRun.labelSprite) return;
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 84;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(7, 11, 20, 0.9)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 4;
  const r = 18;
  ctx.beginPath();
  ctx.moveTo(r + 6, 8);
  ctx.lineTo(414 - r, 8);
  ctx.quadraticCurveTo(414, 8, 414, 8 + r);
  ctx.lineTo(414, 62 - r);
  ctx.quadraticCurveTo(414, 62, 414 - r, 62);
  ctx.lineTo(222, 62);
  ctx.lineTo(210, 76);
  ctx.lineTo(198, 62);
  ctx.lineTo(r + 6, 62);
  ctx.quadraticCurveTo(6, 62, 6, 62 - r);
  ctx.lineTo(6, 8 + r);
  ctx.quadraticCurveTo(6, 8, r + 6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 210, 36);

  if (hadleyRun.labelSprite.material.map) {
    hadleyRun.labelSprite.material.map.dispose();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  hadleyRun.labelSprite.material.map = tex;
  hadleyRun.labelSprite.material.needsUpdate = true;
}

function syncHadleyStepVisuals() {
  const st = HADLEY_STATIONS[hadleyRun.step];
  const cp = hadleyRun.checkpoints[hadleyRun.step];
  if (!st || !cp || !hadleyRun.group) return;

  // Position beacon group flush on the lunar surface at the active checkpoint
  hadleyRun.group.position.copy(cp.pos);
  const up = cp.pos.clone().normalize();
  hadleyRun.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  hadleyRun.group.visible = true;

  if (hadleyRun.beamMesh) hadleyRun.beamMesh.material.color.setHex(st.color);
  if (hadleyRun.ringMesh) hadleyRun.ringMesh.material.color.setHex(st.color);
  if (hadleyRun.innerRingMesh) hadleyRun.innerRingMesh.material.color.setHex(st.color);
  setHadleyBeaconLabel(st.beacon, st.hex);

  // Update HUD text & 4-step progress pills
  const nameEl = document.getElementById('hadley-target-name');
  const hintEl = document.getElementById('hadley-target-hint');
  if (nameEl) {
    nameEl.textContent = st.name;
    nameEl.style.color = st.hex;
  }
  if (hintEl) hintEl.textContent = st.hint;

  for (let i = 0; i < 4; i++) {
    const pill = document.getElementById(`hadley-pill-${i}`);
    if (!pill) continue;
    if (i < hadleyRun.step) {
      pill.className = 'py-1 px-1 rounded-lg border border-[#7ec4a0]/55 bg-[#7ec4a0]/18 text-[#7ec4a0] truncate';
      pill.textContent = `✓ ${HADLEY_STATIONS[i].short.slice(3)}`;
    } else if (i === hadleyRun.step) {
      pill.className = 'py-1 px-1 rounded-lg border border-[#f4d58d]/65 bg-[#f4d58d]/18 text-[#f4d58d] font-semibold truncate';
      pill.textContent = HADLEY_STATIONS[i].short;
    } else {
      pill.className = 'py-1 px-1 rounded-lg border border-slate-800 bg-[#0b101c] text-slate-500 truncate';
      pill.textContent = HADLEY_STATIONS[i].short;
    }
  }
}

export function stopHadleyRilleRun(silent = false) {
  hadleyRun.active = false;
  if (hadleyRun.group) hadleyRun.group.visible = false;
  const hud = document.getElementById('hadley-hud');
  if (hud) hud.classList.add('hidden');
  if (!silent && typeof showToast === 'function') {
    showToast('Exited Apollo 15 Hadley Rille Run', 'info');
  }
}

function completeHadleyRilleRun() {
  hadleyRun.active = false;
  say('hadleyDone');
  if (hadleyRun.group) hadleyRun.group.visible = false;
  const hud = document.getElementById('hadley-hud');
  if (hud) hud.classList.add('hidden');

  const t = hadleyRun.elapsed;
  const hadleyNewBest = hadleyRun.bestTime === null || t < hadleyRun.bestTime;
  if (hadleyNewBest) {
    hadleyRun.bestTime = t;
    save.data.records.hadleyBest = t;
    scheduleSave();
    const badge = document.getElementById('hadley-best-badge');
    if (badge) badge.textContent = `BEST ${formatHadleyTime(t)}`;
  }

  let medal = 'BRONZE MEDAL · COMPLETE';
  let medalClass = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-[#d9826c]/20 text-[#f8c4b4] border border-[#d9826c]/50';
  if (t < 55) {
    medal = 'GOLD MEDAL · APOLLO ACE';
    medalClass = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-[#f4d58d]/22 text-[#f4d58d] border border-[#f4d58d]/55';
  } else if (t < 80) {
    medal = 'SILVER MEDAL · MISSION COMPLETE';
    medalClass = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-slate-200/18 text-slate-100 border border-slate-300/50';
  }

  sound.playScanComplete();

  const modal = document.getElementById('hadley-result-modal');
  const medalEl = document.getElementById('hadley-medal-badge');
  const timeEl = document.getElementById('hadley-final-time');
  const ptsEl = document.getElementById('hadley-final-pts');
  if (medalEl) {
    medalEl.textContent = medal;
    medalEl.className = medalClass;
  }
  if (timeEl) timeEl.textContent = formatHadleyTime(t);
  if (ptsEl) ptsEl.textContent = hadleyNewBest ? 'NEW BEST ★' : formatHadleyTime(hadleyRun.bestTime);
  if (modal) modal.classList.remove('hidden');
}

/**
 * Teleports LM Falcon & LRV-1 Rover to real Apollo 15 Hadley-Apennine coordinates,
 * places the 3 geological sample beacons flush on the NASA LOLA terrain, and starts the clock.
 */
function startHadleyRilleRun() {
  setTimeout(() => say('hadleyStart'), 900);
  sound.init();
  if (a11Run.active) stopA11Run(true);
  if (rdv.active) rdvEnd(true);
  restoreFullLander();
  lander.crashed = false;
  if (iceRun.active) stopSouthPoleIceRun(true);
  document.getElementById('sites-drawer').classList.add('hidden');
  document.getElementById('ice-result-modal').classList.add('hidden');

  // Hide start/result overlays and ensure HUD is visible
  const startOv = document.getElementById('start-overlay');
  const hudRoot = document.getElementById('hud-root');
  const resModal = document.getElementById('hadley-result-modal');
  if (startOv) startOv.classList.add('hidden');
  if (hudRoot) hudRoot.classList.remove('hidden');
  if (resModal) resModal.classList.add('hidden');

  // 1. Place LM "Falcon" flush at real Apollo 15 site (26.13°N, 3.63°E)
  const lmDir = hadleyLatLonToVec3(HADLEY_ORIGIN.lat, HADLEY_ORIGIN.lon, MOON_RADIUS);
  const lmSurfR = getExactSurfaceHit(lmDir, _hrNorm);
  const lmUp = lmDir.clone().normalize();
  const lmOffset = LANDER_FOOT_OFFSET;

  lander.pos.copy(lmUp).multiplyScalar(lmSurfR + lmOffset);
  lander.vel.set(0, 0, 0);
  if (lander.angVel) lander.angVel.set(0, 0, 0);
  lander.isLanded = true;
  lander.inOrbit = false;
  lander.docked = false;
  lander.aglUnits = 0;
  lander.lat = HADLEY_ORIGIN.lat;
  lander.lon = HADLEY_ORIGIN.lon;
  lander.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _hrNorm).normalize();
  lander.up.copy(lmUp);
  lander.forward.set(0, 0, 1).applyQuaternion(lander.quat);
  lander.forward.addScaledVector(lmUp, -lander.forward.dot(lmUp)).normalize();
  lander.right.crossVectors(lmUp, lander.forward).normalize();
  lander.fuel = 100;
  lander.thrustIntensity = 0;
  gameState.autoSoftLand = false;
  landerGroup.position.copy(lander.pos);
  landerGroup.quaternion.copy(lander.quat);
  landerGroup.visible = true;

  // 2. Build all 4 exact surface waypoints around Hadley-Apennine
  hadleyRun.checkpoints = HADLEY_STATIONS.map((st, idx) => {
    if (idx === 3) {
      return { pos: lmUp.clone().multiplyScalar(lmSurfR + 0.01) };
    }
    const raw = hadleyLatLonToVec3(HADLEY_ORIGIN.lat + st.dLat, HADLEY_ORIGIN.lon + st.dLon, MOON_RADIUS);
    const sR = getExactSurfaceHit(raw, null);
    return { pos: raw.normalize().multiplyScalar(sR + 0.01) };
  });

  // 3. Deploy LRV-1 Rover beside LM Falcon, aimed straight at Station 1 (Elbow Crater)
  const st1Pos = hadleyRun.checkpoints[0].pos;
  const tangentToSt1 = st1Pos.clone().sub(lander.pos);
  tangentToSt1.addScaledVector(lmUp, -tangentToSt1.dot(lmUp)).normalize();

  const roverSpawnDir = lander.pos.clone().addScaledVector(tangentToSt1, 0.24);
  const roverSurfR = getExactSurfaceHit(roverSpawnDir, _hrNorm);
  const wheelOff = ROVER_WHEEL_OFFSET;

  resetRoverDynamics();
  rover.deployed = true;
  rover.pos.copy(roverSpawnDir).normalize().multiplyScalar(roverSurfR + wheelOff + 0.004);
  rover.up.copy(rover.pos).normalize();
  rover.forward.copy(tangentToSt1).addScaledVector(_hrNorm, -tangentToSt1.dot(_hrNorm)).normalize();
  rover.right.crossVectors(_hrNorm, rover.forward).normalize();
  _hrBasisX.crossVectors(_hrNorm, rover.forward).normalize();
  _hrMat.makeBasis(_hrBasisX, _hrNorm, rover.forward);
  rover.quat.setFromRotationMatrix(_hrMat).normalize();
  roverGroup.position.copy(rover.pos);
  roverGroup.quaternion.copy(rover.quat);
  roverGroup.visible = true;

  // Start the sim (the run can be launched straight from the briefing screen) & switch to Rover mode
  gameState.started = true;
  gameState.activeScan.inProgress = false;
  if (scanRingMesh) scanRingMesh.visible = false;
  setGameMode('rover');

  hadleyRun.active = true;
  hadleyRun.step = 0;
  hadleyRun.elapsed = 0;
  hadleyRun.lastPerfMs = performance.now();

  syncHadleyStepVisuals();
  const hud = document.getElementById('hadley-hud');
  if (hud) hud.classList.remove('hidden');

  sound.playPing(587.33, 0.14);
  setTimeout(() => sound.playPing(880, 0.18), 110);
  if (typeof showToast === 'function') {
    showToast('APOLLO 15 HADLEY RILLE RUN: Collect 3 lunar samples & return to LM Falcon!', 'info');
  }
}

/**
 * Per-frame update for the Hadley Rille Rover Run:
 * advances timer, animates the 3D beacon, updates compass arrow & distance,
 * and checks checkpoint sample capture.
 */
export function updateHadleyRilleRun() {
  if (!hadleyRun.active || !hadleyRun.initialized) return;

  const nowMs = performance.now();
  const dt = THREE.MathUtils.clamp((nowMs - hadleyRun.lastPerfMs) / 1000, 0, 0.1);
  hadleyRun.lastPerfMs = nowMs;
  hadleyRun.elapsed += dt;

  const timerEl = document.getElementById('hadley-timer');
  if (timerEl) timerEl.textContent = formatHadleyTime(hadleyRun.elapsed);

  const cp = hadleyRun.checkpoints[hadleyRun.step];
  if (!cp) return;

  // Animate pulsing 3D beacon ring & distance-scaled label sprite
  const pulse = 1 + Math.sin(nowMs * 0.006) * 0.12;
  if (hadleyRun.ringMesh) {
    hadleyRun.ringMesh.scale.set(pulse, pulse, 1);
    hadleyRun.ringMesh.rotation.z = nowMs * 0.0014;
  }
  if (hadleyRun.innerRingMesh) {
    hadleyRun.innerRingMesh.rotation.z = -nowMs * 0.0022;
  }
  if (hadleyRun.labelSprite && camera) {
    const camDist = camera.position.distanceTo(cp.pos);
    const s = THREE.MathUtils.clamp(camDist * 0.055, 0.22, 4.5);
    hadleyRun.labelSprite.scale.set(s * 3.8, s * 0.76, 1);
  }

  // Compute distance & relative compass bearing from the Rover
  const distUnits = rover.pos.distanceTo(cp.pos);
  const distKm = (distUnits / MOON_RADIUS) * MOON_REAL_KM;
  const distEl = document.getElementById('hadley-dist');
  if (distEl) {
    distEl.textContent = distKm >= 10 ? `${distKm.toFixed(0)} km` : `${distKm.toFixed(1)} km`;
  }

  // Relative bearing arrow (0 deg = straight ahead of rover/camera heading)
  _hrUp.copy(rover.pos).normalize();
  _hrToTarget.copy(cp.pos).sub(rover.pos);
  _hrToTarget.addScaledVector(_hrUp, -_hrToTarget.dot(_hrUp));
  if (_hrToTarget.lengthSq() > 1e-6) {
    _hrToTarget.normalize();
    const refFwd = roverCam.initialized
      ? _hrFwd.copy(roverCam.heading)
      : _hrFwd.copy(rover.forward);
    refFwd.addScaledVector(_hrUp, -refFwd.dot(_hrUp)).normalize();
    _hrRight.crossVectors(refFwd, _hrUp).normalize();
    const fDot = _hrToTarget.dot(refFwd);
    const rDot = _hrToTarget.dot(_hrRight);
    const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(rDot, fDot));
    const arrowEl = document.getElementById('hadley-arrow');
    if (arrowEl) {
      arrowEl.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
    }
  }

  // Checkpoint capture check
  const capRad = hadleyRun.step === 3 ? 0.48 : hadleyRun.captureRadius;
  if (distUnits <= capRad) {
    const st = HADLEY_STATIONS[hadleyRun.step];
    if (typeof spawnDustBurst === 'function') {
      spawnDustBurst(cp.pos.clone(), cp.pos.clone().normalize(), 24, 0.9);
    }
    if (typeof showToast === 'function') {
      showToast(st.fact, 'success');
    }

    if (hadleyRun.step < 3) {
      hadleyRun.step++;
      syncHadleyStepVisuals();
      sound.playPing(659.25, 0.14);
      setTimeout(() => sound.playPing(987.77, 0.18), 90);
    } else {
      completeHadleyRilleRun();
    }
  }
}

/**
 * Self-bootstrapping initializer for the 3D Hadley Rille beacon group & UI buttons.
 */
export function initHadleyRilleRun() {
  if (hadleyRun.initialized) return;
  hadleyRun.initialized = true;

  const group = new THREE.Group();
  group.visible = false;

  // Vertical glowing light column visible over crater rims
  const beamGeo = new THREE.CylinderGeometry(0.055, 0.14, 2.2, 20, 1, true);
  beamGeo.translate(0, 1.1, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xf4d58d,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const beamMesh = new THREE.Mesh(beamGeo, beamMat);

  // Outer target capture ring flush on terrain
  const ringGeo = new THREE.RingGeometry(0.32, 0.40, 36);
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.translate(0, 0.025, 0);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf4d58d,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);

  // Inner dashed/faceted target halo
  const innerGeo = new THREE.RingGeometry(0.16, 0.21, 6);
  innerGeo.rotateX(-Math.PI / 2);
  innerGeo.translate(0, 0.03, 0);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xf4d58d,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const innerRingMesh = new THREE.Mesh(innerGeo, innerMat);

  // Floating 3D waypoint badge above the beam
  const labelMat = new THREE.SpriteMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.position.set(0, 1.65, 0);
  labelSprite.center.set(0.5, 0.0);

  group.add(beamMesh, ringMesh, innerRingMesh, labelSprite);
  scene.add(group);

  hadleyRun.group = group;
  hadleyRun.beamMesh = beamMesh;
  hadleyRun.ringMesh = ringMesh;
  hadleyRun.innerRingMesh = innerRingMesh;
  hadleyRun.labelSprite = labelSprite;

  // Wire UI buttons
  const startBtn = document.getElementById('hadley-run-btn');
  if (startBtn) startBtn.addEventListener('click', startHadleyRilleRun);

  const abortBtn = document.getElementById('hadley-abort-btn');
  if (abortBtn) abortBtn.addEventListener('click', () => stopHadleyRilleRun(false));

  const retryBtn = document.getElementById('hadley-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', startHadleyRilleRun);

  const closeRes = () => {
    const m = document.getElementById('hadley-result-modal');
    if (m) m.classList.add('hidden');
  };
  const closeBtn = document.getElementById('hadley-result-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeRes);
  const freeBtn = document.getElementById('hadley-freeroam-btn');
  if (freeBtn) freeBtn.addEventListener('click', closeRes);

}


// =========================================================================
// ARTEMIS III — SOUTH POLE ICE RUN (THERMAL SHADOW-SURVIVAL CHALLENGE)
// =========================================================================
export const iceRun = {
  active: false,
  initialized: false,
  step: 0, // 0, 1, 2 = Polar Ice Cores; 3 = Return to Sunlit Peak of Eternal Light
  elapsed: 0,
  battery: 100,
  tempC: 18,
  bestTime: null,
  lastPerfMs: 0,
  lowBattWarned: false,
  group: null,
  beamMesh: null,
  ringMesh: null,
  innerRingMesh: null,
  labelSprite: null,
  checkpoints: [],
  captureRadius: 0.44
};

// Sunlit Shackleton Connecting Ridge near the Lunar South Pole (-85.8°S avoids pole gimbal singularity)
const ICE_ORIGIN = { lat: -85.8, lon: 15.0 };
const ICE_STATIONS = [
  {
    short: '1. Rim',
    beacon: 'STN 1 · SHACKLETON RIM',
    name: 'STN 1 · Shackleton Rim (Frost Line)',
    hint: 'Cross the polar terminator — temperatures plunge into the crater',
    fact: 'CORE 1 SECURED: Polar Regolith Frost — trace water molecules detected along the rim shadow!',
    dLat: 2.1,
    dLon: 26.0,
    color: 0x7dd3fc,
    hex: '#7dd3fc'
  },
  {
    short: '2. PSR Ice',
    beacon: 'STN 2 · PSR COLD TRAP',
    name: 'STN 2 · Permanently Shadowed Floor (-223°C)',
    hint: 'DEEP SHADOW: Heater draining fast! Grab the ice core & boost out',
    fact: 'CORE 2 SECURED: Pure Polar Water Ice — frozen in eternal darkness for over 2 billion years!',
    dLat: 3.9,
    dLon: -8.0,
    color: 0x38bdf8,
    hex: '#38bdf8'
  },
  {
    short: '3. Vein',
    beacon: 'STN 3 · HYDROGEN VEIN',
    name: 'STN 3 · Polar Hydrogen & Ice Deposit',
    hint: 'Final cold-trap sample — watch your heater battery!',
    fact: 'CORE 3 SECURED: Subsurface Ice Vein — enough fuel stock to power future Mars missions!',
    dLat: 1.6,
    dLon: -34.0,
    color: 0xa5f3fc,
    hex: '#a5f3fc'
  },
  {
    short: '4. Sunlight',
    beacon: 'PEAK OF ETERNAL LIGHT',
    name: 'FINAL LEG · Climb to Sunlit Artemis Base',
    hint: 'Race back to the sunlit ridge to recharge & stow the ice cores!',
    fact: 'ARTEMIS III COMPLETE: Polar water ice safely stowed on the sunlit ridge!',
    dLat: 0,
    dLon: 0,
    color: 0xf4d58d,
    hex: '#f4d58d'
  }
];

const _iceUp = new THREE.Vector3();
const _iceToTarget = new THREE.Vector3();
const _iceFwd = new THREE.Vector3();
const _iceRight = new THREE.Vector3();
const _iceNorm = new THREE.Vector3();
const _iceBasisX = new THREE.Vector3();
const _iceMat = new THREE.Matrix4();

function iceLatLonToVec3(latDeg, lonDeg, radius) {
  if (typeof latLonToVec3 === 'function') {
    return latLonToVec3(latDeg, lonDeg, radius);
  }
  const phi = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function setIceBeaconLabel(text, accentHex) {
  if (!iceRun.labelSprite) return;
  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 84;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(7, 11, 20, 0.92)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 4;
  const r = 18;
  ctx.beginPath();
  ctx.moveTo(r + 6, 8);
  ctx.lineTo(434 - r, 8);
  ctx.quadraticCurveTo(434, 8, 434, 8 + r);
  ctx.lineTo(434, 62 - r);
  ctx.quadraticCurveTo(434, 62, 434 - r, 62);
  ctx.lineTo(232, 62);
  ctx.lineTo(220, 76);
  ctx.lineTo(208, 62);
  ctx.lineTo(r + 6, 62);
  ctx.quadraticCurveTo(6, 62, 6, 62 - r);
  ctx.lineTo(6, 8 + r);
  ctx.quadraticCurveTo(6, 8, r + 6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 220, 36);

  if (iceRun.labelSprite.material.map) {
    iceRun.labelSprite.material.map.dispose();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  iceRun.labelSprite.material.map = tex;
  iceRun.labelSprite.material.needsUpdate = true;
}

function syncIceStepVisuals() {
  const st = ICE_STATIONS[iceRun.step];
  const cp = iceRun.checkpoints[iceRun.step];
  if (!st || !cp || !iceRun.group) return;

  iceRun.group.position.copy(cp.pos);
  const up = cp.pos.clone().normalize();
  iceRun.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  iceRun.group.visible = true;

  if (iceRun.beamMesh) iceRun.beamMesh.material.color.setHex(st.color);
  if (iceRun.ringMesh) iceRun.ringMesh.material.color.setHex(st.color);
  if (iceRun.innerRingMesh) iceRun.innerRingMesh.material.color.setHex(st.color);
  setIceBeaconLabel(st.beacon, st.hex);

  const nameEl = document.getElementById('ice-target-name');
  const hintEl = document.getElementById('ice-target-hint');
  if (nameEl) {
    nameEl.textContent = st.name;
    nameEl.style.color = st.hex;
  }
  if (hintEl) hintEl.textContent = st.hint;

  for (let i = 0; i < 4; i++) {
    const pill = document.getElementById(`ice-pill-${i}`);
    if (!pill) continue;
    if (i < iceRun.step) {
      pill.className = 'py-1 px-1 rounded-lg border border-[#7ec4a0]/55 bg-[#7ec4a0]/18 text-[#7ec4a0] truncate';
      pill.textContent = `✓ ${ICE_STATIONS[i].short.slice(3)}`;
    } else if (i === iceRun.step) {
      pill.className = 'py-1 px-1 rounded-lg border border-[#7dd3fc]/65 bg-[#7dd3fc]/18 text-[#7dd3fc] font-semibold truncate';
      pill.textContent = ICE_STATIONS[i].short;
    } else {
      pill.className = 'py-1 px-1 rounded-lg border border-slate-800 bg-[#0b101c] text-slate-500 truncate';
      pill.textContent = ICE_STATIONS[i].short;
    }
  }
}

export function stopSouthPoleIceRun(silent = false) {
  iceRun.active = false;
  if (iceRun.group) iceRun.group.visible = false;
  const hud = document.getElementById('ice-hud');
  if (hud) hud.classList.add('hidden');
  const frost = document.getElementById('ice-frost-vignette');
  if (frost) frost.style.opacity = '0';
  if (!silent && typeof showToast === 'function') {
    showToast('Exited Artemis III South Pole Ice Run', 'info');
  }
}

function finishSouthPoleIceRun(frozenOut = false) {
  iceRun.active = false;
  if (!frozenOut) say('iceDone');
  if (iceRun.group) iceRun.group.visible = false;
  const hud = document.getElementById('ice-hud');
  if (hud) hud.classList.add('hidden');
  const frost = document.getElementById('ice-frost-vignette');
  if (frost) frost.style.opacity = '0';

  const modal = document.getElementById('ice-result-modal');
  const medalEl = document.getElementById('ice-medal-badge');
  const titleEl = document.getElementById('ice-result-title');
  const timeEl = document.getElementById('ice-final-time');
  const battEl = document.getElementById('ice-final-batt');
  const ptsEl = document.getElementById('ice-final-pts');
  const bodyEl = document.getElementById('ice-result-body');

  const t = iceRun.elapsed;
  if (timeEl) timeEl.textContent = formatHadleyTime(t);
  if (battEl) battEl.textContent = `${Math.round(iceRun.battery)}%`;

  if (frozenOut) {
    if (medalEl) {
      medalEl.textContent = 'THERMAL FREEZE-OUT · BATTERY DEPLETED';
      medalEl.className = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-[#d9826c]/22 text-[#f8c4b4] border border-[#d9826c]/55';
    }
    if (titleEl) titleEl.textContent = 'Rover Electronics Froze in the PSR!';
    if (ptsEl) ptsEl.textContent = iceRun.bestTime !== null ? formatHadleyTime(iceRun.bestTime) : '--';
    if (bodyEl) {
      bodyEl.innerHTML = 'At <span class="text-[#7dd3fc] font-mono-tech">-223°C</span> inside a Permanently Shadowed Region, rover heaters drain batteries rapidly. Hold <strong class="text-white">SHIFT</strong> for turbo boost to race between cold traps and climb back to the sunlit ridge before power hits 0%!';
    }
    sound.playTouchdown(true);
  } else {
    const iceNewBest = iceRun.bestTime === null || t < iceRun.bestTime;
    if (iceNewBest) {
      iceRun.bestTime = t;
      save.data.records.iceBest = t;
      scheduleSave();
      const badge = document.getElementById('ice-best-badge');
      if (badge) badge.textContent = `BEST ${formatHadleyTime(t)}`;
    }

    let medal = 'BRONZE MEDAL · ICE SECURED';
    let medalClass = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-[#d9826c]/20 text-[#f8c4b4] border border-[#d9826c]/50';
    if (t < 55) {
      medal = 'GOLD MEDAL · ARTEMIS PIONEER';
      medalClass = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-[#7dd3fc]/22 text-[#7dd3fc] border border-[#7dd3fc]/55';
    } else if (t < 80) {
      medal = 'SILVER MEDAL · ICE SECURED';
      medalClass = 'px-3 py-1 rounded-full text-[11px] font-mono-tech font-semibold bg-slate-200/18 text-slate-100 border border-slate-300/50';
    }

    if (medalEl) {
      medalEl.textContent = medal;
      medalEl.className = medalClass;
    }
    if (titleEl) titleEl.textContent = 'Shackleton Water Ice Secured!';
    if (ptsEl) ptsEl.textContent = iceNewBest ? 'NEW BEST ★' : formatHadleyTime(iceRun.bestTime);
    if (bodyEl) {
      bodyEl.innerHTML = 'Because the Moon\'s axial tilt is just <strong class="text-white">1.5°</strong>, the floors of polar craters like <span class="text-[#7dd3fc] font-medium">Shackleton Crater</span> have not seen sunlight in billions of years—trapping ancient water ice at <span class="text-[#7dd3fc] font-mono-tech">-223°C</span> right beside sunlit ridges ("Peaks of Eternal Light") where Artemis solar arrays can run nearly nonstop.';
    }
    sound.playScanComplete();
  }

  if (modal) modal.classList.remove('hidden');
}

/**
 * Launches the Artemis III South Pole Ice Run near Shackleton Crater:
 * lands the LM on a sunlit polar ridge, deploys the rover aimed at Station 1,
 * and activates the live thermal shadow-survival loop.
 */
function startSouthPoleIceRun() {
  setTimeout(() => say('iceStart'), 900);
  sound.init();
  if (a11Run.active) stopA11Run(true);
  if (rdv.active) rdvEnd(true);
  restoreFullLander();
  lander.crashed = false;
  if (hadleyRun.active) stopHadleyRilleRun(true);
  document.getElementById('sites-drawer').classList.add('hidden');
  document.getElementById('hadley-result-modal').classList.add('hidden');

  const startOv = document.getElementById('start-overlay');
  const hudRoot = document.getElementById('hud-root');
  const resModal = document.getElementById('ice-result-modal');
  if (startOv) startOv.classList.add('hidden');
  if (hudRoot) hudRoot.classList.remove('hidden');
  if (resModal) resModal.classList.add('hidden');

  // 1. Land LM flush on the sunlit Shackleton Connecting Ridge
  const lmDir = iceLatLonToVec3(ICE_ORIGIN.lat, ICE_ORIGIN.lon, MOON_RADIUS);
  const lmSurfR = getExactSurfaceHit(lmDir, _iceNorm);
  const lmUp = lmDir.clone().normalize();
  const lmOffset = LANDER_FOOT_OFFSET;

  lander.pos.copy(lmUp).multiplyScalar(lmSurfR + lmOffset);
  lander.vel.set(0, 0, 0);
  if (lander.angVel) lander.angVel.set(0, 0, 0);
  lander.isLanded = true;
  lander.inOrbit = false;
  lander.docked = false;
  lander.aglUnits = 0;
  lander.lat = ICE_ORIGIN.lat;
  lander.lon = ICE_ORIGIN.lon;
  lander.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _iceNorm).normalize();
  lander.up.copy(lmUp);
  lander.forward.set(0, 0, 1).applyQuaternion(lander.quat);
  lander.forward.addScaledVector(lmUp, -lander.forward.dot(lmUp)).normalize();
  lander.right.crossVectors(lmUp, lander.forward).normalize();
  lander.fuel = 100;
  lander.thrustIntensity = 0;
  gameState.autoSoftLand = false;
  landerGroup.position.copy(lander.pos);
  landerGroup.quaternion.copy(lander.quat);
  landerGroup.visible = true;

  // 2. Build all 4 exact surface waypoints around the South Pole cold traps
  iceRun.checkpoints = ICE_STATIONS.map((st, idx) => {
    if (idx === 3) {
      return { pos: lmUp.clone().multiplyScalar(lmSurfR + 0.01) };
    }
    const raw = iceLatLonToVec3(ICE_ORIGIN.lat + st.dLat, ICE_ORIGIN.lon + st.dLon, MOON_RADIUS);
    const sR = getExactSurfaceHit(raw, null);
    return { pos: raw.normalize().multiplyScalar(sR + 0.01) };
  });

  // 3. Deploy Rover beside the Lander, aimed straight at Station 1
  const st1Pos = iceRun.checkpoints[0].pos;
  const tangentToSt1 = st1Pos.clone().sub(lander.pos);
  tangentToSt1.addScaledVector(lmUp, -tangentToSt1.dot(lmUp)).normalize();

  const roverSpawnDir = lander.pos.clone().addScaledVector(tangentToSt1, 0.24);
  const roverSurfR = getExactSurfaceHit(roverSpawnDir, _iceNorm);
  const wheelOff = ROVER_WHEEL_OFFSET;

  resetRoverDynamics();
  rover.deployed = true;
  rover.pos.copy(roverSpawnDir).normalize().multiplyScalar(roverSurfR + wheelOff + 0.004);
  rover.up.copy(rover.pos).normalize();
  rover.forward.copy(tangentToSt1).addScaledVector(_iceNorm, -tangentToSt1.dot(_iceNorm)).normalize();
  rover.right.crossVectors(_iceNorm, rover.forward).normalize();
  _iceBasisX.crossVectors(_iceNorm, rover.forward).normalize();
  _iceMat.makeBasis(_iceBasisX, _iceNorm, rover.forward);
  rover.quat.setFromRotationMatrix(_iceMat).normalize();
  roverGroup.position.copy(rover.pos);
  roverGroup.quaternion.copy(rover.quat);
  roverGroup.visible = true;

  // Start the sim (the run can be launched straight from the briefing screen) & switch to Rover mode
  gameState.started = true;
  gameState.activeScan.inProgress = false;
  if (scanRingMesh) scanRingMesh.visible = false;
  setGameMode('rover');

  iceRun.active = true;
  iceRun.step = 0;
  iceRun.elapsed = 0;
  iceRun.battery = 100;
  iceRun.tempC = 18;
  iceRun.lowBattWarned = false;
  iceRun.lastPerfMs = performance.now();

  syncIceStepVisuals();
  const hud = document.getElementById('ice-hud');
  if (hud) hud.classList.remove('hidden');

  sound.playPing(523.25, 0.14);
  setTimeout(() => sound.playPing(783.99, 0.18), 110);
  if (typeof showToast === 'function') {
    showToast('ARTEMIS III ICE RUN: Dive into the -223°C polar shadows, grab 3 ice cores & return to sunlight!', 'info');
  }
}

/**
 * Per-frame update for the Artemis III South Pole Ice Run:
 * simulates polar shadow temperatures, heater battery drain/solar recharge,
 * frost vignette, 3D icy beacon animation, compass arrow, and sample capture.
 */
export function updateSouthPoleIceRun() {
  if (!iceRun.active || !iceRun.initialized) return;

  const nowMs = performance.now();
  const dt = THREE.MathUtils.clamp((nowMs - iceRun.lastPerfMs) / 1000, 0, 0.1);
  iceRun.lastPerfMs = nowMs;
  iceRun.elapsed += dt;

  const timerEl = document.getElementById('ice-timer');
  if (timerEl) timerEl.textContent = formatHadleyTime(iceRun.elapsed);

  const cp = iceRun.checkpoints[iceRun.step];
  const basePos = iceRun.checkpoints[3].pos;
  if (!cp || !basePos) return;

  // Compute thermal zone based on distance from the Sunlit Peak of Eternal Light
  const distFromBase = rover.pos.distanceTo(basePos);
  let targetTemp = 18;
  let battRate = 7.5; // Recharging in sunlight
  let zoneLabel = 'SUNLIT RIM';
  let zoneColor = '#f4d58d';

  if (distFromBase > 2.2) {
    // Deep Permanently Shadowed Region (PSR)
    targetTemp = -223;
    battRate = -3.1;
    zoneLabel = 'DEEP PSR SHADOW';
    zoneColor = '#38bdf8';
  } else if (distFromBase > 1.05) {
    // Polar terminator / cold transition slope
    targetTemp = -128;
    battRate = -1.45;
    zoneLabel = 'POLAR TWILIGHT';
    zoneColor = '#7dd3fc';
  }

  iceRun.tempC = THREE.MathUtils.lerp(iceRun.tempC, targetTemp, 1 - Math.exp(-2.2 * dt));
  iceRun.battery = THREE.MathUtils.clamp(iceRun.battery + battRate * dt, 0, 100);

  // Update thermal HUD elements & icy frost screen-edge vignette
  const zoneEl = document.getElementById('ice-zone-badge');
  const tempEl = document.getElementById('ice-temp-val');
  const battBar = document.getElementById('ice-battery-bar');
  const battPct = document.getElementById('ice-battery-pct');
  const frost = document.getElementById('ice-frost-vignette');

  if (zoneEl) {
    zoneEl.textContent = zoneLabel;
    zoneEl.style.color = zoneColor;
  }
  if (tempEl) {
    const rounded = Math.round(iceRun.tempC);
    tempEl.textContent = `${rounded > 0 ? '+' : ''}${rounded}°C`;
    tempEl.style.color = rounded < -150 ? '#7dd3fc' : (rounded < 0 ? '#e2e8f0' : '#f4d58d');
  }
  if (battBar && battPct) {
    const pct = Math.round(iceRun.battery);
    battBar.style.width = `${pct}%`;
    battPct.textContent = `${pct}%`;
    const low = pct <= 25;
    battBar.style.backgroundColor = low ? '#d9826c' : (battRate > 0 ? '#7ec4a0' : '#7dd3fc');
    battPct.style.color = low ? '#f8c4b4' : (battRate > 0 ? '#7ec4a0' : '#7dd3fc');
  }
  if (frost) {
    const coldIntensity = THREE.MathUtils.clamp((-iceRun.tempC - 90) / 140, 0, 1);
    frost.style.opacity = (coldIntensity * (iceRun.battery < 25 ? 1.0 : 0.72)).toFixed(2);
  }

  if (iceRun.battery <= 22 && !iceRun.lowBattWarned) {
    iceRun.lowBattWarned = true;
    sound.playPing(330, 0.22);
    if (typeof showToast === 'function') {
      showToast('WARNING: Heater battery critical! Return to sunlit ridge soon!', 'warn');
    }
  }
  if (iceRun.battery <= 0) {
    finishSouthPoleIceRun(true);
    return;
  }

  // Animate 3D icy beacon
  const pulse = 1 + Math.sin(nowMs * 0.0065) * 0.13;
  if (iceRun.ringMesh) {
    iceRun.ringMesh.scale.set(pulse, pulse, 1);
    iceRun.ringMesh.rotation.z = nowMs * 0.0016;
  }
  if (iceRun.innerRingMesh) {
    iceRun.innerRingMesh.rotation.z = -nowMs * 0.0024;
  }
  if (iceRun.labelSprite && camera) {
    const camDist = camera.position.distanceTo(cp.pos);
    const s = THREE.MathUtils.clamp(camDist * 0.055, 0.22, 4.5);
    iceRun.labelSprite.scale.set(s * 3.9, s * 0.76, 1);
  }

  // Distance & compass bearing arrow
  const distUnits = rover.pos.distanceTo(cp.pos);
  const distKm = (distUnits / MOON_RADIUS) * MOON_REAL_KM;
  const distEl = document.getElementById('ice-dist');
  if (distEl) {
    distEl.textContent = distKm >= 10 ? `${distKm.toFixed(0)} km` : `${distKm.toFixed(1)} km`;
  }

  _iceUp.copy(rover.pos).normalize();
  _iceToTarget.copy(cp.pos).sub(rover.pos);
  _iceToTarget.addScaledVector(_iceUp, -_iceToTarget.dot(_iceUp));
  if (_iceToTarget.lengthSq() > 1e-6) {
    _iceToTarget.normalize();
    const refFwd = roverCam.initialized
      ? _iceFwd.copy(roverCam.heading)
      : _iceFwd.copy(rover.forward);
    refFwd.addScaledVector(_iceUp, -refFwd.dot(_iceUp)).normalize();
    _iceRight.crossVectors(refFwd, _iceUp).normalize();
    const fDot = _iceToTarget.dot(refFwd);
    const rDot = _iceToTarget.dot(_iceRight);
    const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(rDot, fDot));
    const arrowEl = document.getElementById('ice-arrow');
    if (arrowEl) arrowEl.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
  }

  // Checkpoint capture check
  const capRad = iceRun.step === 3 ? 0.52 : iceRun.captureRadius;
  if (distUnits <= capRad) {
    const st = ICE_STATIONS[iceRun.step];
    if (typeof spawnDustBurst === 'function') {
      spawnDustBurst(cp.pos.clone(), cp.pos.clone().normalize(), 24, 0.9);
    }
    if (typeof showToast === 'function') {
      showToast(st.fact, 'success');
    }

    if (iceRun.step < 3) {
      // Emergency thermal cell boost on each ice core capture
      iceRun.battery = Math.min(100, iceRun.battery + 10);
      iceRun.step++;
      syncIceStepVisuals();
      sound.playPing(698.46, 0.14);
      setTimeout(() => sound.playPing(1046.5, 0.18), 90);
    } else {
      finishSouthPoleIceRun(false);
    }
  }
}

/**
 * Self-bootstrapping initializer for the 3D Artemis III Ice Run beacon & UI handlers.
 */
export function initSouthPoleIceRun() {
  if (iceRun.initialized) return;
  iceRun.initialized = true;

  const group = new THREE.Group();
  group.visible = false;

  const beamGeo = new THREE.CylinderGeometry(0.055, 0.14, 2.3, 20, 1, true);
  beamGeo.translate(0, 1.15, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.36,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const beamMesh = new THREE.Mesh(beamGeo, beamMat);

  const ringGeo = new THREE.RingGeometry(0.32, 0.41, 36);
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.translate(0, 0.025, 0);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);

  const innerGeo = new THREE.RingGeometry(0.16, 0.21, 6);
  innerGeo.rotateX(-Math.PI / 2);
  innerGeo.translate(0, 0.03, 0);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.76,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const innerRingMesh = new THREE.Mesh(innerGeo, innerMat);

  const labelMat = new THREE.SpriteMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.position.set(0, 1.7, 0);
  labelSprite.center.set(0.5, 0.0);

  group.add(beamMesh, ringMesh, innerRingMesh, labelSprite);
  scene.add(group);

  iceRun.group = group;
  iceRun.beamMesh = beamMesh;
  iceRun.ringMesh = ringMesh;
  iceRun.innerRingMesh = innerRingMesh;
  iceRun.labelSprite = labelSprite;

  const startBtn = document.getElementById('ice-run-btn');
  if (startBtn) startBtn.addEventListener('click', startSouthPoleIceRun);

  const abortBtn = document.getElementById('ice-abort-btn');
  if (abortBtn) abortBtn.addEventListener('click', () => stopSouthPoleIceRun(false));

  const retryBtn = document.getElementById('ice-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', startSouthPoleIceRun);

  const closeRes = () => {
    const m = document.getElementById('ice-result-modal');
    if (m) m.classList.add('hidden');
  };
  const closeBtn = document.getElementById('ice-result-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeRes);
  const freeBtn = document.getElementById('ice-freeroam-btn');
  if (freeBtn) freeBtn.addEventListener('click', closeRes);

}
