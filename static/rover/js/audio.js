import { gameState, lander } from './state.js';

// =========================================================================
// 2. PROCEDURAL WEB AUDIO ENGINE (SFX + GENERATIVE SOUNDTRACK)
// =========================================================================
class LunarAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.thrusterGain = null;
    this.thrusterFilter = null;
    this.initialized = false;

    // Procedural Background Soundtrack nodes & state
    this.musicMuted = false;
    this.musicMaster = null;
    this.musicDry = null;
    this.musicWet = null;
    this.musicBaseGain = 0.34;
    this.musicDuck = 1.0;
    this.musicTimer = null;
    this.phraseBarsLeft = 0;
    this.chordIdx = 0;
    this.progIdx = 0;
  }
  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      // White noise buffer for rocket engine rumble
      const bufSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      this.thrusterFilter = this.ctx.createBiquadFilter();
      this.thrusterFilter.type = 'lowpass';
      this.thrusterFilter.frequency.value = 180;

      this.thrusterGain = this.ctx.createGain();
      this.thrusterGain.gain.value = 0;

      noise.connect(this.thrusterFilter);
      this.thrusterFilter.connect(this.thrusterGain);
      this.thrusterGain.connect(this.ctx.destination);
      noise.start();

      this.setupMusicEngine();
      this.initialized = true;
      this.startMusicLoop();
    } catch (err) {
      // Silently ignore if Web Audio is unavailable
    }
  }
  setupMusicEngine() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;

    this.musicMaster = this.ctx.createGain();
    this.musicMaster.gain.value = (this.muted || this.musicMuted) ? 0 : this.musicBaseGain;
    this.musicMaster.connect(this.ctx.destination);

    // Dry & Wet buses
    this.musicDry = this.ctx.createGain();
    this.musicDry.gain.value = 0.62;
    this.musicDry.connect(this.musicMaster);

    this.musicWet = this.ctx.createGain();
    this.musicWet.gain.value = 0.68;

    // Warm stereo space reverb impulse (3.6s smooth exponential decay)
    const irLen = Math.floor(sr * 3.6);
    const irBuf = this.ctx.createBuffer(2, irLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const chData = irBuf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        const env = Math.pow(1 - t, 2.75) * Math.min(1, i / (sr * 0.035));
        const white = Math.random() * 2 - 1;
        lp = lp * 0.72 + white * 0.28; // Warm damped tail
        chData[i] = lp * env;
      }
    }
    const convolver = this.ctx.createConvolver();
    convolver.buffer = irBuf;

    const reverbFilter = this.ctx.createBiquadFilter();
    reverbFilter.type = 'lowpass';
    reverbFilter.frequency.value = 2200;

    // Subtle warm tape-style echo into reverb & master
    const delay = this.ctx.createDelay(1.0);
    delay.delayTime.value = 0.44;
    const delayFb = this.ctx.createGain();
    delayFb.gain.value = 0.28;
    const delayTone = this.ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 1350;
    const delayMix = this.ctx.createGain();
    delayMix.gain.value = 0.32;

    this.musicWet.connect(convolver);
    convolver.connect(reverbFilter);
    reverbFilter.connect(this.musicMaster);

    this.musicWet.connect(delay);
    delay.connect(delayTone);
    delayTone.connect(delayFb);
    delayFb.connect(delay);
    delayTone.connect(delayMix);
    delayMix.connect(this.musicMaster);
  }
  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  /**
   * Dynamic environment blend:
   * 0.0 = Cozy lunar surface / rover (Outer Wilds acoustic plucks + warm felt piano)
   * 1.0 = High orbit / CSM / orbital view (Minecraft airy piano + ethereal pads)
   */
  getSpaceBlend() {
    if (typeof gameState === 'undefined' || typeof lander === 'undefined') return 0.35;
    if (gameState.mode === 'orbital' || lander.docked || lander.inOrbit) return 1.0;
    if (gameState.mode === 'rover' || lander.isLanded) return 0.0;
    return Math.max(0, Math.min(1, (lander.aglUnits || 0) / 8.0));
  }
  /**
   * Outer Wilds-inspired warm acoustic string pluck
   */
  playAcousticPluck(midi, time, vel = 0.14) {
    if (!this.ctx || !this.musicDry || !this.musicWet) return;
    const freq = this.midiToFreq(midi);
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.0018, time);

    const osc2Mix = this.ctx.createGain();
    osc2Mix.gain.value = 0.24;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 1.1;
    filt.frequency.setValueAtTime(Math.min(3400, freq * 6.5), time);
    filt.frequency.exponentialRampToValueAtTime(Math.max(280, freq * 1.6), time + 0.28);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(vel, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 1.85);

    osc1.connect(filt);
    osc2.connect(osc2Mix);
    osc2Mix.connect(filt);
    filt.connect(env);
    env.connect(this.musicDry);
    env.connect(this.musicWet);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 1.95);
    osc2.stop(time + 1.95);
  }
  /**
   * Minecraft (C418)-inspired soft felt piano note
   */
  playFeltPiano(midi, time, vel = 0.16, dur = 3.8) {
    if (!this.ctx || !this.musicDry || !this.musicWet) return;
    const freq = this.midiToFreq(midi);
    const fund = this.ctx.createOscillator();
    const over = this.ctx.createOscillator();
    fund.type = 'sine';
    over.type = 'triangle';
    fund.frequency.setValueAtTime(freq, time);
    over.frequency.setValueAtTime(freq * 2, time);

    const overGain = this.ctx.createGain();
    overGain.gain.setValueAtTime(0.14, time);
    overGain.gain.exponentialRampToValueAtTime(0.001, time + 0.55);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1750, time);
    filt.frequency.exponentialRampToValueAtTime(680, time + dur * 0.7);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(vel, time + 0.024);
    env.gain.exponentialRampToValueAtTime(vel * 0.32, time + dur * 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    const wetSend = this.ctx.createGain();
    wetSend.gain.value = 1.15;

    fund.connect(filt);
    over.connect(overGain);
    overGain.connect(filt);
    filt.connect(env);
    env.connect(this.musicDry);
    env.connect(wetSend);
    wetSend.connect(this.musicWet);

    fund.start(time);
    over.start(time);
    fund.stop(time + dur + 0.1);
    over.stop(time + dur + 0.1);
  }
  /**
   * Slow-breathing ethereal lunar pad chord
   */
  playLunarPad(midiNotes, time, dur = 6.5, vel = 0.045) {
    if (!this.ctx || !this.musicWet) return;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(520, time);
    filt.frequency.linearRampToValueAtTime(920, time + dur * 0.45);
    filt.frequency.linearRampToValueAtTime(420, time + dur);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(vel, time + Math.min(2.6, dur * 0.38));
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    filt.connect(env);
    env.connect(this.musicWet);

    midiNotes.forEach((m, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      const detune = (i - 1) * 4.5;
      osc.frequency.setValueAtTime(this.midiToFreq(m), time);
      osc.detune.setValueAtTime(detune, time);
      osc.connect(filt);
      osc.start(time);
      osc.stop(time + dur + 0.15);
    });
  }
  startMusicLoop() {
    if (this.musicTimer) return;
    // Begin first gentle phrase ~1.8s after launch
    this.phraseBarsLeft = 4 + Math.floor(Math.random() * 3);
    this.musicTimer = setTimeout(() => this.scheduleMusicStep(), 1800);
  }
  scheduleMusicStep() {
    this.musicTimer = null;
    if (!this.initialized || !this.ctx) return;

    // Wait quietly if audio context is suspended or muted
    if (this.muted || this.musicMuted || this.ctx.state !== 'running') {
      this.musicTimer = setTimeout(() => this.scheduleMusicStep(), 1600);
      return;
    }

    // Peaceful lunar silence between musical phrases (7–13s)
    if (this.phraseBarsLeft <= 0) {
      this.phraseBarsLeft = 4 + Math.floor(Math.random() * 3);
      this.progIdx = (this.progIdx + 1 + Math.floor(Math.random() * 2)) % 3;
      this.chordIdx = 0;
      const silenceMs = 7000 + Math.random() * 6000;
      this.musicTimer = setTimeout(() => this.scheduleMusicStep(), silenceMs);
      return;
    }

    // Nostalgic D Major / D Lydian chord progressions (Outer Wilds + C418 mood)
    const PROGRESSIONS = [
      // Dmaj9 -> Gmaj7#11 -> Bm9 -> A6/9
      [
        { bass: 50, pad: [57, 64, 66], arp: [50, 57, 62, 64, 66, 69], melody: [73, 74, 78, 81] },
        { bass: 43, pad: [55, 62, 66], arp: [43, 50, 59, 62, 66, 69], melody: [73, 74, 76, 78] },
        { bass: 47, pad: [54, 61, 62], arp: [47, 54, 59, 62, 66, 73], melody: [74, 78, 81, 85] },
        { bass: 45, pad: [52, 59, 61], arp: [45, 52, 57, 61, 64, 66], melody: [69, 73, 74, 76] }
      ],
      // Gmaj7 -> Dmaj9 -> Em9 -> Aadd9
      [
        { bass: 43, pad: [55, 59, 66], arp: [43, 50, 55, 59, 62, 66], melody: [71, 74, 78, 81] },
        { bass: 50, pad: [57, 61, 66], arp: [50, 57, 61, 64, 66, 69], melody: [73, 76, 78, 81] },
        { bass: 40, pad: [55, 59, 62], arp: [40, 47, 55, 59, 62, 66], melody: [71, 74, 76, 79] },
        { bass: 45, pad: [52, 57, 59], arp: [45, 52, 59, 61, 64, 69], melody: [73, 74, 76, 81] }
      ],
      // Bm7 -> Gmaj9 -> Dmaj7 -> F#m7
      [
        { bass: 47, pad: [54, 57, 62], arp: [47, 54, 57, 62, 66, 69], melody: [74, 76, 78, 81] },
        { bass: 43, pad: [55, 62, 66], arp: [43, 50, 57, 59, 62, 66], melody: [73, 74, 78, 83] },
        { bass: 50, pad: [57, 61, 66], arp: [50, 57, 61, 66, 69, 73], melody: [74, 78, 81, 86] },
        { bass: 42, pad: [54, 57, 61], arp: [42, 49, 54, 57, 61, 64], melody: [69, 73, 76, 78] }
      ]
    ];

    const prog = PROGRESSIONS[this.progIdx % PROGRESSIONS.length];
    const chord = prog[this.chordIdx % prog.length];
    const space = this.getSpaceBlend(); // 0 = Surface/Rover, 1 = Orbit/CSM
    const surface = 1.0 - space;

    const now = this.ctx.currentTime + 0.08;
    const barDur = 4.2 + space * 1.1; // Slower, more floating tempo in orbit

    // 1. Ethereal Lunar Pad (gentle on surface, lush in orbit)
    const padGain = 0.022 + space * 0.048;
    this.playLunarPad(chord.pad, now, barDur * 1.45, padGain);

    // 2. Outer Wilds Acoustic Campfire Arpeggio (prominent on surface & rover, fades in deep orbit)
    if (surface > 0.12) {
      const stepDur = barDur / 6;
      const pattern = Math.random() < 0.5 ? [0, 1, 2, 4, 3, 5] : [0, 2, 1, 3, 5, 4];
      pattern.forEach((idx, step) => {
        if (Math.random() < 0.14) return; // Occasional breathing space
        const t = now + step * stepDur + (Math.random() - 0.5) * 0.025;
        const vel = (0.055 + surface * 0.085) * (step === 0 ? 1.15 : 0.9);
        this.playAcousticPluck(chord.arp[idx % chord.arp.length], t, vel);
      });
    }

    // 3. Minecraft Felt Piano (warm bass root + sparse, wandering upper motifs)
    const pianoBaseVel = 0.10 + space * 0.065;
    this.playFeltPiano(chord.bass + (space > 0.5 ? 12 : 0), now, pianoBaseVel * 0.9, barDur * 1.1);

    const motifNotes = space > 0.5 ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2);
    for (let n = 0; n < motifNotes; n++) {
      const frac = (n + 0.5 + Math.random() * 0.45) / (motifNotes + 0.5);
      const t = now + frac * barDur;
      const notePool = space > 0.45 ? chord.melody : chord.arp.slice(2);
      const midi = notePool[Math.floor(Math.random() * notePool.length)];
      this.playFeltPiano(midi, t, pianoBaseVel * (0.75 + Math.random() * 0.35), 3.4 + space * 1.6);
    }

    this.chordIdx = (this.chordIdx + 1) % prog.length;
    this.phraseBarsLeft--;
    this.musicTimer = setTimeout(() => this.scheduleMusicStep(), barDur * 1000);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this.thrusterGain && this.muted) {
        this.thrusterGain.gain.setTargetAtTime(0, now, 0.05);
      }
      if (this.musicMaster) {
        const targetMusic = (this.muted || this.musicMuted) ? 0 : this.musicBaseGain * this.musicDuck;
        this.musicMaster.gain.setTargetAtTime(targetMusic, now, 0.18);
      }
    }
    return this.muted;
  }
  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    if (!this.initialized && !this.musicMuted) {
      this.init();
    }
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (!this.musicMuted && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      if (this.musicMaster) {
        const targetMusic = (this.muted || this.musicMuted) ? 0 : this.musicBaseGain * this.musicDuck;
        this.musicMaster.gain.setTargetAtTime(targetMusic, now, 0.18);
      }
      if (!this.musicMuted && !this.muted && !this.musicTimer && this.initialized) {
        this.phraseBarsLeft = 4 + Math.floor(Math.random() * 3);
        this.musicTimer = setTimeout(() => this.scheduleMusicStep(), 350);
      }
    }
    return this.musicMuted;
  }
  updateThruster(intensity, boost) {
    if (!this.initialized || !this.thrusterGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const targetGain = this.muted ? 0 : Math.min(0.22, intensity * (boost ? 0.22 : 0.14));
    const targetFreq = boost ? 420 : (140 + intensity * 190);
    this.thrusterGain.gain.setTargetAtTime(targetGain, now, 0.06);
    this.thrusterFilter.frequency.setTargetAtTime(targetFreq, now, 0.06);

    // Sidechain-duck the soundtrack slightly while main engine is roaring
    if (this.musicMaster) {
      this.musicDuck = 1.0 - Math.min(0.56, intensity * (boost ? 0.65 : 0.48));
      const targetMusic = (this.muted || this.musicMuted) ? 0 : this.musicBaseGain * this.musicDuck;
      this.musicMaster.gain.setTargetAtTime(targetMusic, now, 0.16);
    }
  }
  playPing(freq = 640, dur = 0.12) {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.15, now + dur);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }
  playTouchdown(hard = false) {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = hard ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(hard ? 140 : 95, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + (hard ? 0.35 : 0.2));
    g.gain.setValueAtTime(hard ? 0.18 : 0.12, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (hard ? 0.35 : 0.2));
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + (hard ? 0.36 : 0.22));
  }
  playScanComplete() {
    if (!this.initialized || this.muted || !this.ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
      setTimeout(() => this.playPing(f, 0.18), idx * 80);
    });
  }
  playStageSep() {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.24);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }
  playExplosion() {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.65);
    g.gain.setValueAtTime(0.28, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.72);
  }
}

export const sound = new LunarAudio();
