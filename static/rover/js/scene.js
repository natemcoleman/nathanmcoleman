import * as THREE from 'three';
import { CSM_ORBIT_RADIUS, LANDER_SCALE, LANDMARKS, MOON_RADIUS, MOON_SEG_H, MOON_SEG_W, ROVER_SCALE } from './constants.js';
import { beaconClickTargets, beaconMap, csm, gameState, rover, terrainState } from './state.js';
import { applyTerrainRelief, latLonToVec3 } from './coords.js';
import { generateProceduralMoonMaps } from './procedural-moon.js';
import { warpLanderToLandmark } from './modes.js';
import { carveWestCrater } from './apollo11.js';
import { ambientLight, directionalLight, pointLight, setSRGB, setupRendererColor } from './three-compat.js';

// =========================================================================
// 7. THREE.JS SCENE, MOON, EARTH, BEACONS, LANDER, ROVER & APOLLO 11 CSM
// =========================================================================
// Scene objects — created by initScene() and the builders below
export let scene, camera, renderer;
export let moonMesh, moonMaterial, latLonGridGroup;
export let moonUnitDirs = null;            // Base unit sphere directions for exact CPU vertex displacement
export let sunLight, sunVisual, earthGroup;
export let landerGroup, landerMeshRoot, landerDescentGroup, enginePlume, landerSpotLight, laserBeam;
export let roverGroup, roverMeshRoot;
export let csmGroup, csmOrbitLine;
export let scanRingMesh;
let dustPoints, dustGeometry;

function createStarfield() {
  const count = 3200;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2 * Math.PI;
    const phi = Math.acos(2 * v - 1);
    const r = 1600 + Math.random() * 900;
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const tint = 0.78 + Math.random() * 0.22;
    col[i * 3]     = tint;
    col[i * 3 + 1] = tint * (0.94 + Math.random() * 0.06);
    col[i * 3 + 2] = Math.min(1, tint * (0.96 + Math.random() * 0.1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.88 });
  scene.add(new THREE.Points(geo, mat));
}

function createEarthInSky() {
  earthGroup = new THREE.Group();
  // Sub-Earth direction is +X (0° lat, 0° lon)
  earthGroup.position.set(1180, 145, -80);

  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#dbeafe');
  grad.addColorStop(0.12, '#1d4ed8');
  grad.addColorStop(0.5, '#0f3d7a');
  grad.addColorStop(0.88, '#1e40af');
  grad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Soft continents & cloud swirls
  ctx.fillStyle = 'rgba(74, 140, 92, 0.72)';
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    ctx.ellipse(Math.random() * 512, 42 + Math.random() * 172, 18 + Math.random() * 44, 10 + Math.random() * 24, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
  for (let i = 0; i < 42; i++) {
    ctx.beginPath();
    ctx.ellipse(Math.random() * 512, 20 + Math.random() * 216, 22 + Math.random() * 56, 4 + Math.random() * 10, (Math.random() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const earthTex = new THREE.CanvasTexture(c);
  setSRGB(earthTex);
  const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(42, 96, 64),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.72, metalness: 0.05 })
  );
  earthGroup.add(earthMesh);
  earthGroup.userData.earthMesh = earthMesh;

  // Soft blue atmospheric halo
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(44.2, 24, 18),
    new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.16, side: THREE.BackSide })
  );
  earthGroup.add(atmo);
  scene.add(earthGroup);
}

function createLatLonGrid() {
  latLonGridGroup = new THREE.Group();
  latLonGridGroup.visible = false;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf4d58d, transparent: true, opacity: 0.24 });

  for (let lat = -75; lat <= 75; lat += 15) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) {
      pts.push(latLonToVec3(lat, lon, MOON_RADIUS));
    }
    latLonGridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 4) {
      pts.push(latLonToVec3(lat, lon, MOON_RADIUS));
    }
    latLonGridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  scene.add(latLonGridGroup);
}

function createLandmarkBeacons() {
  LANDMARKS.forEach((lm) => {
    lm.unitPos = latLonToVec3(lm.lat, lm.lon, 1.0);
    const group = new THREE.Group();

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.18, 4.6, 8),
      new THREE.MeshBasicMaterial({ color: 0xf4d58d, transparent: true, opacity: 0.6 })
    );
    pillar.position.y = 2.3;
    group.add(pillar);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.55, 24),
      new THREE.MeshBasicMaterial({ color: 0xf4d58d, side: THREE.DoubleSide, transparent: true, opacity: 0.78 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    group.add(ring);

    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.85, 0),
      new THREE.MeshBasicMaterial({ color: 0xf4d58d })
    );
    diamond.position.y = 5.3;
    diamond.userData.landmarkId = lm.id;
    group.add(diamond);

    // Invisible larger hit sphere for easy clicking in Orbital mode
    const hitSphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitSphere.position.y = 3.2;
    hitSphere.userData.landmarkId = lm.id;
    group.add(hitSphere);
    beaconClickTargets.push(hitSphere);

    scene.add(group);
    beaconMap.set(lm.id, { group, pillar, ring, diamond, lm });
  });
}

