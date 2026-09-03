/** The in-level chrome: counters, rule strip and the action bar. */
import type { Level } from '../game/deal.ts';
import { MODIFIERS } from '../game/content.ts';
import { remaining, type Sim } from '../game/sim.ts';
import { el } from './dom.ts';
import { modChip, sheetPanel } from './shell.ts';

export interface HudActions {
  menu(): void;
  undo(): void;
  hint(): void;
  peek(): void;
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
      el('footer', { class: 'actions' }, [this.undoBtn, this.hintBtn, this.peekBtn]),
    ]);
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
    // A board priced past what a standard deck could afford says so, up front.
    // The whole point of withdrawing that guarantee is the moment where the
    // player realises their build is what has to close the gap — which only
    // lands if they are told before the board is lost, not after.
    if (level.needsBuild) {
      const n = level.plainPar - level.budget;
      const chip = el('span', { class: 'chip needs-build' }, [`⚠ ${n} beyond a standard deck`]);
      chip.addEventListener('click', () =>
        sheetPanel({
          title: 'Beyond a standard deck',
          body: el('p', { class: 'prose' }, [
            `This board costs ${level.plainPar} moves to clear with no enchantments, and you have ${level.budget}. ` +
            `Your deck has to make up the difference — every move your cards save you is a move you needed.`,
          ]),
        }),
      );
      this.strip.prepend(chip);
    }
    this.strip.classList.toggle('empty', level.modifiers.length === 0 && !level.needsBuild);
    this.peekBtn.classList.toggle('hidden', level.peeksLeft === 0);
    this.timer.classList.toggle('hidden', level.timeLimit === 0);
  }

  update(level: Level, sim: Sim, opts: { canUndo: boolean }): void {
    this.moves.textContent = String(Math.max(0, sim.movesLeft));
    // Par is the length of the line the solver actually found on this board.
    // Showing it turns a comfortable clear into a score rather than a shrug.
    // Live surplus: how far ahead of the line that clears this board you are,
    // which is the number that actually tells you what you can afford to spend.
    // What you would carry into the next level if you finished from here on
    // the solver's line. Naming it "carry" rather than "spare" is the whole
    // lesson: these moves are not use-them-or-lose-them any more.
    const carry = sim.movesLeft - Math.max(0, level.par - sim.movesUsed);
    this.par.textContent = carry >= 0 ? `${carry} carry · par ${level.par}` : `${-carry} behind par ${level.par}`;
    this.par.classList.toggle('over', carry <= 2);
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

