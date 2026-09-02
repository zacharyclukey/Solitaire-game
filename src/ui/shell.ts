/** Screen switching, modals, toasts and the small reusable pieces of chrome. */
import { CHARMS, CURSES, ENCHANTS, MODIFIERS, type CharmId, type ModifierId } from '../game/content.ts';
import { RANK_LABEL, SUIT_GLYPH, type DeckCard } from '../game/types.ts';
import { el } from './dom.ts';

export type ScreenId = 'title' | 'fork' | 'play' | 'reward' | 'shop' | 'over';

const screens = new Map<ScreenId, HTMLElement>();
let currentScreen: ScreenId = 'title';
let overlayRoot: HTMLElement;
let toastRoot: HTMLElement;
const overlayStack: (() => void)[] = [];

/** Closes the topmost panel or dialog. Returns false when none is open. */
export function closeTopOverlay(): boolean {
  const close = overlayStack.pop();
  if (!close) return false;
  close();
  return true;
}

function pushOverlay(close: () => void): () => void {
  const wrapped = (): void => {
    const i = overlayStack.indexOf(wrapped);
    if (i >= 0) overlayStack.splice(i, 1);
    close();
  };
  overlayStack.push(wrapped);
  return wrapped;
}

export function registerScreens(root: HTMLElement): void {
  for (const id of ['title', 'fork', 'play', 'reward', 'shop', 'over'] as ScreenId[]) {
    const node = el('section', { class: 'screen', id: `scr-${id}` });
    screens.set(id, node);
    root.append(node);
  }
  overlayRoot = el('div', { class: 'overlay-root' });
  toastRoot = el('div', { class: 'toast-root', 'aria-live': 'polite' });
  root.append(overlayRoot, toastRoot);
  screens.get('title')!.classList.add('active');
}

export function screen(id: ScreenId): HTMLElement {
  return screens.get(id)!;
}

export function show(id: ScreenId): void {
  if (currentScreen === id) return;
  screens.get(currentScreen)?.classList.remove('active');
  const next = screens.get(id)!;
  next.classList.add('active');
  next.scrollTop = 0;
  currentScreen = id;
}

export function activeScreen(): ScreenId {
  return currentScreen;
}

/* ------------------------------------------------------------------ toast */

export function toast(message: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  const node = el('div', { class: `toast ${kind}` }, [message]);
  toastRoot.append(node);
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => node.remove(), 300);
  }, 2000);
}

/* ------------------------------------------------------------------ modal */

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'ghost' | 'danger';
  value?: unknown;
}

export function modal(opts: {
  title: string;
  body?: Node | string;
  actions?: ModalAction[];
  dismissable?: boolean;
  className?: string;
}): Promise<unknown> {
  return new Promise((resolve) => {
    const sheet = el('div', { class: `sheet ${opts.className ?? ''}` });
    sheet.append(el('h2', { class: 'sheet-title' }, [opts.title]));
    if (opts.body) sheet.append(el('div', { class: 'sheet-body' }, [opts.body as Node]));
    const row = el('div', { class: 'sheet-actions' });
    for (const a of opts.actions ?? [{ label: 'OK', kind: 'primary' as const }]) {
      const b = el('button', { class: `btn ${a.kind ?? 'ghost'}`, type: 'button' }, [a.label]);
      b.addEventListener('click', () => {
        close();
        resolve(a.value ?? a.label);
      });
      row.append(b);
    }
    sheet.append(row);
    const scrim = el('div', { class: 'scrim' }, [sheet]);
    const close = pushOverlay(() => {
      scrim.classList.remove('in');
      setTimeout(() => scrim.remove(), 220);
    });
    if (opts.dismissable !== false) {
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) {
          close();
          resolve(null);
        }
      });
    }
    overlayRoot.append(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
  });
}

export function sheetPanel(opts: { title: string; body: Node; onClose?: () => void }): () => void {
  const sheet = el('div', { class: 'sheet tall' });
  const close = pushOverlay(() => {
    scrim.classList.remove('in');
    setTimeout(() => scrim.remove(), 220);
    opts.onClose?.();
  });
  const header = el('div', { class: 'sheet-head' }, [
    el('h2', { class: 'sheet-title' }, [opts.title]),
    (() => {
      const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close' }, ['✕']);
      b.addEventListener('click', close);
      return b;
    })(),
  ]);
  sheet.append(header, el('div', { class: 'sheet-body scroll' }, [opts.body]));
  const scrim = el('div', { class: 'scrim' }, [sheet]);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  overlayRoot.append(scrim);
  requestAnimationFrame(() => scrim.classList.add('in'));
  return close;
}

