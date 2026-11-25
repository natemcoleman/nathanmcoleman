import * as THREE from 'three';
import { LANDMARKS } from './constants.js';
import { sound } from './audio.js';
import { gameState, terrainState } from './state.js';
import { applyTerrainRelief } from './coords.js';
import { refreshBeaconColors, scene, updateSunDirection } from './scene.js';
import { stuntStars } from './rover.js';
import { hudPrefs, renderSitesList } from './hud.js';
import { formatHadleyTime, hadleyRun, iceRun, orbitRingState, syncOrbitRingToggleUI } from './challenges.js';
import { ALSEP_MAX, alsepStations, applyOverlayMode, createAlsepStation, makeDescentStageClone, overlayState, parkedStages, rdv, reseatSurfaceAssets } from './apollo-ops.js';
import { FINDS, foundCount } from './finds.js';

// =========================================================================
// 19. PROGRESS SAVE — versioned, browser-local, autosaving
// =========================================================================
const SAVE_KEY = 'lro.save.v1';
const SAVE_VERSION = 1;
export const save = {
  available: false,   // storage usable in this browser/frame
  loaded: false,      // a previous save was found and applied
  timer: null,
  resetArmed: false,
  resetTimer: null,
  data: null
};

function defaultSave() {
  return {
    v: SAVE_VERSION,
    surveyed: [],
    alsep: [],           // [{ lat, lon }]
    parkedStages: [],    // [{ lat, lon }]
    records: {
      hadleyBest: null,  // seconds
      iceBest: null,
      bestTrick: null,   // { label, difficulty, air }
      longestAir: 0,     // seconds, clean landings only
      dockings: 0,
      a11Best: null,     // seconds of fuel left on the best Apollo 11 landing
      earthReturns: 0,   // splashdowns
      earthBest: null    // best % of re-entry inside the corridor
    },
    firsts: {},          // milestones: landing, rover, scan, alsep, stage, docking (journal-ready)
    journal: {},         // Field Journal: id -> { t, by }
    tracking: null,      // find id followed by Ping
    settings: {
      music: true,
      sound: true,
      radio: 'on',      // Mission Control subtitles (+ recorded clips): 'on' | 'off'
      hover: true,      // hover assist
      popups: 'all',    // 'all' tips and messages, or 'essential' (warnings only) — set after the first mission
      overlay: 0,
      orbitRing: true,
      relief: 5,
      sunAngle: 42,
      sunCycle: false,
      target: LANDMARKS[0].id
    }
  };
}
save.data = defaultSave();

const isPlainObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
// Fill a (possibly older or partial) save on top of the current defaults, keeping only known shapes
function mergeSave(def, obj) {
  if (!isPlainObj(obj)) return def;
  for (const k of Object.keys(def)) {
    if (obj[k] === undefined) continue;
    if (isPlainObj(def[k]) && Object.keys(def[k]).length && isPlainObj(obj[k])) {
      def[k] = mergeSave(def[k], obj[k]);
    } else if (Array.isArray(def[k]) === Array.isArray(obj[k]) || def[k] === null) {
      def[k] = obj[k];
    }
  }
  // Free-form maps keep every key
  if (isPlainObj(obj.firsts)) def.firsts = { ...obj.firsts };
  if (isPlainObj(obj.journal)) def.journal = { ...obj.journal };
  return def;
}

function storageUsable() {
  try {
    const k = 'lro.__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (_) {
    return false;
  }
}

export function loadSave() {
  save.available = storageUsable();
  if (!save.available) return;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    // Future schema changes migrate here: if (parsed.v === 1) { ...; parsed.v = 2; }
    save.data = mergeSave(defaultSave(), parsed);
    save.data.v = SAVE_VERSION;
    save.loaded = true;
  } catch (_) {
    save.data = defaultSave(); // corrupt save: start clean rather than crash
  }
}

const validLatLon = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90;

