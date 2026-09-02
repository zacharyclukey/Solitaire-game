/**
 * Synthesised sound effects.
 *
 * Every sound is generated with oscillators and noise bursts at runtime, which
 * keeps the bundle tiny, works offline, and avoids shipping licensed audio.
 */
import { settings } from './storage.ts';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function ensure(): AudioContext | null {
  if (!settings().sound) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** iOS only unlocks audio inside a user gesture. */
export function unlock(): void {
  ensure();
}

interface ToneOpts {
  freq: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  glide?: number;
}

function tone(o: ToneOpts): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.glide), t + (o.dur ?? 0.15));
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur ?? 0.15));
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + (o.dur ?? 0.15) + 0.02);
}

function noise(dur = 0.08, gain = 0.16, hp = 900, delay = 0): void {
  const c = ensure();
  if (!c || !master || !noiseBuffer) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = hp;
  filter.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  tap(): void {
    tone({ freq: 620, dur: 0.05, type: 'sine', gain: 0.09 });
  },
  lift(): void {
    noise(0.05, 0.1, 2600);
    tone({ freq: 420, dur: 0.06, type: 'sine', gain: 0.07 });
  },
  place(): void {
    noise(0.07, 0.14, 1500);
    tone({ freq: 180, dur: 0.09, type: 'sine', gain: 0.14, glide: 120 });
  },
  flip(): void {
    noise(0.05, 0.12, 3200);
    tone({ freq: 880, dur: 0.05, type: 'sine', gain: 0.06 });
  },
  deny(): void {
    tone({ freq: 150, dur: 0.13, type: 'square', gain: 0.08, glide: 90 });
  },
  gold(): void {
    tone({ freq: 1320, dur: 0.1, type: 'sine', gain: 0.1 });
    tone({ freq: 1760, dur: 0.14, type: 'sine', gain: 0.08, delay: 0.06 });
  },
  boon(): void {
    [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.11, delay: i * 0.05 }));
  },
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.13, delay: i * 0.085 }),
    );
  },
  lose(): void {
    [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.42, type: 'sine', gain: 0.13, delay: i * 0.13 }));
  },
  deal(): void {
    noise(0.05, 0.08, 1800);
  },
  burn(): void {
    noise(0.3, 0.14, 700);
    tone({ freq: 300, dur: 0.3, type: 'sawtooth', gain: 0.06, glide: 60 });
  },
};
