// =========================================================================
// 24. GUIDED FIRST MISSION — skippable: land → rover → Ping → first find → free play
// =========================================================================
import { gameState, lander } from './state.js';
import { save, scheduleSave, markFirst } from './save.js';
import { hudPrefs, showToast } from './hud.js';
import { sound } from './audio.js';
import { applyRadioSetting, say, stopRadio } from './radio.js';
import { setHoverAssist } from './modes.js';
import { ui } from './context-ui.js';
import { finds } from './finds.js';

const STEPS = [
  {
    id: 'rover', title: 'Deploy the rover',
    keys: 'Press R (or the Deploy Rover button) to roll the rover out.',
    touch: 'Tap Deploy Rover.',
    radio: 'Eagle, Houston. You are down at Tranquility Base. Get the rover out and stretch its legs.',
    done: () => gameState.mode === 'rover',
  },
  {
    id: 'ping', title: 'Ping for hidden finds',
    keys: 'Press F to ping. An arrow points the way to the nearest hidden find.',
    touch: 'Tap Ping. An arrow points the way to the nearest hidden find.',
    radio: 'Rover, Houston. There is history hidden all over this Moon. Ping and see what turns up.',
    done: (t) => finds.lastPing > t.stepStart,
  },
  {
    id: 'find', title: 'Follow the signal',
    keys: 'Drive with W A S D (SHIFT for turbo). The signal bars fill as you get closer. Ping again any time.',
    touch: 'Drive with your left thumb (TURBO to go fast). The signal bars fill as you get closer. Ping again any time.',
    radio: 'Rover, Houston. The warmer the signal, the closer you are. Go get it.',
    done: (t) => Object.keys(save.data.journal || {}).length > t.foundAtStep,
  },
];

export const tutorial = { active: false, step: 0, stepStart: 0, foundAtStep: 0, spokeStep: -1 };

function $(id) { return document.getElementById(id); }

export function startTutorial() {
  tutorial.active = true;
  tutorial.step = 0;
  tutorial.spokeStep = -1;
  beginStep();
  $('tut-hud').classList.remove('hidden');
  render();
}

export function maybeStartTutorial() {
  if (save.data.firsts && save.data.firsts.tutorial) return;
  setTimeout(() => { if (gameState.started && !tutorial.active) startTutorial(); }, 4200);
}

function beginStep() {
  tutorial.stepStart = performance.now();
  tutorial.foundAtStep = Object.keys(save.data.journal || {}).length;
}

// After the first mission the training wheels come off: radio, hover assist and routine tips go quiet
// (warnings, discoveries and challenge panels still show). All of it can be turned back on in the menu.
function goQuiet() {
  save.data.settings.radio = 'off';
  applyRadioSetting();
  stopRadio();
  if (gameState.hoverAssist) setHoverAssist(false);
  hudPrefs.popups = 'essential';
  syncPopupsButton();
  scheduleSave();
}

export function stopTutorial(reason) {
  if (!tutorial.active) return;
  tutorial.active = false;
  $('tut-hud').classList.add('hidden');
  if (!save.data.firsts.tutorial) { save.data.firsts.tutorial = Date.now(); scheduleSave(); }
  if (reason === 'skip') {
    goQuiet();
    showToast('Guided mission skipped. Radio, hover assist and tips are off — turn them on in the menu', 'gold', { important: true });
  }
}

function finish() {
  tutorial.active = false;
  $('tut-hud').classList.add('hidden');
  markFirst('tutorial');
  sound.playScanComplete();
  goQuiet();
  showToast('First mission complete — the Moon is yours. Radio, hover assist and tips are now off (menu to turn back on)', 'sage', { important: true });
}

function render() {
  const s = STEPS[tutorial.step];
  $('tut-step').textContent = `FIRST MISSION · ${tutorial.step + 1}/${STEPS.length}`;
  $('tut-title').textContent = s.title;
  $('tut-text').textContent = ui.touch ? s.touch : s.keys;
  for (let i = 0; i < STEPS.length; i++) {
    const pip = $(`tut-pip-${i}`);
    if (pip) pip.className = `tut-pip${i < tutorial.step ? ' done' : (i === tutorial.step ? ' now' : '')}`;
  }
}

export function updateTutorial() {
  if (!tutorial.active || !gameState.started) return;
  const s = STEPS[tutorial.step];
  if (tutorial.spokeStep !== tutorial.step && performance.now() - tutorial.stepStart > 600) {
    tutorial.spokeStep = tutorial.step;
    say(`tut.${s.id}`, { text: s.radio });
  }
  if (s.done(tutorial)) {
    sound.playPing(880, 0.12);
    tutorial.step++;
    if (tutorial.step >= STEPS.length) { finish(); return; }
    beginStep();
    render();
  }
}

export function syncPopupsButton() {
  const el = $('popups-state');
  if (el) el.textContent = hudPrefs.popups === 'all' ? 'ALL' : 'WARNINGS';
}

export function bindTutorial() {
  const skip = $('tut-skip-btn');
  if (skip) skip.addEventListener('click', () => stopTutorial('skip'));
  syncPopupsButton();
  const pop = $('popups-toggle-btn');
  if (pop) pop.addEventListener('click', () => {
    hudPrefs.popups = hudPrefs.popups === 'all' ? 'essential' : 'all';
    syncPopupsButton();
    scheduleSave();
    showToast(hudPrefs.popups === 'all' ? 'Tips and messages on' : 'Tips off — warnings only', 'gold', { important: true });
  });
  const replay = $('tut-replay-btn');
  if (replay) replay.addEventListener('click', () => { if (gameState.started) startTutorial(); });
}
