// THE IRON LOTUS — the game's one and only procedural score.
// A dark martial-arts atmosphere inspired by traditional Chinese instruments,
// synthesized with fixed mathematics: 132 BPM (11×12), D pentatonic
// pitch geometry, Euclidean percussion, and an eight-bar through-composed phrase. An erhu
// fiddle) lead carrying a haunting melody, a guzheng (plucked zither) ostinato,
// a dizi (bamboo flute) playing ornaments, and light percussion (temple block,
// frame drum, big drum). Combat-intensity layering + impact stingers.
// No external assets. Client-side only.

type Wave = OscillatorType;

// D minor pentatonic (D F G A C): a darker, entirely new pitch world.
// Frequencies are generated from semitone geometry rather than copied audio.
const PENTA = [
  146.83, 174.61, 196.0, 220.0, 261.63,
  293.66, 349.23, 392.0, 440.0, 523.25,
  587.33, 698.46, 783.99, 880.0, 1046.5,
  1174.66, 1396.91, 1567.98, 1760.0, 2093.0,
];
function note(degree: number): number {
  const n = ((degree % PENTA.length) + PENTA.length) % PENTA.length;
  return PENTA[n];
}

function euclideanPulse(step: number, pulses: number, steps: number, rotation = 0): boolean {
  const n = ((step + rotation) % steps + steps) % steps;
  return Math.floor(((n + 1) * pulses) / steps) !== Math.floor((n * pulses) / steps);
}

// Eight-bar descending/returning cycle; never selected by Director intent.
const BASS_ROOTS = [73.42, 87.31, 65.41, 73.42, 55.0, 65.41, 87.31, 73.42];

// Sixteen-step guzheng blade ostinato: asymmetric 5+5+6 accent geometry.
const GUZHENG_ARP = [0, 3, 1, 5, 2, 4, 1, 6, 0, 4, 2, 7, 3, 1, 5, 2];

// New eight-bar erhu melody. Bar lengths follow a 3-2-3 breathing pattern;
// rests are part of the melody, preventing the old continuous lead texture.
const ERHU_BARS: number[][] = [
  [0, -1, 3, 2, -1, 1, 0, -1],
  [5, 6, -1, 8, -1, 6, 4, -1],
  [3, -1, 7, -1, 6, 3, 1, -1],
  [0, 2, 3, -1, 5, -1, 4, 2],
  [8, -1, 10, 9, -1, 7, 6, -1],
  [5, 3, -1, 2, 1, -1, 0, -1],
  [3, -1, 4, 6, -1, 8, 7, 4],
  [2, 1, 0, -1, -1, 0, -1, -1],
];

// Dizi ornament: a quick high flourish [deg, deg, deg] played between erhu phrases.
const DIZI_FLOURISH = [14, 12, 13, 10];

