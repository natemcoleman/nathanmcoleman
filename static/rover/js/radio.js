// =========================================================================
// 22. MISSION CONTROL RADIO — Quindar tones, static, spoken calls, subtitles
// =========================================================================
// Every call has an id (e.g. 'landing', 'find.luna9') and always shows as a subtitle.
// There is no synthesized voice. To play a real recording for a call, put the file in
// audio/radio/<id>.mp3 and list the id in audio/radio/manifest.json:
//   { "files": ["landing", "find.luna9"] }
// Type lroRadioLines() in the browser console for every line's id and text.
import { sound } from './audio.js';
import { gameState, lander, rover } from './state.js';
import { LANDMARKS } from './constants.js';
import { save, scheduleSave } from './save.js';
import { FINDS } from './finds.js';
import { latLonToVec3 } from './coords.js';
import { a11Run, a11FuelSeconds, power } from './apollo11.js';

const MODES = ['on', 'off'];   // on = subtitles, plus recorded clips where they exist
const QUINDAR_IN = 2525;   // Hz, Apollo "intro" tone that keyed the ground transmitters
const QUINDAR_OUT = 2475;  // Hz, "outro" tone
const TONE_SEC = 0.25;

// Fixed lines. {cs} is the callsign the ground uses for you right now.
const LINES = {
  welcome:      { text: '{cs}, Houston. Radio check. You are on the surface and go to explore.', prio: 2 },
  landing:      { text: '{cs}, Houston. We copy you down. Nice landing.', prio: 2, cool: 60 },
  landingSite:  { text: '{cs}, Houston. We copy you down at {site}. Nice landing.', prio: 2, cool: 60 },
  landingFirst: { text: 'Houston copies touchdown. Your first one. We are breathing again down here.', prio: 3 },
  tipped:       { text: '{cs}, Houston. We show the LM tipped over. Are you okay? Check your slope before you set down.', prio: 3, cool: 30 },
  crash:        { text: '{cs}, Houston. We have lost your signal. Say again? {cs}, Houston.', prio: 3, cool: 30 },
  fuel25:       { text: '{cs}, Houston. Fuel is at twenty five percent.', prio: 2 },
  fuel10:       { text: '{cs}, Houston. Ten percent fuel. Land now, or head back to orbit.', prio: 3 },
  battery20:    { text: 'Rover, Houston. Battery is down to twenty percent. The sun will top you up.', prio: 2 },
  batteryOut:   { text: 'Rover, Houston. Your battery reads flat. Park in the sun when you get a chance.', prio: 3 },
  roverFirst:   { text: 'Rover, Houston. Good to see you rolling. The ground is all yours. Go find something.', prio: 2 },
  rover:        { text: 'Rover, Houston. We see you rolling.', prio: 1, cool: 180 },
  alsep:        { text: 'Houston has data from your science station. The seismometer is listening, and the laser reflector is pointed at Earth.', prio: 2, cool: 60 },
  staging:      { text: '{cs}, Houston. Good staging. The descent stage stays behind as your launch pad.', prio: 2, cool: 30 },
  rendezvous:   { text: 'Eagle, Houston. You are go for rendezvous with Columbia.', prio: 2, cool: 60 },
  docking:      { text: 'Houston copies hard dock. Welcome back, Eagle. Columbia is happy to see you.', prio: 3 },
  allSites:     { text: 'Houston here. That is all ten sites surveyed. The whole back room is on its feet.', prio: 3 },
  a11Start:     { text: 'Eagle, Houston. You are go for landing. We are go on that 1202 alarm. Fly it by hand.', prio: 3 },
  a11Sixty:     { text: 'Sixty seconds.', prio: 3 },
  a11Thirty:    { text: 'Thirty seconds.', prio: 3 },
  eagleLanded:  { text: 'Houston, Tranquility Base here. The Eagle has landed.', prio: 3, cool: 120, who: 'ARMSTRONG' },
  a11Down:      { text: 'Roger, Tranquility. We copy you on the ground. You got a bunch of guys about to turn blue. We are breathing again. Thanks a lot.', prio: 3 },
  a11Fail:      { text: 'Eagle, Houston. Abort. That one got away from us. Reset and try again.', prio: 3 },
  hadleyStart:  { text: 'Rover, Houston. The rille run is on. Hit every checkpoint. Clock is running.', prio: 2 },
  hadleyDone:   { text: 'Rover, Houston. Good run along Hadley Rille. Dave Scott would be proud.', prio: 2 },
  iceStart:     { text: 'Rover, Houston. You are cleared into the shadows. It is minus two hundred down there, so watch your heater battery.', prio: 2 },
  iceDone:      { text: 'Rover, Houston. We copy water ice. That is drinking water, air and rocket fuel for the next crew.', prio: 2 },
  teiGo:        { text: 'Columbia, Houston. You are go for TEI. Light the engine and come on home.', prio: 3 },
  teiDone:      { text: 'Columbia, Houston. Good burn. On Apollo 8, the first words after this burn were: please be informed, there is a Santa Claus.', prio: 3 },
  entry:        { text: 'Columbia, Houston. Entry interface. Keep her in the corridor: too steep and you burn, too shallow and you skip.', prio: 3 },
  splashdown:   { text: 'Columbia, Houston. We see you on the main chutes. Welcome home, and congratulations on a perfect mission.', prio: 3 },
  entryFail:    { text: 'Columbia, Houston. We have lost the signal. Let us run that entry again.', prio: 3 },
  'tut.land':   { text: 'Eagle, Houston. First things first: bring her down gently. Green ground is flat ground.', prio: 3 },
  'tut.rover':  { text: 'Eagle, Houston. Nice landing. Get the rover out and stretch its legs.', prio: 3 },
  'tut.ping':   { text: 'Rover, Houston. There is history hidden all over this Moon. Ping and see what turns up.', prio: 3 },
  'tut.find':   { text: 'Rover, Houston. The warmer the signal, the closer you are. Go get it.', prio: 3 },
  tutDone:      { text: 'Rover, Houston. That is the whole job. The Moon is yours now: land anywhere, find everything.', prio: 3 },
};
// Lines built from the game's own data (on first use: finds.js and this module import each other)
let dataLinesBuilt = false;
function allLines() {
  if (!dataLinesBuilt) {
    dataLinesBuilt = true;
    for (const lm of LANDMARKS) {
      const fact = (lm.science || lm.desc || '').split(/(?<=\.)\s/)[0];
      LINES[`scan.${lm.id}`] = { text: `{cs}, Houston. We copy your scan of ${lm.shortName || lm.name}. ${fact}`, prio: 3 };
    }
    for (const f of FINDS) {
      LINES[`find.${f.id}`] = { text: `{cs}, Houston. That is ${f.name.replace(/^The /, 'the ')}! ${f.hook || ''}`.trim(), prio: 3 };
    }
  }
  return LINES;
}

