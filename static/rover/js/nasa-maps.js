import * as THREE from 'three';
import { ELEV_GRID_H, ELEV_GRID_W } from './constants.js';
import { sound } from './audio.js';
import { terrainState } from './state.js';
import { applyTerrainRelief } from './coords.js';
import { earthGroup, moonMaterial, renderer } from './scene.js';
import { showToast } from './hud.js';
import { refreshMoonMap } from './apollo-ops.js';
import { setSRGB } from './three-compat.js';

// =========================================================================
// 6. NASA SVS 4720 GEOTIFF & IMAGE DECODER + DRAG-AND-DROP LOADER
// =========================================================================
function setKitProgress(visible, label = '', pct = 0) {
  const wrap = document.getElementById('kit-progress-wrap');
  const lbl = document.getElementById('kit-progress-label');
  const pctEl = document.getElementById('kit-progress-pct');
  const bar = document.getElementById('kit-progress-bar');
  wrap.classList.toggle('hidden', !visible);
  if (visible) {
    lbl.textContent = label;
    pctEl.textContent = `${Math.round(pct)}%`;
    bar.style.width = `${Math.round(pct)}%`;
  }
}

function showKitError(msg) {
  const box = document.getElementById('kit-error-box');
  if (!msg) {
    box.classList.add('hidden');
    box.textContent = '';
  } else {
    box.textContent = msg;
    box.classList.remove('hidden');
  }
}

function updateSlotPreview(slot, dataUrl, statusText) {
  const img = document.getElementById(slot === 'color' ? 'preview-color-img' : 'preview-dem-img');
  const ph = document.getElementById(slot === 'color' ? 'preview-color-placeholder' : 'preview-dem-placeholder');
  const lbl = document.getElementById(slot === 'color' ? 'color-status-label' : 'dem-status-label');
  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove('hidden');
    ph.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }
  lbl.textContent = statusText;
}

// geotiff.js is only needed for dropped .tif files, so it loads on first use: local copy, then CDN.
let geoTiffLoading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => { el.remove(); reject(new Error(`Could not load ${src}`)); };
    document.head.appendChild(el);
  });
}
function ensureGeoTiff() {
  if (typeof GeoTIFF !== 'undefined') return Promise.resolve();
  if (!geoTiffLoading) {
    geoTiffLoading = loadScript('vendor/geotiff.js')
      .catch(() => loadScript('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js'))
      .then(() => { if (typeof GeoTIFF === 'undefined') throw new Error('no GeoTIFF'); })
      .catch(() => { geoTiffLoading = null; throw new Error('GeoTIFF library failed to load. Please check your internet connection or use .jpg/.png.'); });
  }
  return geoTiffLoading;
}