export function applySave() {
  const d = save.data;
  // Surveyed sites & current target
  const ids = new Set(LANDMARKS.map((l) => l.id));
  gameState.surveyed = new Set((Array.isArray(d.surveyed) ? d.surveyed : []).filter((id) => ids.has(id)));
  gameState.allCelebrated = gameState.surveyed.size === LANDMARKS.length;
  if (ids.has(d.settings.target)) gameState.targetLandmarkId = d.settings.target;
  refreshBeaconColors();
  renderSitesList();

  // Settings
  const relief = THREE.MathUtils.clamp(Number(d.settings.relief) || 5, 1, 15);
  if (Math.abs(relief - terrainState.reliefExaggeration) > 1e-6) applyTerrainRelief(relief);
  document.getElementById('relief-scale-slider').value = relief;
  document.getElementById('relief-scale-val').textContent = `${relief.toFixed(1)}x`;
  const sun = ((Number(d.settings.sunAngle) % 360) + 360) % 360;
  updateSunDirection(sun);
  document.getElementById('sun-angle-slider').value = Math.round(sun);
  document.getElementById('sun-angle-val').textContent = `${Math.round(sun)}°`;
  gameState.sunAutoCycle = !!d.settings.sunCycle;
  document.getElementById('sun-cycle-check').checked = gameState.sunAutoCycle;
  orbitRingState.enabled = d.settings.orbitRing !== false;
  // Nov 25: auto hold is now off by default — switch it off once for older saves too
  if (!d.settings.hoverOffV2) { d.settings.hover = false; d.settings.hoverOffV2 = true; }
  gameState.hoverAssist = d.settings.hover === true;
  hudPrefs.popups = d.settings.popups === 'essential' ? 'essential' : 'all';
  syncOrbitRingToggleUI();
  sound.musicMuted = d.settings.music === false;
  sound.muted = d.settings.sound === false;
  syncAudioButtons();
  applyOverlayMode(THREE.MathUtils.clamp(d.settings.overlay | 0, 0, 2), true);

  // Things you left on the Moon
  (Array.isArray(d.alsep) ? d.alsep : []).filter(validLatLon).slice(0, ALSEP_MAX)
    .forEach((p) => createAlsepStation(p.lat, p.lon));
  (Array.isArray(d.parkedStages) ? d.parkedStages : []).filter(validLatLon).slice(0, 50).forEach((p) => {
    const stage = makeDescentStageClone();
    scene.add(stage);
    parkedStages.push({ group: stage, lat: p.lat, lon: p.lon });
  });
  reseatSurfaceAssets();

  // Records
  const r = d.records;
  hadleyRun.bestTime = Number.isFinite(r.hadleyBest) ? r.hadleyBest : null;
  iceRun.bestTime = Number.isFinite(r.iceBest) ? r.iceBest : null;
  if (hadleyRun.bestTime !== null) document.getElementById('hadley-best-badge').textContent = `BEST ${formatHadleyTime(hadleyRun.bestTime)}`;
  if (iceRun.bestTime !== null) document.getElementById('ice-best-badge').textContent = `BEST ${formatHadleyTime(iceRun.bestTime)}`;
  rdv.dockedOnce = (r.dockings | 0) > 0;

  updateProgressCounts();
  renderBriefingSave();
  document.getElementById('save-note').textContent = save.available
    ? 'Progress saves automatically on this device.'
    : 'This browser is blocking storage — progress will reset when you close the page.';

  // Autosave: periodic + whenever the page is hidden or closed
  setInterval(() => { if (gameState.started) writeSave(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeSave(); });
  window.addEventListener('pagehide', writeSave);
}

function collectSave() {
  const d = save.data;
  d.v = SAVE_VERSION;
  d.surveyed = [...gameState.surveyed];
  d.alsep = alsepStations.map((st) => ({ lat: +st.lat.toFixed(4), lon: +st.lon.toFixed(4) }));
  d.parkedStages = parkedStages.map((p) => ({ lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4) }));
  d.settings.music = !sound.musicMuted;
  d.settings.sound = !sound.muted;
  d.settings.overlay = overlayState.mode;
  d.settings.orbitRing = orbitRingState.enabled;
  d.settings.hover = gameState.hoverAssist;
  d.settings.popups = hudPrefs.popups;
  d.settings.relief = terrainState.reliefExaggeration;
  d.settings.sunAngle = Math.round(gameState.sunAngleDeg);
  d.settings.sunCycle = gameState.sunAutoCycle;
  d.settings.target = gameState.targetLandmarkId;
  return d;
}

function writeSave() {
  if (!save.available) return;
  clearTimeout(save.timer);
  save.timer = null;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(collectSave()));
  } catch (_) { /* quota or privacy mode: keep playing */ }
}

export function scheduleSave() {
  if (!save.available) return;
  clearTimeout(save.timer);
  save.timer = setTimeout(writeSave, 600);
}

export function markFirst(key) {
  if (save.data.firsts[key]) return false;
  save.data.firsts[key] = Date.now();
  scheduleSave();
  return true;
}