export const radio = {
  mode: 'on',
  queue: [],
  busy: false,
  lastAt: {},          // id -> time of last play (cooldowns)
  recorded: new Set(), // ids with a recorded file
  audio: null,        // recorded clip playing now
  unlocked: false,
  staticNodes: null,
};

// ---------- Settings ----------
export function applyRadioSetting() {
  const m = save.data && save.data.settings && save.data.settings.radio;
  radio.mode = m === 'off' ? 'off' : 'on';   // older saves said 'voice' or 'text'
  syncRadioButton();
}
function cycleRadioMode() {
  radio.mode = MODES[(MODES.indexOf(radio.mode) + 1) % MODES.length];
  save.data.settings.radio = radio.mode;
  scheduleSave();
  syncRadioButton();
  if (radio.mode === 'off') stopRadio();
  else say('check', { text: 'Houston, radio check. Loud and clear.' });
}
function syncRadioButton() {
  const el = document.getElementById('radio-mode-state');
  if (el) el.textContent = radio.mode === 'off' ? 'OFF' : 'ON';
}

// Kept so callers don't change: recorded clips play after the first tap without special unlocking
export function unlockRadio() {}

// ---------- Sound: Quindar beeps and static ----------
function audioOn() { return sound.ctx && !sound.muted && sound.ctx.state === 'running'; }
function beep(freq) {
  if (!audioOn()) return;
  const ctx = sound.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.01);
  g.gain.setValueAtTime(0.09, t + TONE_SEC - 0.015);
  g.gain.linearRampToValueAtTime(0, t + TONE_SEC);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + TONE_SEC + 0.02);
}
function staticOn() {
  if (!audioOn() || radio.staticNodes) return;
  const ctx = sound.ctx, sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * 2, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const crackle = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 4 : 0;
    d[i] = (Math.random() * 2 - 1) * 0.5 + crackle;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0.022, ctx.currentTime + 0.08);
  src.connect(band).connect(g).connect(ctx.destination);
  src.start();
  radio.staticNodes = { src, g };
  duckMusic(true);
}
function staticOff() {
  const n = radio.staticNodes;
  radio.staticNodes = null;
  duckMusic(false);
  if (!n || !sound.ctx) return;
  const t = sound.ctx.currentTime;
  n.g.gain.setTargetAtTime(0, t, 0.05);
  n.src.stop(t + 0.3);
}
function duckMusic(on) {
  if (!sound.musicMaster || !sound.ctx || sound.muted || sound.musicMuted) return;
  const base = sound.musicBaseGain * (sound.musicDuck || 1);
  sound.musicMaster.gain.setTargetAtTime(on ? base * 0.35 : base, sound.ctx.currentTime, 0.15);
}

