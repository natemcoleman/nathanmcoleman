import * as THREE from 'three';
import { LANDMARKS, MOON_RADIUS } from './constants.js';
import { sound } from './audio.js';
import { beaconClickTargets, camCtrl, csm, gameState, keys, rover, roverCam } from './state.js';
import { applyTerrainRelief, getDisplacementScale } from './coords.js';
import { processUploadedFile, resetSlotToProcedural } from './nasa-maps.js';
import { camera, latLonGridGroup, renderer, updateSunDirection } from './scene.js';
import { focusOrbitOnLandmark, setAutoGyro, setAutoSoftLand, setHoverAssist, toggleRoverDeployment } from './modes.js';
import { triggerLidarScan } from './scan.js';
import { renderSitesList, setGameMode, showToast } from './hud.js';
import { handleAction, rdv, toggleDockAttitudeHold } from './apollo-ops.js';
import { bindContextUI, closeMenu, inputSrc, toggleDetails, ui } from './context-ui.js';
import { save, scheduleSave, welcomeBackText } from './save.js';
import { closeJournal } from './finds.js';
import { say, unlockRadio } from './radio.js';
import { maybeStartTutorial } from './tutorial.js';

// =========================================================================
// 14. INPUT BINDINGS (KEYBOARD, MOUSE, TOUCH & DRAG-DROP)
// =========================================================================
// Browsers won't let a page block CTRL+W (close tab), so while CTRL is held we ask before leaving.
let ctrlGuardOn = false;
function ctrlGuard(e) { e.preventDefault(); e.returnValue = ''; }
function armCtrlGuard(on) {
  if (on === ctrlGuardOn || !gameState.started) return;
  ctrlGuardOn = on;
  if (on) window.addEventListener('beforeunload', ctrlGuard);
  else window.removeEventListener('beforeunload', ctrlGuard);
}

// Phones: no double-tap or pinch zoom (iOS ignores user-scalable=no), and undo any zoom that slips through
function blockPageZoom() {
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!typing && now - lastTouchEnd < 320) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  const vv = window.visualViewport;
  const meta = document.querySelector('meta[name="viewport"]');
  if (vv && meta) {
    vv.addEventListener('resize', () => {
      if (vv.scale > 1.01) {
        const c = meta.getAttribute('content');
        meta.setAttribute('content', c.replace(/maximum-scale=[^,]*/, 'maximum-scale=1.01'));
        requestAnimationFrame(() => meta.setAttribute('content', c));
      }
    });
  }
}

