import * as THREE from 'three';
import { BASE_RELIEF_UNITS, ELEV_GRID_H, ELEV_GRID_W, LANDMARKS, MOON_RADIUS, MOON_REAL_KM, MOON_SEG_H, MOON_SEG_W, ROVER_WHEEL_OFFSET } from './constants.js';
import { beaconMap, camCtrl, lander, rover, terrainState } from './state.js';
import { latLonGridGroup, moonMaterial, moonMesh, moonUnitDirs } from './scene.js';
import { landerFootOffset, markOverlayDirty, rdv, reseatSurfaceAssets } from './apollo-ops.js';

// =========================================================================
// 4. EXACT NASA SVS 4720 SELENOGRAPHIC COORDINATE MATH
// =========================================================================
// NASA SVS 4720 cylindrical maps are centered at 0° longitude (u = 0.5).
// In Three.js SphereGeometry (phiStart=0, phiLength=2*PI):
//   u = 0.5 -> phi = PI -> (+X, 0, 0) [Sub-Earth point, 0° lon]
//   East longitude (+lon) increases u toward 1.0 -> -Z at +90°E
export function latLonToVec3(latDeg, lonDeg, radius = MOON_RADIUS, target = new THREE.Vector3()) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const cosLat = Math.cos(lat);
  target.set(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * cosLat * Math.sin(lon)
  );
  return target;
}

export function vec3ToLatLon(vec) {
  const r = vec.length();
  if (r < 1e-6) return { lat: 0, lon: 0 };
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(vec.y / r, -1, 1)));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-vec.z, vec.x));
  return { lat, lon };
}

export function greatCircleKm(unitA, unitB) {
  const dot = THREE.MathUtils.clamp(unitA.dot(unitB), -1, 1);
  return Math.acos(dot) * MOON_REAL_KM;
}