// ---------- Subtitles ----------
function showCaption(text, who = 'HOUSTON') {
  const box = document.getElementById('radio-caption');
  if (!box) return;
  const w = document.getElementById('radio-caption-who');
  if (w) w.textContent = who;
  document.getElementById('radio-caption-text').textContent = text;
  box.classList.remove('hidden');
  box.classList.add('on');
}
function hideCaption() {
  const box = document.getElementById('radio-caption');
  if (!box) return;
  box.classList.remove('on');
  box.classList.add('hidden');
}

// ---------- Queue ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function callsign() {
  if (gameState.mode === 'rover') return 'Rover';
  return 'Eagle';
}
function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, k) => (k === 'cs' ? callsign() : (vars && vars[k] != null ? vars[k] : '')));
}

// Queue a call by id. vars fill {placeholders}; vars.text overrides the catalog text.
// opts.force: historic recordings play even with the radio switched off
export function say(id, vars = null, opts = null) {
  if ((radio.mode === 'off' && !(opts && opts.force && radio.recorded.has(id))) || !gameState.started) return false;
  const line = allLines()[id] || (vars && vars.text ? { text: vars.text, prio: 2 } : null);
  if (!line) return false;
  const now = performance.now() / 1000;
  if (line.cool && radio.lastAt[id] && now - radio.lastAt[id] < line.cool) return false;
  if (radio.queue.some((q) => q.id === id)) return false;
  radio.lastAt[id] = now;
  // Higher priority jumps the queue; low-priority chatter is dropped when the line is busy
  if (line.prio <= 1 && (radio.busy || radio.queue.length)) return false;
  radio.queue.push({ id, text: fill(line.text, vars), who: line.who || 'HOUSTON', prio: line.prio || 1, t: now });
  // Keep at most 4 waiting: drop the oldest of the least important
  while (radio.queue.length > 4) {
    let drop = 0;
    radio.queue.forEach((q, i) => { const d = radio.queue[drop]; if (q.prio < d.prio || (q.prio === d.prio && q.t < d.t)) drop = i; });
    radio.queue.splice(drop, 1);
  }
  if (!radio.busy) playNext();
  return true;
}

function nextItem() {
  // Most important first; news older than 25 s is stale unless it's urgent
  const now = performance.now() / 1000;
  radio.queue = radio.queue.filter((q) => q.prio >= 3 || now - q.t < 25);
  if (!radio.queue.length) return null;
  let best = 0;
  radio.queue.forEach((q, i) => { const b = radio.queue[best]; if (q.prio > b.prio || (q.prio === b.prio && q.t < b.t)) best = i; });
  return radio.queue.splice(best, 1)[0];
}

async function playNext() {
  const item = nextItem();
  if (!item) { radio.busy = false; return; }
  radio.busy = true;
  radio.current = item;
  staticOn();
  beep(QUINDAR_IN);
  await wait(TONE_SEC * 1000 + 120);
  showCaption(item.text, item.who);
  await speakItem(item);
  hideCaption();
  beep(QUINDAR_OUT);
  await wait(TONE_SEC * 1000 + 60);
  staticOff();
  radio.current = null;
  await wait(500);
  playNext();
}