export function bindInputs() {
  blockPageZoom();
  window.addEventListener('keyup', (e) => { if (e.code === 'ControlLeft' || e.code === 'ControlRight' || !e.ctrlKey) armCtrlGuard(false); });
  window.addEventListener('blur', () => armCtrlGuard(false));
  const keyMap = {
    KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
    KeyQ: 'yawLeft', KeyZ: 'yawRight', KeyC: 'down', ControlLeft: 'down', ControlRight: 'down',
    Space: 'lift', ShiftLeft: 'boost', ShiftRight: 'boost',
    ArrowUp: 'arrowUp', ArrowDown: 'arrowDown', ArrowLeft: 'arrowLeft', ArrowRight: 'arrowRight'
  };

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (keyMap[e.code]) {
      inputSrc.kb[keyMap[e.code]] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      // CTRL is the hover LOWER key: keep CTRL+S/D/A/F… from opening browser dialogs mid-flight
      if (/^(Key|Digit|Space|Arrow|Tab)/.test(e.code)) e.preventDefault();
      armCtrlGuard(true);
    }
    if (e.repeat) return;

    switch (e.code) {
      case 'KeyT':
        if (gameState.started && gameState.mode === 'lander') {
          if (rdv.active && rdv.phase === 'manual') toggleDockAttitudeHold();
          else if (!rdv.active) setAutoGyro(!gameState.autoGyro);
        }
        break;
      case 'KeyK':
        if (gameState.started) handleAction('dock');
        break;
      case 'KeyX':
        if (gameState.started) handleAction('stage');
        break;
      case 'KeyP':
        if (gameState.started) handleAction('alsep');
        break;
      case 'KeyL':
        if (gameState.started) handleAction('overlay');
        break;
      case 'KeyF':
        if (gameState.started) handleAction('ping');
        break;
      case 'KeyB':
        if (gameState.started) handleAction('retro');
        break;
      case 'KeyN':
        if (gameState.started) handleAction('prograde');
        break;
      case 'KeyY':
        if (gameState.started) handleAction('gohome');
        break;
      case 'KeyJ':
        if (gameState.started) handleAction('journal');
        break;
      case 'KeyR':
        if (gameState.started && (gameState.mode === 'lander' || gameState.mode === 'rover')) {
          toggleRoverDeployment();
        }
        break;
      case 'KeyH':
        if (gameState.started && gameState.mode === 'lander' && !rdv.active) setHoverAssist(!gameState.hoverAssist);
        break;
      case 'KeyG':
        if (gameState.started && gameState.mode === 'lander' && !rdv.active) setAutoSoftLand(!gameState.autoSoftLand);
        break;
      case 'KeyE':
        if (gameState.started) triggerLidarScan();
        break;
      case 'Tab':
      case 'KeyM':
        if (gameState.started) {
          e.preventDefault();
          setGameMode(gameState.mode === 'orbital' ? (rover.deployed ? 'rover' : 'lander') : 'orbital');
        }
        break;
      case 'KeyI':
        if (gameState.started) toggleDetails();
        break;
      case 'Slash':
      case 'F1':
        e.preventDefault();
        document.getElementById('help-modal').classList.remove('hidden');
        break;
      case 'Escape':
        closeMenu();
        document.getElementById('help-modal').classList.add('hidden');
        closeJournal();
        document.getElementById('a11-result-modal').classList.add('hidden');
        document.getElementById('kit-modal').classList.add('hidden');
        document.getElementById('sites-drawer').classList.add('hidden');
        document.getElementById('env-modal').classList.add('hidden');
        document.getElementById('dossier-modal').classList.add('hidden');
        document.getElementById('hadley-result-modal').classList.add('hidden');
        document.getElementById('ice-result-modal').classList.add('hidden');
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) inputSrc.kb[keyMap[e.code]] = false;
  });

  // Mouse Camera Drag, Zoom & Beacon Raycasting
  const dom = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  dom.addEventListener('mousedown', (e) => {
    sound.init();
    camCtrl.isDragging = true;
    roverCam.dragging = true;
    camCtrl.dragMoved = false;
    camCtrl.lastX = e.clientX;
    camCtrl.lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!camCtrl.isDragging || !gameState.started) return;
    const dx = e.clientX - camCtrl.lastX;
    const dy = e.clientY - camCtrl.lastY;
    if (Math.hypot(dx, dy) > 2) camCtrl.dragMoved = true;
    camCtrl.lastX = e.clientX;
    camCtrl.lastY = e.clientY;

    if (gameState.mode === 'rover') {
      roverCam.userYaw -= dx * 0.0065;
      roverCam.userPitch = THREE.MathUtils.clamp(roverCam.userPitch + dy * 0.005, -0.18, 0.92);
    } else if (gameState.mode === 'lander') {
      camCtrl.chaseYaw -= dx * 0.0065;
      camCtrl.chasePitch = THREE.MathUtils.clamp(camCtrl.chasePitch + dy * 0.0055, 0.08, 1.25);
    } else {
      csm.tracking = false;
      camCtrl.targetOrbitLonDeg -= dx * 0.28;
      camCtrl.targetOrbitLatDeg = THREE.MathUtils.clamp(camCtrl.targetOrbitLatDeg + dy * 0.25, -88, 88);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (camCtrl.isDragging && !camCtrl.dragMoved && gameState.started && gameState.mode === 'orbital') {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(beaconClickTargets, false);
      if (hits.length > 0) {
        const id = hits[0].object.userData.landmarkId;
        const lm = LANDMARKS.find(x => x.id === id);
        if (lm) focusOrbitOnLandmark(lm);
      }
    }
    camCtrl.isDragging = false;
    roverCam.dragging = false;
  });

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (gameState.mode === 'lander' && rdv.active && (rdv.phase === 'approach' || rdv.phase === 'manual' || rdv.phase === 'docked')) {
      camCtrl.dockDist = THREE.MathUtils.clamp(camCtrl.dockDist * (1 + Math.sign(e.deltaY) * 0.1), 0.35, 6.0);
    } else if (gameState.mode === 'lander') {
      camCtrl.chaseDist = THREE.MathUtils.clamp(camCtrl.chaseDist + e.deltaY * 0.0025, 0.42, 18.0);
    } else if (gameState.mode === 'rover') {
      roverCam.zoom = THREE.MathUtils.clamp(roverCam.zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.34, 3.6);
    } else {
      csm.tracking = false;
      const minOrb = Math.max(116, MOON_RADIUS + getDisplacementScale() * 0.56 + 12);
      camCtrl.targetOrbitDist = THREE.MathUtils.clamp(camCtrl.targetOrbitDist + e.deltaY * 0.14, minOrb, 390);
    }
  }, { passive: false });

  // Touch Camera Orbit & Pinch Zoom
  dom.addEventListener('touchstart', (e) => {
    sound.init();
    if (e.targetTouches.length === 1) {
      camCtrl.isDragging = true;
      roverCam.dragging = true;
      camCtrl.lastX = e.targetTouches[0].clientX;
      camCtrl.lastY = e.targetTouches[0].clientY;
    } else if (e.targetTouches.length === 2) {
      camCtrl.pinchDist = Math.hypot(
        e.targetTouches[0].clientX - e.targetTouches[1].clientX,
        e.targetTouches[0].clientY - e.targetTouches[1].clientY
      );
    }
  }, { passive: true });

  dom.addEventListener('touchmove', (e) => {
    if (!gameState.started) return;
    if (e.targetTouches.length === 1 && camCtrl.isDragging) {
      const dx = e.targetTouches[0].clientX - camCtrl.lastX;
      const dy = e.targetTouches[0].clientY - camCtrl.lastY;
      camCtrl.lastX = e.targetTouches[0].clientX;
      camCtrl.lastY = e.targetTouches[0].clientY;
      if (gameState.mode === 'rover') {
        roverCam.userYaw -= dx * 0.008;
        roverCam.userPitch = THREE.MathUtils.clamp(roverCam.userPitch + dy * 0.006, -0.18, 0.92);
      } else if (gameState.mode === 'lander') {
        camCtrl.chaseYaw -= dx * 0.008;
        camCtrl.chasePitch = THREE.MathUtils.clamp(camCtrl.chasePitch + dy * 0.007, 0.08, 1.25);
      } else {
        csm.tracking = false;
        camCtrl.targetOrbitLonDeg -= dx * 0.34;
        camCtrl.targetOrbitLatDeg = THREE.MathUtils.clamp(camCtrl.targetOrbitLatDeg + dy * 0.3, -88, 88);
      }
    } else if (e.targetTouches.length === 2) {
      const dist = Math.hypot(
        e.targetTouches[0].clientX - e.targetTouches[1].clientX,
        e.targetTouches[0].clientY - e.targetTouches[1].clientY
      );
      const delta = camCtrl.pinchDist - dist;
      camCtrl.pinchDist = dist;
      if (gameState.mode === 'lander') {
        camCtrl.chaseDist = THREE.MathUtils.clamp(camCtrl.chaseDist + delta * 0.008, 0.42, 18.0);
      } else if (gameState.mode === 'rover') {
        roverCam.zoom = THREE.MathUtils.clamp(roverCam.zoom + delta * 0.005, 0.34, 3.6);
      } else {
        csm.tracking = false;
        const minOrb = Math.max(116, MOON_RADIUS + getDisplacementScale() * 0.56 + 12);
        camCtrl.targetOrbitDist = THREE.MathUtils.clamp(camCtrl.targetOrbitDist + delta * 0.45, minOrb, 390);
      }
    }
  }, { passive: true });

  dom.addEventListener('touchend', () => { camCtrl.isDragging = false; roverCam.dragging = false; });

  // On-Screen Touch Flight Buttons
  document.querySelectorAll('#menu-sheet [data-action]').forEach((btn) => {
    btn.addEventListener('click', () => { sound.init(); handleAction(btn.getAttribute('data-action')); });
  });
  bindContextUI();
  document.getElementById('dock-abort-btn').addEventListener('click', () => { sound.init(); handleAction('dock'); });
  document.getElementById('overlay-btn').addEventListener('click', () => { sound.init(); handleAction('overlay'); });

  document.querySelectorAll('.touch-key[data-key]').forEach((btn) => {
    const k = btn.getAttribute('data-key');
    const press = (e) => {
      e.preventDefault();
      sound.init();
      keys[k] = true;
      btn.classList.add('pressed');
    };
    const release = (e) => {
      e.preventDefault();
      keys[k] = false;
      btn.classList.remove('pressed');
    };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });

  // UI Button Listeners
  document.getElementById('launch-mission-btn').addEventListener('click', () => {
    sound.init();
    gameState.started = true;
    document.getElementById('start-overlay').classList.add('hidden');
    document.getElementById('hud-root').classList.remove('hidden');
    sound.playPing(660, 0.16);
    unlockRadio();
    setTimeout(() => say('welcome'), 1800);
    maybeStartTutorial();
    if (save.loaded) showToast(welcomeBackText(), 'sage');
    else showToast(ui.touch ? 'Left thumb to fly · hold THRUST to hover, slide up or down to climb or descend' : 'WASD to fly · SPACE engine · press G to auto-land', 'gold');
  });

  document.getElementById('start-open-kit-btn').addEventListener('click', () => {
    sound.init();
    document.getElementById('kit-modal').classList.remove('hidden');
  });

  document.getElementById('autogyro-btn').addEventListener('click', () => { sound.init(); setAutoGyro(!gameState.autoGyro); });
  document.getElementById('hover-assist-btn').addEventListener('click', () => { sound.init(); setHoverAssist(!gameState.hoverAssist); });

  const musicToggleBtn = document.getElementById('music-toggle-btn');
  musicToggleBtn.addEventListener('click', () => {
    sound.init();
    const musicOff = sound.toggleMusic();
    document.getElementById('music-on-icon').classList.toggle('hidden', musicOff);
    document.getElementById('music-off-icon').classList.toggle('hidden', !musicOff);
    musicToggleBtn.classList.toggle('text-[#7ec4a0]', !musicOff);
    musicToggleBtn.classList.toggle('border-[#7ec4a0]/45', !musicOff);
    musicToggleBtn.classList.toggle('text-slate-500', musicOff);
    musicToggleBtn.classList.toggle('border-slate-700', musicOff);
    musicToggleBtn.title = musicOff ? 'Music: OFF (Click to Enable)' : 'Music: ON (Click to Mute)';
    scheduleSave();
    showToast(musicOff ? 'Background Music Muted' : 'Background Music Enabled', 'gold');
  });

  document.getElementById('sound-toggle-btn').addEventListener('click', () => {
    sound.init();
    const muted = sound.toggleMute();
    scheduleSave();
    document.getElementById('sound-on-icon').classList.toggle('hidden', muted);
    document.getElementById('sound-off-icon').classList.toggle('hidden', !muted);
  });

  // Drawers & Modals
  document.getElementById('open-sites-btn').addEventListener('click', () => {
    renderSitesList();
    document.getElementById('sites-drawer').classList.toggle('hidden');
  });
  document.getElementById('close-sites-btn').addEventListener('click', () => document.getElementById('sites-drawer').classList.add('hidden'));

  document.getElementById('open-env-btn').addEventListener('click', () => document.getElementById('env-modal').classList.toggle('hidden'));
  document.getElementById('close-env-btn').addEventListener('click', () => document.getElementById('env-modal').classList.add('hidden'));

  document.getElementById('open-kit-btn').addEventListener('click', () => document.getElementById('kit-modal').classList.remove('hidden'));
  document.getElementById('close-kit-btn').addEventListener('click', () => document.getElementById('kit-modal').classList.add('hidden'));

  document.getElementById('close-dossier-btn').addEventListener('click', () => document.getElementById('dossier-modal').classList.add('hidden'));
  document.getElementById('dossier-continue-btn').addEventListener('click', () => document.getElementById('dossier-modal').classList.add('hidden'));

  // Environment Sliders
  document.getElementById('sun-angle-slider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('sun-angle-val').textContent = `${Math.round(val)}°`;
    updateSunDirection(val);
    scheduleSave();
  });
  document.getElementById('sun-cycle-check').addEventListener('change', (e) => {
    gameState.sunAutoCycle = e.target.checked;
    scheduleSave();
  });
  document.getElementById('relief-scale-slider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('relief-scale-val').textContent = `${val.toFixed(1)}x`;
    applyTerrainRelief(val);
    scheduleSave();
  });

  // Orbital Quick Views & Lat/Lon Grid
  document.querySelectorAll('.orbital-qv-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.init();
      const v = btn.getAttribute('data-view');
      if (v === 'csm') {
        csm.tracking = true;
        showToast('Tracking Apollo 11 CSM "Columbia" in Lunar Orbit', 'sage');
        sound.playPing(780, 0.14);
        return;
      }
      csm.tracking = false;
      if (v === 'near') {
        camCtrl.targetOrbitLatDeg = 5;
        camCtrl.targetOrbitLonDeg = 0;
        camCtrl.targetOrbitDist = 235;
      } else if (v === 'far') {
        camCtrl.targetOrbitLatDeg = 5;
        camCtrl.targetOrbitLonDeg = 180;
        camCtrl.targetOrbitDist = 235;
      } else if (v === 'north') {
        camCtrl.targetOrbitLatDeg = 85;
        camCtrl.targetOrbitLonDeg = 0;
        camCtrl.targetOrbitDist = 220;
      } else if (v === 'south') {
        camCtrl.targetOrbitLatDeg = -85;
        camCtrl.targetOrbitLonDeg = 129.78;
        camCtrl.targetOrbitDist = 220;
      }
      sound.playPing(660, 0.11);
    });
  });

  document.getElementById('orbital-grid-btn').addEventListener('click', (e) => {
    gameState.gridVisible = !gameState.gridVisible;
    if (latLonGridGroup) latLonGridGroup.visible = gameState.gridVisible;
    e.target.textContent = `Grid: ${gameState.gridVisible ? 'ON' : 'OFF'}`;
  });

  // CGI Moon Kit File Inputs & Dropzones
  const colorZone = document.getElementById('dropzone-color');
  const demZone = document.getElementById('dropzone-dem');
  const colorInput = document.getElementById('input-color-file');
  const demInput = document.getElementById('input-dem-file');

  colorZone.addEventListener('click', (e) => {
    if (e.target.id === 'reset-color-btn') return;
    colorInput.click();
  });
  demZone.addEventListener('click', (e) => {
    if (e.target.id === 'reset-dem-btn') return;
    demInput.click();
  });
  document.getElementById('reset-color-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    resetSlotToProcedural('color');
  });
  document.getElementById('reset-dem-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    resetSlotToProcedural('dem');
  });

  colorInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) processUploadedFile(e.target.files[0], 'color');
    e.target.value = '';
  });
  demInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) processUploadedFile(e.target.files[0], 'dem');
    e.target.value = '';
  });

  // Zone-Specific Drop Handlers
  [
    { el: colorZone, slot: 'color' },
    { el: demZone, slot: 'dem' }
  ].forEach(({ el, slot }) => {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop-active');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-active'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-active');
      document.getElementById('global-drop-overlay').classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        processUploadedFile(e.dataTransfer.files[0], slot);
      }
    });
  });

  // Global Viewport Drag & Drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    document.getElementById('global-drop-overlay').classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.getElementById('global-drop-overlay').classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.getElementById('global-drop-overlay').classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      Array.from(e.dataTransfer.files).forEach((f) => processUploadedFile(f, null));
    }
  });

  // Resize Handler
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
}
