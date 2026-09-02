/**
 * The playing surface.
 *
 * Cards are absolutely-positioned elements moved with `translate3d`, so the
 * browser animates every relayout on the compositor. Input supports both
 * tap-to-select and direct dragging, because on a phone people expect either.
 *
 * The draw pile and the waste share the simulation's column array (the two
 * indices at and above `sim.tableau`), so they share all the hit-testing and
 * highlight code too; only their on-screen placement differs.
 */
import type { Level } from '../game/deal.ts';
import { legalMoves, stock, stockIdx, wasteIdx, type Sim } from '../game/sim.ts';
import type { CardDef, Move } from '../game/types.ts';
import { makeCardEl } from './cardview.ts';
import { el } from './dom.ts';
import type { VictoryCard } from './victory.ts';

export interface BoardCallbacks {
  onMove(move: Move): void;
  onIllegal(): void;
  onLift(): void;
  onInspect(def: CardDef, anchor: DOMRect): void;
}

interface Geometry {
  pad: number;
  gap: number;
  cardW: number;
  cardH: number;
  upStep: number;
  downStep: number;
  tableauTop: number;
}

const RATIO = 1.44;

export class BoardView {
  readonly root: HTMLElement;
  private cardsLayer: HTMLElement;
  private slotsLayer: HTMLElement;
  private stockBadge: HTMLElement;
  private sim!: Sim;
  private level!: Level;
  private cardEls: HTMLElement[] = [];
  private slots: HTMLElement[] = [];
  private geom: Geometry = { pad: 6, gap: 5, cardW: 40, cardH: 58, upStep: 18, downStep: 10, tableauTop: 0 };
  private positions: { x: number; y: number }[] = [];
  private offsetY = 0;
  private selection: { col: number; idx: number } | null = null;
  private cb: BoardCallbacks;
  private hintTimer = 0;
  private locked = false;

  private drag: {
    id: number;
    col: number;
    idx: number;
    els: HTMLElement[];
    bases: { x: number; y: number }[];
    startX: number;
    startY: number;
    active: boolean;
    moves: Move[];
    pointerId: number;
  } | null = null;

  private pressTimer = 0;

  constructor(root: HTMLElement, cb: BoardCallbacks) {
    this.root = root;
    this.cb = cb;
    this.slotsLayer = el('div', { class: 'slots' });
    this.cardsLayer = el('div', { class: 'cards' });
    this.stockBadge = el('div', { class: 'stock-count' });
    this.root.append(this.slotsLayer, this.cardsLayer, this.stockBadge);
    this.attach();
  }

  get busy(): boolean {
    return this.locked;
  }
  set busy(v: boolean) {
    this.locked = v;
  }

  private get tableauCount(): number {
    return this.sim.tableau;
  }

  mount(level: Level): void {
    this.level = level;
    this.sim = level.sim;
    this.selection = null;
    this.cardsLayer.replaceChildren();
    this.slotsLayer.replaceChildren();
    this.cardEls = this.sim.defs.map((def, i) => makeCardEl(def, i));
    this.slots = this.sim.cols.map((_, c) => {
      const kind = c < level.columns ? 'slot' : c === stockIdx(this.sim) ? 'slot stock' : 'slot waste';
      return el('div', { class: kind, 'data-col': String(c) });
    });
    this.slotsLayer.append(...this.slots);
    this.cardsLayer.append(...this.cardEls);
    this.measure();
    this.layout(false);
  }

  /** Deal animation: cards fly in from off-screen, column by column. */
  async dealIn(): Promise<void> {
    this.root.classList.add('dealing');
    for (const e of this.cardEls) {
      e.style.transition = 'none';
      e.style.transform = `translate3d(${this.geom.cardW * 3}px, -60vh, 0) rotate(12deg)`;
      e.style.opacity = '0';
    }
    void this.root.offsetHeight;
    const order: number[] = [];
    const maxLen = Math.max(...this.sim.cols.map((c) => c.length));
    for (let i = 0; i < maxLen; i++) for (const col of this.sim.cols) if (col[i] !== undefined) order.push(col[i]);
    order.forEach((id, n) => {
      const e = this.cardEls[id];
      e.style.transition = '';
      e.style.transitionDelay = `${n * 14}ms`;
    });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    this.layout(true);
    for (const e of this.cardEls) e.style.opacity = '1';
    await new Promise((r) => setTimeout(r, order.length * 14 + 320));
    for (const e of this.cardEls) e.style.transitionDelay = '';
    this.root.classList.remove('dealing');
  }

