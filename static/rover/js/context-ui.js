import * as THREE from 'three';
import { LANDMARKS, MOON_RADIUS, MOON_REAL_KM, SPEED_TO_MS } from './constants.js';
import { sound } from './audio.js';
import { csm, gameState, keys, lander, rover } from './state.js';
import { getSurfaceNormalAtPosition, greatCircleKm } from './coords.js';
import { updateAssistButtonsUI } from './modes.js';
import { renderSitesList, setGameMode, showToast } from './hud.js';
import { ALSEP_MAX, PROX_RANGE, SLOPE_HAZARD_DEG, alsepStations, handleAction, overlayState, rdv, seismo } from './apollo-ops.js';
import { renderRecords, startFresh, updateProgressCounts } from './save.js';
import { a11FuelSeconds, a11Run, inBoulderField, vehicleThermal } from './apollo11.js';

// =========================================================================
// 18. CONTEXT-AWARE HUD: ONLY THE CONTROLS THAT MATTER RIGHT NOW
//     (floating thumbstick, hold buttons, one prompt, key hints, menu)
// =========================================================================
export const inputSrc = { kb: {}, touch: {}, joy: {} };   // merged into `keys` every frame
export const ui = {
  ctx: '',
  sig: '',
  spec: null,
  touch: false,
  touchMode: 'auto',      // auto | on | off
  nearbyLandmark: null,
  menuOpen: false,
  holdEls: new Map(),     // key -> persistent hold button (survives re-renders so held buttons stay held)
  readoutEls: []
};
const joy = { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0, R: 52 };
const JOY_KEYS = ['forward', 'backward', 'left', 'right', 'lift', 'down'];
try { ui.touchMode = localStorage.getItem('lro.touchMode') || 'auto'; } catch (_) { /* storage blocked */ }

export function mergeInputs() {
  for (const k in keys) keys[k] = !!(inputSrc.kb[k] || inputSrc.touch[k] || inputSrc.joy[k]);
}

function detectTouchUI() {
  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  const t = ui.touchMode === 'on' || (ui.touchMode === 'auto' && (mq('(pointer: coarse)') || (mq('(hover: none)') && navigator.maxTouchPoints > 0)));
  if (t !== ui.touch) {
    ui.touch = t;
    document.body.classList.toggle('touch-ui', t);
    ui.sig = '';
    inputSrc.touch = {};
    resetJoystick();
  }
}

// ---------------- What is the player doing right now? ----------------
function getUIContext() {
  if (!gameState.started) return 'briefing';
  if (gameState.mode === 'orbital') return 'orbital';
  if (gameState.mode === 'rover' && rover.deployed) {
    if (rover.crashed) return 'crashed';
    if (rover.isTumbling && rover.isGrounded) return 'rover-flipped';
    if (!rover.isGrounded && rover.stunt.airTime > 0.3) return 'rover-air'; // hysteresis: bumps don't flicker the UI
    return 'rover';
  }
  if (lander.crashed) return 'crashed';
  if (rdv.active) return rdv.phase === 'manual' ? 'dock-manual' : (rdv.phase === 'docked' ? 'docked' : 'rdv-auto');
  if (lander.isLanded) return 'landed';
  return 'flight';
}

const fmtDist = (u) => {
  const km = u * (MOON_REAL_KM / MOON_RADIUS);
  if (km >= 100) return `${km.toFixed(0)} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 1000)} m`;
};
const _uiN = new THREE.Vector3();
function slopeAt(craft) {
  getSurfaceNormalAtPosition(craft.pos, _uiN);
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_uiN.dot(craft.up), -1, 1)));
}
function slopeTint(deg) {
  return deg >= SLOPE_HAZARD_DEG ? '#f8c4b4' : (deg >= 14 ? '#f6a96b' : (deg >= 8 ? '#f4d58d' : '#7ec4a0'));
}

