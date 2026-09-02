/** Worker-backed search, with a synchronous fallback if workers are unavailable. */
import { dealLevel, type DealOptions, type Level } from './deal.ts';
import type { Sim } from './sim.ts';
import { hint } from './solver.ts';
import type { Move } from './types.ts';

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../worker/deal.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string } & Record<string, unknown>>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = () => {
      broken = true;
      for (const [, p] of pending) p.reject(new Error('worker error'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

export function warmUp(): void {
  getWorker();
}

function ask<T>(message: object, timeoutMs: number): Promise<T> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...message });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('worker timeout'));
      }
    }, timeoutMs);
  });
}

export async function dealLevelAsync(opts: DealOptions): Promise<Level> {
  const p = ask<{ level: Level }>({ kind: 'deal', opts }, 15000);
  if (!p) return dealLevel(opts);
  try {
    return (await p).level;
  } catch {
    return dealLevel(opts);
  }
}

export async function hintAsync(sim: Sim): Promise<Move | null> {
  const plain: Sim = {
    ...sim,
    cols: sim.cols.map((c) => c.slice()),
    up: sim.up.slice(),
    gone: sim.gone.slice(),
  };
  const p = ask<{ move: Move | null }>({ kind: 'hint', sim: plain }, 6000);
  if (!p) return hint(sim);
  try {
    return (await p).move;
  } catch {
    return hint(sim);
  }
}
