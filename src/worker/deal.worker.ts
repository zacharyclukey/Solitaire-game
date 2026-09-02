/// <reference lib="webworker" />
/**
 * Search runs off the main thread: dealing (which certifies the board) and
 * hints both call the solver, and both would otherwise drop frames.
 */
import { dealLevel, type DealOptions } from '../game/deal.ts';
import { hint } from '../game/solver.ts';
import type { Sim } from '../game/sim.ts';

type Req =
  | { id: number; kind: 'deal'; opts: DealOptions }
  | { id: number; kind: 'hint'; sim: Sim };

self.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data;
  const post = (payload: object): void => (self as unknown as Worker).postMessage({ id: msg.id, ...payload });
  try {
    if (msg.kind === 'deal') post({ level: dealLevel(msg.opts) });
    else post({ move: hint(msg.sim) });
  } catch (err) {
    post({ error: String(err) });
  }
};