async function decodeGeoTiffFile(file, slot) {
  await ensureGeoTiff();
  setKitProgress(true, `Reading ${file.name}...`, 15);
  const arrayBuf = await file.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuf);
  const image = await tiff.getImage();
  const srcW = image.getWidth();
  const srcH = image.getHeight();
  const spp = image.getSamplesPerPixel();

  // Cap WebGL texture size cleanly while preserving aspect ratio
  const maxW = slot === 'color' ? 4096 : 2048;
  const maxH = slot === 'color' ? 2048 : 1024;
  const targetW = Math.min(srcW, maxW);
  const targetH = Math.min(srcH, maxH);

  setKitProgress(true, `Decoding ${srcW}×${srcH} TIFF -> ${targetW}×${targetH}...`, 45);
  const rasters = await image.readRasters({
    width: targetW,
    height: targetH,
    resampleMethod: 'bilinear'
  });

  setKitProgress(true, 'Building WebGL lunar map...', 78);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(targetW, targetH);
  const out = imgData.data;

  if (slot === 'color') {
    const rBand = rasters[0];
    const gBand = spp >= 3 ? rasters[1] : rBand;
    const bBand = spp >= 3 ? rasters[2] : rBand;
    const is16Bit = rBand instanceof Uint16Array;
    const isFloat = rBand instanceof Float32Array || rBand instanceof Float64Array;
    const scale = is16Bit ? (255 / 65535) : (isFloat ? 255 : 1);

    for (let i = 0; i < targetW * targetH; i++) {
      const pi = i * 4;
      out[pi]     = THREE.MathUtils.clamp(Math.round(rBand[i] * scale), 0, 255);
      out[pi + 1] = THREE.MathUtils.clamp(Math.round(gBand[i] * scale), 0, 255);
      out[pi + 2] = THREE.MathUtils.clamp(Math.round(bBand[i] * scale), 0, 255);
      out[pi + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return { canvas, width: srcW, height: srcH };
  } else {
    // Elevation DEM (supports Float32 km, Uint16 half-meters offset +20000, Int16, or 8-bit)
    const band = rasters[0];
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      if (Number.isFinite(v)) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    const range = Math.max(1e-6, maxV - minV);

    // Determine real km range for accurate HUD altimeter
    let minKm = -9.12, maxKm = 10.78;
    if (band instanceof Float32Array && maxV < 40 && minV > -40) {
      minKm = minV;
      maxKm = maxV;
    } else if (band instanceof Uint16Array && maxV > 1000) {
      minKm = (minV - 20000) / 2000;
      maxKm = (maxV - 20000) / 2000;
    }

    for (let i = 0; i < targetW * targetH; i++) {
      const norm = THREE.MathUtils.clamp((band[i] - minV) / range, 0, 1);
      const byte = Math.round(norm * 255);
      const pi = i * 4;
      out[pi] = byte;
      out[pi + 1] = byte;
      out[pi + 2] = byte;
      out[pi + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Resample normalized elevation to CPU grid for exact lander/rover collision
    const grid = new Float32Array(ELEV_GRID_W * ELEV_GRID_H);
    for (let gy = 0; gy < ELEV_GRID_H; gy++) {
      const sy = Math.min(targetH - 1, Math.floor((gy / (ELEV_GRID_H - 1)) * (targetH - 1)));
      for (let gx = 0; gx < ELEV_GRID_W; gx++) {
        const sx = Math.min(targetW - 1, Math.floor((gx / (ELEV_GRID_W - 1)) * (targetW - 1)));
        grid[gy * ELEV_GRID_W + gx] = THREE.MathUtils.clamp((band[sy * targetW + sx] - minV) / range, 0, 1);
      }
    }
    return { canvas, width: srcW, height: srcH, grid, minKm, maxKm };
  }
}

function decodeStandardImage(fileOrUrl, slot) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let objectUrl = null;
    if (fileOrUrl instanceof File) {
      objectUrl = URL.createObjectURL(fileOrUrl);
      img.src = objectUrl;
    } else {
      img.src = fileOrUrl;
    }
    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const maxW = slot === 'color' ? 4096 : 2048;
      const maxH = slot === 'color' ? 2048 : 1024;
      const targetW = Math.min(img.naturalWidth, maxW);
      const targetH = Math.min(img.naturalHeight, maxH);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);

      if (slot === 'color') {
        resolve({ canvas, width: img.naturalWidth, height: img.naturalHeight });
      } else {
        // Extract luminance to CPU elevation grid
        const gCanvas = document.createElement('canvas');
        gCanvas.width = ELEV_GRID_W;
        gCanvas.height = ELEV_GRID_H;
        const gCtx = gCanvas.getContext('2d');
        gCtx.drawImage(img, 0, 0, ELEV_GRID_W, ELEV_GRID_H);
        const px = gCtx.getImageData(0, 0, ELEV_GRID_W, ELEV_GRID_H).data;
        const grid = new Float32Array(ELEV_GRID_W * ELEV_GRID_H);
        for (let i = 0; i < grid.length; i++) {
          grid[i] = px[i * 4] / 255;
        }
        resolve({ canvas, width: img.naturalWidth, height: img.naturalHeight, grid, minKm: -9.12, maxKm: 10.78 });
      }
    };
    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode image file.'));
    };
  });
}

function applyColorCanvas(canvas, label) {
  const tex = new THREE.CanvasTexture(canvas);
  setSRGB(tex);
  tex.anisotropy = 8;
  terrainState.baseColorMap = tex;
  refreshMoonMap();
  terrainState.colorSource = label;
  updateSlotPreview('color', canvas.toDataURL('image/jpeg', 0.65), label);
}

