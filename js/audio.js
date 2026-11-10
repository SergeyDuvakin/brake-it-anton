/**
 * Original synthesized audio. Nothing is downloaded.
 * The context starts only after a gesture. If Web Audio is missing, every
 * call stays silent and the game keeps running.
 */

export function createAudio() {
  let ctx = null;
  let master = null;
  let effects = true;
  let musicOn = true;
  let voiceOn = true;
  let noise = null;
  let brake = null;
  let radioOn = false;
  let stepTimer = 0;

  function audible() {
    return effects || musicOn || voiceOn;
  }

  function ac() {
    if (!audible()) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.75;
        master.connect(ctx.destination);
        const seconds = 1;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < data.length; i++) {
          brown = (brown + 0.02 * (Math.random() * 2 - 1)) * 0.96;
          data[i] = brown * 3.2;
        }
        noise = buffer;
      } catch {
        ctx = null;
        return null;
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function envGain(duration, peak) {
    const audio = ac();
    if (!audio) return null;
    const gain = audio.createGain();
    const now = audio.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(master);
    return { audio, gain, now };
  }

  function tone(freq, duration, type, peak) {
    if (!effects) return;
    const made = envGain(duration, peak);
    if (!made) return;
    const osc = made.audio.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, made.now);
    osc.connect(made.gain);
    osc.start(made.now);
    osc.stop(made.now + duration + 0.02);
  }

  function ensureBrake() {
    const audio = ac();
    if (!audio || brake) return;
    const src = audio.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    const gain = audio.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    brake = { filter, gain };
  }

  function stopRadio() {
    radioOn = false;
    if (stepTimer) window.clearTimeout(stepTimer);
    stepTimer = 0;
  }

  // A tiny original motif, not a recording. Two oscillators, minor and dumb.
  function startRadio() {
    const audio = ac();
    if (!audio || !musicOn) return;
    if (radioOn) return;
    radioOn = true;
    const notes = [196, 233, 262, 233, 196, 175, 196, 262];
    const playAt = (when, freq) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const under = audio.createOscillator();
      under.type = "sine";
      under.frequency.value = freq / 2;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.018, when + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
      osc.connect(gain);
      under.connect(gain);
      gain.connect(master);
      osc.start(when);
      under.start(when);
      osc.stop(when + 0.3);
      under.stop(when + 0.3);
      osc.onended = () => {
        try {
          osc.disconnect();
          under.disconnect();
          gain.disconnect();
        } catch {
          /* already gone */
        }
      };
    };
    const loop = () => {
      if (!radioOn || !ctx) return;
      const start = audio.currentTime + 0.05;
      notes.forEach((freq, i) => playAt(start + i * 0.34, freq));
      stepTimer = window.setTimeout(loop, notes.length * 340);
    };
    loop();
  }

  return {
    supported() {
      return !!(window.AudioContext || window.webkitAudioContext);
    },
    unlock() {
      return !!ac();
    },
    setEnabled(value) {
      effects = !!value;
      musicOn = !!value;
      if (!value) {
        stopRadio();
        if (brake) brake.gain.gain.value = 0;
        if (master) master.gain.value = 0;
      } else if (master) master.gain.value = 0.75;
    },
    setEffects(value) {
      effects = !!value;
      if (!effects && brake) brake.gain.gain.value = 0;
      if (master && audible()) master.gain.value = 0.75;
    },
    setMusic(value) {
      musicOn = !!value;
      if (!musicOn) stopRadio();
      if (master && audible()) master.gain.value = 0.75;
    },
    setVoice(value) {
      voiceOn = !!value;
    },
    voiceEnabled() {
      return voiceOn;
    },
    pedal(down) {
      tone(down ? 140 : 220, 0.07, "square", 0.03);
    },
    brakeAmount(amount, speed) {
      if (!effects) return;
      ensureBrake();
      if (!brake) return;
      const vol = amount > 0.35 && speed > 3 ? Math.min(0.05, amount * speed * 0.0016) : 0;
      brake.gain.gain.value = vol;
      brake.filter.frequency.value = 280 + speed * 18;
    },
    crash() {
      tone(90, 0.22, "sawtooth", 0.06);
      tone(180, 0.12, "square", 0.03);
    },
    honk() {
      tone(340, 0.12, "square", 0.04);
      tone(280, 0.16, "square", 0.03);
    },
    near() {
      tone(720, 0.07, "square", 0.03);
      tone(540, 0.09, "triangle", 0.02);
    },
    pop() {
      tone(392, 0.08, "triangle", 0.028);
      tone(523, 0.1, "triangle", 0.02);
    },
    ui() {
      tone(520, 0.05, "square", 0.025);
    },
    voice(text) {
      if (!voiceOn) return;
      const audio = ac();
      if (!audio) return;
      const line = String(text || "");
      const count = 2 + (line.length % 3);
      const root = 246 + ((line.charCodeAt(0) || 70) % 6) * 16;
      for (let i = 0; i < count; i += 1) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const when = audio.currentTime + i * 0.09;
        osc.type = "triangle";
        osc.frequency.value = root * (i % 2 ? 1.25 : 1);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.05, when + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
        osc.connect(gain);
        gain.connect(master);
        osc.start(when);
        osc.stop(when + 0.1);
      }
    },
    cargo(type) {
      if (type === "fish") {
        tone(880, 0.12, "sine", 0.03);
        tone(660, 0.16, "triangle", 0.02);
      } else {
        tone(520, 0.08, "triangle", 0.03);
        tone(390, 0.1, "sine", 0.02);
      }
    },
    sting() {
      tone(523, 0.12, "triangle", 0.04);
      tone(659, 0.16, "triangle", 0.03);
    },
    startRadio,
    stopRadio,
    duck(important) {
      if (!master || !audible()) return;
      master.gain.value = important ? 0.35 : 0.75;
    },
  };
}
