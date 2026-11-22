import * as THREE from 'three';
import { LANDMARKS, MOON_RADIUS, MOON_REAL_KM, SPEED_TO_MS } from './constants.js';
import { sound } from './audio.js';
import { camCtrl, csm, gameState, lander, rover } from './state.js';
import { formatLat, formatLon, greatCircleKm } from './coords.js';
import { camera } from './scene.js';
import { focusOrbitOnLandmark, toggleRoverDeployment, updateAssistButtonsUI, warpLanderToLandmark } from './modes.js';
import { rdv, updateSlopeReadout } from './apollo-ops.js';
import { ui } from './context-ui.js';

// =========================================================================
// 13. HUD UPDATES, MODALS, TOASTS & SITES DRAWER
// =========================================================================
let toastTimer = null;
// 'all' = every tip and status message; 'essential' = only warnings and messages marked important
export const hudPrefs = { popups: 'all' };

export function showToast(msg, tone = 'gold', opts = null) {
  if (hudPrefs.popups === 'essential' && tone !== 'warn' && !(opts && opts.important)) return;
  const box = document.getElementById('toast-box');
  box.textContent = msg;
  const borderCls = (tone === 'sage' || tone === 'success')
    ? 'border-[#7ec4a0]/55 text-[#7ec4a0]'
    : (tone === 'warn' ? 'border-[#d9826c]/60 text-[#f8c4b4]' : 'border-[#f4d58d]/50 text-[#f4d58d]');
  box.className = `hud-panel px-3.5 py-1.5 rounded-full text-[11px] sm:text-xs font-mono-tech font-medium border text-center max-w-full ${borderCls}`;
  box.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), 3200);
}

export function triggerImpactFlash() {
  const el = document.getElementById('impact-flash');
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 240);
}

export function openDossierModal(lm) {
  document.getElementById('dossier-title').textContent = lm.name;
  document.getElementById('dossier-coords').textContent = `${formatLat(lm.lat)}, ${formatLon(lm.lon)} · ${lm.category}`;
  document.getElementById('dossier-desc').textContent = lm.desc;
  document.getElementById('dossier-science').textContent = lm.science;
  document.getElementById('dossier-modal').classList.remove('hidden');
}

export function renderSitesList() {
  const list = document.getElementById('sites-list');
  list.innerHTML = '';
  LANDMARKS.forEach((lm) => {
    const done = gameState.surveyed.has(lm.id);
    const isTarget = gameState.targetLandmarkId === lm.id;
    const card = document.createElement('div');
    card.className = `p-3 rounded-2xl bg-[#111827]/90 border ${isTarget ? 'border-[#f4d58d]/55' : 'border-slate-800'} transition`;
    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-xs font-semibold text-white">${lm.name}</div>
          <div class="text-[10px] font-mono-tech text-slate-400 mt-0.5">${formatLat(lm.lat)} · ${formatLon(lm.lon)} · ${lm.category}</div>
        </div>
        <span class="text-[9px] font-mono-tech px-2 py-0.5 rounded-full ${done ? 'bg-[#7ec4a0]/20 text-[#7ec4a0]' : 'bg-slate-800 text-slate-400'}">
          ${done ? 'DONE' : 'OPEN'}
        </span>
      </div>
      <div class="mt-2.5 flex gap-1.5">
        <button data-warp="${lm.id}" class="flex-1 py-1.5 px-2 rounded-lg text-[10px] font-mono-tech font-semibold bg-[#f4d58d]/15 hover:bg-[#f4d58d]/28 text-[#f4d58d] border border-[#f4d58d]/35 cursor-pointer">Warp Lander</button>
        <button data-orbit="${lm.id}" class="flex-1 py-1.5 px-2 rounded-lg text-[10px] font-mono-tech font-medium bg-[#0b101c] hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer">Orbit View</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-warp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.init();
      const lm = LANDMARKS.find(x => x.id === btn.getAttribute('data-warp'));
      document.getElementById('sites-drawer').classList.add('hidden');
      warpLanderToLandmark(lm, true);
    });
  });
  list.querySelectorAll('[data-orbit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.init();
      const lm = LANDMARKS.find(x => x.id === btn.getAttribute('data-orbit'));
      document.getElementById('sites-drawer').classList.add('hidden');
      focusOrbitOnLandmark(lm);
    });
  });
}

