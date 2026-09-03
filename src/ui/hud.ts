/** The in-level chrome: counters, rule strip and the action bar. */
import type { Level } from '../game/deal.ts';
import { CONSUMABLE_LIST, MODIFIERS, type ConsumableId } from '../game/content.ts';
import { remaining, type Sim } from '../game/sim.ts';
import { el } from './dom.ts';
import { modChip, sheetPanel } from './shell.ts';

export interface HudActions {
  menu(): void;
  undo(): void;
  hint(): void;
  peek(): void;
  use(id: ConsumableId): void;
}

export class Hud {
  readonly root: HTMLElement;
  readonly boardHost: HTMLElement;
  private moves!: HTMLElement;
  private par!: HTMLElement;
  private movesBox!: HTMLElement;
  private turned!: HTMLElement;
  private depth!: HTMLElement;
  private depthBox!: HTMLElement;
  private timer!: HTMLElement;
  private strip!: HTMLElement;
  private bar!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private hintBtn!: HTMLButtonElement;
  private peekBtn!: HTMLButtonElement;
  private itemBtns!: HTMLButtonElement[];
  private banner!: HTMLElement;
  private coach!: HTMLElement;

  constructor(actions: HudActions) {
    this.par = el('span', { class: 'hud-par' }, ['']);
    this.movesBox = el('div', { class: 'hud-moves' }, [
      (this.moves = el('b', {}, ['0'])),
      el('span', {}, ['moves left']),
      this.par,
    ]);
    this.depth = el('b', {}, ['1']);
    this.depthBox = el('div', { class: 'hud-depth' }, ['LV ', this.depth]);
    this.turned = el('b', {}, ['0/0']);
    this.timer = el('div', { class: 'hud-timer hidden' }, ['']);
    this.strip = el('div', { class: 'mods-strip' });
    this.bar = el('div', { class: 'progress' }, [el('i')]);
    this.boardHost = el('div', { class: 'board', id: 'board' });
    this.banner = el('div', { class: 'deal-banner' }, ['Dealing…']);
    this.coach = el('div', { class: 'coach' }, [el('p', { class: 'coach-text' })]);

    const menuBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Menu' }, ['☰']);
    menuBtn.addEventListener('click', actions.menu);

    this.undoBtn = el('button', { class: 'act', type: 'button' }, [
      el('span', { class: 'act-glyph' }, ['↶']),
      el('span', { class: 'act-label' }, ['Undo']),
      el('em', { class: 'act-count' }, ['3']),
    ]) as HTMLButtonElement;
    this.undoBtn.addEventListener('click', actions.undo);

    this.hintBtn = el('button', { class: 'act', type: 'button' }, [
      el('span', { class: 'act-glyph' }, ['◈']),
      el('span', { class: 'act-label' }, ['Oracle']),
      el('em', { class: 'act-count' }, ['2']),
    ]) as HTMLButtonElement;
    this.hintBtn.addEventListener('click', actions.hint);

    this.peekBtn = el('button', { class: 'act', type: 'button' }, [
      el('span', { class: 'act-glyph' }, ['◉']),
      el('span', { class: 'act-label' }, ['Peek']),
      el('em', { class: 'act-count' }, ['1']),
    ]) as HTMLButtonElement;
    this.peekBtn.addEventListener('click', actions.peek);

    // An escape only helps if it is in reach of the thumb at the moment the
    // board goes dead, so these sit in the action row rather than behind a menu.
    // They appear only when one is actually held.
    this.itemBtns = CONSUMABLE_LIST.map((c) => {
      const b = el('button', { class: 'act item hidden', type: 'button' }, [
        el('span', { class: 'act-glyph' }, [c.glyph]),
        el('span', { class: 'act-label' }, [c.name]),
        el('em', { class: 'act-count' }, ['0']),
      ]) as HTMLButtonElement;
      b.addEventListener('click', () => actions.use(c.id));
      return b;
    });

    this.root = el('div', { class: 'play' }, [
      el('header', { class: 'hud' }, [
        menuBtn,
        this.depthBox,
        this.movesBox,
        el('div', { class: 'hud-turned' }, [this.turned, el('span', {}, ['to place'])]),
        this.timer,
      ]),
      this.bar,
      this.strip,
      el('div', { class: 'board-wrap' }, [this.boardHost, this.banner, this.coach]),
      el('footer', { class: 'actions' }, [this.undoBtn, this.hintBtn, this.peekBtn, ...this.itemBtns]),
    ]);
  }

