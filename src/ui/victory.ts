/**
 * The victory cascade.
 *
 * Facedown has no foundations during play — so when a board is finally cleared
 * we build them, once, and let every card sort itself home. Four streams, ace
 * first, arcing up out of the tableau and dropping onto their pile.
 *
 * Mechanics, deliberately kept to the board's own idiom:
 *
 * - Cards are moved with `el.style.transform = translate3d(...)`, exactly as
 *   `BoardView.layout` does. Each card's *resting* transform is written up
 *   front, and the flight itself is a Web Animations keyframe run over the same
 *   property with `fill: 'backwards'` — so the element holds its start position
 *   during its delay, flies, and then falls back to the resting value it
 *   already has. Cancelling an animation therefore snaps that card to its
 *   foundation with no bookkeeping, which is the whole of `skip()`.
 * - Sequencing is one requestAnimationFrame clock over a sorted event queue,
 *   plus a single watchdog timeout. One handle each, both cleared on teardown.
 * - Face-down cards turn over by swapping `.down` for `.up`; the rotation lives
 *   in board.css on the inner `.flip`, and we do not touch it.
 *
 * The caller owns the card elements: nothing here reparents, clones or removes
 * them, and every element and class this module adds is taken back off at the
 * end, however the sequence ends.
 */

export interface VictoryCard {
  el: HTMLElement;
  /** 1..13 */
  rank: number;
  /** 0 spades, 1 hearts, 2 diamonds, 3 clubs */
  suit: number;
  /** current translate3d x, in px, within `layer` */
  x: number;
  /** current translate3d y, in px, within `layer` */
  y: number;
}

export interface VictoryOptions {
  cardW: number;
  cardH: number;
  reduceMotion: boolean;
  /** Called as cards land, so the caller can play a sound. Throttled here to at
   *  most ~10 calls across the whole sequence. */
  onLand?: () => void;
}

export interface VictoryHandle {
  /** Resolves once, when the sequence has finished or been skipped. */
  done: Promise<void>;
  /** Cut to the end immediately. Safe at any time, and twice. */
  skip(): void;
}

const SUIT_PIP = ['♠', '♥', '♦', '♣'];

/** How long one card spends in the air. */
const FLIGHT = 540;
/** Beat before the first card leaves, so the foundations land first. */
const LEAD = 200;
/** Head start between one suit's stream and the next. */
const SUIT_STAGGER = 80;
/** The closing flourish once all four piles are full. */
const FLOURISH = 780;
const MIN_STEP = 110;
const MAX_STEP = 300;
/** Everything, collapsed, for reduced motion. */
const REDUCED = 300;