  /* ------------------------------------------------------------- geometry */

  measure(): void {
    const w = this.root.clientWidth;
    const cols = this.level.columns;
    const pad = Math.max(4, Math.round(w * 0.012));
    const gap = Math.max(3, Math.round(w * 0.011));
    const cardW = Math.floor((w - pad * 2 - gap * (cols - 1)) / cols);
    const cardH = Math.round(cardW * RATIO);
    const tableauTop = cardH + Math.round(cardH * 0.3);
    this.geom = { ...this.geom, pad, gap, cardW, cardH, tableauTop };
    this.root.style.setProperty('--card-w', `${cardW}px`);
    this.root.style.setProperty('--card-h', `${cardH}px`);
    this.root.style.setProperty('--tableau-top', `${tableauTop}px`);
    this.computeFan();
  }

  /**
   * Chooses how far apart stacked cards sit. Columns fan out to fill the height
   * available — tight when a pile is deep, generous when it is not — and the
   * block is nudged down so a shallow board is not marooned at the top.
   */
  private computeFan(): void {
    const { cardH, tableauTop } = this.geom;
    const avail = Math.max(cardH, this.root.clientHeight - tableauTop - 2);
    const tallest = (u: number, d: number): number => {
      let best = cardH;
      for (let c = 0; c < this.tableauCount; c++) {
        const col = this.sim.cols[c];
        let y = 0;
        for (let i = 0; i < col.length - 1; i++) y += this.sim.up[col[i]] ? u : d;
        best = Math.max(best, y + cardH);
      }
      return best;
    };

    let up = Math.round(cardH * 0.3);
    let down = Math.round(cardH * 0.16);
    const span = tallest(up, down) - cardH;
    if (span > 0) {
      const k = (avail - cardH) / span;
      if (k < 1) {
        up = Math.max(9, Math.round(up * Math.max(0.3, k)));
        down = Math.max(5, Math.round(down * Math.max(0.3, k)));
      } else {
        up = Math.min(Math.round(cardH * 0.66), Math.round(up * Math.min(k, 2.4)));
        down = Math.min(Math.round(cardH * 0.36), Math.round(down * Math.min(k, 2.4)));
      }
    }
    this.geom.upStep = up;
    this.geom.downStep = down;
    this.offsetY = this.geom.tableauTop + Math.round(Math.max(0, avail - tallest(up, down)) * 0.12);
  }

  private zoneX(c: number): number {
    const { pad, cardW, gap } = this.geom;
    // Draw pile far left, waste beside it; the rest of the top strip is air.
    const i = c < this.tableauCount ? c : c - this.tableauCount;
    return pad + i * (cardW + gap);
  }

  private zoneTop(c: number): number {
    return c < this.tableauCount ? this.offsetY : 0;
  }

  /** Horizontal fan for the last few waste cards, so recent draws stay visible. */
  private wasteFan(idx: number, len: number): number {
    const shown = Math.min(3, len);
    const rank = idx - (len - shown);
    // Wide enough that each card's rank and suit stay legible; the top strip
    // has the room, since only the pile and the waste live up there.
    return rank <= 0 ? 0 : rank * Math.round(this.geom.cardW * 0.52);
  }