  /** Show only the escapes actually held, with their remaining charges. */
  setItems(held: Partial<Record<ConsumableId, number>>): void {
    CONSUMABLE_LIST.forEach((c, i) => {
      const n = held[c.id] ?? 0;
      this.itemBtns[i].classList.toggle('hidden', n <= 0);
      this.itemBtns[i].querySelector('.act-count')!.textContent = String(n);
    });
  }

  setDealing(on: boolean): void {
    this.banner.classList.toggle('on', on);
  }

  /**
   * The tutorial's coaching line. The board is shortened by exactly the
   * banner's height so the cards it is teaching about never sit behind it.
   */
  setCoach(text: string | null): void {
    this.coach.classList.toggle('on', text !== null);
    if (text === null) {
      this.boardHost.style.bottom = '';
      return;
    }
    this.coach.firstElementChild!.textContent = text;
    this.boardHost.style.bottom = `${this.coach.offsetHeight + 10}px`;
  }

  mount(level: Level): void {
    const lesson = level.spec.kind === 'tutorial';
    this.depthBox.classList.toggle('lesson', lesson);
    this.depthBox.firstChild!.textContent = lesson ? 'LESSON' : 'LV ';
    this.depth.textContent = lesson ? '' : String(level.spec.stage);
    this.strip.replaceChildren(
      ...level.modifiers.map((m) => {
        const c = modChip(m);
        c.addEventListener('click', () =>
          sheetPanel({
            title: MODIFIERS[m].name,
            body: el('p', { class: 'prose' }, [MODIFIERS[m].text]),
          }),
        );
        return c;
      }),
    );
    this.strip.classList.toggle('empty', level.modifiers.length === 0);
    this.peekBtn.classList.toggle('hidden', level.peeksLeft === 0);
    this.timer.classList.toggle('hidden', level.timeLimit === 0);
  }

  update(level: Level, sim: Sim, opts: { canUndo: boolean }): void {
    this.moves.textContent = String(Math.max(0, sim.movesLeft));
    // Deliberately no par, no carry, no deficit against a standard deck. While
    // a board is being played the only number that changes anything the player
    // does is how many moves are left; everything else was scoreboard dressing
    // that invited them to play the arithmetic instead of the cards. Par comes
    // back at the end of the level, as a score.
    this.par.textContent = '';
    this.par.classList.toggle('over', sim.movesLeft <= 3);
    const total = sim.defs.length;
    // What is actually left to do: face-down cards plus everything stranded on
    // the waste, which has been seen but not sorted into a column.
    const left = remaining(sim);
    this.turned.textContent = String(left);
    (this.bar.firstElementChild as HTMLElement).style.width = `${((total - left) / total) * 100}%`;
    this.movesBox.classList.toggle('low', sim.movesLeft <= 5);
    this.movesBox.classList.toggle('critical', sim.movesLeft <= 2);
    this.undoBtn.querySelector('.act-count')!.textContent =
      level.undosLeft > 20 ? '∞' : String(level.undosLeft);
    this.undoBtn.disabled = !opts.canUndo || level.undosLeft <= 0;
    // Cheapest reading is 1 move; below that the Oracle has nothing to sell.
    this.hintBtn.querySelector('.act-count')!.textContent = '−1';
    this.hintBtn.disabled = sim.movesLeft < 1;
    this.peekBtn.querySelector('.act-count')!.textContent = String(level.peeksLeft);
    this.peekBtn.disabled = level.peeksLeft <= 0;
  }

  setTime(seconds: number): void {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.timer.classList.toggle('urgent', seconds <= 20);
  }

  setHintEnabled(on: boolean): void {
    this.hintBtn.classList.toggle('hidden', !on);
  }

  flashMoves(delta: number): void {
    const cls = delta > 0 ? 'gain' : 'spend';
    this.movesBox.classList.remove('gain', 'spend');
    void this.movesBox.offsetHeight;
    this.movesBox.classList.add(cls);
    setTimeout(() => this.movesBox.classList.remove(cls), 500);
  }
}