export function playVictory(layer: HTMLElement, cards: VictoryCard[], opts: VictoryOptions): VictoryHandle {
  const { cardW, cardH } = opts;

  let settled = false;
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });

  const owned: HTMLElement[] = []; // elements we put into `layer`
  // Cards in pile order. A card only climbs above the foundation outlines when
  // it actually leaves the tableau, so the outlines stay legible over a board
  // that is still full; `finish` grants the rest their place immediately.
  let stacking: VictoryCard[] = [];
  const flights: Animation[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let raf = 0;

  /* ------------------------------------------------------------ geometry */

  const width = layer.clientWidth || cardW * 7;
  const gap = Math.max(6, Math.round(cardW * 0.16));
  const rowW = cardW * 4 + gap * 3;
  const rowX = Math.round((width - rowW) / 2);
  const rowY = Math.round(cardH * 0.26);
  const slotX = (suit: number): number => rowX + suit * (cardW + gap);

  /** Where the i-th card of a suit comes to rest: a pile that grows a hair
   *  upwards and wobbles a hair sideways, so it reads as stacked, not merged. */
  const restX = (c: VictoryCard): number => slotX(c.suit) + (((c.rank * 7 + c.suit * 13) % 5) - 2) * 0.55;
  const restY = (i: number): number => rowY - Math.min(i, 10) * 1.1;

  /* --------------------------------------------------------------- piles */

  const piles: VictoryCard[][] = [[], [], [], []];
  for (const c of cards) {
    const s = c.suit >= 0 && c.suit < 4 ? c.suit : 0;
    piles[s].push(c);
  }
  for (const p of piles) p.sort((a, b) => a.rank - b.rank);
  const deepest = Math.max(0, ...piles.map((p) => p.length));

  /* ------------------------------------------------------------ teardown */

  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    // Cancelling reverts each card to its resting transform, already written.
    for (const a of flights) {
      try {
        a.cancel();
      } catch {
        /* an animation already finished or detached */
      }
    }
    flights.length = 0;
    stacking.forEach((c, i) => {
      c.el.style.zIndex = String(400 + i);
    });
    for (const c of cards) {
      c.el.classList.remove('v-fly', 'v-crown', 'just-flipped');
      c.el.classList.remove('down');
      c.el.classList.add('up');
    }
    for (const e of owned) e.remove();
    owned.length = 0;
    layer.classList.remove('v-run');
    release();
  };

  /* -------------------------------------------------------- the outlines */

  const buildSlots = (animate: boolean): void => {
    for (let s = 0; s < 4; s++) {
      const slot = document.createElement('div');
      slot.className = `v-slot s${s}`;
      slot.style.width = `${cardW}px`;
      slot.style.height = `${cardH}px`;
      slot.style.borderRadius = `${(cardW * 0.115).toFixed(1)}px`;
      slot.style.transform = `translate3d(${slotX(s)}px, ${rowY}px, 0)`;
      if (animate) slot.style.animationDelay = `calc(${s * 70}ms * var(--dur, 1))`;
      else slot.style.animation = 'none';
      const pip = document.createElement('div');
      pip.className = 'v-pip';
      pip.style.fontSize = `${Math.round(cardW * 0.5)}px`;
      pip.textContent = SUIT_PIP[s];
      slot.append(pip);
      layer.append(slot);
      owned.push(slot);
    }
  };

  layer.classList.add('v-run');
  for (const c of cards) c.el.classList.add('v-fly');

  /* ------------------------------------------------- the reduced-motion cut */

  if (opts.reduceMotion) {
    buildSlots(false);
    for (const slot of owned) slot.classList.add('lit');
    for (const pile of piles) {
      pile.forEach((c, i) => {
        stacking.push(c);
        c.el.style.transform = `translate3d(${restX(c)}px, ${restY(i)}px, 0) rotate(0deg) scale(1, 1)`;
        c.el.classList.remove('down');
        c.el.classList.add('up');
      });
    }
    opts.onLand?.();
    timers.push(setTimeout(finish, REDUCED));
    return { done, skip: finish };
  }

  if (!cards.length) {
    buildSlots(true);
    timers.push(setTimeout(finish, 420));
    return { done, skip: finish };
  }

  /* ------------------------------------------------------------ the timing */

  const n = cards.length;
  const budget = n <= 28 ? 3000 : Math.min(4400, 3000 + (n - 28) * 90);
  const room = budget - LEAD - FLIGHT - FLOURISH - SUIT_STAGGER * 3;
  const step = deepest > 1 ? Math.min(MAX_STEP, Math.max(MIN_STEP, room / (deepest - 1))) : 0;
  const launchAt = (suit: number, i: number): number => LEAD + suit * SUIT_STAGGER + i * step;

  // At most ten thuds across the whole run, however big the deck.
  const every = Math.max(1, Math.ceil(n / 9));

  buildSlots(true);

  /* ------------------------------------------------------------ the flight */

  type Beat = { at: number; run: () => void };
  const queue: Beat[] = [];

  const order = piles
    .flatMap((pile, s) => pile.map((c, i) => ({ c, s, i })))
    .sort((a, b) => launchAt(a.s, a.i) - launchAt(b.s, b.i));
  stacking = order.map((o) => o.c);

  let landed = 0;
  let last = 0;

  order.forEach(({ c, s, i }, seq) => {
    const tx = restX(c);
    const ty = restY(i);
    const t0 = launchAt(s, i);

    // The resting state, written the way the board writes it. The keyframes
    // below only borrow the property until they end.
    c.el.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(0deg) scale(1, 1)`;

    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    const lift = Math.min(cardH * 2.1, cardH * 0.5 + dist * 0.24);
    const spin = (dx >= 0 ? 1 : -1) * Math.min(16, 5 + dist * 0.024);
    const squash = cardH * 0.03;
    // The arc and the hover above the pile are both capped at the top of the
    // layer: a card should look thrown, not launched off the screen and over
    // the HUD. This is why the foundation row is not flush with the top.
    const ceiling = 0;
    const apexX = c.x + dx * 0.56;
    const apexY = Math.max(ceiling, c.y + dy * 0.5 - lift);
    const hoverY = Math.max(ceiling, ty - Math.max(12, cardH * 0.24));

    const frames: Keyframe[] = [
      {
        offset: 0,
        transform: `translate3d(${c.x}px, ${c.y}px, 0) rotate(0deg) scale(1, 1)`,
        easing: 'cubic-bezier(0.42, 0, 0.6, 0.5)',
      },
      {
        offset: 0.46,
        transform: `translate3d(${apexX.toFixed(1)}px, ${apexY.toFixed(1)}px, 0) rotate(${spin.toFixed(1)}deg) scale(1.08, 1.08)`,
        easing: 'cubic-bezier(0.35, 0.1, 0.3, 1)',
      },
      {
        offset: 0.78,
        transform: `translate3d(${tx.toFixed(1)}px, ${hoverY.toFixed(1)}px, 0) rotate(${(spin * 0.18).toFixed(1)}deg) scale(1.03, 1.03)`,
        easing: 'cubic-bezier(0.5, 0, 0.85, 0.6)',
      },
      {
        offset: 0.9,
        transform: `translate3d(${tx.toFixed(1)}px, ${(ty + squash).toFixed(1)}px, 0) rotate(0deg) scale(1.07, 0.92)`,
        easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)',
      },
      {
        offset: 1,
        transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(0deg) scale(1, 1)`,
      },
    ];

    if (typeof c.el.animate === 'function') {
      flights.push(c.el.animate(frames, { duration: FLIGHT, delay: t0, fill: 'backwards' }));
    }

    queue.push({ at: t0, run: () => { c.el.style.zIndex = String(400 + seq); } });

    if (c.el.classList.contains('down')) {
      // Early in the climb: the flip itself takes 0.36s in board.css, so any
      // later than this and the card is still turning as it lands.
      queue.push({
        at: t0 + FLIGHT * 0.12,
        run: () => {
          c.el.classList.remove('down');
          c.el.classList.add('up');
          c.el.classList.add('just-flipped');
        },
      });
    }

    const at = t0 + FLIGHT;
    last = Math.max(last, at);
    queue.push({
      at,
      run: () => {
        if (landed++ % every === 0) opts.onLand?.();
      },
    });
  });

  /* --------------------------------------------------------- the flourish */

  queue.push({
    at: last,
    run: () => {
      for (const slot of owned) slot.classList.add('lit');

      const cx = rowX + rowW / 2;
      const cy = rowY + cardH / 2;
      const r = Math.round(rowW * 0.62);
      for (const kind of ['v-burst', 'v-ring']) {
        const e = document.createElement('div');
        e.className = kind;
        e.style.width = `${r * 2}px`;
        e.style.height = `${r * 2}px`;
        e.style.transform = `translate3d(${Math.round(cx - r)}px, ${Math.round(cy - r)}px, 0)`;
        layer.append(e);
        owned.push(e);
      }

      piles.forEach((pile, s) => {
        const top = pile[pile.length - 1];
        if (!top) return;
        const i = pile.length - 1;
        const tx = restX(top);
        const ty = restY(i);
        top.el.classList.remove('just-flipped');
        top.el.classList.add('v-crown');
        if (typeof top.el.animate === 'function') {
          flights.push(
            top.el.animate(
              [
                { transform: `translate3d(${tx}px, ${ty}px, 0) rotate(0deg) scale(1, 1)` },
                {
                  offset: 0.4,
                  transform: `translate3d(${tx}px, ${(ty - cardH * 0.14).toFixed(1)}px, 0) rotate(0deg) scale(1.06, 1.06)`,
                },
                { transform: `translate3d(${tx}px, ${ty}px, 0) rotate(0deg) scale(1, 1)` },
              ],
              { duration: 620, delay: s * 70, easing: 'cubic-bezier(0.3, 0.9, 0.35, 1)', fill: 'backwards' },
            ),
          );
        }
      });

      opts.onLand?.();
    },
  });

  const total = last + FLOURISH;
  queue.push({ at: total, run: finish });
  queue.sort((a, b) => a.at - b.at);

  /* ------------------------------------------------------------ the clock */

  let next = 0;
  const start = performance.now();
  const tick = (): void => {
    raf = 0;
    if (settled) return;
    const t = performance.now() - start;
    while (next < queue.length && queue[next].at <= t) queue[next++].run();
    if (!settled && next < queue.length) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // If rAF is throttled away (backgrounded tab), still land and resolve.
  timers.push(setTimeout(finish, total + 1500));

  return { done, skip: finish };
}