// Readouts: [label, value, color?]
const READOUTS = {
  alt: () => ['ALT', fmtDist(lander.aglUnits)],
  vs: () => {
    const v = lander.vel.dot(lander.up) * SPEED_TO_MS * 0.25;
    return ['DESCENT', `${v >= 0 ? '+' : ''}${v.toFixed(0)} m/s`, v < -75 ? '#f8c4b4' : (v < -30 ? '#f4d58d' : null)];
  },
  fuel: () => ['FUEL', `${Math.round(lander.fuel)}%`, lander.fuel < 22 ? '#f8c4b4' : null],
  slope: () => {
    const craft = gameState.mode === 'rover' ? rover : lander;
    if (inBoulderField(craft.up)) return ['SLOPE', 'BOULDERS', '#f8c4b4'];
    const d = slopeAt(craft);
    return ['SLOPE', `${d.toFixed(0)}°`, slopeTint(d)];
  },
  orbit: () => {
    if (lander.inOrbit) return ['ORBIT', 'LOCKED', '#7ec4a0'];
    const vTan = lander.vel.clone().addScaledVector(lander.up, -lander.vel.dot(lander.up)).length();
    return ['ORBIT SPD', `${Math.min(199, Math.round((vTan / Math.max(0.1, lander.vCirc)) * 100))}%`];
  },
  site: () => {
    const lm = LANDMARKS.find(l => l.id === gameState.targetLandmarkId) || LANDMARKS[0];
    return ['SITE', `${greatCircleKm(lander.up, lm.unitPos).toFixed(0)} km`];
  },
  speed: () => ['SPEED', `${(rover.speed * 11.5).toFixed(0)} m/s`],
  lm: () => ['TO LM', fmtDist(rover.pos.distanceTo(lander.pos))],
  air: () => ['AIR', `${rover.stunt.airTime.toFixed(1)}s`, '#f4d58d'],
  height: () => ['HEIGHT', fmtDist(rover.aglUnits)],
  fuelsec: () => {
    const s = a11FuelSeconds();
    return ['FUEL', `${s.toFixed(0)} s`, s <= 10 ? '#f8c4b4' : (s <= 20 ? '#f4d58d' : null)];
  },
  power: () => {
    const r = vehicleThermal(gameState.mode === 'rover' && rover.deployed ? 'rover' : 'lander');
    const t = Math.round(r.t), b = Math.round(r.b);
    return ['TEMP · BATT', `${t > 0 ? '+' : ''}${t}°C · ${b}%`, b <= 15 ? '#f8c4b4' : (t < -150 ? '#7dd3fc' : (t > 80 ? '#f6a96b' : null))];
  },
  pse: () => {
    const p = seismo.peak;
    return ['QUAKE', p > 0.35 ? 'STRONG' : (p > 0.12 ? 'EVENT' : 'quiet'), p > 0.35 ? '#f8c4b4' : (p > 0.12 ? '#f4d58d' : '#64748b')];
  }
};

