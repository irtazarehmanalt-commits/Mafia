'use client';

/**
 * Procedural sound.
 *
 * Every cue is synthesised with the Web Audio API rather than loaded from
 * files: nothing to download, nothing to license, and the timbre can be tuned
 * in code. The context is created lazily on the first user gesture, which is
 * exactly what browser autoplay policies require.
 */
export type SoundCue =
  | 'gameStart'
  | 'night'
  | 'morning'
  | 'death'
  | 'vote'
  | 'eliminate'
  | 'victory'
  | 'defeat'
  | 'tick'
  | 'join';

const VOLUME_KEY = 'mafia:volume';
const MUTED_KEY = 'mafia:muted';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;
  private muted = false;
  private unlocked = false;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      const storedVolume = window.localStorage.getItem(VOLUME_KEY);
      const storedMuted = window.localStorage.getItem(MUTED_KEY);
      if (storedVolume !== null) this.volume = Math.min(1, Math.max(0, Number(storedVolume)));
      if (storedMuted !== null) this.muted = storedMuted === 'true';
    } catch {
      /* storage unavailable — fall back to defaults */
    }
  }

  /** Must be called from inside a user gesture handler. */
  unlock(): void {
    if (this.unlocked || typeof window === 'undefined') return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      void this.ctx.resume();
      this.unlocked = true;
    } catch {
      /* audio unavailable — the game is fully playable silently */
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get currentVolume(): number {
    return this.volume;
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    try {
      window.localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      /* ignore */
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
    try {
      window.localStorage.setItem(MUTED_KEY, String(muted));
    } catch {
      /* ignore */
    }
  }

  play(cue: SoundCue): void {
    if (!this.unlocked || this.muted || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;

    switch (cue) {
      case 'gameStart':
        this.chord(now, [146.83, 220, 293.66], 1.6, 'sine', 0.18);
        break;
      case 'night':
        // A low, slow swell — the town going to sleep.
        this.tone(now, 55, 2.4, 'sine', 0.22);
        this.tone(now + 0.1, 82.4, 2.0, 'triangle', 0.1);
        break;
      case 'morning':
        this.chord(now, [261.63, 329.63, 392], 1.2, 'triangle', 0.13);
        break;
      case 'death':
        // Dissonant minor second, plus a low thud.
        this.tone(now, 138.59, 1.4, 'sawtooth', 0.13);
        this.tone(now, 146.83, 1.4, 'sawtooth', 0.11);
        this.tone(now, 48, 0.7, 'sine', 0.3);
        break;
      case 'eliminate':
        this.tone(now, 196, 0.18, 'square', 0.1);
        this.tone(now + 0.14, 130.81, 0.9, 'sawtooth', 0.14);
        break;
      case 'vote':
        this.tone(now, 660, 0.07, 'square', 0.05);
        break;
      case 'tick':
        this.tone(now, 1200, 0.035, 'square', 0.03);
        break;
      case 'join':
        this.tone(now, 523.25, 0.09, 'sine', 0.07);
        this.tone(now + 0.08, 783.99, 0.12, 'sine', 0.06);
        break;
      case 'victory':
        this.chord(now, [261.63, 329.63, 392, 523.25], 2.2, 'triangle', 0.15);
        break;
      case 'defeat':
        this.chord(now, [261.63, 311.13, 369.99], 2.2, 'sawtooth', 0.11);
        break;
    }
  }

  private tone(
    at: number,
    frequency: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;

    // Short attack, exponential decay — avoids clicks at both ends.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }

  private chord(
    at: number,
    frequencies: number[],
    duration: number,
    type: OscillatorType,
    peak: number,
  ): void {
    frequencies.forEach((frequency, index) => {
      // Slight stagger so the chord blooms rather than hitting flat.
      this.tone(at + index * 0.06, frequency, duration, type, peak);
    });
  }
}

let engine: SoundEngine | null = null;

export function sound(): SoundEngine {
  if (!engine) engine = new SoundEngine();
  return engine;
}
