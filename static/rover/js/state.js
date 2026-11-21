import * as THREE from 'three';
import { CSM_ORBIT_RADIUS, ELEV_GRID_H, ELEV_GRID_W, LANDMARKS, LUNAR_MU } from './constants.js';
import { recordSeismicArrival } from './apollo-ops.js';

// =========================================================================
// 3. STATE & SCENE GLOBALS
// =========================================================================
export const beaconMap = new Map();
export const beaconClickTargets = [];

// Terrain & Dataset State
export const terrainState = {
  reliefExaggeration: 5.0, // Default 5.0x LOLA terrain exaggeration
  elevGrid: new Float32Array(ELEV_GRID_W * ELEV_GRID_H), // normalized [0..1]
  minElevKm: -9.12,
  maxElevKm: 10.78,
  colorSource: 'Procedural 2048×1024',
  demSource: 'Procedural 1024×512',
  proceduralColorTex: null,
  proceduralDemTex: null,
  proceduralElevGrid: null,
  baseColorMap: null,      // Active albedo (procedural or uploaded); overlays swap in over it
  westCraterCarved: false  // Scaled-up West Crater for the Apollo 11 challenge
};

export const gameState = {
  started: false,
  mode: 'lander',      // 'lander' | 'rover' | 'orbital'
  autoGyro: true,      // true = SAS Upright Stabilized | false = Free 360° Acrobatic Mode
  hoverAssist: true,
  autoSoftLand: false,
  retroHold: false,    // SAS retrograde hold (engine against direction of travel)
  gridVisible: false,
  sunAngleDeg: 42,
  sunAutoCycle: false,
  surveyed: new Set(),
  targetLandmarkId: LANDMARKS[0].id,
  activeScan: {
    inProgress: false,
    landmarkId: null,
    progress: 0,
    lastTick: 0
  },
  allCelebrated: false
};

export const lander = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  up: new THREE.Vector3(1, 0, 0),
  forward: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(0, 0, 1),
  quat: new THREE.Quaternion(),
  angVel: new THREE.Vector3(0, 0, 0),
  fuel: 100.0,
  isLanded: false,
  inOrbit: false,
  docked: false,       // Hard-docked to CSM Columbia
  ascentOnly: false,   // Descent stage separated [X]
  crashed: false,
  crashTimer: 0,
  slopeDeg: 0,
  apKm: null,
  peKm: null,
  vCirc: 12.7,
  pitchTilt: 0,
  rollTilt: 0,
  pitchDeg: 0,
  rollDeg: 0,
  isInverted: false,
  thrustIntensity: 0,
  isBoosting: false,
  aglUnits: 0,
  elevKm: 0,
  lat: 0.674,
  lon: 23.473
};

export const rover = {
  deployed: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  up: new THREE.Vector3(1, 0, 0),
  forward: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(0, 0, 1),
  quat: new THREE.Quaternion(),
  angVel: new THREE.Vector3(0, 0, 0),  // Local-frame angular velocity (x = pitch, y = spin, z = roll)
  steerAngle: 0,
  wheelSpin: 0,
  speed: 0,
  isGrounded: true,
  isTumbling: false,                    // Resting / sliding on roof or side
  selfRightTimer: 0,                    // Active self-righting hop window
  flipCooldown: 0,
  flipHintCooldown: 0,
  aglUnits: 0,
  elevKm: 0,
  lat: 0.674,
  lon: 23.473,
  wheels: [],
  frontPivots: [],
  crashed: false,
  crashTimer: 0,
  stunt: {
    active: false,
    airTime: 0,
    maxAgl: 0,
    pitchRad: 0,
    yawRad: 0,
    rollRad: 0,
    bannerTimer: 0,
    bannerTitle: '',
    bannerSub: '',
    bannerPts: '',
    bannerKind: 'landed',
    bannerStars: ''
  }
};


export const csm = {
  angle: 0.32,
  inclination: THREE.MathUtils.degToRad(1.2),
  omega: Math.sqrt(LUNAR_MU / Math.pow(CSM_ORBIT_RADIUS, 3)),
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  tracking: false
};

export const camCtrl = {
  chaseYaw: 0,
  chasePitch: 0.34,
  chaseDist: 1.35,
  roverDist: 0.68,
  orbitLonDeg: 20,
  orbitLatDeg: 10,
  targetOrbitLonDeg: 20,
  targetOrbitLatDeg: 10,
  orbitDist: 235,
  targetOrbitDist: 235,
  isDragging: false,
  dragMoved: false,
  lastX: 0,
  lastY: 0,
  pinchDist: 0,
  dockDist: 0.95,
  dockLookBlend: 0,
  landerCamOffset: null,
  landerHeading: null   // Moon-anchored camera heading (tangent to the surface), independent of the LM's spin
};

export const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  yawLeft: false,
  yawRight: false,
  lift: false,
  boost: false,
  arrowUp: false,
  arrowDown: false,
  arrowLeft: false,
  arrowRight: false,
  down: false
};


// Smooth spring-damped rover chase camera state (independent of the lander chase camera)
export const roverCam = {
  initialized: false,
  wasActive: false,
  dragging: false,
  userYaw: 0,
  userPitch: 0,
  zoom: 0.68,
  baseFov: 52,
  lastDt: 0.016,
  up: new THREE.Vector3(0, 1, 0),
  heading: new THREE.Vector3(0, 0, 1),
  pos: new THREE.Vector3(),
  lookAt: new THREE.Vector3()
};

// Small camera shake from hard rover landings & tumbles
export const seismic = { intensity: 0 };
export function triggerSeismicEvent(intensity, origin) {
  const craft = (gameState.mode === 'rover' && rover.deployed) ? rover : lander;
  const dCraft = origin ? craft.pos.distanceTo(origin) : 0;
  const shake = intensity * Math.exp(-dCraft / 2.5);
  seismic.intensity = Math.min(1, Math.max(seismic.intensity, shake));
  if (origin) recordSeismicArrival(intensity, origin);
}