export function startFresh() {
  if (!save.resetArmed) {
    save.resetArmed = true;
    const lbl = document.getElementById('reset-btn-label');
    lbl.textContent = 'Tap again to erase all progress';
    lbl.style.color = '#f8c4b4';
    clearTimeout(save.resetTimer);
    save.resetTimer = setTimeout(() => {
      save.resetArmed = false;
      lbl.textContent = 'Start fresh';
      lbl.style.color = '';
    }, 4000);
    return;
  }
  save.available = false; // stop the page-hide autosave from writing the old state back
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem('lro.touchMode');
  } catch (_) { /* ignore */ }
  location.reload();
}

// ---------------- Progress & records UI ----------------
export function updateProgressCounts() {
  document.getElementById('hud-survey-count').textContent = `${gameState.surveyed.size}/${LANDMARKS.length}`;
  document.getElementById('hud-alsep-count').textContent = `${alsepStations.length}/${ALSEP_MAX} stations`;
}

export function renderRecords() {
  const r = save.data.records;
  const rows = [
    ['Field journal', `${foundCount()} / ${FINDS.length} found`],
    ['Sites surveyed', `${gameState.surveyed.size} / ${LANDMARKS.length}`],
    ['Science stations', `${alsepStations.length} / ${ALSEP_MAX}`],
    ['Descent stages left', `${parkedStages.length}`],
    ['Best trick', r.bestTrick ? `${r.bestTrick.label} ${stuntStars(r.bestTrick.difficulty)}` : '—'],
    ['Longest jump', r.longestAir > 0 ? `${r.longestAir.toFixed(1)} s` : '—'],
    ['Hadley Rille run', r.hadleyBest !== null && Number.isFinite(r.hadleyBest) ? formatHadleyTime(r.hadleyBest) : '—'],
    ['South Pole ice run', r.iceBest !== null && Number.isFinite(r.iceBest) ? formatHadleyTime(r.iceBest) : '—'],
    ['Apollo 11 landing', Number.isFinite(r.a11Best) ? `${r.a11Best.toFixed(0)} s fuel left` : '—'],
    ['Dockings with Columbia', `${r.dockings | 0}`]
  ];
  const list = document.getElementById('records-list');
  list.replaceChildren();
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3 py-0.5';
    const a = document.createElement('span'); a.className = 'text-slate-400'; a.textContent = k;
    const b = document.createElement('span'); b.className = 'text-slate-100 font-mono-tech text-right'; b.textContent = v;
    row.append(a, b);
    list.appendChild(row);
  });
}

export function welcomeBackText() {
  const parts = [`${foundCount()} journal finds`, `${gameState.surveyed.size}/${LANDMARKS.length} sites surveyed`];
  if (alsepStations.length) parts.push(`${alsepStations.length} science station${alsepStations.length > 1 ? 's' : ''} still listening`);
  return `Welcome back — ${parts.join(' · ')}`;
}

function renderBriefingSave() {
  const el = document.getElementById('save-summary');
  const btn = document.getElementById('launch-mission-btn');
  if (!save.loaded) return;
  const r = save.data.records;
  const bits = [`${foundCount()}/${FINDS.length} finds`, `${gameState.surveyed.size}/${LANDMARKS.length} sites`];
  if (alsepStations.length) bits.push(`${alsepStations.length} station${alsepStations.length > 1 ? 's' : ''}`);
  if (r.dockings) bits.push(`${r.dockings} docking${r.dockings > 1 ? 's' : ''}`);
  if (Number.isFinite(r.hadleyBest)) bits.push(`Hadley best ${formatHadleyTime(r.hadleyBest)}`);
  el.textContent = `Saved progress: ${bits.join(' · ')}`;
  el.classList.remove('hidden');
  btn.textContent = 'Continue exploring';
}

function syncAudioButtons() {
  const musicOff = sound.musicMuted;
  document.getElementById('music-on-icon').classList.toggle('hidden', musicOff);
  document.getElementById('music-off-icon').classList.toggle('hidden', !musicOff);
  const mb = document.getElementById('music-toggle-btn');
  mb.title = musicOff ? 'Music: OFF (Click to Enable)' : 'Music: ON (Click to Mute)';
  document.getElementById('sound-on-icon').classList.toggle('hidden', sound.muted);
  document.getElementById('sound-off-icon').classList.toggle('hidden', !sound.muted);
}