// Everything the HUD shows for a given moment
function contextSpec(ctx) {
  const nb = ui.nearbyLandmark;
  const scan = nb ? { label: `${gameState.surveyed.has(nb.id) ? 'Re-scan' : 'Scan'} ${nb.shortName}`, key: 'E', act: 'scan' } : null;
  const spec = { prompt: null, secondary: [], holds: [], joy: null, hints: [], readouts: [], orbitalBar: false, waypoint: true };
  const canAlsep = !lander.ascentOnly && alsepStations.length < ALSEP_MAX;
  switch (ctx) {
    case 'flight': {
      const nearCsm = lander.inOrbit || lander.pos.distanceTo(csm.pos) < PROX_RANGE;
      spec.prompt = scan
        || (gameState.autoSoftLand ? { label: 'Cancel auto-land', key: 'G', act: 'autoland', tone: 'dim' } : null)
        || (nearCsm ? { label: 'Rendezvous with Columbia', key: 'K', act: 'dock', tone: 'sage' } : null)
        || (lander.aglUnits < 12 && !lander.inOrbit ? { label: 'Land for me', key: 'G', act: 'autoland' } : null);
      if (scan && nearCsm) spec.secondary.push({ label: 'Rendezvous with Columbia', key: 'K', act: 'dock' });
      if (spec.prompt && spec.prompt.act !== 'autoland' && !gameState.autoSoftLand && lander.aglUnits < 12 && !lander.inOrbit) {
        spec.secondary.push({ label: 'Land for me', key: 'G', act: 'autoland' });
      }
      if (lander.aglUnits < 6) spec.secondary.push({ label: 'Ping', key: 'F', act: 'ping' });
      if (a11Run.active) {
        // Armstrong's landing: no autopilot, the slope map is your eyes
        spec.prompt = overlayState.mode !== 2 ? { label: 'Slope map', key: 'L', act: 'slopemap', tone: 'sage' } : null;
        spec.secondary = [];
      }
      spec.secondary.unshift({ label: gameState.retroHold ? 'Retro hold ON' : 'Retro hold', key: 'B', act: 'retro', tone: gameState.retroHold ? 'on' : '' });
      const descendOk = gameState.hoverAssist && gameState.autoGyro && !gameState.retroHold;
      const hovering = descendOk && !gameState.autoSoftLand;
      spec.holds = [{ key: 'boost', label: hovering ? 'RISE' : 'BOOST' }, { key: 'lift', label: 'ENGINE', big: true }];
      if (descendOk) spec.holds.unshift({ key: 'down', label: 'LOWER' });
      spec.joy = 'move';
      spec.hints = [['WASD', gameState.autoGyro ? 'Fly' : 'Pitch / roll'], ['SPACE', 'Engine']];
      if (hovering) spec.hints.push(['SHIFT', 'Rise'], ['CTRL', 'Lower']);
      else spec.hints.push(['SHIFT', 'Boost']);
      spec.hints.push(['B', 'Retro'], ['Q/Z', 'Turn'], ['DRAG', 'Look'], ['TAB', 'Map']);
      spec.readouts = ['alt', 'vs', a11Run.active ? 'fuelsec' : 'fuel', lander.aglUnits < 3 ? 'slope' : 'orbit', 'power'];
      break;
    }
    case 'landed': {
      const main = !lander.ascentOnly ? { label: 'Deploy Rover', key: 'R', act: 'rover', tone: 'sage' } : { label: 'Fly to Columbia', key: 'K', act: 'dock', tone: 'sage' };
      spec.prompt = scan || main;
      if (scan) spec.secondary.push(main);   // a scan never hides the normal next step
      if (canAlsep) spec.secondary.push({ label: 'Science station', key: 'P', act: 'alsep' });
      if (main.act !== 'dock') spec.secondary.push({ label: 'Fly to Columbia', key: 'K', act: 'dock' });
      spec.secondary.push({ label: 'Ping', key: 'F', act: 'ping' });
      spec.holds = [{ key: 'lift', label: 'LIFT OFF', big: true }];
      spec.joy = 'move';
      spec.hints = [['SPACE', 'Lift off'], ['WASD', 'Hop'], ['DRAG', 'Look'], ['TAB', 'Map']];
      spec.readouts = ['slope', 'fuel', 'site', 'power'];
      break;
    }
    case 'rover': {
      const nearLm = rover.pos.distanceTo(lander.pos) < 0.6;
      spec.prompt = scan || (nearLm ? { label: 'Board LM', key: 'R', act: 'rover', tone: 'sage' } : null);
      if (!spec.prompt || spec.prompt.act !== 'rover') spec.secondary.push({ label: 'Board LM', key: 'R', act: 'rover' });
      if (canAlsep && rover.speed < 0.4) spec.secondary.push({ label: 'Science station', key: 'P', act: 'alsep' });
      spec.secondary.push({ label: 'Ping', key: 'F', act: 'ping' });
      spec.holds = [{ key: 'lift', label: 'BRAKE' }, { key: 'boost', label: 'TURBO', big: true }];
      spec.joy = 'move';
      spec.hints = [['W/S', 'Drive'], ['A/D', 'Steer'], ['SHIFT', 'Turbo'], ['SPACE', 'Brake'], ['DRAG', 'Look'], ['TAB', 'Map']];
      spec.readouts = ['speed', 'slope', 'lm', 'power'];
      if (alsepStations.length) spec.readouts.push('pse');
      break;
    }
    case 'rover-air':
      spec.holds = [{ key: 'yawLeft', label: '⟲<br>ROLL' }, { key: 'yawRight', label: 'ROLL<br>⟳' }, { key: 'boost', label: 'TURBO', big: true }];
      spec.joy = 'move';
      spec.hints = [['W/S', 'Flip'], ['A/D', 'Spin'], ['Q/Z', 'Roll'], ['SHIFT', 'Boost'], ['', 'Land wheels-down!']];
      spec.readouts = ['air', 'height', 'speed'];
      break;
    case 'rover-flipped':
      spec.prompt = { label: 'Flip upright', key: 'SPACE', act: 'selfright' };
      spec.secondary.push({ label: 'Board LM', key: 'R', act: 'rover' });
      spec.joy = 'move';
      spec.hints = [['SPACE', 'Self-right hop'], ['A/D', 'Rock it over']];
      spec.readouts = ['speed'];
      break;
    case 'orbital':
      spec.prompt = { label: rover.deployed ? 'Back to Rover' : 'Back to LM', key: 'TAB', act: 'map', tone: 'dim' };
      spec.orbitalBar = true;
      spec.waypoint = false;
      spec.hints = [['DRAG', 'Rotate'], ['WHEEL', 'Zoom'], ['CLICK', 'Beacon'], ['TAB', 'Back']];
      break;
    case 'rdv-auto':
      spec.waypoint = false;
      spec.hints = [['', 'Guidance is flying'], ['K', 'Abort'], ['TAB', 'Map'], ['WHEEL', 'Zoom']];
      break;
    case 'dock-manual':
      spec.waypoint = false;
      spec.holds = [{ key: 'boost', label: 'FAST' }, { key: 'backward', label: 'BACK' }, { key: 'forward', label: 'CLOSER', big: true }];
      spec.joy = 'dock';
      if (!ui.touch) spec.secondary.push({ label: rdv.attHold ? 'Attitude hold ON' : 'Attitude hold OFF', key: 'T', act: 'atthold' });
      spec.secondary.push({ label: 'Release', key: 'K', act: 'dock' });
      spec.hints = [['W/S', 'Closer / back'], ['A/D', 'Left / right'], ['SPACE/C', 'Up / down'], ['SHIFT', 'Fast'], ['↑↓←→', 'Pitch / yaw'], ['Q/Z', 'Roll']];
      break;
    case 'docked':
      spec.waypoint = false;
      spec.prompt = { label: 'Undock', key: 'K', act: 'dock', tone: 'sage' };
      spec.hints = [['K', 'Undock'], ['TAB', 'Map'], ['WHEEL', 'Zoom']];
      break;
    case 'crashed':
      spec.hints = [['', 'Stand by — new vehicle inbound']];
      break;
    default:
      spec.waypoint = false;
  }
  return spec;
}

