/**
 * Local persistence. Everything the game knows lives in one JSON blob so a
 * future cloud-save or Capacitor Preferences backend is a one-function swap.
 */
import type { RunState } from './game/run.ts';

const KEY = 'facedown.save.v1';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  reduceMotion: boolean;
  leftHanded: boolean;
  highContrast: boolean;
  fourColour: boolean;
  showHint: boolean;
  confirmRestart: boolean;
}

/** One finished run, for the records screen. */
export interface RunRecord {
  depth: number;
  score: number;
  seed: number;
  reason: string;
  daily: boolean;
  at: number;
}

export interface MetaStats {
  runs: number;
  bestDepth: number;
  bestScore: number;
  levelsCleared: number;
  cardsTurned: number;
  movesSpent: number;
  dailyDate: string;
  dailyDepth: number;
  seenHelp: boolean;
  tutorialDone: boolean;
  /** Achievement id -> unlock timestamp. */
  achievements: Record<string, number>;
  /** Most recent finished runs, newest first. */
  history: RunRecord[];
}

export interface SaveData {
  version: number;
  run: RunState | null;
  stats: MetaStats;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  haptics: true,
  reduceMotion: false,
  leftHanded: false,
  highContrast: false,
  fourColour: false,
  showHint: true,
  confirmRestart: true,
};

export const DEFAULT_STATS: MetaStats = {
  runs: 0,
  bestDepth: 0,
  bestScore: 0,
  levelsCleared: 0,
  cardsTurned: 0,
  movesSpent: 0,
  dailyDate: '',
  dailyDepth: 0,
  seenHelp: false,
  tutorialDone: false,
  achievements: {},
  history: [],
};

function blank(): SaveData {
  return { version: 1, run: null, stats: { ...DEFAULT_STATS }, settings: { ...DEFAULT_SETTINGS } };
}

let cache: SaveData | null = null;

export function load(): SaveData {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      cache = {
        version: 1,
        run: parsed.run ?? null,
        stats: {
          ...DEFAULT_STATS,
          ...(parsed.stats ?? {}),
          // Nested defaults survive a save written by an older version.
          achievements: { ...(parsed.stats?.achievements ?? {}) },
          history: parsed.stats?.history ?? [],
        },
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
      return cache;
    }
  } catch {
    /* corrupted save: start clean rather than trapping the player on a crash */
  }
  cache = blank();
  return cache;
}

let pending = 0;

export function save(): void {
  if (!cache) return;
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* storage full or blocked — the game keeps working in-memory */
    }
  });
}

export function settings(): Settings {
  return load().settings;
}

export function stats(): MetaStats {
  return load().stats;
}

export function setRun(run: RunState | null): void {
  load().run = run;
  save();
}

export function getRun(): RunState | null {
  const r = load().run;
  // Saves written before the move bank existed have no purse. Start them empty
  // rather than with an undefined that would poison every sum downstream.
  if (r && typeof r.bank !== 'number') r.bank = 0;
  return r;
}

export const HISTORY_LIMIT = 25;

/** Records a finished run, newest first, keeping the list bounded. */
export function pushRunRecord(record: RunRecord): void {
  const st = stats();
  st.history = [record, ...st.history].slice(0, HISTORY_LIMIT);
  save();
}

export function unlock(id: string): boolean {
  const st = stats();
  if (st.achievements[id]) return false;
  st.achievements[id] = Date.now();
  save();
  return true;
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function wipe(): void {
  cache = blank();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