  layout(animate = true): void {
    this.computeFan();
    const { upStep, downStep } = this.geom;
    this.slots.forEach((sl, c) => {
      sl.style.transform = `translate3d(${this.zoneX(c)}px, ${this.zoneTop(c)}px, 0)`;
    });
    this.positions = new Array(this.sim.defs.length).fill(null).map(() => ({ x: 0, y: 0 }));
    const onBoard = new Set<number>();

    this.sim.cols.forEach((col, c) => {
      const tableauCol = c < this.tableauCount;
      const isWaste = c === wasteIdx(this.sim);
      let y = this.zoneTop(c);
      col.forEach((id, i) => {
        onBoard.add(id);
        const e = this.cardEls[id];
        // The draw pile is a neat stack; the waste fans sideways; the tableau
        // fans down by the amount computeFan settled on.
        const x = this.zoneX(c) + (isWaste ? this.wasteFan(i, col.length) : 0);
        this.positions[id] = { x, y };
        if (!animate) e.style.transition = 'none';
        e.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        e.style.zIndex = String(10 + i);
        e.classList.toggle('up', this.sim.up[id] === 1);
        e.classList.toggle('down', this.sim.up[id] === 0);
        e.classList.toggle('tail', i === col.length - 1);
        e.classList.toggle('in-pile', !tableauCol);
        if (!animate) {
          void e.offsetHeight;
          e.style.transition = '';
        }
        if (tableauCol) y += this.sim.up[id] ? upStep : downStep;
      });
    });

    for (let id = 0; id < this.cardEls.length; id++) {
      this.cardEls[id].classList.toggle('burned', !onBoard.has(id));
    }
    this.slots.forEach((sl, c) => sl.classList.toggle('open', this.sim.cols[c].length === 0));

    const left = stock(this.sim).length;
    this.stockBadge.textContent = String(left);
    this.stockBadge.classList.toggle('empty', left === 0);
    this.stockBadge.style.transform = `translate3d(${this.zoneX(stockIdx(this.sim))}px, 0, 0)`;
  }

  /* --------------------------------------------------------------- lookup */

  private locate(id: number): { col: number; idx: number } | null {
    for (let c = 0; c < this.sim.cols.length; c++) {
      const i = this.sim.cols[c].indexOf(id);
      if (i >= 0) return { col: c, idx: i };
    }
    return null;
  }

  private movesForCard(col: number, idx: number): Move[] {
    return legalMoves(this.sim, true).filter(
      (m) =>
        m.from === col &&
        ((m.kind === 'm' && m.fromIdx === idx) || (m.kind !== 'm' && idx === this.sim.cols[col].length - 1)),
    );
  }

  /** Resolves a drop zone to a legal move. Cards only ever land on the tableau. */
  private moveTo(moves: Move[], zone: number): Move | undefined {
    return moves.find((m) => m.kind === 'm' && m.to === zone);
  }

  /** Best automatic destination: onto a card before bare ground, then cheapest. */
  private bestMove(moves: Move[]): Move | null {
    const stacking = moves.filter((m) => m.kind === 'm');
    if (!stacking.length) return moves.find((m) => m.kind !== 'd') ?? null;
    const rank = (m: Move): number => (this.sim.cols[m.to].length === 0 ? 2 : 1);
    return [...stacking].sort((a, b) => rank(a) - rank(b) || a.cost - b.cost || a.to - b.to)[0];
  }

  /* ------------------------------------------------------------ selection */

  private markTargets(moves: Move[]): void {
    for (const m of moves) {
      if (m.kind !== 'm') continue;
      const tcol = this.sim.cols[m.to];
      if (tcol.length === 0) this.slots[m.to].classList.add('target');
      else this.cardEls[tcol[tcol.length - 1]].classList.add('target');
    }
  }

  private setSelection(col: number, idx: number): void {
    this.clearSelection();
    const moves = this.movesForCard(col, idx);
    if (!moves.length) {
      this.shake(this.sim.cols[col][idx]);
      this.cb.onIllegal();
      return;
    }
    this.selection = { col, idx };
    for (const id of this.sim.cols[col].slice(idx)) this.cardEls[id].classList.add('picked');
    this.markTargets(moves);
    this.root.classList.add('has-selection');
    this.cb.onLift();
  }

  clearSelection(): void {
    this.selection = null;
    this.root.classList.remove('has-selection');
    for (const e of this.cardEls) e.classList.remove('picked', 'target');
    for (const s of this.slots) s.classList.remove('target');
  }

  private shake(id: number): void {
    const e = this.cardEls[id];
    if (!e) return;
    e.classList.remove('shake');
    void e.offsetHeight;
    e.classList.add('shake');
    setTimeout(() => e.classList.remove('shake'), 420);
  }

  /* ---------------------------------------------------------------- input */

