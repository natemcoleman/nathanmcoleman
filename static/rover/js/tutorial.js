// =========================================================================
// 24. GUIDED FIRST MISSION — skippable: land → rover → Ping → first find → free play
// =========================================================================
import { gameState, lander } from './state.js';
import { save, scheduleSave, markFirst } from './save.js';
import { showToast } from './hud.js';
import { sound } from './audio.js';
import { say } from './radio.js';
import { ui } from './context-ui.js';
import { finds } from './finds.js';

const STEPS = [
  {
    id: 'land', title: 'Land the Eagle',
    keys: 'Fly with W A S D. Hover is on: hold CTRL to come down, SHIFT to climb. Aim for the Tranquility Base beacon.',
    touch: 'Left thumb flies. Hold THRUST and slide down to come down, up to climb. Aim for the Tranquility Base beacon.',
    radio: 'Eagle, Houston. First things first: bring her down gently. Green ground is flat ground.',
    done: () => lander.isLanded && gameState.mode === 'lander',
  },
  {
    id: 'rover', title: 'Deploy the rover',
    keys: 'Press R (or the Deploy Rover button) to roll the rover out.',
    touch: 'Tap Deploy Rover.',
    radio: 'Eagle, Houston. Nice landing. Get the rover out and stretch its legs.',
    done: () => gameState.mode === 'rover',
  },
  {
    id: 'ping', title: 'Ping for hidden finds',
    keys: 'Press F to ping. It tells you which way the nearest hidden find is.',
    touch: 'Tap Ping. It tells you which way the nearest hidden find is.',
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

export function stopTutorial(reason) {
  if (!tutorial.active) return;
  tutorial.active = false;
  $('tut-hud').classList.add('hidden');
  if (!save.data.firsts.tutorial) { save.data.firsts.tutorial = Date.now(); scheduleSave(); }
  if (reason === 'skip') showToast('Guided mission skipped — replay it any time from the menu', 'gold');
}

function finish() {
  tutorial.active = false;
  $('tut-hud').classList.add('hidden');
  markFirst('tutorial');
  scheduleSave();
  sound.playScanComplete();
  say('tutDone', { text: 'Rover, Houston. That is the whole job. The Moon is yours now: land anywhere, find everything.' });
  showToast('First mission complete — the Moon is yours. Open the Field Journal to see what else is out there.', 'sage');
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

export function bindTutorial() {
  const skip = $('tut-skip-btn');
  if (skip) skip.addEventListener('click', () => stopTutorial('skip'));
  const replay = $('tut-replay-btn');
  if (replay) replay.addEventListener('click', () => { if (gameState.started) startTutorial(); });
}