export type HitKind = "punch" | "kick" | "roundhouse" | "throw" | "block" | "ko";

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private delay: DelayNode | null = null;
  private delayFb: GainNode | null = null;
  private droneNodes: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private schedulerId: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private bar = 0;
  private running = false;
  private _volume = 0.55;
  private lastErhuFreq = 0; // for portamento between erhu notes
  private tempo = 132; // 11×12: urgent but still readable under combat
  private get stepDur() {
    return 60 / this.tempo / 4; // 16th note
  }

  get playing(): boolean {
    return this.running;
  }

  get volume(): number {
    return this._volume;
  }

  setVolume(v: number) {
    this._volume = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  async start() {
    if (this.running) return;
    if (typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._volume;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7000;
      lp.Q.value = 0.3;
      this.master.connect(lp);
      lp.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.82;
      this.delay = this.ctx.createDelay(1.0);
      this.delay.delayTime.value = 0.382; // golden-ratio conjugate
      this.delayFb = this.ctx.createGain();
      this.delayFb.gain.value = 0.236; // phi^-3
      this.musicBus.connect(this.master);
      this.musicBus.connect(this.delay);
      this.delay.connect(this.delayFb);
      this.delayFb.connect(this.delay);
      this.delayFb.connect(this.master);
    }
    try {
      await this.ctx.resume();
    } catch {
      /* ignore */
    }
    this.running = true;
    this.startDrone();
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.bar = 0;
    this.lastErhuFreq = 0;
    this.schedulerId = window.setInterval(() => this.scheduler(), 25);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.stopDrone();
  }

  toggle(): boolean {
    if (this.running) this.stop();
    else void this.start();
    return this.running;
  }

  dispose() {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  // --- impact stingers (combat SFX) ---
  hit(kind: HitKind) {
    if (!this.ctx || !this.master || !this.running) return;
    const t = this.ctx.currentTime + 0.001;
    switch (kind) {
      case "punch":
        this.impactBoom(t, 90, 0.16, 0.5);
        this.metallicClang(t, 0.1, 0.12);
        break;
      case "kick":
        this.impactBoom(t, 70, 0.22, 0.7);
        this.metallicClang(t, 0.14, 0.16);
        break;
      case "roundhouse":
        this.whoosh(t, 0.18);
        this.impactBoom(t, 55, 0.32, 0.95);
        this.metallicClang(t, 0.2, 0.22);
        break;
      case "throw":
        this.whoosh(t, 0.12);
        this.impactBoom(t, 48, 0.28, 0.85);
        this.metallicClang(t, 0.18, 0.2);
        break;
      case "block":
        this.metallicClang(t, 0.16, 0.18);
        this.impactBoom(t, 120, 0.08, 0.3);
        break;
      case "ko":
        this.whoosh(t - 0.05, 0.3);
        this.impactBoom(t, 42, 0.5, 1.0);
        this.metallicClang(t, 0.28, 0.3);
        this.impactBoom(t + 0.06, 38, 0.4, 0.8);
        break;
    }
  }

  // --- drone (sustained tonic + fifth, the "guqin" bed) ---
  private startDrone() {
    if (!this.ctx || !this.musicBus) return;
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneGain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.8);
    this.droneGain.connect(this.musicBus);

    const freqs: [number, number][] = [
      [73.42, 1.0], // D2 tonic
      [110.0, 0.55], // A2 fifth
    ];
    for (const [f, g] of freqs) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const og = this.ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(lp);
      lp.connect(this.droneGain);
      o.start();
      this.droneNodes.push(o);
    }
    // slow tremolo
    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.value = 0.14;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    this.lfo.connect(lfoGain);
    lfoGain.connect(this.droneGain.gain);
    this.lfo.start();
  }

  private stopDrone() {
    if (this.droneGain && this.ctx) {
      this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
    const nodes = this.droneNodes;
    const lfo = this.lfo;
    window.setTimeout(() => {
      nodes.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* ignore */
        }
      });
      try {
        lfo?.stop();
      } catch {
        /* ignore */
      }
    }, 700);
    this.droneNodes = [];
    this.lfo = null;
    this.droneGain = null;
  }

  // --- scheduler: 8-bar cycle, 16 steps/bar ---
  private scheduler() {
    if (!this.ctx || !this.running) return;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.scheduleStep(this.bar, this.step, this.nextNoteTime);
      this.nextNoteTime += this.stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar = (this.bar + 1) % ERHU_BARS.length;
        if (this.bar === 0) this.lastErhuFreq = 0;
      }
    }
  }

  private scheduleStep(bar: number, step: number, time: number) {
    // ---- percussion ----
    // War-drum skeleton: asymmetric attacks create forward pressure without
    // responding to player inputs or spawning a second arrangement.
    if (step === 0 || step === 6 || step === 10 || step === 15) {
      this.bigDrum(time, step === 0 ? 0.72 : 0.48);
    }
    // Dense Euclidean cross-rhythm: E(7,16) against rotated E(5,16).
    if (euclideanPulse(step, 7, 16)) this.frameDrum(time, step === 0 ? 0.42 : 0.28);
    if (euclideanPulse(step, 5, 16, 3)) this.templeBlock(time, 0.2);

    // ---- sub bass on the bar root (downbeat) ----
    if (step === 0) this.subBass(BASS_ROOTS[bar], time);

    // ---- guzheng blade ostinato (16th notes) ----
    const guzhengDegree = GUZHENG_ARP[step];
    const guzhengAccent = step === 0 || step === 5 || step === 10 ? 0.16 : 0.085;
    this.guzheng(note(guzhengDegree + 2), time, this.stepDur * 1.35, guzhengAccent);
    // Combat hits use short SFX only. Do not start an additional musical
    // layer on attack; that previously sounded like two scores overlapping.

    // ---- erhu lead melody (8th notes, sustained) ----
    const eDeg = ERHU_BARS[bar][Math.floor(step / 2)];
    if (eDeg >= 0) {
      const f = note(eDeg);
      this.erhu(f, time, this.stepDur * 2.05, 0.17);
      this.lastErhuFreq = f;
    }

    // ---- dizi ornament: sparse answer at golden-section phrase points ----
    if ((bar === 2 || bar === 5) && step === 13) {
      const base = time + this.stepDur;
      DIZI_FLOURISH.forEach((d, i) => {
        this.dizi(note(d), base + i * this.stepDur * 0.5, this.stepDur * 0.6, 0.08);
      });
    }

    // ---- one restrained breath into the second half ----
    if (bar === 3 && step === 12) this.riser(time, this.stepDur * 4);
  }

  // --- voices ---
  // erhu: bowed 2-string fiddle — sawtooth through a resonant bandpass, with a
  // wide vibrato and portamento (pitch slide) from the previous note.
  private erhu(freq: number, time: number, dur: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq * 1.6;
    f.Q.value = 3.5;
    o.type = "sawtooth";
    // portamento from the previous note's pitch
    const startF = this.lastErhuFreq > 0 ? this.lastErhuFreq : freq;
    o.frequency.setValueAtTime(startF, time);
    o.frequency.exponentialRampToValueAtTime(freq, time + 0.09);
    // wide vibrato (erhu signature)
    const vib = this.ctx.createOscillator();
    const vibGain = this.ctx.createGain();
    vib.frequency.value = 5.5;
    vibGain.gain.value = freq * 0.012;
    vib.connect(vibGain);
    vibGain.connect(o.frequency);
    // bowed envelope: smooth attack, sustain, smooth release
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.1);
    g.gain.setValueAtTime(gain, time + dur - 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay!);
    o.start(time);
    o.stop(time + dur + 0.05);
    vib.start(time);
    vib.stop(time + dur + 0.05);
  }

  // guzheng: plucked zither — bright triangle + octave harmonic, fast decay.
  private guzheng(freq: number, time: number, dur: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq * 5;
    f.Q.value = 0.5;
    o.type = "triangle";
    o2.type = "sine";
    o.frequency.value = freq;
    o2.frequency.value = freq * 2;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.3;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(f);
    f.connect(this.musicBus);
    o.start(time);
    o2.start(time);
    o.stop(time + dur + 0.02);
    o2.stop(time + dur + 0.02);
  }

  // dizi: bamboo flute — sine + breath noise with a flutter (amplitude tremolo).
  private dizi(freq: number, time: number, dur: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const flutter = this.ctx.createOscillator();
    const flutterGain = this.ctx.createGain();
    flutter.frequency.value = 6.5;
    flutterGain.gain.value = gain * 0.35;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.04);
    g.gain.setValueAtTime(gain, time + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    flutter.connect(flutterGain);
    flutterGain.connect(g.gain);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay!);
    o.start(time);
    o.stop(time + dur + 0.05);
    flutter.start(time);
    flutter.stop(time + dur + 0.05);
    // breath noise
    const n = this.noiseBurst(time, dur, 0.02, 1500);
    if (n) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = 1.5;
      n.disconnect();
      n.connect(bp);
      bp.connect(this.musicBus);
    }
  }

  // temple block (muyu): woody knock — triangle blip with pitch drop + click.
  private templeBlock(time: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(880, time);
    o.frequency.exponentialRampToValueAtTime(620, time + 0.03);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.08);
  }

  // frame drum (bo): small hand drum — short sine pitch drop + noise body.
  private frameDrum(time: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(190, time);
    o.frequency.exponentialRampToValueAtTime(95, time + 0.08);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.16);
    const n = this.noiseBurst(time, 0.05, gain * 0.3, 250);
    if (n) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 250;
      bp.Q.value = 0.8;
      n.disconnect();
      n.connect(bp);
      bp.connect(this.musicBus);
    }
  }

  // big drum (da-gu): deeper, longer boom.
  private bigDrum(time: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(130, time);
    o.frequency.exponentialRampToValueAtTime(48, time + 0.18);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.34);
  }

  private subBass(freq: number, time: number) {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.18, time + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.62);
  }

  private riser(time: number, dur: number) {
    if (!this.ctx || !this.musicBus) return;
    const n = this.noiseBurst(time, dur, 0.0001, 200);
    if (!n) return;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, time);
    f.frequency.exponentialRampToValueAtTime(5500, time + dur);
    n.disconnect();
    n.connect(f);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.18, time + dur);
    f.connect(g);
    g.connect(this.musicBus);
  }

  // --- impact stinger voices ---
  private impactBoom(time: number, baseFreq: number, dur: number, gain: number) {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(baseFreq * 2.4, time);
    o.frequency.exponentialRampToValueAtTime(baseFreq, time + dur);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  private metallicClang(time: number, dur: number, gain: number) {
    if (!this.ctx || !this.master) return;
    const partials = [1, 1.84, 2.41, 3.2, 4.3];
    const base = 880;
    partials.forEach((p, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = "triangle";
      o.frequency.value = base * p;
      const a = (gain * (1 - i * 0.15)) / partials.length;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(a, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g);
      g.connect(this.master!);
      o.start(time);
      o.stop(time + dur + 0.02);
    });
  }

  private whoosh(time: number, dur: number) {
    if (!this.ctx || !this.master) return;
    const n = this.noiseBurst(time, dur, 0.0001, 400);
    if (!n) return;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(400, time);
    f.frequency.exponentialRampToValueAtTime(5000, time + dur * 0.6);
    f.frequency.exponentialRampToValueAtTime(800, time + dur);
    n.disconnect();
    n.connect(f);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.3, time + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    f.connect(g);
    g.connect(this.master);
  }

  private noiseBurst(
    time: number,
    dur: number,
    gain: number,
    cutoff: number,
  ): AudioNode | null {
    if (!this.ctx) return null;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f);
    f.connect(g);
    src.start(time);
    src.stop(time + dur + 0.02);
    return g;
  }
}