export function refreshBeaconColors() {
  beaconMap.forEach(({ pillar, ring, diamond, lm }) => {
    const isSurveyed = gameState.surveyed.has(lm.id);
    const isTarget = gameState.targetLandmarkId === lm.id;
    const hex = isSurveyed ? 0x7ec4a0 : (isTarget ? 0xf4d58d : 0x94a3b8);
    pillar.material.color.setHex(hex);
    ring.material.color.setHex(hex);
    diamond.material.color.setHex(hex);
  });
}

function createLander() {
  landerGroup = new THREE.Group();
  landerMeshRoot = new THREE.Group();
  landerMeshRoot.scale.setScalar(LANDER_SCALE);
  landerGroup.add(landerMeshRoot);
  landerDescentGroup = new THREE.Group();
  landerMeshRoot.add(landerDescentGroup);

  const goldFoil = new THREE.MeshStandardMaterial({ color: 0xd9a84e, roughness: 0.34, metalness: 0.82 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xdbe2ec, roughness: 0.42, metalness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.45 });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  // Octagonal Descent Stage
  const descent = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.42, 8), goldFoil);
  descent.position.y = -0.14;
  landerDescentGroup.add(descent);

  // Ascent Cabin
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.48, 8), hullMat);
  cabin.position.y = 0.28;
  landerMeshRoot.add(cabin);

  // Cockpit Forward Windows (+Z is forward)
  const winL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.06), windowMat);
  winL.position.set(-0.14, 0.34, 0.44);
  landerMeshRoot.add(winL);
  const winR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.06), windowMat);
  winR.position.set(0.14, 0.34, 0.44);
  landerMeshRoot.add(winR);

  // Top Comms Dish
  const dishMast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 6), hullMat);
  dishMast.position.set(0, 0.64, -0.05);
  landerMeshRoot.add(dishMast);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.08, 12, 1, true), goldFoil);
  dish.position.set(0, 0.78, -0.05);
  dish.rotation.x = Math.PI * 0.75;
  landerMeshRoot.add(dish);

  // 4 Landing Legs & Footpads
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + Math.PI / 4;
    const legGroup = new THREE.Group();
    legGroup.rotation.y = ang;

    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), darkMat);
    strut.position.set(0, -0.34, 0.64);
    strut.rotation.x = -0.45;
    legGroup.add(strut);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 10), goldFoil);
    pad.position.set(0, -0.66, 0.8);
    legGroup.add(pad);

    landerDescentGroup.add(legGroup);
  }

  // Main Descent Engine Bell
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 14, 1, true), darkMat);
  nozzle.position.y = -0.46;
  landerDescentGroup.add(nozzle);

  // Ascent Propulsion System bell (hidden inside the descent stage until separation)
  const apsBell = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.14, 12, 1, true), darkMat);
  apsBell.position.y = -0.0;
  landerMeshRoot.add(apsBell);

  // CSM docking drogue on top of the ascent stage
  const drogue = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.06, 12), darkMat);
  drogue.position.set(0, 0.55, 0.06);
  landerMeshRoot.add(drogue);

  // Engine Exhaust Plume
  enginePlume = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 1.35, 12),
    new THREE.MeshBasicMaterial({ color: 0xf4d58d, transparent: true, opacity: 0, depthWrite: false })
  );
  enginePlume.rotation.x = Math.PI;
  enginePlume.position.y = -1.12;
  landerMeshRoot.add(enginePlume);

  // LOLA Downward Laser Altimeter Beam
  const beamGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6);
  beamGeo.translate(0, -0.5, 0);
  laserBeam = new THREE.Mesh(
    beamGeo,
    new THREE.MeshBasicMaterial({ color: 0x7ec4a0, transparent: true, opacity: 0.42, depthWrite: false })
  );
  laserBeam.position.y = -0.45;
  landerMeshRoot.add(laserBeam);

  // Local Soft Surface Illumination Light
  landerSpotLight = pointLight(0xfff1d6, 0.75, 4.5, 1.6);
  landerSpotLight.position.set(0, -0.6, 0);
  landerMeshRoot.add(landerSpotLight);

  scene.add(landerGroup);
}