function applyDemResult(res, label) {
  const tex = new THREE.CanvasTexture(res.canvas);
  tex.anisotropy = 4;
  if (moonMaterial) {
    moonMaterial.bumpMap = tex;
    moonMaterial.needsUpdate = true;
  }
  terrainState.elevGrid.set(res.grid);
  terrainState.westCraterCarved = false;
  terrainState.minElevKm = res.minKm;
  terrainState.maxElevKm = res.maxKm;
  terrainState.demSource = label;
  applyTerrainRelief(terrainState.reliefExaggeration);
  updateSlotPreview('dem', res.canvas.toDataURL('image/jpeg', 0.65), label);
}

export async function processUploadedFile(file, forcedSlot = null) {
  if (!file) return;
  showKitError(null);
  const name = file.name.toLowerCase();
  const slot = forcedSlot || ((name.includes('ldem') || name.includes('dem') || name.includes('disp') || name.includes('elev') || name.includes('height')) ? 'dem' : 'color');
  const isTiff = name.endsWith('.tif') || name.endsWith('.tiff');

  try {
    setKitProgress(true, `Loading ${file.name}...`, 10);
    const res = isTiff
      ? await decodeGeoTiffFile(file, slot)
      : await decodeStandardImage(file, slot);

    setKitProgress(true, 'Applying NASA texture to Moon...', 94);
    const label = `${file.name} (${res.width}×${res.height})`;
    if (slot === 'color') {
      applyColorCanvas(res.canvas, label);
      showToast(`Loaded Color Map: ${file.name}`, 'gold');
    } else {
      applyDemResult(res, label);
      showToast(`Loaded LOLA DEM: ${file.name}`, 'sage');
    }
    sound.playPing(780, 0.16);
    setKitProgress(false);
  } catch (err) {
    setKitProgress(false);
    showKitError(`Upload error (${file.name}): ${err.message || err}`);
    showToast('Failed to decode lunar map file.', 'warn');
  }
}

export function resetSlotToProcedural(slot) {
  if (slot === 'color' && terrainState.proceduralColorTex) {
    terrainState.baseColorMap = terrainState.proceduralColorTex;
    refreshMoonMap();
    terrainState.colorSource = 'Procedural 2048×1024';
    updateSlotPreview('color', null, 'Procedural 2048×1024');
    showToast('Restored Procedural Color Map', 'gold');
  } else if (slot === 'dem' && terrainState.proceduralDemTex) {
    moonMaterial.bumpMap = terrainState.proceduralDemTex;
    moonMaterial.needsUpdate = true;
    terrainState.elevGrid.set(terrainState.proceduralElevGrid);
    terrainState.westCraterCarved = true;
    terrainState.minElevKm = -9.12;
    terrainState.maxElevKm = 10.78;
    terrainState.demSource = 'Procedural 1024×512';
    applyTerrainRelief(terrainState.reliefExaggeration);
    updateSlotPreview('dem', null, 'Procedural 1024×512');
    showToast('Restored Procedural LOLA DEM', 'sage');
  }
}

// Self-hosted NASA maps. Reads ./textures.json next to the page (see static/rover/ on the site);
// falls back to the legacy ./textures/*.jpg pair. Picks lighter files on phones.
function pickTextureQuality() {
  const q = new URLSearchParams(location.search).get('tex');
  if (q === 'hi' || q === 'lo') return { color: q, dem: q };
  const maxTex = (renderer && renderer.capabilities && renderer.capabilities.maxTextureSize) || 4096;
  const lowMem = navigator.deviceMemory && navigator.deviceMemory < 4;
  const phone = window.matchMedia && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
  return { color: (maxTex >= 4096 && !lowMem) ? 'hi' : 'lo', dem: (phone || lowMem) ? 'lo' : 'hi' };
}

async function loadBitmap(url) {
  const resp = await fetch(url, { cache: 'force-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const blob = await resp.blob();
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch (_) { /* fall through */ }
  }
  const objUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode failed')); im.src = objUrl; });
  } finally { setTimeout(() => URL.revokeObjectURL(objUrl), 0); }
}

