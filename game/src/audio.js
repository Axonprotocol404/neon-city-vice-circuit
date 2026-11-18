// =============================================================================
// Neon City: Vice Circuit — procedural audio (WebAudio, zero assets)
// =============================================================================
// Procedural WebAudio: engine hum whose pitch tracks speed, gunshots, police
// sirens, UI blips and explosion thuds. No assets — everything is synthesized
// from oscillators and white-noise buffers.
//
// LIFECYCLE: the AudioContext is created lazily on the first user gesture
// (browsers block audio until then) via resume(). The engine hum and siren
// are continuous layers with setTargetAtTime ramps; one-shot sounds are
// short-lived nodes created per call and left to garbage-collect.
export function createAudio() {
  let ctx = null;      // AudioContext, created lazily on first gesture
  let master = null;   // master gain feeding the destination
  let engine = null;   // { osc, sub, gain, filter } — continuous engine hum
  let siren = null;    // { osc, lfo, gain } — police siren layer
  let enabled = true;  // goes false when WebAudio is unavailable

  /** Lazily create the AudioContext and master gain. */
  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return false; }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  }

  /** Called on user gestures so the context leaves "suspended" state. */
  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  // ------------------------------------------------------------- engine
  // Two detuned oscillators (saw + sub square) through a lowpass. Gain rises
  // while driving; pitch and cutoff track speed.
  function startEngine() {
    if (!ensure() || engine) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 25;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    sub.start();
    engine = { osc, sub, gain, filter };
  }

  /** speedRatio 0..1, driving: whether the player is in a car. */
  function updateEngine(speedRatio, driving) {
    if (!engine) return;
    const t = ctx.currentTime;
    // Gain fades in while driving, out when on foot.
    const target = driving ? 0.14 : 0;
    engine.gain.gain.setTargetAtTime(target, t, 0.15);
    if (driving) {
      // Pitch and filter cutoff rise with speed for a natural rev feel.
      engine.osc.frequency.setTargetAtTime(45 + speedRatio * 130, t, 0.08);
      engine.sub.frequency.setTargetAtTime(22 + speedRatio * 65, t, 0.08);
      engine.filter.frequency.setTargetAtTime(280 + speedRatio * 900, t, 0.1);
    }
  }

  function stopEngine() {
    if (!engine) return;
    engine.osc.stop();
    engine.sub.stop();
    engine = null;
  }

  // -------------------------------------------------------------- siren
  // Triangle osc at 700 Hz with a 1.4 Hz sine LFO (±180 Hz) on the pitch.
  // Gain ramps in/out; teardown is deferred so the fade is audible.
  function setSiren(on) {
    if (!ensure()) return;
    if (on && !siren) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 700;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1.4;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      lfo.start();
      siren = { osc, lfo, gain };
    }
    if (siren) {
      const t = ctx.currentTime;
      siren.gain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.3);
      if (!on) {
        // Let it fade, then tear it down on the next call that needs it.
        const dead = siren;
        setTimeout(() => {
          try { dead.osc.stop(); dead.lfo.stop(); } catch { /* already stopped */ }
        }, 1200);
        siren = null;
      }
    }
  }

  // ------------------------------------------------------------- one-shots
  /** Decaying white-noise burst through a bandpass/lowpass/highpass filter. */
  function noiseBurst(duration, freq, gainLevel, type = 'bandpass') {
    if (!ensure()) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Linear decay envelope over the whole buffer (1 - i/frames).
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = gainLevel;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  /** A single oscillator note with exponential decay, optional pitch slide. */
  function tone(freq, duration, gainLevel, type = 'square', slideTo = null) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainLevel, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  // ------------------------------------------------------------- public API
  // One-shot sound effects. Every one is a mix of noiseBurst and/or tone.
  return {
    resume,
    startEngine,
    updateEngine,
    stopEngine,
    setSiren,
    shot() { noiseBurst(0.09, 1400, 0.35); tone(190, 0.06, 0.2, 'square', 60); },
    policeShot() { noiseBurst(0.08, 1100, 0.22); },
    hit() { noiseBurst(0.05, 2400, 0.18, 'highpass'); },
    crash() { noiseBurst(0.25, 220, 0.4, 'lowpass'); tone(70, 0.2, 0.3, 'sawtooth', 40); },
    explosion() { noiseBurst(0.5, 140, 0.55, 'lowpass'); tone(55, 0.4, 0.4, 'sawtooth', 28); },
    blip() { tone(880, 0.07, 0.15, 'sine'); },
    confirm() { tone(520, 0.09, 0.16, 'sine', 780); },
    mission() { tone(392, 0.14, 0.2, 'triangle'); setTimeout(() => tone(587, 0.2, 0.2, 'triangle'), 130); },
    fail() { tone(300, 0.25, 0.2, 'sawtooth', 140); },
    hurt() { tone(140, 0.12, 0.25, 'sawtooth', 80); },
    honk() { tone(310, 0.18, 0.12, 'square'); tone(392, 0.18, 0.1, 'square'); },
    heliTick: null, // rotor handled implicitly by engine ambience
  };
}