// Deployable Apollo-Style Lunar Roving Vehicle (0.4x Lander Scale)
function createRover() {
  roverGroup = new THREE.Group();
  roverGroup.visible = false;
  roverMeshRoot = new THREE.Group();
  roverMeshRoot.scale.setScalar(ROVER_SCALE);
  roverGroup.add(roverMeshRoot);

  const chassisMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.42, metalness: 0.65 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9a84e, roughness: 0.34, metalness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.68, metalness: 0.35 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.82, metalness: 0.45 });
  const suitMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6, metalness: 0.08 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xf4d58d, roughness: 0.15, metalness: 0.92 });

  // Main tubular flatbed chassis (length along +Z forward)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 1.75), chassisMat);
  deck.position.y = -0.04;
  roverMeshRoot.add(deck);

  // Front gold thermal battery/avionics bay
  const frontBay = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.34, 0.42), goldMat);
  frontBay.position.set(0, 0.16, 0.64);
  roverMeshRoot.add(frontBay);

  // Rear science equipment & core-sample rack
  const rearRack = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.28, 0.36), darkMat);
  rearRack.position.set(0, 0.14, -0.66);
  roverMeshRoot.add(rearRack);

  // Two crew seats + seated astronaut on left seat
  [-0.24, 0.24].forEach((sx) => {
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.07), chassisMat);
    seatBack.position.set(sx, 0.24, -0.24);
    seatBack.rotation.x = -0.18;
    roverMeshRoot.add(seatBack);
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.18), suitMat);
  torso.position.set(-0.24, 0.28, -0.1);
  roverMeshRoot.add(torso);
  const plss = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.12), suitMat);
  plss.position.set(-0.24, 0.3, -0.21);
  roverMeshRoot.add(plss);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), suitMat);
  helmet.position.set(-0.24, 0.54, -0.08);
  roverMeshRoot.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), visorMat);
  visor.position.set(-0.24, 0.54, -0.03);
  roverMeshRoot.add(visor);

  // High-Gain Parabolic Dish Antenna & TV Mast
  const antMast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), chassisMat);
  antMast.position.set(0.3, 0.42, 0.55);
  roverMeshRoot.add(antMast);
  const antDish = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.1, 14, 1, true), goldMat);
  antDish.position.set(0.3, 0.74, 0.55);
  antDish.rotation.x = Math.PI * 0.72;
  roverMeshRoot.add(antDish);

  // 4 Wire-Mesh Wheels (Front pair steered via pivot groups)
  rover.wheels = [];
  rover.frontPivots = [];
  const wheelPositions = [
    { x: -0.56, z:  0.62, front: true },
    { x:  0.56, z:  0.62, front: true },
    { x: -0.56, z: -0.62, front: false },
    { x:  0.56, z: -0.62, front: false }
  ];

  wheelPositions.forEach((wp) => {
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, -0.22, wp.z);

    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.42), goldMat);
    fender.position.set(0, 0.25, 0);
    pivot.add(fender);

    const wheelGroup = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 16), tireMat);
    tire.rotation.z = Math.PI / 2;
    wheelGroup.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 10), chassisMat);
    hub.rotation.z = Math.PI / 2;
    wheelGroup.add(hub);

    pivot.add(wheelGroup);
    roverMeshRoot.add(pivot);
    rover.wheels.push(wheelGroup);
    if (wp.front) rover.frontPivots.push(pivot);
  });

  const roverLight = pointLight(0xfff5e0, 0.55, 2.2, 1.8);
  roverLight.position.set(0, 0.35, 0.9);
  roverMeshRoot.add(roverLight);

  scene.add(roverGroup);
}