// 16-bit elevation packed into a PNG: R = high byte, G = low byte
async function decodePackedDem(url, minKm, maxKm) {
  const bmp = await loadBitmap(url);
  const w = bmp.width, h = bmp.height;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0);
  const px = sctx.getImageData(0, 0, w, h).data;
  if (bmp.close) bmp.close();
  const hgt = new Float32Array(w * h);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const out = img.data;
  for (let i = 0; i < w * h; i++) {
    const v = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;
    hgt[i] = v;
    const byte = px[i * 4];
    out[i * 4] = byte; out[i * 4 + 1] = byte; out[i * 4 + 2] = byte; out[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Box-average down to the physics grid
  const grid = new Float32Array(ELEV_GRID_W * ELEV_GRID_H);
  const fx = w / ELEV_GRID_W, fy = h / ELEV_GRID_H;
  for (let gy = 0; gy < ELEV_GRID_H; gy++) {
    const y0 = Math.floor(gy * fy), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * fy));
    for (let gx = 0; gx < ELEV_GRID_W; gx++) {
      const x0 = Math.floor(gx * fx), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * fx));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) for (let x = x0; x < x1 && x < w; x++) { sum += hgt[y * w + x]; n++; }
      grid[gy * ELEV_GRID_W + gx] = n ? sum / n : 0;
    }
  }
  return { canvas, width: w, height: h, grid, minKm, maxKm };
}

export async function silentlyProbeSelfHostedTextures() {
  const badge = document.getElementById('boot-dataset-badge');
  let manifest = null;
  try {
    const r = await fetch('./textures.json', { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch (_) { /* no manifest */ }
  const q = pickTextureQuality();
  if (manifest && manifest.earth) loadEarthMaps(manifest.earth, q.color);
  let colorOk = false;
  try {
    const url = manifest && manifest.color ? (manifest.color[q.color] || manifest.color.hi || manifest.color.lo) : './textures/lroc_color_2k.jpg';
    const colorRes = await decodeStandardImage(url, 'color');
    applyColorCanvas(colorRes.canvas, `LROC color ${colorRes.width}×${colorRes.height}`);
    colorOk = true;
  } catch (_) { /* keep procedural color */ }
  try {
    if (manifest && manifest.dem) {
      const url = manifest.dem[q.dem] || manifest.dem.hi || manifest.dem.lo;
      const demRes = await decodePackedDem(url, manifest.dem.minKm, manifest.dem.maxKm);
      applyDemResult(demRes, `LOLA 16-bit ${demRes.width}×${demRes.height}`);
    } else {
      const demRes = await decodeStandardImage('./textures/ldem_3_8bit.jpg', 'dem');
      applyDemResult(demRes, 'Self-Hosted LOLA DEM');
    }
  } catch (_) { /* stay on procedural DEM */ }
  badge.textContent = colorOk ? 'NASA LRO maps loaded' : 'LRO Procedural 2K Ready (Drop NASA Maps Anytime)';
}

// NASA Earth (Blue Marble day map + clouds), listed under "earth" in textures.json.
// Without it the Earth keeps its built-in painted look.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}
export async function loadEarthMaps(spec, quality) {
  const mesh = earthGroup && earthGroup.userData.earthMesh;
  if (!spec || !mesh) return;
  try {
    const day = spec.day && (spec.day[quality] || spec.day.hi || spec.day.lo);
    if (day) {
      const tex = setSRGB(new THREE.Texture(await loadImage(day)));
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      mesh.material.map = tex;
      // The game's sunlight is aimed for the Moon, so you often see Earth's night side: a faint glow
      // from the same map keeps the continents readable without washing out the day side
      mesh.material.emissiveMap = tex;
      mesh.material.emissive = new THREE.Color(0x8c96aa);
      mesh.material.emissiveIntensity = 0.42;
      mesh.material.roughness = 0.85;
      mesh.material.needsUpdate = true;
    }
    const clouds = spec.clouds && (spec.clouds[quality] || spec.clouds.hi || spec.clouds.lo);
    if (clouds && !mesh.userData.clouds) {
      const ct = new THREE.Texture(await loadImage(clouds));
      ct.needsUpdate = true;
      const layer = new THREE.Mesh(
        new THREE.SphereGeometry(42.35, 48, 32),
        // Faint glow to match the Earth's, so clouds stay white rather than grey on the night side
        new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: ct, transparent: true, depthWrite: false, roughness: 1, emissive: 0x9aa3b4, emissiveIntensity: 0.38 })
      );
      mesh.add(layer);
      mesh.userData.clouds = layer;
      layer.onBeforeRender = () => { layer.rotation.y += 0.00004; };   // clouds drift slowly over the ground
    }
  } catch (_) { /* keep the painted Earth */ }
}
