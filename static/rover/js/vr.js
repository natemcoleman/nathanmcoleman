// =========================================================================
// VR (WebXR) — play in a headset such as Meta Quest, from its browser
// -------------------------------------------------------------------------
// The game camera keeps doing its normal job (chase cam, lander cam, Earth
// trip…). In VR a "rig" is moved to that camera every frame and the headset
// looks around from there. The rig is kept level with the local horizon so
// your view doesn't pitch and roll with the craft (big motion-sickness cause).
//
// Quest controllers → the same inputs the keyboard uses:
//   Left stick ........ fly / drive (W A S D)
//   Right stick ....... yaw left/right (Q/E) · down = descend while hovering
//   Right trigger ..... engine (SPACE) · rover brake
//   Left trigger ...... climb / boost (SHIFT) · rover turbo
//   A ................. the main on-screen action (Deploy rover, Board LM, Dock…)
//   B ................. the next action shown beside it
//   X ................. Ping
//   Y ................. hover assist on/off (H)
//
// The HTML HUD (speed, fuel, menus, popups) can't be drawn inside VR.
// =========================================================================
import * as THREE from 'three';
import { camera, renderer, scene } from './scene.js';
import { gameState } from './state.js';
import { inputSrc, ui } from './context-ui.js';
import { handleAction } from './apollo-ops.js';
import { sound } from './audio.js';
import { setHoverAssist } from './modes.js';

// How many game units one real metre is in VR. The LM is ~0.25 units tall and ~7 m in real life.
const params = new URLSearchParams(location.search);
const UNITS_PER_M = Number(params.get('vrscale')) || 0.035;
// ?vrpreview shows the VR view (levelled, scaled rig) on a normal screen — for checking framing without a headset
const PREVIEW = params.has('vrpreview');

export const vr = { supported: false, active: false, session: null, rig: null, eye: null, prevTouchMode: null, prevBtn: [] };

const _f = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _origin = new THREE.Vector3();

export function initVR() {
  if (!renderer.xr) return;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  if (renderer.xr.setFoveation) renderer.xr.setFoveation(1);

  // The rig carries the VR eye camera; the headset pose is applied inside it
  vr.rig = new THREE.Group();
  vr.rig.scale.setScalar(UNITS_PER_M);
  // near/far are in real metres inside the scaled rig: 5 cm … far enough to keep Earth and the stars
  vr.eye = new THREE.PerspectiveCamera(70, 1, 0.05, 4200 / UNITS_PER_M * 1.3);
  vr.rig.add(vr.eye);
  scene.add(vr.rig);

  const btns = [document.getElementById('vr-start-btn'), document.getElementById('vr-menu-btn')];
  if (!navigator.xr || !navigator.xr.isSessionSupported) return;
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    vr.supported = ok;
    btns.forEach((b) => b && b.classList.toggle('hidden', !ok));
  }).catch(() => {});
  btns.forEach((b) => b && b.addEventListener('click', () => toggleVR(b.id === 'vr-start-btn')));
}

export function toggleVR(startGame = false) {
  if (vr.session) { vr.session.end(); return; }
  // requestSession must run straight from the tap, before anything else
  navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] }).then((session) => {
    vr.session = session;
    vr.active = true;
    vr.prevTouchMode = ui.touchMode;
    ui.touchMode = 'off';                  // controllers drive the keyboard path, not the phone THRUST button
    renderer.xr.setSession(session);
    session.addEventListener('end', onEnd);
    sound.init();
    if (startGame && !gameState.started) {
      const launch = document.getElementById('launch-mission-btn');
      if (launch) launch.click();
    }
  }).catch((e) => console.warn('[VR] could not start', e));
}

function onEnd() {
  vr.session = null;
  vr.active = false;
  inputSrc.xr = {};
  if (vr.prevTouchMode != null) ui.touchMode = vr.prevTouchMode;
}

export const isVR = () => !!(renderer.xr && renderer.xr.isPresenting);
const rigOn = () => isVR() || PREVIEW;

// Put the rig where the game camera is, levelled to the local horizon
export function updateVRRig() {
  if (!rigOn()) return;
  if (PREVIEW && vr.eye.aspect !== camera.aspect) { vr.eye.aspect = camera.aspect; vr.eye.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  vr.rig.position.copy(camera.position);
  camera.getWorldDirection(_f);
  _up.copy(camera.up).normalize();
  if (_up.lengthSq() < 0.5) _up.copy(camera.position).normalize();
  const vertical = Math.abs(_f.dot(_up));
  if (vertical < 0.97) {
    _f.addScaledVector(_up, -_f.dot(_up)).normalize();       // drop the pitch, keep the heading
    _m.lookAt(_origin, _f, _up);
    _q.setFromRotationMatrix(_m);
    vr.rig.quaternion.copy(_q);
  } else {
    vr.rig.quaternion.copy(camera.quaternion);                // looking straight down (orbit view): keep as is
  }
  vr.rig.updateMatrixWorld(true);
}

// Read the Quest controllers into the same key flags the keyboard sets
export function updateVRInput() {
  if (!isVR() || !vr.session) return;
  const k = {};
  const pressed = [];
  for (const src of vr.session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const DZ = 0.45;
    if (src.handedness === 'left') {
      if (ax[1] < -DZ) k.forward = true;
      if (ax[1] > DZ) k.backward = true;
      if (ax[0] < -DZ) k.left = true;
      if (ax[0] > DZ) k.right = true;
      if (btn(0)) k.boost = true;                 // trigger
      if (btn(4)) pressed.push('X');
      if (btn(5)) pressed.push('Y');
    } else {
      if (ax[0] < -DZ) k.yawLeft = true;
      if (ax[0] > DZ) k.yawRight = true;
      if (ax[1] > DZ) k.down = true;
      if (btn(0)) k.lift = true;                  // trigger
      if (btn(4)) pressed.push('A');
      if (btn(5)) pressed.push('B');
    }
  }
  inputSrc.xr = k;

  // Buttons fire once per press
  for (const b of pressed) if (!vr.prevBtn.includes(b)) onButton(b);
  vr.prevBtn = pressed;
}

function onButton(b) {
  sound.init();
  if (!gameState.started) {
    if (b === 'A') document.getElementById('launch-mission-btn')?.click();
    return;
  }
  if (b === 'A') document.querySelector('#act-prompt button')?.click();
  else if (b === 'B') document.querySelector('#act-secondary button')?.click();
  else if (b === 'X') handleAction('ping');
  else if (b === 'Y') setHoverAssist(!gameState.hoverAssist);
}

export function vrCamera() {
  return rigOn() ? vr.eye : camera;
}