// ---------------- Rendering ----------------
function makeActionButton(p, cls) {
  const b = document.createElement('button');
  b.className = `${cls}${p.tone ? ' ' + p.tone : ''}`;
  b.type = 'button';
  const label = document.createElement('span');
  label.textContent = p.label;
  b.appendChild(label);
  if (!ui.touch && p.key) {
    const kb = document.createElement('span');
    kb.className = 'kb';
    kb.textContent = p.key;
    b.appendChild(kb);
  }
  b.addEventListener('click', () => { sound.init(); handleAction(p.act); });
  return b;
}

function makeHoldButton(h) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `hold-btn${h.big ? ' big' : ''}`;
  b.innerHTML = h.label;
  const down = (e) => {
    e.preventDefault();
    sound.init();
    try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    inputSrc.touch[h.key] = true;
    b.classList.add('pressed');
  };
  const up = () => {
    inputSrc.touch[h.key] = false;
    b.classList.remove('pressed');
  };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

function renderContextUI(spec) {
  // Prompt + secondary taps
  const pWrap = document.getElementById('act-prompt');
  const sWrap = document.getElementById('act-secondary');
  pWrap.replaceChildren();
  sWrap.replaceChildren();
  if (spec.prompt) pWrap.appendChild(makeActionButton(spec.prompt, 'prompt-btn'));
  spec.secondary.forEach((p) => sWrap.appendChild(makeActionButton(p, 'chip-btn')));

  // Hold buttons: diff so a button you're holding through a context change stays held
  const hWrap = document.getElementById('act-holds');
  const want = ui.touch ? spec.holds : [];
  const wantKeys = new Set(want.map((h) => h.key));
  for (const [k, el] of ui.holdEls) {
    if (!wantKeys.has(k)) {
      inputSrc.touch[k] = false;
      el.remove();
      ui.holdEls.delete(k);
    }
  }
  want.forEach((h) => {
    let el = ui.holdEls.get(h.key);
    if (!el) {
      el = makeHoldButton(h);
      ui.holdEls.set(h.key, el);
    } else {
      el.innerHTML = h.label;
      el.classList.toggle('big', !!h.big);
    }
    hWrap.appendChild(el); // appendChild re-orders existing nodes without dropping pointer capture
  });

  // Thumbstick
  const zone = document.getElementById('joy-zone');
  const showJoy = ui.touch && !!spec.joy;
  if (!showJoy) resetJoystick();
  zone.classList.toggle('hidden', !showJoy);
  if (showJoy && !joy.active) placeJoystickAtRest();

  // Desktop key hints
  const hints = document.getElementById('key-hints');
  hints.replaceChildren();
  spec.hints.forEach(([k, label]) => {
    const span = document.createElement('span');
    if (k) {
      const kb = document.createElement('kbd');
      kb.textContent = k;
      span.appendChild(kb);
    }
    span.appendChild(document.createTextNode(label));
    hints.appendChild(span);
  });
  hints.classList.toggle('hidden', ui.touch || spec.hints.length === 0);

  // Readouts
  const ro = document.getElementById('readouts');
  ro.replaceChildren();
  ui.readoutEls = spec.readouts.map((id) => {
    const box = document.createElement('div');
    box.className = 'ro';
    const l = document.createElement('div'); l.className = 'ro-l';
    const v = document.createElement('div'); v.className = 'ro-v';
    box.append(l, v);
    ro.appendChild(box);
    return { id, l, v };
  });
  ro.classList.toggle('hidden', spec.readouts.length === 0);

  document.getElementById('orbital-controls-bar').classList.toggle('hidden', !spec.orbitalBar);
  document.getElementById('waypoint-chip').style.display = spec.waypoint ? '' : 'none';
  document.getElementById('map-btn-label').textContent = gameState.mode === 'orbital' ? 'Back' : 'Map';
}