// Orbiting Apollo 11 Command & Service Module (CSM "Columbia")
function createOrbitalStage() {
  csmGroup = new THREE.Group();
  const csmMesh = new THREE.Group();
  csmMesh.scale.setScalar(LANDER_SCALE * 1.65);
  csmGroup.add(csmMesh);

  const cmMat = new THREE.MeshStandardMaterial({ color: 0xdbe2ec, roughness: 0.28, metalness: 0.82 });
  const smMat = new THREE.MeshStandardMaterial({ color: 0xb8c2d0, roughness: 0.42, metalness: 0.68 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55, metalness: 0.55 });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.45, metalness: 0.72, side: THREE.DoubleSide });
  const radMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5, metalness: 0.25 });

  // Orientation: +Z is prograde nose (Command Module forward docking probe)
  const cmCone = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.96, 20), cmMat);
  cmCone.rotation.x = Math.PI / 2;
  cmCone.position.z = 1.28;
  csmMesh.add(cmCone);

  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.36, 10), darkMat);
  probe.rotation.x = Math.PI / 2;
  probe.position.z = 1.86;
  csmMesh.add(probe);

  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.14, 20), darkMat);
  shield.rotation.x = Math.PI / 2;
  shield.position.z = 0.76;
  csmMesh.add(shield);

  const smBody = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 1.52, 20), smMat);
  smBody.rotation.x = Math.PI / 2;
  smBody.position.z = -0.06;
  csmMesh.add(smBody);

  const radBand = new THREE.Mesh(new THREE.CylinderGeometry(0.69, 0.69, 0.46, 20), radMat);
  radBand.rotation.x = Math.PI / 2;
  radBand.position.z = 0.25;
  csmMesh.add(radBand);

  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.28), darkMat);
    pod.position.set(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0.28);
    csmMesh.add(pod);
  }

  const sps = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.88, 18, 1, true), nozzleMat);
  sps.rotation.x = Math.PI / 2;
  sps.position.z = -1.22;
  csmMesh.add(sps);

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.85, 6), smMat);
  boom.position.set(0.55, 0.48, -0.78);
  boom.rotation.z = -0.6;
  csmMesh.add(boom);

  const dishCluster = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.08, 0.08, 12), cmMat);
  dishCluster.position.set(0.82, 0.78, -0.78);
  dishCluster.rotation.x = Math.PI / 2;
  csmMesh.add(dishCluster);

  // Subtle Orbital Tracking Halo
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x7ec4a0, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
  );
  csmGroup.add(halo);
  csmGroup.userData.halo = halo;
  scene.add(csmGroup);

  // Subtle Orbital Path Line around the Moon
  const orbitPts = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const x = Math.cos(a) * CSM_ORBIT_RADIUS;
    const z = -Math.sin(a) * CSM_ORBIT_RADIUS;
    const y = Math.sin(a) * Math.sin(csm.inclination) * CSM_ORBIT_RADIUS;
    orbitPts.push(new THREE.Vector3(x, y, z));
  }
  csmOrbitLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0x7ec4a0, transparent: true, opacity: 0.28 })
  );
  scene.add(csmOrbitLine);
}

export function updateOrbitalStage(dt) {
  if (!csmGroup) return;
  csm.angle = (csm.angle + csm.omega * dt) % (Math.PI * 2);
  const ca = Math.cos(csm.angle);
  const sa = Math.sin(csm.angle);
  const inc = Math.sin(csm.inclination);

  csm.pos.set(
    ca * CSM_ORBIT_RADIUS,
    sa * inc * CSM_ORBIT_RADIUS,
    -sa * CSM_ORBIT_RADIUS
  );
  csm.vel.set(
    -sa * CSM_ORBIT_RADIUS * csm.omega,
    ca * inc * CSM_ORBIT_RADIUS * csm.omega,
    -ca * CSM_ORBIT_RADIUS * csm.omega
  );

  csmGroup.position.copy(csm.pos);
  const lookAhead = csm.pos.clone().add(csm.vel);
  csmGroup.up.copy(csm.pos).normalize();
  csmGroup.lookAt(lookAhead);

  if (csmGroup.userData.halo && camera) {
    csmGroup.userData.halo.lookAt(camera.position);
    const d = camera.position.distanceTo(csm.pos);
    const haloScale = THREE.MathUtils.clamp(d * 0.022, 0.45, 5.5);
    csmGroup.userData.halo.scale.setScalar(haloScale);
  }
}

// Dust & Exhaust Particle Pool
const MAX_PARTICLES = 260;
const particles = [];
let particleCursor = 0;

function initDustParticles() {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      pos: new THREE.Vector3(0, -9999, 0),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      color: new THREE.Color(0xcbd5e1)
    });
    positions[i * 3 + 1] = -9999;
  }
  dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dustGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.085,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });
  dustPoints = new THREE.Points(dustGeometry, mat);
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);
}

export function spawnParticle(pos, vel, colorHex = 0xcbd5e1, life = 0.65) {
  const p = particles[particleCursor];
  particleCursor = (particleCursor + 1) % MAX_PARTICLES;
  p.pos.copy(pos);
  p.vel.copy(vel);
  p.life = life;
  p.maxLife = life;
  p.color.setHex(colorHex);
}

