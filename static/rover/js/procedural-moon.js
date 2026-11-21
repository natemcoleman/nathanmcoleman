import * as THREE from 'three';
import { ELEV_GRID_H, ELEV_GRID_W } from './constants.js';
import { terrainState } from './state.js';
import { latLonToVec3 } from './coords.js';
import { setSRGB } from './three-compat.js';

// =========================================================================
// 5. PROCEDURAL LRO-CALIBRATED 2K ALBEDO & LOLA DEM GENERATOR
// =========================================================================
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function valueNoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);

  const x00 = n000 + (n100 - n000) * ux;
  const x10 = n010 + (n110 - n010) * ux;
  const x01 = n001 + (n101 - n001) * ux;
  const x11 = n011 + (n111 - n011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbm3(x, y, z, octaves = 4) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise3(x * freq, y * freq, z * freq) * amp;
    freq *= 2.04;
    amp *= 0.5;
  }
  return val;
}

export function generateProceduralMoonMaps() {
  const W = ELEV_GRID_W;
  const H = ELEV_GRID_H;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = W;
  colorCanvas.height = H;
  const cCtx = colorCanvas.getContext('2d');
  const cImg = cCtx.createImageData(W, H);
  const cData = cImg.data;

  const demCanvas = document.createElement('canvas');
  demCanvas.width = W;
  demCanvas.height = H;
  const dCtx = demCanvas.getContext('2d');
  const dImg = dCtx.createImageData(W, H);
  const dData = dImg.data;

  const elevGrid = new Float32Array(W * H);

  // Major real lunar maria basins (lat, lon, angular radius in rad, depth, darkness)
  const maria = [
    { lat: 32.8, lon: -15.6, r: 0.36, depth: 0.16, dark: 0.36 }, // Mare Imbrium
    { lat: 18.0, lon: -45.0, r: 0.48, depth: 0.14, dark: 0.34 }, // Oceanus Procellarum
    { lat: 28.0, lon:  17.5, r: 0.22, depth: 0.14, dark: 0.33 }, // Mare Serenitatis
    { lat:  8.5, lon:  31.4, r: 0.24, depth: 0.13, dark: 0.36 }, // Mare Tranquillitatis
    { lat: 17.0, lon:  59.1, r: 0.15, depth: 0.16, dark: 0.38 }, // Mare Crisium
    { lat: -7.8, lon:  51.3, r: 0.20, depth: 0.12, dark: 0.30 }, // Mare Fecunditatis
    { lat: -21.3, lon: -16.6, r: 0.21, depth: 0.11, dark: 0.30 }, // Mare Nubium
    { lat: -53.0, lon: -169.0, r: 0.62, depth: 0.28, dark: 0.16 } // South Pole-Aitken Basin
  ].map(m => ({ ...m, vec: latLonToVec3(m.lat, m.lon, 1.0) }));

  // Prominent real craters + seeded procedural craters
  const craters = [
    { lat: -43.31, lon: -11.36, r: 0.055, depth: 0.22, rim: 0.09, rays: true },  // Tycho
    { lat:   9.62, lon: -20.08, r: 0.060, depth: 0.22, rim: 0.09, rays: true },  // Copernicus
    { lat: -20.40, lon: 129.10, r: 0.095, depth: 0.20, rim: 0.08, darkFloor: true }, // Tsiolkovskiy
    { lat: -89.67, lon: 129.78, r: 0.025, depth: 0.16, rim: 0.07, rays: false }, // Shackleton
    { lat:  19.92, lon:  -2.86, r: 0.080, depth: -0.22, rim: 0.0, mountain: true } // Mons Huygens peak
  ];

  // Deterministic seeded craters across globe
  let seed = 4720;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 160; i++) {
    const lat = Math.asin(rand() * 2 - 1) * (180 / Math.PI);
    const lon = rand() * 360 - 180;
    const r = 0.014 + Math.pow(rand(), 2.4) * 0.09;
    craters.push({
      lat, lon, r,
      depth: 0.06 + r * 1.4,
      rim: 0.025 + r * 0.55,
      rays: r > 0.065 && rand() < 0.25
    });
  }
  const craterData = craters.map(c => ({ ...c, vec: latLonToVec3(c.lat, c.lon, 1.0) }));

  const p = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const latDeg = 90 - (y / (H - 1)) * 180;
    const latRad = THREE.MathUtils.degToRad(latDeg);
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    for (let x = 0; x < W; x++) {
      const lonDeg = (x / (W - 1)) * 360 - 180;
      const lonRad = THREE.MathUtils.degToRad(lonDeg);
      p.set(cosLat * Math.cos(lonRad), sinLat, -cosLat * Math.sin(lonRad));

      const nLarge = fbm3(p.x * 2.4 + 3.1, p.y * 2.4 - 1.7, p.z * 2.4 + 5.2, 4);
      const nFine = fbm3(p.x * 11.0, p.y * 11.0, p.z * 11.0, 3);

      // Base highlands elevation & albedo
      let elev = 0.54 + (nLarge - 0.5) * 0.34 + (nFine - 0.5) * 0.08;
      let albedo = 0.56 + (nLarge - 0.5) * 0.16 + (nFine - 0.5) * 0.12;

      // Apply lunar maria depressions & dark basalt plains
      for (let i = 0; i < maria.length; i++) {
        const m = maria[i];
        const dist = Math.acos(THREE.MathUtils.clamp(p.dot(m.vec), -1, 1));
        if (dist < m.r * 1.35) {
          const t = THREE.MathUtils.clamp(1 - dist / m.r, 0, 1);
          const smooth = t * t * (3 - 2 * t);
          const edgeNoise = (nLarge - 0.5) * 0.22;
          const mask = THREE.MathUtils.clamp(smooth + edgeNoise * smooth, 0, 1);
          elev -= mask * m.depth;
          albedo -= mask * m.dark;
        }
      }

      // Apply craters, rims, central peaks, and ejecta rays
      for (let i = 0; i < craterData.length; i++) {
        const c = craterData[i];
        const dot = THREE.MathUtils.clamp(p.dot(c.vec), -1, 1);
        const ang = Math.acos(dot);
        const maxRange = c.rays ? c.r * 4.5 : c.r * 1.45;
        if (ang > maxRange) continue;

        const q = ang / c.r;
        if (c.mountain) {
          if (q < 1.2) {
            const peak = Math.cos(Math.min(1, q / 1.2) * Math.PI * 0.5);
            elev += peak * peak * 0.26;
            albedo += peak * 0.08;
          }
        } else {
          if (q < 1.0) {
            // Bowl depression + subtle central peak for large craters
            const bowl = (1 - q * q);
            elev -= bowl * c.depth;
            if (c.r > 0.045 && q < 0.25) {
              elev += (1 - q / 0.25) * c.depth * 0.42;
            }
            if (c.darkFloor) albedo -= bowl * 0.34;
          } else if (q < 1.4) {
            // Raised crater rim
            const rimT = 1 - (q - 1.0) / 0.4;
            elev += rimT * rimT * c.rim;
            albedo += rimT * 0.09;
          }
          if (c.rays && q >= 0.85 && q < 4.5) {
            const rayFade = Math.pow(1 - (q - 0.85) / 3.65, 2.2);
            const rayNoise = Math.pow(valueNoise3(p.x * 26, p.y * 26, p.z * 26), 2.5);
            albedo += rayFade * rayNoise * 0.28;
          }
        }
      }

      elev = THREE.MathUtils.clamp(elev, 0.02, 0.98);
      albedo = THREE.MathUtils.clamp(albedo, 0.14, 0.88);

      const idx = y * W + x;
      elevGrid[idx] = elev;

      // Subtle natural-color lunar tint (slight warm-grey highlands, cool-slate maria)
      const pi = idx * 4;
      const rCol = Math.round(THREE.MathUtils.clamp(albedo * 246 + 4, 0, 255));
      const gCol = Math.round(THREE.MathUtils.clamp(albedo * 243 + 3, 0, 255));
      const bCol = Math.round(THREE.MathUtils.clamp(albedo * 238 + 6, 0, 255));
      cData[pi] = rCol;
      cData[pi + 1] = gCol;
      cData[pi + 2] = bCol;
      cData[pi + 3] = 255;

      const dVal = Math.round(elev * 255);
      dData[pi] = dVal;
      dData[pi + 1] = dVal;
      dData[pi + 2] = dVal;
      dData[pi + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  dCtx.putImageData(dImg, 0, 0);

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  setSRGB(colorTex);
  colorTex.anisotropy = 8;

  const demTex = new THREE.CanvasTexture(demCanvas);
  demTex.anisotropy = 4;

  terrainState.proceduralColorTex = colorTex;
  terrainState.proceduralDemTex = demTex;
  terrainState.proceduralElevGrid = new Float32Array(elevGrid);
  terrainState.elevGrid.set(elevGrid);

  return { colorTex, demTex };
}