export function updateContextUI() {
  detectTouchUI();
  const ctx = getUIContext();
  if (ctx !== ui.ctx) {
    // Entering manual docking on a phone: attitude hold always on (two-axis puzzle)
    if (ctx === 'dock-manual' && ui.touch) rdv.attHold = true;
    ui.ctx = ctx;
  }
  const spec = contextSpec(ctx);
  const sig = [ctx, ui.touch, spec.prompt && spec.prompt.label, spec.secondary.map((p) => p.label).join('|'),
    spec.holds.map((h) => h.key).join('|'), spec.readouts.join('|'), spec.hints.map((h) => h[1]).join('|'), gameState.mode].join('#');
  if (sig !== ui.sig) {
    ui.sig = sig;
    renderContextUI(spec);
  }
  ui.spec = spec;
  for (const r of ui.readoutEls) {
    const [label, value, color] = READOUTS[r.id]();
    r.l.textContent = label;
    r.v.textContent = value;
    r.v.style.color = color || '';
  }
  applyJoystick(spec.joy);
}

// ---------------- Floating thumbstick ----------------
function placeJoystickAtRest() {
  const zone = document.getElementById('joy-zone');
  const base = document.getElementById('joy-base');
  base.style.left = '96px';
  base.style.top = `${Math.max(80, zone.clientHeight - 96)}px`;
  document.getElementById('joy-knob').style.transform = '';
}

function resetJoystick() {
  joy.active = false;
  joy.id = null;
  joy.x = 0;
  joy.y = 0;
  JOY_KEYS.forEach((k) => { inputSrc.joy[k] = false; });
  const zone = document.getElementById('joy-zone');
  if (zone) {
    zone.classList.remove('active');
    placeJoystickAtRest();
  }
}

function applyJoystick(mode) {
  const j = inputSrc.joy;
  JOY_KEYS.forEach((k) => { j[k] = false; });
  if (!joy.active || !mode) return;
  const t = 0.32;
  if (mode === 'move') {
    j.forward = joy.y < -t;
    j.backward = joy.y > t;
    j.left = joy.x < -t;
    j.right = joy.x > t;
  } else if (mode === 'dock') {
    j.right = joy.x > t;
    j.left = joy.x < -t;
    j.lift = joy.y < -t;   // push up = translate up
    j.down = joy.y > t;
  }
}