export function spawnDustBurst(origin, normal, count = 10, speed = 0.65) {
  const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(normal, ref).normalize();
  const t2 = new THREE.Vector3().crossVectors(normal, t1).normalize();

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = (0.35 + Math.random() * 0.85) * speed;
    const vel = new THREE.Vector3()
      .addScaledVector(t1, Math.cos(ang) * spd)
      .addScaledVector(t2, Math.sin(ang) * spd)
      .addScaledVector(normal, (0.25 + Math.random() * 0.65) * speed * 0.55);
    const pos = origin.clone()
      .addScaledVector(t1, (Math.random() - 0.5) * 0.08)
      .addScaledVector(t2, (Math.random() - 0.5) * 0.08);
    spawnParticle(pos, vel, 0xb8bcc6, 0.45 + Math.random() * 0.45);
  }
}

export function updateParticles(dt) {
  const posArr = dustGeometry.attributes.position.array;
  const colArr = dustGeometry.attributes.color.array;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (p.life > 0) {
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      const fade = Math.max(0, p.life / p.maxLife);
      posArr[i * 3]     = p.pos.x;
      posArr[i * 3 + 1] = p.pos.y;
      posArr[i * 3 + 2] = p.pos.z;
      colArr[i * 3]     = p.color.r * fade;
      colArr[i * 3 + 1] = p.color.g * fade;
      colArr[i * 3 + 2] = p.color.b * fade;
    } else {
      posArr[i * 3 + 1] = -9999;
    }
  }
  dustGeometry.attributes.position.needsUpdate = true;
  dustGeometry.attributes.color.needsUpdate = true;
}

export function updateSunDirection(angleDeg) {
  gameState.sunAngleDeg = angleDeg;
  const rad = THREE.MathUtils.degToRad(angleDeg);
  const dist = 620;
  const sx = Math.cos(rad) * dist;
  const sy = 95;
  const sz = Math.sin(rad) * dist;
  if (sunLight) sunLight.position.set(sx, sy, sz);
  if (sunVisual) sunVisual.position.set(sx * 2.4, sy * 2.4, sz * 2.4);
}

export function initThreeScene() {
  const container = document.getElementById('canvas-container');
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050811);

  camera = new THREE.PerspectiveCamera(52, w / h, 0.005, 4200);
  camera.position.set(220, 34, 0);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(w, h);
  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2));
  setupRendererColor(renderer);
  container.appendChild(renderer.domElement);

  // Lighting
  sunLight = directionalLight(0xfffaf0, 1.95);
  scene.add(sunLight);
  scene.add(ambientLight(0x3b4d70, 0.24)); // Subtle earthshine fill

  sunVisual = new THREE.Mesh(
    new THREE.SphereGeometry(24, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff8dc })
  );
  scene.add(sunVisual);
  updateSunDirection(gameState.sunAngleDeg);

  createStarfield();
  createEarthInSky();

  // Build Procedural Moon Maps & CPU-Displaced 320×160 Sphere (Zero GPU/CPU Terrain Desync)
  const { colorTex, demTex } = generateProceduralMoonMaps();
  carveWestCrater(terrainState.elevGrid);
  carveWestCrater(terrainState.proceduralElevGrid);
  terrainState.westCraterCarved = true;
  const moonGeo = new THREE.SphereGeometry(MOON_RADIUS, MOON_SEG_W, MOON_SEG_H);
  const posAttr = moonGeo.attributes.position;
  moonUnitDirs = new Float32Array(posAttr.count * 3);
  const tmpV = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    tmpV.fromBufferAttribute(posAttr, i).normalize();
    moonUnitDirs[i * 3] = tmpV.x;
    moonUnitDirs[i * 3 + 1] = tmpV.y;
    moonUnitDirs[i * 3 + 2] = tmpV.z;
  }
  moonMaterial = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: demTex,
    bumpScale: 0.14 * Math.sqrt(terrainState.reliefExaggeration),
    roughness: 0.94,
    metalness: 0.02
  });
  terrainState.baseColorMap = colorTex;
  moonMesh = new THREE.Mesh(moonGeo, moonMaterial);
  scene.add(moonMesh);

  // Expanding Lidar Scan Ring
  scanRingMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.0, 48),
    new THREE.MeshBasicMaterial({ color: 0x7ec4a0, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  scanRingMesh.visible = false;
  scene.add(scanRingMesh);

  createLatLonGrid();
  createLandmarkBeacons();
  createLander();
  createRover();
  createOrbitalStage();
  initDustParticles();

  applyTerrainRelief(terrainState.reliefExaggeration);
  warpLanderToLandmark(LANDMARKS[0], false);
}
