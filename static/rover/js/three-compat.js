// Keeps the game looking the same on old and new Three.js.
// The version is picked in index.html (import map): newest by default, ?three=128 for the original.
// From r152 Three.js manages colour spaces, and from r155 lights use physical units.
// These helpers undo both, so colours and brightness match what the game was tuned with on r128.
import * as THREE from 'three';

export const THREE_REVISION = parseInt(THREE.REVISION, 10);

// r152+: treat hex colours as raw values, as r128 did (otherwise everything shifts darker)
if (THREE.ColorManagement && 'enabled' in THREE.ColorManagement) THREE.ColorManagement.enabled = false;

// r155+: Lambert/Phong shading divides by π; r128 didn't
const LEGACY_LIGHT = THREE_REVISION >= 155 ? Math.PI : 1;

export function setSRGB(tex) {
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  else tex.encoding = THREE.sRGBEncoding;
  return tex;
}

export function setupRendererColor(renderer) {
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;
}

export function directionalLight(color, intensity) {
  return new THREE.DirectionalLight(color, intensity * LEGACY_LIGHT);
}

export function ambientLight(color, intensity) {
  return new THREE.AmbientLight(color, intensity * LEGACY_LIGHT);
}

// r128 faded point lights smoothly to zero at `distance`: (1 - d/distance)^decay.
// Newer versions use inverse-square falloff, which blows out the ground right under a small lamp.
// Instead use no decay with a shorter cutoff: full brightness up close, and the same half-brightness
// distance as r128, which is a close match for the lander and rover lamps.
export function pointLight(color, intensity, distance, decay) {
  if (THREE_REVISION < 155) return new THREE.PointLight(color, intensity, distance, decay);
  const halfLegacy = 1 - Math.pow(0.5, 1 / decay);           // where r128 reached half brightness
  const halfWindow = Math.pow(1 - Math.SQRT1_2, 0.25);        // same for (1 - x^4)^2
  return new THREE.PointLight(color, intensity * LEGACY_LIGHT, distance * (halfLegacy / halfWindow), 0);
}