function readingTime(text) { return 1200 + text.split(/\s+/).length * 330; }

function speakItem(item) {
  const fallback = () => wait(readingTime(item.text));
  if (!sound.muted && radio.recorded.has(item.id)) return playRecorded(item).catch(fallback);
  return fallback();
}

function playRecorded(item) {
  return new Promise((resolve, reject) => {
    const a = new Audio(`audio/radio/${item.id}.mp3`);
    radio.audio = a;
    a.volume = 0.95;
    a.onended = resolve;
    a.onerror = reject;
    a.play().catch(reject);
  });
}

export function stopRadio() {
  radio.queue.length = 0;
  if (radio.audio) { try { radio.audio.pause(); } catch (_) { /* ignore */ } radio.audio = null; }
  hideCaption();
}

// ---------- Watching the game for calls ----------
export function a11RunActive() { return a11Run.active; }

// Landing call: names the site when you set down within ~40 km of one
export function radioLanding(first) {
  if (a11Run.active) return;
  // One call per real landing: settling or a small hop shouldn't trigger another
  const now = performance.now() / 1000;
  if (now - (radio.lastLandingAt || -1e9) < 45) return;
  radio.lastLandingAt = now;
  if (first) { say('landingFirst'); return; }
  let best = null, bestKm = 40;
  for (const lm of LANDMARKS) {
    const km = Math.acos(Math.min(1, Math.max(-1, latLonToVec3(lm.lat, lm.lon, 1).dot(lander.up)))) * 1737.4;
    if (km < bestKm) { bestKm = km; best = lm; }
  }
  if (best && best.id === 'apollo11' && bestKm < 15) { say('eagleLanded', null, { force: true }); say('landingSite', { site: best.shortName }); }
  else if (best) say('landingSite', { site: best.shortName || best.name });
  else say('landing');
}

const watch = { wasLanded: null, fuelFlag: 0, battFlag: 0, crashed: false, tipped: false, a11Fuel: null };

export function updateRadio() {
  if (!gameState.started || radio.mode === 'off') return;
  // Fuel calls once per flight; refuelling (landing or warping) resets them
  if (gameState.mode === 'lander' && !a11Run.active) {
    if (lander.fuel > 40) watch.fuelFlag = 0;
    if (!lander.isLanded && lander.fuel <= 10 && watch.fuelFlag < 2) { watch.fuelFlag = 2; say('fuel10'); }
    else if (!lander.isLanded && lander.fuel <= 25 && watch.fuelFlag < 1) { watch.fuelFlag = 1; say('fuel25'); }
  }
  // Rover battery
  if (gameState.mode === 'rover') {
    if (power.rover > 40) watch.battFlag = 0;
    if (power.rover <= 0 && watch.battFlag < 2) { watch.battFlag = 2; say('batteryOut'); }
    else if (power.rover <= 20 && watch.battFlag < 1) { watch.battFlag = 1; say('battery20'); }
  }
  // Apollo 11: Charlie Duke's fuel callouts
  if (a11Run.active && !lander.isLanded) {
    const s = a11FuelSeconds();
    if (watch.a11Fuel != null) {
      if (watch.a11Fuel > 60 && s <= 60) say('a11Sixty');
      if (watch.a11Fuel > 30 && s <= 30) say('a11Thirty');
    }
    watch.a11Fuel = s;
  } else watch.a11Fuel = null;
}

// Window-console helper: every line, for recording real voice files
window.lroRadioLines = () => Object.entries(allLines()).map(([id, l]) => ({ id, text: l.text.replace(/\{cs\}/g, 'Eagle') }));

export function initRadio() {
  applyRadioSetting();
  fetch('audio/radio/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (m && Array.isArray(m.files)) m.files.forEach((id) => radio.recorded.add(id)); })
    .catch(() => { /* no recordings yet: subtitles only */ });
  const btn = document.getElementById('radio-mode-btn');
  if (btn) btn.addEventListener('click', () => { sound.init(); unlockRadio(); cycleRadioMode(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopRadio(); });
}