  /** Maps a screen point to a tableau column or reserve cell. */
  private zoneAt(clientX: number, clientY: number): number {
    const r = this.root.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const { pad, cardW, gap, tableauTop } = this.geom;
    if (y < tableauTop) {
      // Top strip: the draw pile occupies the first column slot, the waste the
      // second; everything to the right of them counts as the waste too.
      return x < pad + cardW + gap * 0.5 ? stockIdx(this.sim) : wasteIdx(this.sim);
    }
    const band = r.width / this.level.columns;
    return Math.min(this.level.columns - 1, Math.max(0, Math.floor(x / band)));
  }

  private attach(): void {
    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMoveEv(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('pointercancel', () => this.cancelDrag());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown(e: PointerEvent): void {
    if (this.locked) return;
    const target = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    this.clearHint();

    // Anywhere on the draw pile — the slot or the cards stacked on it — turns
    // the next card. It never participates in selection or dragging.
    if (this.zoneAt(e.clientX, e.clientY) === stockIdx(this.sim)) {
      this.clearSelection();
      const draw = legalMoves(this.sim, true).find((m) => m.kind === 'd');
      if (draw) this.cb.onMove(draw);
      else this.cb.onIllegal();
      return;
    }

    if (!target) {
      if (this.selection) {
        const zone = this.zoneAt(e.clientX, e.clientY);
        const mv = this.moveTo(this.movesForCard(this.selection.col, this.selection.idx), zone);
        if (mv) {
          this.clearSelection();
          this.cb.onMove(mv);
          return;
        }
      }
      this.clearSelection();
      return;
    }

    const id = Number(target.dataset.id);
    const at = this.locate(id);
    if (!at) return;

    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = 0;
      this.cancelDrag();
      this.cb.onInspect(this.sim.defs[id], target.getBoundingClientRect());
    }, 460);

    if (this.selection && (this.selection.col !== at.col || this.selection.idx !== at.idx)) {
      const mv = this.moveTo(this.movesForCard(this.selection.col, this.selection.idx), at.col);
      if (mv) {
        clearTimeout(this.pressTimer);
        this.pressTimer = 0;
        this.clearSelection();
        this.cb.onMove(mv);
        return;
      }
    }

    const moves = this.movesForCard(at.col, at.idx);
    const ids = this.sim.up[id] ? this.sim.cols[at.col].slice(at.idx) : [];
    this.drag = {
      id,
      col: at.col,
      idx: at.idx,
      els: ids.map((i) => this.cardEls[i]),
      bases: ids.map((i) => ({ ...this.positions[i] })),
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      moves,
      pointerId: e.pointerId,
    };
    this.root.setPointerCapture(e.pointerId);
  }