/* --------------------------------------------------------------- fragments */

export function modChip(id: ModifierId, opts: { compact?: boolean } = {}): HTMLElement {
  const m = MODIFIERS[id];
  const cls = m.threat < 0 ? 'chip boon' : 'chip bane';
  const node = el('span', { class: cls, 'data-mod': id, title: `${m.name} — ${m.text}` }, [
    el('span', { class: 'chip-glyph' }, [m.glyph]),
    opts.compact ? null : el('span', { class: 'chip-name' }, [m.name]),
  ]);
  return node;
}

export function charmChip(id: CharmId): HTMLElement {
  const c = CHARMS[id];
  return el('span', { class: 'chip charm', title: `${c.name} — ${c.text}` }, [
    el('span', { class: 'chip-glyph' }, [c.glyph]),
    el('span', { class: 'chip-name' }, [c.name]),
  ]);
}

export function miniCard(card: DeckCard, opts: { selectable?: boolean } = {}): HTMLElement {
  const node = el('div', {
    class: `mini s${card.suit}${opts.selectable ? ' selectable' : ''}${card.curse ? ' cursed' : ''}`,
    'data-uid': String(card.uid),
  });
  node.append(
    el('div', { class: 'mini-idx' }, [`${RANK_LABEL[card.rank]}`, el('i', {}, [SUIT_GLYPH[card.suit]])]),
    el('div', { class: 'mini-pip' }, [SUIT_GLYPH[card.suit]]),
  );
  if (card.ench) node.append(el('div', { class: 'mini-badge ench', title: ENCHANTS[card.ench].name }, [ENCHANTS[card.ench].glyph]));
  if (card.curse) node.append(el('div', { class: 'mini-badge curse', title: CURSES[card.curse].name }, [CURSES[card.curse].glyph]));
  return node;
}

/** Full-screen deck picker. Resolves with a uid, or null if cancelled. */
export function pickCard(
  deck: DeckCard[],
  opts: { title: string; hint?: string; allow?: (c: DeckCard) => boolean; cancellable?: boolean },
): Promise<number | null> {
  return new Promise((resolve) => {
    const grid = el('div', { class: 'deck-grid' });
    const body = el('div', {}, [opts.hint ? el('p', { class: 'hint' }, [opts.hint]) : null, grid]);
    let done = false;
    const finish = (uid: number | null): void => {
      if (done) return;
      done = true;
      close();
      resolve(uid);
    };
    const sorted = [...deck].sort((a, b) => a.suit - b.suit || a.rank - b.rank);
    for (const c of sorted) {
      const allowed = opts.allow ? opts.allow(c) : true;
      const node = miniCard(c, { selectable: allowed });
      if (!allowed) node.classList.add('disabled');
      else node.addEventListener('click', () => finish(c.uid));
      grid.append(node);
    }
    const close = sheetPanel({
      title: opts.title,
      body,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
    });
    if (opts.cancellable === false) {
      // Force a choice: keep the panel modal by swallowing scrim clicks.
      const scrim = overlayRoot.lastElementChild as HTMLElement;
      scrim.classList.add('locked');
    }
  });
}

/** A sheet of buttons that dismisses itself before running the chosen action,
 *  so panels never stack on top of one another. */
export function menuSheet(
  title: string,
  items: { label: string; kind?: string; fn: () => void }[],
  extra?: Node,
): void {
  let close = (): void => {};
  const body = el('div', {}, [
    extra ?? null,
    el(
      'div',
      { class: 'menu' },
      items.map((i) => {
        const b = el('button', { class: `btn ${i.kind ?? 'ghost'}`, type: 'button' }, [i.label]);
        b.addEventListener('click', () => {
          close();
          setTimeout(i.fn, 170);
        });
        return b;
      }),
    ),
  ]);
  close = sheetPanel({ title, body });
}

export function statRow(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat-row' }, [el('span', {}, [label]), el('strong', {}, [value])]);
}