export function formatLat(lat) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon) {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

export function getDisplacementScale() {
  return BASE_RELIEF_UNITS * terrainState.reliefExaggeration;
}

// Bilinear sampling of CPU LOLA elevation grid using exact SphereGeometry UVs (u: 0..1, vTop: 0=North..1=South)
function sampleElevGridUV(u, vTop) {
  const uu = ((u % 1) + 1) % 1;
  const vv = THREE.MathUtils.clamp(vTop, 0, 1);

  const fx = uu * (ELEV_GRID_W - 1);
  const fy = vv * (ELEV_GRID_H - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % ELEV_GRID_W;
  const y1 = Math.min(ELEV_GRID_H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const g = terrainState.elevGrid;
  const v00 = g[y0 * ELEV_GRID_W + x0];
  const v10 = g[y0 * ELEV_GRID_W + x1];
  const v01 = g[y1 * ELEV_GRID_W + x0];
  const v11 = g[y1 * ELEV_GRID_W + x1];

  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

// Bilinear sampling of CPU LOLA elevation grid matching SphereGeometry UVs
export function sampleTerrainAtLatLon(latDeg, lonDeg) {
  const u = (lonDeg + 180) / 360;
  const vTop = (90 - latDeg) / 180;
  const norm = sampleElevGridUV(u, vTop);
  const elevKm = terrainState.minElevKm + norm * (terrainState.maxElevKm - terrainState.minElevKm);
  return { norm, elevKm };
}

// Allocation-free O(1) Möller-Trumbore ray-triangle intersection from Moon center (0,0,0)
const _rtDir = new THREE.Vector3();
const _rtV0 = new THREE.Vector3();
const _rtV1 = new THREE.Vector3();
const _rtV2 = new THREE.Vector3();
const _rtE1 = new THREE.Vector3();
const _rtE2 = new THREE.Vector3();
const _rtP = new THREE.Vector3();
const _rtT = new THREE.Vector3();
const _rtQ = new THREE.Vector3();
const _rtHitNormal = new THREE.Vector3();

function intersectOriginRayTriangle(dir, posAttr, i0, i1, i2, outNormal) {
  _rtV0.fromBufferAttribute(posAttr, i0);
  _rtV1.fromBufferAttribute(posAttr, i1);
  _rtV2.fromBufferAttribute(posAttr, i2);

  _rtE1.subVectors(_rtV1, _rtV0);
  _rtE2.subVectors(_rtV2, _rtV0);
  _rtP.crossVectors(dir, _rtE2);
  const det = _rtE1.dot(_rtP);
  if (Math.abs(det) < 1e-10) return -1;

  const invDet = 1.0 / det;
  _rtT.copy(_rtV0).negate(); // Origin (0,0,0) - V0
  const u = _rtT.dot(_rtP) * invDet;
  if (u < -1e-5 || u > 1.0 + 1e-5) return -1;

  _rtQ.crossVectors(_rtT, _rtE1);
  const v = dir.dot(_rtQ) * invDet;
  if (v < -1e-5 || u + v > 1.0 + 1e-5) return -1;

  const t = _rtE2.dot(_rtQ) * invDet;
  if (t <= 0) return -1;

  if (outNormal) {
    outNormal.crossVectors(_rtE1, _rtE2);
    if (outNormal.lengthSq() > 1e-12) {
      outNormal.normalize();
      if (outNormal.dot(dir) < 0) outNormal.negate();
    } else {
      outNormal.copy(dir);
    }
  }
  return t;
}

// Queries the EXACT rendered triangle height & normal on the displaced Moon mesh in O(1) time
export function getExactSurfaceHit(vec, outNormal = null) {
  if (!moonMesh || !moonMesh.geometry) {
    const { lat, lon } = vec3ToLatLon(vec);
    const { norm } = sampleTerrainAtLatLon(lat, lon);
    if (outNormal) outNormal.copy(vec).normalize();
    return MOON_RADIUS + (norm - 0.5) * getDisplacementScale();
  }

  _rtDir.copy(vec).normalize();
  const { lat, lon } = vec3ToLatLon(_rtDir);
  const u = (((lon + 180) / 360) % 1 + 1) % 1;
  const vTop = THREE.MathUtils.clamp((90 - lat) / 180, 0, 1);

  const ix0 = Math.min(MOON_SEG_W - 1, Math.floor(u * MOON_SEG_W));
  const iy0 = Math.min(MOON_SEG_H - 1, Math.floor(vTop * MOON_SEG_H));
  const posAttr = moonMesh.geometry.attributes.position;
  const stride = MOON_SEG_W + 1;

  const testQuad = (ix, iy) => {
    const a = iy * stride + (ix + 1);
    const b = iy * stride + ix;
    const c = (iy + 1) * stride + ix;
    const d = (iy + 1) * stride + (ix + 1);
    if (iy !== 0) {
      const t1 = intersectOriginRayTriangle(_rtDir, posAttr, a, b, d, outNormal);
      if (t1 > 0) return t1;
    }
    if (iy !== MOON_SEG_H - 1) {
      const t2 = intersectOriginRayTriangle(_rtDir, posAttr, b, c, d, outNormal);
      if (t2 > 0) return t2;
    }
    return -1;
  };

  // Fast path: exact quad hit (99.9% of calls)
  let hitT = testQuad(ix0, iy0);
  if (hitT > 0) return hitT;

  // Boundary fallback: check immediate 8 neighbor quads for edge/pole precision
  for (let dy = -1; dy <= 1; dy++) {
    const ny = iy0 + dy;
    if (ny < 0 || ny >= MOON_SEG_H) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (ix0 + dx + MOON_SEG_W) % MOON_SEG_W;
      hitT = testQuad(nx, ny);
      if (hitT > 0) return hitT;
    }
  }

  const { norm } = sampleTerrainAtLatLon(lat, lon);
  if (outNormal) outNormal.copy(_rtDir);
  return MOON_RADIUS + (norm - 0.5) * getDisplacementScale();
}

const _tmpLatLonVec = new THREE.Vector3();
export function getSurfaceRadiusAtLatLon(latDeg, lonDeg) {
  if (moonMesh && moonMesh.geometry) {
    latLonToVec3(latDeg, lonDeg, 1.0, _tmpLatLonVec);
    return getExactSurfaceHit(_tmpLatLonVec, null);
  }
  const { norm } = sampleTerrainAtLatLon(latDeg, lonDeg);
  return MOON_RADIUS + (norm - 0.5) * getDisplacementScale();
}

export function getSurfaceRadiusAtPosition(vec) {
  return getExactSurfaceHit(vec, null);
}

// Returns the exact outward normal of the rendered displaced Moon triangle at any 3D point
export function getSurfaceNormalAtPosition(vec, target = new THREE.Vector3()) {
  getExactSurfaceHit(vec, target);
  return target;
}

export function applyTerrainRelief(exaggeration) {
  terrainState.reliefExaggeration = exaggeration;
  const scale = getDisplacementScale();

  // Displace the actual 3D Moon vertices on the CPU so GPU triangles match physics 100%
  if (moonMesh && moonMesh.geometry && moonUnitDirs) {
    const geo = moonMesh.geometry;
    const posAttr = geo.attributes.position;
    const uvAttr = geo.attributes.uv;
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      const u = uvAttr.getX(i);
      const vTop = 1.0 - uvAttr.getY(i);
      const norm = sampleElevGridUV(u, vTop);
      const r = MOON_RADIUS + (norm - 0.5) * scale;
      const bi = i * 3;
      posAttr.setXYZ(i, moonUnitDirs[bi] * r, moonUnitDirs[bi + 1] * r, moonUnitDirs[bi + 2] * r);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  if (moonMaterial) {
    moonMaterial.bumpScale = 0.14 * Math.sqrt(exaggeration);
    moonMaterial.needsUpdate = true;
  }

  // Reposition all landmark beacons onto new displaced surface
  LANDMARKS.forEach((lm) => {
    const b = beaconMap.get(lm.id);
    if (!b) return;
    const r = getSurfaceRadiusAtLatLon(lm.lat, lm.lon);
    latLonToVec3(lm.lat, lm.lon, r + 0.08, b.group.position);
    const up = b.group.position.clone().normalize();
    b.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  });

  // Adjust Lat/Lon grid radius so it stays cleanly above the highest peaks
  if (latLonGridGroup) {
    const gridScale = (MOON_RADIUS + scale * 0.56 + 0.8) / MOON_RADIUS;
    latLonGridGroup.scale.setScalar(gridScale);
  }

  // Keep lander & rover cleanly above newly scaled relief
  reseatSurfaceAssets();
  markOverlayDirty();
  if (lander.pos.lengthSq() > 1 && !rdv.active) {
    const minR = getSurfaceRadiusAtPosition(lander.pos) + landerFootOffset();
    if (lander.pos.length() < minR || lander.isLanded) {
      lander.pos.setLength(minR);
    }
  }
  if (rover.deployed && rover.pos.lengthSq() > 1) {
    const minRR = getSurfaceRadiusAtPosition(rover.pos) + ROVER_WHEEL_OFFSET;
    if (rover.pos.length() < minRR || rover.isGrounded) {
      rover.pos.setLength(minRR);
    }
  }
  const minOrb = Math.max(116, MOON_RADIUS + scale * 0.56 + 12);
  if (camCtrl.targetOrbitDist < minOrb) camCtrl.targetOrbitDist = minOrb;
}