  private onMoveEv(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 9) return;
      if (!d.moves.some((m) => m.kind === 'm')) {
        this.cancelDrag();
        return;
      }
      if (this.pressTimer) {
        clearTimeout(this.pressTimer);
        this.pressTimer = 0;
      }
      d.active = true;
      this.clearSelection();
      this.root.classList.add('dragging');
      d.els.forEach((n) => n.classList.add('drag'));
      this.markTargets(d.moves);
      this.cb.onLift();
    }
    d.els.forEach((n, i) => {
      n.style.transform = `translate3d(${d.bases[i].x + dx}px, ${d.bases[i].y + dy}px, 0)`;
      n.style.zIndex = String(900 + i);
    });
    this.updateHover(d, dx, dy);
  }

  private updateHover(d: NonNullable<BoardView['drag']>, dx: number, dy: number): void {
    const r = this.root.getBoundingClientRect();
    const cx = r.left + d.bases[0].x + dx + this.geom.cardW / 2;
    const cy = r.top + d.bases[0].y + dy + this.geom.cardH / 2;
    const zone = this.zoneAt(cx, cy);
    const mv = this.moveTo(d.moves, zone);
    this.cardEls.forEach((c) => c.classList.remove('hover'));
    this.slots.forEach((s) => s.classList.remove('hover'));
    if (!mv) return;
    const to = mv.to;
    const tcol = this.sim.cols[to];
    if (tcol.length === 0) this.slots[to].classList.add('hover');
    else this.cardEls[tcol[tcol.length - 1]].classList.add('hover');
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = 0;
    }
    if (!d || e.pointerId !== d.pointerId) return;

    if (!d.active) {
      this.drag = null;
      if (this.selection && this.selection.col === d.col && this.selection.idx === d.idx) {
        const best = this.bestMove(d.moves);
        this.clearSelection();
        if (best) this.cb.onMove(best);
        else this.cb.onIllegal();
        return;
      }
      if (d.moves.length === 1 && d.moves[0].kind !== 'm') {
        this.cb.onMove(d.moves[0]); // burn / turn actions have no destination
        return;
      }
      this.setSelection(d.col, d.idx);
      return;
    }

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const r = this.root.getBoundingClientRect();
    const zone = this.zoneAt(
      r.left + d.bases[0].x + dx + this.geom.cardW / 2,
      r.top + d.bases[0].y + dy + this.geom.cardH / 2,
    );
    const mv = this.moveTo(d.moves, zone);
    this.finishDrag();
    if (mv) this.cb.onMove(mv);
    else {
      this.layout(true);
      this.cb.onIllegal();
    }
  }

  private finishDrag(): void {
    const d = this.drag;
    this.drag = null;
    this.root.classList.remove('dragging');
    if (d) d.els.forEach((e) => e.classList.remove('drag'));
    this.cardEls.forEach((c) => c.classList.remove('hover', 'target'));
    this.slots.forEach((s) => s.classList.remove('hover', 'target'));
  }

  private cancelDrag(): void {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = 0;
    }
    if (!this.drag) return;
    this.finishDrag();
    this.layout(true);
  }

  /* ----------------------------------------------------------- affordances */

  /** Paints a move onto the board: `src` on the card being moved, `dst` on
   *  whatever it would land on. Shared by the hint button and the tutorial. */
  private mark(move: Move, src: string, dst: string): void {
    const fromCol = this.sim.cols[move.from];
    const head = fromCol[move.fromIdx] ?? fromCol[fromCol.length - 1];
    if (head !== undefined) this.cardEls[head]?.classList.add(src);
    if (move.kind !== 'm') return;
    const tcol = this.sim.cols[move.to];
    if (tcol.length === 0) this.slots[move.to].classList.add(dst);
    else this.cardEls[tcol[tcol.length - 1]].classList.add(dst);
  }

  showHint(move: Move): void {
    this.clearHint();
    this.mark(move, 'hint-src', 'hint-dst');
    this.hintTimer = window.setTimeout(() => this.clearHint(), 2600);
  }

  clearHint(): void {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = 0;
    }
    for (const e of this.cardEls) e.classList.remove('hint-src', 'hint-dst');
    for (const s of this.slots) s.classList.remove('hint-dst');
  }

  /** Persistent coaching highlight, redrawn after every move by the tutorial. */
  setCoachMove(move: Move | null): void {
    for (const e of this.cardEls) e.classList.remove('coach-src', 'coach-dst');
    for (const s of this.slots) s.classList.remove('coach-dst');
    if (move) this.mark(move, 'coach-src', 'coach-dst');
  }

  setPeek(on: boolean): void {
    this.root.classList.toggle('peeking', on);
  }

  flashBurn(id: number): void {
    this.cardEls[id]?.classList.add('burning');
  }

  pulseFlip(ids: number[]): void {
    for (const id of ids) {
      const e = this.cardEls[id];
      if (!e) continue;
      e.classList.remove('just-flipped');
      void e.offsetHeight;
      e.classList.add('just-flipped');
      setTimeout(() => e.classList.remove('just-flipped'), 700);
    }
  }

  /**
   * Everything the victory sequence needs to sort the board: the layer the
   * cards live in, and where each one is resting right now. Burned cards are
   * absent, because they are no longer on the board to sort.
   */
  victorySnapshot(): { layer: HTMLElement; cards: VictoryCard[]; cardW: number; cardH: number } {
    const cards: VictoryCard[] = [];
    for (const col of this.sim.cols) {
      for (const id of col) {
        const d = this.sim.defs[id];
        const p = this.positions[id] ?? { x: 0, y: 0 };
        cards.push({ el: this.cardEls[id], rank: d.rank, suit: d.suit, x: p.x, y: p.y });
      }
    }
    return { layer: this.cardsLayer, cards, cardW: this.geom.cardW, cardH: this.geom.cardH };
  }

  celebrate(): void {
    this.root.classList.add('cleared');
    setTimeout(() => this.root.classList.remove('cleared'), 1800);
  }
}