function bindJoystick() {
  const zone = document.getElementById('joy-zone');
  const base = document.getElementById('joy-base');
  const knob = document.getElementById('joy-knob');
  const move = (e) => {
    const r = zone.getBoundingClientRect();
    let dx = (e.clientX - r.left - joy.cx) / joy.R;
    let dy = (e.clientY - r.top - joy.cy) / joy.R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    joy.x = dx;
    joy.y = dy;
    knob.style.transform = `translate(${(dx * joy.R).toFixed(1)}px, ${(dy * joy.R).toFixed(1)}px)`;
  };
  zone.addEventListener('pointerdown', (e) => {
    if (joy.active) return;
    e.preventDefault();
    sound.init();
    try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const r = zone.getBoundingClientRect();
    joy.active = true;
    joy.id = e.pointerId;
    joy.cx = THREE.MathUtils.clamp(e.clientX - r.left, 64, r.width - 40);
    joy.cy = THREE.MathUtils.clamp(e.clientY - r.top, 64, r.height - 40);
    base.style.left = `${joy.cx}px`;
    base.style.top = `${joy.cy}px`;
    zone.classList.add('active');
    move(e);
  });
  zone.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) move(e); });
  const end = (e) => { if (e.pointerId === joy.id) resetJoystick(); };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);
  window.addEventListener('resize', () => { if (!joy.active) placeJoystickAtRest(); });
}

// ---------------- Menu, details, map, full screen ----------------
function openMenu() {
  ui.menuOpen = true;
  document.getElementById('menu-sheet').classList.remove('hidden');
  document.getElementById('menu-backdrop').classList.remove('hidden');
  updateAssistButtonsUI();
  syncTouchModeLabel();
  renderRecords();
  updateProgressCounts();
}
export function closeMenu() {
  ui.menuOpen = false;
  document.getElementById('menu-sheet').classList.add('hidden');
  document.getElementById('menu-backdrop').classList.add('hidden');
}
export function toggleDetails() {
  document.getElementById('details-panel').classList.toggle('hidden');
}
export function toggleMap() {
  setGameMode(gameState.mode === 'orbital' ? (rover.deployed ? 'rover' : 'lander') : 'orbital');
}
function syncTouchModeLabel() {
  const el = document.getElementById('touch-mode-state');
  el.textContent = ui.touchMode === 'auto' ? `AUTO (${ui.touch ? 'ON' : 'OFF'})` : ui.touchMode.toUpperCase();
}
function toggleFullscreen() {
  const el = document.documentElement;
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const fallback = () => showToast('Full screen isn’t available here — on iPhone use Share → Add to Home Screen', 'gold');
  if (!req) { fallback(); return; }
  try {
    const p = req.call(el);
    const lock = () => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); };
    if (p && p.then) p.then(lock).catch(fallback); else lock();
  } catch (_) { fallback(); }
}

export function bindContextUI() {
  bindJoystick();
  document.getElementById('menu-btn').addEventListener('click', () => { sound.init(); ui.menuOpen ? closeMenu() : openMenu(); });
  document.getElementById('menu-close-btn').addEventListener('click', closeMenu);
  document.getElementById('menu-backdrop').addEventListener('click', closeMenu);
  document.getElementById('menu-sheet').addEventListener('click', (e) => {
    const item = e.target.closest('[data-close-menu]');
    if (item) setTimeout(closeMenu, 0);
  });
  document.getElementById('map-btn').addEventListener('click', () => { sound.init(); toggleMap(); });
  document.getElementById('waypoint-chip').addEventListener('click', () => {
    renderSitesList();
    document.getElementById('sites-drawer').classList.remove('hidden');
  });
  document.getElementById('readouts').addEventListener('click', toggleDetails);
  document.getElementById('details-toggle-btn').addEventListener('click', toggleDetails);
  document.getElementById('details-close-btn').addEventListener('click', toggleDetails);
  document.getElementById('help-btn').addEventListener('click', () => document.getElementById('help-modal').classList.remove('hidden'));
  document.getElementById('help-close-btn').addEventListener('click', () => document.getElementById('help-modal').classList.add('hidden'));
  document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
  document.getElementById('reset-btn').addEventListener('click', startFresh);
  document.getElementById('touch-mode-btn').addEventListener('click', () => {
    ui.touchMode = ui.touchMode === 'auto' ? 'on' : (ui.touchMode === 'on' ? 'off' : 'auto');
    try { localStorage.setItem('lro.touchMode', ui.touchMode); } catch (_) { /* ignore */ }
    detectTouchUI();
    syncTouchModeLabel();
  });
  // Never leave a key stuck down when the tab loses focus
  window.addEventListener('blur', () => {
    inputSrc.kb = {};
    inputSrc.touch = {};
    resetJoystick();
    for (const el of ui.holdEls.values()) el.classList.remove('pressed');
  });
  detectTouchUI();
}