export function updateTelemetryHUD() {
  const isRover = gameState.mode === 'rover';
  const craft = isRover ? rover : lander;

  document.getElementById('tel-lat').textContent = formatLat(craft.lat);
  document.getElementById('tel-lon').textContent = formatLon(craft.lon);
  document.getElementById('tel-elev').textContent = `${craft.elevKm >= 0 ? '+' : ''}${craft.elevKm.toFixed(2)} km`;

  const altKm = craft.aglUnits * (MOON_REAL_KM / MOON_RADIUS);
  const altMeters = Math.round(altKm * 1000);
  document.getElementById('tel-alt').textContent = altMeters >= 1000
    ? `${altKm.toFixed(2)} km`
    : `${altMeters} m`;

  const vRad = craft.vel.dot(craft.up);
  const vTan = craft.vel.clone().addScaledVector(craft.up, -vRad).length();
  const gSpeedMs = isRover ? (rover.speed * 11.5) : (vTan * SPEED_TO_MS);
  document.getElementById('tel-gspeed').textContent = gSpeedMs >= 1000
    ? `${(gSpeedMs / 1000).toFixed(2)} km/s`
    : `${gSpeedMs.toFixed(1)} m/s`;
  const vs = vRad * (isRover ? 11.5 : SPEED_TO_MS * 0.25);
  const vsEl = document.getElementById('tel-vspeed');
  vsEl.textContent = `${vs >= 0 ? '+' : ''}${vs.toFixed(1)} m/s`;
  vsEl.className = (!isRover && vs < -75) ? 'text-[#d9826c] font-semibold' : 'text-slate-200 font-semibold';

  const apEl = document.getElementById('tel-ap');
  const peEl = document.getElementById('tel-pe');
  const vCircEl = document.getElementById('tel-vcirc');
  const orbPctEl = document.getElementById('tel-orb-pct');
  const orbStrip = document.getElementById('orbit-vel-strip');

  if (orbStrip) orbStrip.classList.toggle('hidden', isRover);
  if (isRover) {
    if (apEl) apEl.textContent = rover.isGrounded ? 'SURFACE' : 'AIRBORNE';
    if (peEl) peEl.textContent = '1/6 G';
  } else {
    if (apEl) {
      if (lander.apKm === null) apEl.textContent = '--';
      else if (!Number.isFinite(lander.apKm)) apEl.textContent = 'ESCAPE';
      else apEl.textContent = `${lander.apKm.toFixed(1)} km`;
    }
    if (peEl) {
      if (lander.peKm === null) peEl.textContent = '--';
      else {
        peEl.textContent = `${lander.peKm.toFixed(1)} km`;
        peEl.className = lander.inOrbit ? 'text-[#7ec4a0] font-semibold' : 'text-slate-300 font-semibold';
      }
    }
    const vCircMs = lander.vCirc * SPEED_TO_MS;
    const pct = Math.min(199, Math.round((vTan / Math.max(0.1, lander.vCirc)) * 100));
    if (vCircEl) vCircEl.textContent = `${Math.round(vCircMs).toLocaleString()} m/s`;
    if (orbPctEl) {
      orbPctEl.textContent = lander.inOrbit ? 'ORBIT LOCK' : `${pct}% V_orb`;
      orbPctEl.className = lander.inOrbit ? 'text-[#7ec4a0] font-semibold' : 'text-slate-300';
    }
  }

  const fuelPct = Math.round(lander.fuel);
  document.getElementById('tel-fuel-pct').textContent = `${fuelPct}%`;
  const fuelBar = document.getElementById('tel-fuel-bar');
  fuelBar.style.width = `${fuelPct}%`;
  fuelBar.className = fuelPct < 22
    ? 'h-full bg-[#d9826c] transition-all duration-100'
    : 'h-full bg-[#7ec4a0] transition-all duration-100';

  const pill = document.getElementById('flight-status-pill');
  if (gameState.mode === 'orbital') {
    pill.textContent = 'ORBIT VIEW';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#111827] text-slate-200 border border-slate-700';
  } else if (isRover) {
    pill.textContent = rover.isGrounded ? 'ROVER DRIVE' : 'LOW-G JUMP';
    pill.className = rover.isGrounded
      ? 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#7ec4a0]/15 text-[#7ec4a0] border border-[#7ec4a0]/40'
      : 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#f4d58d]/20 text-[#f4d58d] border border-[#f4d58d]/50';
    updateAssistButtonsUI();
  } else if (lander.crashed) {
    pill.textContent = 'LM LOST';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#d9826c]/25 text-[#f8c4b4] border border-[#d9826c]/60';
  } else if (rdv.active) {
    pill.textContent = rdv.phase === 'docked' ? 'DOCKED' : (rdv.phase === 'manual' ? 'RCS DOCKING' : 'RENDEZVOUS');
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#7ec4a0]/22 text-[#7ec4a0] border border-[#7ec4a0]/60';
  } else if (lander.inOrbit) {
    pill.textContent = 'IN ORBIT';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#7ec4a0]/22 text-[#7ec4a0] border border-[#7ec4a0]/60';
  } else if (lander.isLanded) {
    pill.textContent = 'TOUCHDOWN';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#7ec4a0]/15 text-[#7ec4a0] border border-[#7ec4a0]/40';
  } else if (gameState.autoSoftLand) {
    pill.textContent = 'AUTO-LAND';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#f4d58d]/20 text-[#f4d58d] border border-[#f4d58d]/45';
  } else if (!gameState.autoGyro) {
    pill.textContent = 'FREE 360°';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#f4d58d]/20 text-[#f4d58d] border border-[#f4d58d]/50';
  } else if (lander.isBoosting) {
    pill.textContent = 'BOOST BURN';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#f4d58d]/20 text-[#f4d58d] border border-[#f4d58d]/45';
  } else {
    pill.textContent = 'AIRBORNE';
    pill.className = 'text-[10px] font-mono-tech font-semibold px-2 py-0.5 rounded-full bg-[#111827] text-slate-200 border border-slate-700';
  }

  updateSlopeReadout(craft);

  const pitchEl = document.getElementById('tel-pitch');
  const rollEl = document.getElementById('tel-roll');
  const invBadge = document.getElementById('inverted-badge');
  const horGroup = document.getElementById('att-horizon-group');

  const activeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(craft.quat).normalize();
  const activeFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(craft.quat).normalize();
  const activeLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(craft.quat).normalize();
  const aUpDot = THREE.MathUtils.clamp(activeUp.dot(craft.up), -1, 1);
  const dispPitch = THREE.MathUtils.radToDeg(Math.atan2(activeFwd.dot(craft.up), aUpDot));
  const dispRoll = THREE.MathUtils.radToDeg(Math.atan2(activeLeft.dot(craft.up), aUpDot));

  if (pitchEl) pitchEl.textContent = `${Math.round(dispPitch)}°`;
  if (rollEl) rollEl.textContent = `${Math.round(dispRoll)}°`;
  if (invBadge) invBadge.classList.toggle('hidden', isRover || !lander.isInverted);
  if (horGroup) {
    const pHorRad = Math.asin(THREE.MathUtils.clamp(activeFwd.dot(craft.up), -1, 1));
    const pitchPx = (pHorRad / (Math.PI * 0.5)) * 16 * (aUpDot >= 0 ? 1 : -1);
    horGroup.setAttribute(
      'transform',
      `translate(20, 20) rotate(${(-dispRoll).toFixed(1)}) translate(0, ${pitchPx.toFixed(1)})`
    );
  }

  // Waypoint chip (top-left)
  const targetLm = LANDMARKS.find(l => l.id === gameState.targetLandmarkId) || LANDMARKS[0];
  if (targetLm && targetLm.unitPos) {
    const distKm = greatCircleKm(craft.up, targetLm.unitPos);
    document.getElementById('compass-target-name').textContent = targetLm.shortName;
    document.getElementById('compass-dist').textContent = distKm >= 10 ? distKm.toFixed(0) : distKm.toFixed(1);
    const arrowEl = document.getElementById('compass-arrow');
    arrowEl.style.color = gameState.surveyed.has(targetLm.id) ? '#7ec4a0' : '#f4d58d';

    const toTarget = targetLm.unitPos.clone().sub(craft.up);
    toTarget.addScaledVector(craft.up, -toTarget.dot(craft.up));
    if (toTarget.lengthSq() > 1e-6) {
      toTarget.normalize();
      const camFwd = new THREE.Vector3();
      camera.getWorldDirection(camFwd);
      camFwd.addScaledVector(craft.up, -camFwd.dot(craft.up));
      if (camFwd.lengthSq() > 1e-6) {
        camFwd.normalize();
        const camRight = new THREE.Vector3().crossVectors(camFwd, craft.up).normalize();
        const deg = THREE.MathUtils.radToDeg(Math.atan2(toTarget.dot(camRight), toTarget.dot(camFwd)));
        arrowEl.style.transform = `rotate(${deg}deg)`;
      }
    }
  }
}

export function setGameMode(mode) {
  camCtrl.landerCamOffset = null;
  if (mode !== gameState.mode) camCtrl.landerHeading = null;
  if (mode === 'rover' && rdv.active) {
    showToast((ui.touch ? 'Finish or abort the rendezvous before driving the Rover' : 'Finish or abort the rendezvous [K] before driving the Rover'), 'warn');
    return;
  }
  if (mode === 'rover' && !rover.deployed) {
    if (!lander.isLanded) {
      showToast('Land the Lunar Module first to deploy the Rover!', 'warn');
      return;
    }
    toggleRoverDeployment();
    return;
  }
  gameState.mode = mode;
  csm.tracking = false;
  if (mode === 'orbital') {
    const craft = rover.deployed ? rover : lander;
    camCtrl.targetOrbitLatDeg = THREE.MathUtils.clamp(craft.lat, -85, 85);
    camCtrl.targetOrbitLonDeg = craft.lon;
    camCtrl.orbitLatDeg = camCtrl.targetOrbitLatDeg;
    camCtrl.orbitLonDeg = camCtrl.targetOrbitLonDeg;
    camCtrl.targetOrbitDist = 230;
  }
  updateAssistButtonsUI();
  sound.playPing(mode === 'orbital' ? 720 : 540, 0.12);
}
