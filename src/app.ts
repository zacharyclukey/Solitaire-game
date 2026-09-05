/**
 * Application controller: owns the run, drives the state machine between
 * screens, and mediates between the rules engine and the views.
 */
import { sfx, unlock } from './audio.ts';
import { CHARMS, CONSUMABLES, ENCHANTS, MODIFIERS, REPRIEVE_MOVES, type ConsumableId } from './game/content.ts';
import { dealLevelAsync, warmUp } from './game/dealAsync.ts';
import type { Level, LevelSpec } from './game/deal.ts';
import { Rng, randomSeed, seedFromString, seedToCode } from './game/rng.ts';
import {
  addCard,
  addCharm,
  computeScore,
  curseRandomCard,
  enchantCard,
  gainGold,
  bankStage,
  clearSunken,
  makeQueue,
  makeRewards,
  makeShop,
  newRun,
  nextWarden,
  removeCard,
  rewardCount,
  SHOP_EVERY,
  stageSpec,
  takeSkip,
  uncurseCard,
  type Reward,
  type RunState,
  type ShopItem,
} from './game/run.ts';
import { analyse, type PostMortem } from './game/postmortem.ts';
import { findRescue } from './game/rescue.ts';
import { ask, questionById, type Answer } from './game/oracle.ts';
import { resolveUndo } from './game/resources.ts';
import { applyMove, cloneSim, dig, isWon, legalMoves, pry, sameMove, settle, waste, type Sim, type SimEvent } from './game/sim.ts';
import { findSolution } from './game/solver.ts';
import {
  emptyStreak,
  emptyTally,
  newlyEarned,
  type AchieveCtx,
  type LevelTally,
  type RunStreak,
} from './game/achievements.ts';
import {
  buildTutorialLevel,
  coachMove,
  COACH_STEPS,
  emptyTally as emptyCoachTally,
  stepFor,
  type CoachTally,
} from './game/tutorial.ts';
import type { Move } from './game/types.ts';
import { haptic } from './haptics.ts';
import { hideSplash, initNative } from './native.ts';
import * as store from './storage.ts';
import { BoardView } from './ui/board.ts';
import { playVictory } from './ui/victory.ts';
import { describeCard } from './ui/cardview.ts';
import { el } from './ui/dom.ts';
import { Hud } from './ui/hud.ts';
import {
  applySettingsToDocument,
  openDeck,
  openHelp,
  openOracle,
  openSettings,
  openCodex,
  renderQueue,
  renderOver,
  renderReward,
  renderShop,
  renderTitle,
  type Epitaph,
  type MenuCtx,
} from './ui/menus.ts';
import {
  activeScreen,
  closeTopOverlay,
  menuSheet,
  modal,
  pickCard,
  registerScreens,
  screen,
  sheetPanel,
  show,
  toast,
} from './ui/shell.ts';

interface Snapshot {
  sim: Sim;
  /** Off-the-books spend when this snapshot was taken, so an undo can refund
   *  the move it reverses without also refunding hints taken since. */
  offBook: number;
}

export class App {
  private run: RunState | null = null;
  private level: Level | null = null;
  private history: Snapshot[] = [];
  private board!: BoardView;
  private hud!: Hud;
  private timerId = 0;
  private timeLeft = 0;
  private dealing = false;
  private tutorial: { tally: CoachTally; step: number } | null = null;
  private tally: LevelTally = emptyTally();
  /** Pristine copy of the deal, kept so a loss can be analysed afterwards. */
  private initialSim: Sim | null = null;
  /**
   * Moves spent on things that are not moves in the replayed list — hints, and
   * undos under Glasswork. The post-mortem has to start from the budget the
   * player actually had, or it will report a line as reachable that never was.
   */
  private offBookSpend = 0;
  private streak: RunStreak = emptyStreak();
  private ctx: MenuCtx;

  constructor(root: HTMLElement) {
    registerScreens(root);
    applySettingsToDocument();

    this.ctx = {
      newRun: () => void this.startRun(randomSeed(), false),
      continueRun: () => void this.resume(),
      daily: () => void this.startDaily(),
      tutorial: () => void this.startTutorial(),
      playStage: () => void this.enterNode(stageSpec(this.run!, this.run!.stage + 1)),
      skipStage: () => void this.skipStage(),
      takeReward: (r) => void this.takeReward(r),
      buy: (item, i) => this.buy(item, i),
      leaveShop: () => this.afterShop(),
      toTitle: () => this.toTitle(),
      abandon: () => void this.abandon(),
    };

    this.hud = new Hud({
      menu: () => this.openPlayMenu(),
      undo: () => this.undo(),
      hint: () => this.openOracle(),
      peek: () => this.peek(),
      use: (id) => void this.useItem(id),
    });
    screen('play').append(this.hud.root);

    this.board = new BoardView(this.hud.boardHost, {
      onMove: (m) => void this.doMove(m),
      onIllegal: () => {
        sfx.deny();
        haptic('warning');
      },
      onLift: () => {
        sfx.lift();
        haptic('select');
      },
      onInspect: (def) => {
        haptic('light');
        sheetPanel({ title: 'Card', body: el('p', { class: 'prose pre' }, [describeCard(def)]) });
      },
    });

    window.addEventListener('resize', () => this.relayout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.relayout(), 220));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });
    document.addEventListener('pointerdown', () => unlock(), { once: true });

    if (new URLSearchParams(location.search).has('qa')) {
      // QA bridge: lets the screenshot/integration harness drive a real run.
      (window as unknown as Record<string, unknown>).facedown = this;
    }

    void initNative({ onBack: () => this.handleBack() });
    warmUp();
    this.toTitle();
    hideSplash();
    if (!store.stats().seenHelp) {
      store.stats().seenHelp = true;
      store.save();
      void this.offerTutorial();
    }
  }

  /** Android hardware back: unwind panels, then pause, then let the OS have it. */
  private handleBack(): boolean {
    if (closeTopOverlay()) return true;
    const s = activeScreen();
    if (s === 'play') {
      this.openPlayMenu();
      return true;
    }
    if (s === 'over') {
      this.toTitle();
      return true;
    }
    return s !== 'title';
  }

  private async offerTutorial(): Promise<void> {
    const choice = await modal({
      title: 'First time?',
      body: 'Two minutes on a small board and you will know the whole game.',
      actions: [
        { label: 'Learn to play', kind: 'primary', value: 'go' },
        { label: 'I know solitaire', kind: 'ghost', value: 'skip' },
      ],
    });
    if (choice === 'go') void this.startTutorial();
    else if (choice === 'skip') openHelp();
  }

  /* --------------------------------------------------------------- routing */

  private toTitle(): void {
    this.stopTimer();
    this.tutorial = null;
    this.hud.setCoach(null);
    renderTitle(this.ctx, !!store.getRun());
    show('title');
  }

  private async startRun(seed: number, daily: boolean): Promise<void> {
    this.tutorial = null;
    this.hud.setCoach(null);
    this.hud.setHintEnabled(store.settings().showHint);
    this.streak = emptyStreak();
    this.tally = emptyTally();
    const run = newRun(seed, daily);
    store.stats().runs += 1;
    this.run = run;
    store.setRun(run);
    this.showQueue();
  }

  private async startDaily(): Promise<void> {
    const key = store.todayKey();
    const existing = store.getRun();
    if (existing?.daily && existing.seed === seedFromString(key)) {
      this.run = existing;
      this.resumePhase();
      return;
    }
    if (existing) {
      const go = await modal({
        title: 'Abandon current run?',
        body: 'Starting the daily deal will discard the run in progress.',
        actions: [
          { label: 'Cancel', kind: 'ghost', value: false },
          { label: 'Start daily', kind: 'danger', value: true },
        ],
      });
      if (!go) return;
    }
    await this.startRun(seedFromString(key), true);
    toast(`Daily deal — ${key}`);
  }

  private async resume(): Promise<void> {
    const saved = store.getRun();
    if (!saved) {
      this.toTitle();
      return;
    }
    this.run = saved;
    this.resumePhase();
  }

  private resumePhase(): void {
    const run = this.run!;
    switch (run.phase) {
      case 'level':
        if (run.current) void this.enterNode(run.current, run.levelMoves);
        else this.showQueue();
        break;
      case 'reward':
        renderReward(this.ctx, run, run.rewards, []);
        show('reward');
        break;
      case 'shop':
        renderShop(this.ctx, run);
        show('shop');
        break;
      case 'over':
        store.setRun(null);
        this.toTitle();
        break;
      default:
        this.showQueue();
    }
  }

  private showQueue(): void {
    const run = this.run!;
    run.phase = 'queue';
    run.current = null;
    run.levelMoves = [];
    this.persist();
    renderQueue(this.ctx, run, makeQueue(run), nextWarden(run));
    show('fork');
  }

  /**
   * Walking past a board. The buff lands and the stage counter moves, so the
   * next board is harder — but nothing is banked, and the score does not move.
   */
  private async skipStage(): Promise<void> {
    const run = this.run!;
    const spec = stageSpec(run, run.stage + 1);
    const go = await modal({
      title: 'Walk past it?',
      body:
        `Stage ${spec.stage} does not go away — it sinks, and surfaces again a few stages down with less room to afford it. ` +
        'You bank nothing now, and it will not count towards your score when it comes back around either. ' +
        'Clear a board in the meantime and the market will set something aside for you; fall first and it will not.',
      actions: [
        { label: 'Stay and play it', kind: 'ghost', value: false },
        { label: 'Walk past it', kind: 'danger', value: true },
      ],
    });
    if (!go) return;
    takeSkip(run);
    sfx.tap();
    haptic('light');
    this.afterStage();
  }

  /* ----------------------------------------------------------------- level */

  private async enterNode(spec: LevelSpec, replay?: RunState['levelMoves']): Promise<void> {
    if (this.dealing) return;
    const run = this.run!;
    this.dealing = true;
    run.phase = 'level';
    run.current = spec;
    if (!replay) run.levelMoves = [];
    this.persist();

    this.hud.setDealing(true);
    show('play');
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const level = await dealLevelAsync({
      deck: run.deck,
      charms: run.charms,
      spec,
      bonusMoves: run.bonusMoves,
      bonusCells: run.bonusCells,
      bank: run.bank,
    });
    rehydrate(level);

    // Bankruptcy. The generator eased this board as far as it goes and the
    // purse still will not cover it, so the run ends here rather than on a
    // board that was lost before the first card moved.
    if (!level.affordable) {
      this.dealing = false;
      this.hud.setDealing(false);
      // A brand-new way to lose deserves an explanation the first time it
      // happens, not just a word on the results screen.
      await modal({
        title: 'Bankrupt',
        body: `The shallowest board this deep still costs ${level.par} moves, and you can raise ${level.budget}. There was no board here you could have afforded.`,
        actions: [{ label: 'End the run', kind: 'primary' }],
        dismissable: false,
      });
      await this.onLose('Bankrupt');
      return;
    }

    this.level = level;
    this.initialSim = cloneSim(level.sim);
    this.history = [];
    this.tally = emptyTally();
    this.offBookSpend = 0;
    this.hud.mount(level);
    this.hud.setItems(run.consumables);
    this.hud.setHintEnabled(store.settings().showHint);
    this.board.mount(level);
    this.hud.setDealing(false);

    if (replay?.length) {
      // Rebuild the undo stack as we replay, so a resumed level plays exactly
      // like one that was never interrupted.
      for (const m of replay) {
        this.history.push({ sim: cloneSim(level.sim), offBook: this.offBookSpend });
        applyMove(level.sim, m as Move, null);
      }
      this.board.layout(false);
    } else if (!store.settings().reduceMotion) {
      this.board.busy = true;
      sfx.deal();
      await this.board.dealIn();
      this.board.busy = false;
    }

    this.refresh();
    this.startTimer(level);
    this.dealing = false;
  }

  private relayout(): void {
    if (!this.level) return;
    this.board.measure();
    this.board.layout(false);
  }

  private refresh(): void {
    const level = this.level!;
    this.hud.update(level, level.sim, { canUndo: this.history.length > 0 });
  }

  private async doMove(mv: Move): Promise<void> {
    const level = this.level;
    if (!level || this.board.busy) return;
    const sim = level.sim;
    const run = this.run;

    let cost = mv.cost;
    if (level.freeFirstMove && sim.movesUsed === 0) cost = 0;
    const applied: Move = { ...mv, cost };
    const toWasOccupied = applied.kind === 'm' && sim.cols[applied.to].length > 0;

    this.history.push({ sim: cloneSim(sim), offBook: this.offBookSpend });
    if (this.history.length > 400) this.history.shift();

    const events: SimEvent[] = [];
    const before = sim.movesLeft;
    applyMove(sim, applied, events);
    if (run) {
      run.levelMoves.push(applied);
      run.stats.movesSpent += Math.max(0, before - sim.movesLeft);
    }

    this.board.clearSelection();
    this.board.clearHint();
    if (!this.tutorial) this.board.setCoachMove(null); // the Oracle's mark is spent
    if (applied.kind === 'b') {
      const burned = events.find((e) => e.t === 'burn');
      if (burned && burned.t === 'burn') this.board.flashBurn(burned.id);
      sfx.burn();
    } else if (applied.kind === 'f' || applied.kind === 'd') {
      sfx.flip();
    } else {
      sfx.place();
    }
    haptic('light');

    this.board.layout(true);
    const flips = events.filter((e) => e.t === 'flip').map((e) => (e.t === 'flip' ? e.id : -1));
    this.tally.maxFlips = Math.max(this.tally.maxFlips, flips.length);
    if (flips.length) {
      this.board.pulseFlip(flips);
      setTimeout(() => sfx.flip(), 90);
      haptic('medium');
    }
    for (const e of events) {
      // Every one of these names the enchantment that caused it. An unattributed
      // "+2 moves" taught the player nothing about the card they chose.
      if (e.t === 'gold') {
        sfx.gold();
        toast(e.src ? `${ENCHANTS[e.src].name} · +${e.n} gold` : `+${e.n} gold`, 'good');
      }
      if (e.t === 'moves') {
        sfx.boon();
        this.hud.flashMoves(e.n);
        this.tally.enchantMoves += e.n;
        toast(e.src ? `${ENCHANTS[e.src].name} · +${e.n} moves` : `+${e.n} moves`, 'good');
      }
      if (e.t === 'cascade') {
        this.tally.enchantFlips += e.n;
        toast(`${ENCHANTS[e.src].name} · turned ${e.n} more`, 'good');
      }
      if (e.t === 'discount') {
        this.tally.enchantMoves += e.saved;
        toast(
          e.src === 'free'
            ? `${ENCHANTS[e.src].name} · free move`
            : `${ENCHANTS[e.src].name} · ${e.saved} move back`,
          'good',
        );
      }
    }
    if (sim.movesLeft < before) this.hud.flashMoves(-1);

    this.refresh();
    this.persist();

    if (this.tutorial) {
      if (isWon(sim)) {
        await this.finishTutorial();
        return;
      }
      this.advanceTutorial(applied, events, toWasOccupied);
      return;
    }

    if (isWon(sim)) {
      await this.onWin();
      return;
    }
    const stuck = sim.movesLeft <= 0 || legalMoves(sim, true).length === 0;
    if (stuck) await this.onStuck();
  }

  private undo(): void {
    const level = this.level;
    if (!level || !this.history.length || level.undosLeft <= 0) return;
    const snap = this.history.pop()!;
    this.tally.undos += 1;
    restoreSim(level.sim, snap.sim);
    // Glasswork's surcharge goes on the books before the sums are done, so it
    // is charged like any other off-the-books spend and cannot be undone away.
    if (level.undoCostsMove) this.offBookSpend += 1;
    const after = resolveUndo({
      restoredMovesLeft: level.sim.movesLeft,
      offBookAtSnapshot: snap.offBook,
      offBookNow: this.offBookSpend,
      undosLeft: level.undosLeft,
    });
    level.sim.movesLeft = after.movesLeft;
    level.undosLeft = after.undosLeft;
    this.run?.levelMoves.pop();
    this.board.clearSelection();
    this.board.clearHint();
    this.board.layout(true);
    this.refresh();
    this.persist();
    if (this.tutorial) this.paintCoach();
    sfx.tap();
    haptic('light');
  }

  /**
   * The Oracle. Questions are paid for in Insight rather than moves, so asking
   * for help never eats the margin you need to finish — and the readings are
   * earned by clearing boards under par, which makes foresight something you
   * play your way into.
   */
  private openOracle(): void {
    const level = this.level;
    if (!level || this.board.busy) return;
    openOracle({
      insight: () => Math.max(0, level.sim.movesLeft),
      undosLeft: () => level.undosLeft,
      ask: async (id) => {
        const q = questionById(id);
        // Paid out of the same allowance the board is played with, and logged
        // off the books so the post-mortem still knows what you really had.
        level.sim.movesLeft -= q.cost;
        this.offBookSpend += q.cost;
        if (this.run) this.run.stats.movesSpent += q.cost;
        this.hud.flashMoves(-1);
        this.tally.hints += 1;
        this.refresh();
        this.persist();
        const from = this.initialSim ? cloneSim(this.initialSim) : null;
        if (from) from.movesLeft -= this.offBookSpend;
        // Off the main thread would be nicer, but a reading is a deliberate
        // pause the player asked for and the sheet says it is thinking.
        const answer = await new Promise<Answer>((resolve) =>
          setTimeout(() => resolve(ask(id, { sim: level.sim, start: from, played: this.run?.levelMoves as Move[] ?? [], budgetMs: 420 })), 30),
        );
        // Persist it rather than using the timed hint flash: the sheet is
        // covering the board while you read, and a suggestion that expires
        // before you can look at it is no suggestion at all.
        if (answer.move) this.board.setCoachMove(answer.move);
        sfx.boon();
        return answer;
      },
      rewind: (moves) => {
        closeTopOverlay();
        for (let i = 0; i < moves; i++) this.undo();
        toast(`Stepped back ${moves} ${moves === 1 ? 'move' : 'moves'}`, 'good');
      },
    });
  }

  private peek(): void {
    const level = this.level;
    if (!level || level.peeksLeft <= 0) return;
    level.peeksLeft -= 1;
    this.board.setPeek(true);
    sfx.tap();
    setTimeout(() => this.board.setPeek(false), 3000);
    this.refresh();
  }

  /* ------------------------------------------------------------ outcomes */

  /**
   * Spend an escape.
   *
   * These cost no moves on purpose. They are bought with gold, and a board that
   * has gone dead is already punishing the player — charging them again to get
   * out of it would turn the rescue into another way to lose. They are also
   * undoable like any other action, so a mis-tap is not fatal.
   */
  private async useItem(id: ConsumableId): Promise<void> {
    const run = this.run!;
    const level = this.level;
    if (!level || this.board.busy) return;
    if ((run.consumables[id] ?? 0) <= 0) return;

    const sim = level.sim;
    this.history.push({ sim: cloneSim(sim), offBook: this.offBookSpend });
    const events: SimEvent[] = [];
    let did = false;
    if (id === 'reprieve') {
      sim.movesLeft += REPRIEVE_MOVES;
      events.push({ t: 'moves', n: REPRIEVE_MOVES });
      did = true;
    } else if (id === 'pry') {
      did = pry(sim, events);
    } else if (id === 'dig') {
      did = dig(sim, events);
    }

    if (!did) {
      // Nothing buried to work on. Hand the charge back rather than spending it
      // on nothing, and say why.
      this.history.pop();
      toast('Nothing buried to work on', 'bad');
      return;
    }

    run.consumables[id] = (run.consumables[id] ?? 0) - 1;
    this.hud.setItems(run.consumables);
    toast(`${CONSUMABLES[id].name} used`, 'good');
    sfx.boon();
    haptic('medium');
    // Same tail as an ordinary move: animate, count the reveals, then re-check
    // whether the board is now won or dead.
    this.board.layout(true);
    const flips = events.filter((e) => e.t === 'flip').map((e) => (e.t === 'flip' ? e.id : -1));
    if (flips.length) this.board.pulseFlip(flips);
    const burned = events.find((e) => e.t === 'burn');
    if (burned && burned.t === 'burn') this.board.flashBurn(burned.id);
    for (const e of events) if (e.t === 'moves') this.hud.flashMoves(e.n);
    this.refresh();
    this.persist();
    if (isWon(sim)) {
      await this.onWin();
      return;
    }
    if (sim.movesLeft <= 0 || legalMoves(sim, true).length === 0) await this.onStuck();
  }

  private async onStuck(): Promise<void> {
    const level = this.level!;
    const canUndo = level.undosLeft > 0 && this.history.length > 0;
    const outOfMoves = level.sim.movesLeft <= 0;
    if (canUndo) {
      const margin = this.marginFromHere(level.sim);
      const choice = await modal({
        title: outOfMoves ? 'Out of moves' : 'No legal moves',
        body: margin ?? (outOfMoves
          ? 'Step back and try a different line, or let the run end here.'
          : 'Nothing can be played from this position.'),
        dismissable: false,
        actions: [
          { label: `Undo (${level.undosLeft})`, kind: 'primary', value: 'undo' },
          { label: 'End the run', kind: 'danger', value: 'end' },
        ],
      });
      if (choice === 'undo') {
        this.undo();
        return;
      }
    }
    await this.onLose(outOfMoves ? 'Out of moves' : 'Stuck');
  }

  /**
   * How far the current position is from a win, ignoring the allowance. Shown
   * at the moment of failure, because "two moves short" is the difference
   * between a wall and a near miss you want to try again.
   */
  private marginFromHere(sim: Sim): string | null {
    const probe = cloneSim(sim);
    probe.movesLeft = Number.MAX_SAFE_INTEGER / 4;
    const sol = findSolution(probe, 320);
    if (!sol) return null;
    const short = sol.cost - Math.max(0, sim.movesLeft);
    if (short <= 0) return 'There is still a line here — you have the moves for it.';
    return `A win is still ${short} ${short === 1 ? 'move' : 'moves'} out of reach from this position. Step back and try a different line, or let the run end here.`;
  }

  /** Turns the solver's account of the run into something worth reading. */
  /**
   * The enchantments that measurably turn a lost board around.
   *
   * Named from the audit in `scripts/enchaudit.ts` rather than from flavour.
   * Re-measured over 43 lost boards, five times the earlier sample: Anchor 53%,
   * Ember 51%, Twin 40%, Chameleon 30%. The bigger sample demoted Chameleon out
   * of the top three, which the 14-board run had it tied for. An older line
   * offered Beacon, which saves none of them — those losses are structural,
   * not two moves short.
   */
  private epitaphFor(pm: PostMortem): Epitaph {
    const lines: string[] = [];
    const level = this.level;
    const consulted = this.tally.hints + this.tally.undos;

    if (pm.lastWinnableAfter !== null && pm.movesAfterLoss !== null && pm.movesAfterLoss > 0) {
      lines.push(`Winnable through move ${pm.lastWinnableAfter} of ${pm.movesPlayed}.`);
    }

    if (pm.shortBy !== null && pm.shortBy > 0) {
      lines.push(`${pm.shortBy} ${pm.shortBy === 1 ? 'move' : 'moves'} short at the end.`);

      // In order of how much the player can actually do about it. Spending is
      // the sharpest thing we can name, because it is theirs and it is exact.
      if (this.offBookSpend >= pm.shortBy && consulted > 0) {
        lines.push(
          `Readings and undos cost you ${this.offBookSpend} — more than you were short by.`,
        );
      } else if (level && level.bank < pm.shortBy) {
        lines.push(
          `You arrived with ${level.bank} banked. This board was lost on the ones before it.`,
        );
      } else {
        lines.push('Boards like this one turn on an Anchor, an Ember or a Twin — insurance, and it is paid for on every board that was going fine.');
      }
    } else if (pm.movesAfterLoss !== null && pm.movesAfterLoss > 3) {
      lines.push('Loaded Dice would have let you take those moves back.');
    }
    return { verdict: pm.verdict, lines };
  }

  private async onWin(): Promise<void> {
    const level = this.level!;
    const run = this.run!;
    this.stopTimer();
    this.board.busy = true;
    sfx.win();
    haptic('success');

    bankStage(run);
    clearSunken(run, level.spec.stage);
    // Everything left on the table carries. This is the whole economy.
    run.bank = Math.max(0, level.sim.movesLeft);
    run.stats.levelsCleared += 1;
    run.stats.cardsTurned += level.sim.revealed;
    this.tally.spare = Math.max(0, level.sim.movesLeft);
    this.tally.wasteLeft = waste(level.sim).length;
    // Scored against the STANDARD par — the line on this board with no
    // enchantments — so the number rewards the build as well as the play, and
    // means the same thing from one level to the next.
    this.tally.underPar = level.plainPar - level.sim.movesUsed;
    this.tally.secondsLeft = level.timeLimit ? Math.max(0, this.timeLeft) : 0;
    this.streak.cleanLevels = this.tally.hints === 0 ? this.streak.cleanLevels + 1 : 0;
    this.streak.patientLevels = this.tally.undos === 0 ? this.streak.patientLevels + 1 : 0;

    const spare = Math.max(0, level.sim.movesLeft);
    // Beating the solver's own line is the real skill test, so it pays.
    const underPar = level.plainPar - level.sim.movesUsed;
    if (underPar > 0) {
      run.bonusMoves += 1;
      toast('+1 move on every level from here', 'good');
    }
    // Gold stays priced off the enchanted line. Scoring moved to standard par
    // and paying on it too would have quietly inflated every purse in the game
    // by the size of the player's build, which is a balance change nobody
    // measured.
    let gold = level.baseGold + level.sim.gold + Math.max(0, level.par - level.sim.movesUsed) * 3;
    if (run.charms.includes('thrift')) gold += spare * 2;
    const gained = gainGold(run, gold);
    run.score = computeScore(run);

    const st = store.stats();
    st.levelsCleared += 1;
    st.cardsTurned += level.sim.revealed;
    st.movesSpent += level.sim.movesUsed;
    if (run.depth > st.bestDepth) st.bestDepth = run.depth;
    if (run.score > st.bestScore) st.bestScore = run.score;
    if (run.daily) {
      st.dailyDate = store.todayKey();
      st.dailyDepth = Math.max(st.dailyDepth, run.depth);
    }

    this.award();

    await this.playVictorySort();
    this.board.busy = false;

    const rewards = makeRewards(run, level.spec.kind, rewardCount(run, level.spec.kind));
    run.rewards = rewards;
    run.phase = 'reward';
    run.levelMoves = [];
    run.current = null;
    this.persist();

    // What the build did, in the currency the run is played in. Without this
    // the enchantments are a row of glyphs and the player never finds out
    // whether choosing them mattered.
    const built: string[] = [];
    if (this.tally.enchantMoves > 0) {
      built.push(`${this.tally.enchantMoves} ${this.tally.enchantMoves === 1 ? 'move' : 'moves'} back`);
    }
    if (this.tally.enchantFlips > 0) {
      built.push(`${this.tally.enchantFlips} extra ${this.tally.enchantFlips === 1 ? 'card' : 'cards'} turned`);
    }

    renderReward(this.ctx, run, rewards, [
      `+${gained} gold`,
      underPar > 0
        ? `${underPar} under standard par`
        : underPar === 0
          ? 'exactly standard par'
          : `${-underPar} over standard par`,
      `${spare} ${spare === 1 ? 'move' : 'moves'} carried`,
      ...(built.length ? [`Your cards: ${built.join(' · ')}`] : []),
    ]);
    show('reward');
  }

  private async onLose(reason: string): Promise<void> {
    const run = this.run!;
    this.stopTimer();
    this.board.busy = true;

    if (run.secondWind) {
      run.secondWind = false;
      sfx.boon();
      await modal({
        title: 'Second Wind',
        body: 'Your charm burns out and the level is dealt again.',
        actions: [{ label: 'Deal again', kind: 'primary' }],
        dismissable: false,
      });
      const spec = run.current!;
      this.board.busy = false;
      await this.enterNode({ ...spec, seed: (spec.seed ^ 0x9e3779b9) >>> 0 });
      return;
    }

    sfx.lose();
    haptic('error');
    const st = store.stats();
    const isBest = run.depth >= st.bestDepth && run.depth > 0;
    run.score = computeScore(run);
    if (run.score > st.bestScore) st.bestScore = run.score;
    run.phase = 'over';
    this.award();
    store.pushRunRecord({
      depth: run.depth,
      score: run.score,
      seed: run.seed,
      reason,
      daily: run.daily,
      at: Date.now(),
    });
    store.setRun(null);
    store.save();

    const actions = {
      again: () => void this.startRun(randomSeed(), false),
      replay: () => void this.startRun(run.seed, false),
      title: () => this.toTitle(),
    };
    renderOver(run, reason, isBest, actions);
    show('over');
    this.board.busy = false;

    // The analysis takes a few hundred milliseconds, so the screen goes up
    // first and the verdict arrives into it rather than delaying it.
    const start = this.initialSim;
    const played = run.levelMoves as Move[];
    if (start && played.length) {
      const from = cloneSim(start);
      from.movesLeft -= this.offBookSpend;
      setTimeout(() => {
        const pm = analyse(from, played, { budgetMs: 900 });
        if (activeScreen() === 'over') renderOver(run, reason, isBest, actions, this.epitaphFor(pm));
        // Then the more useful question, asked second because it costs more:
        // not "where did it slip" but "what were you missing". A loss the
        // player cannot see the answer to reads as bad luck however fair it was.
        setTimeout(() => {
          const r = findRescue(from, start.movesLeft, { budgetMs: 900 });
          if (!r || activeScreen() !== 'over') return;
          const ep = this.epitaphFor(pm);
          ep.lines.push(`${ENCHANTS[r.ench].name} on the ${r.card} wins this board.`);
          renderOver(run, reason, isBest, actions, ep);
        }, 80);
      }, 60);
    }
  }

  private async abandon(): Promise<void> {
    const go = await modal({
      title: 'Abandon this run?',
      body: 'Your progress is scored as it stands.',
      actions: [
        { label: 'Keep playing', kind: 'ghost', value: false },
        { label: 'Abandon', kind: 'danger', value: true },
      ],
    });
    if (!go) return;
    await this.onLose('Abandoned');
  }

  /* ------------------------------------------------------------- rewards */

  private async takeReward(r: Reward): Promise<void> {
    if (!(await this.applyReward(r))) return;
    sfx.boon();
    this.run!.rewards = [];
    this.afterStage();
  }

  /** Applies one reward. Returns false if the player backed out of a picker. */
  private async applyReward(r: Reward): Promise<boolean> {
    const run = this.run!;
    switch (r.t) {
      case 'gold':
        toast(`+${gainGold(run, r.n)} gold`, 'good');
        break;
      case 'moves':
        run.bonusMoves += r.n;
        toast(`+${r.n} moves on every level`, 'good');
        break;
      case 'cell':
        run.bonusCells += 1;
        toast('Draw pile widened', 'good');
        break;
      case 'charm':
        addCharm(run, r.id);
        toast(`${CHARMS[r.id].name} acquired`, 'good');
        break;
      case 'add':
        addCard(run, r.card);
        toast('Card added to your deck', 'good');
        break;
      case 'ench': {
        const uid = await pickCard(run.deck, {
          title: 'Enchant which card?',
          hint: 'Cards that already carry an enchantment cannot take another.',
          allow: (c) => !c.ench,
        });
        if (uid === null) return false;
        enchantCard(run, uid, r.ench);
        break;
      }
      case 'remove': {
        const uid = await pickCard(run.deck, { title: 'Remove which card?', hint: 'A smaller deck is a smaller board.' });
        if (uid === null) return false;
        removeCard(run, uid);
        break;
      }
      case 'uncurse': {
        const uid = await pickCard(run.deck, { title: 'Lift which curse?', allow: (c) => !!c.curse });
        if (uid === null) return false;
        uncurseCard(run, uid);
        break;
      }
      case 'bargain': {
        toast(`+${gainGold(run, r.n)} gold`, 'good');
        const cursed = curseRandomCard(run, new Rng((run.seed ^ (run.stage * 7919)) >>> 0));
        if (cursed) toast('A card in your deck was cursed', 'bad');
        break;
      }
    }
    return true;
  }

  /** Where the run goes once a stage has been played or walked past. */
  private afterStage(): void {
    const run = this.run!;
    if (run.stage % SHOP_EVERY === 0) {
      run.shop = makeShop(run);
      run.marketCredit = 0; // the market has honoured it; it is not owed twice
      run.phase = 'shop';
      this.persist();
      renderShop(this.ctx, run);
      show('shop');
      return;
    }
    this.showQueue();
  }

  private buy(item: ShopItem, index: number): void {
    const run = this.run!;
    if (item.sold || run.gold < item.price) return;
    const finish = (): void => {
      run.gold -= item.price;
      run.shop[index] = { ...item, sold: true };
      sfx.gold();
      renderShop(this.ctx, run);
      this.persist();
    };
    switch (item.t) {
      case 'charm':
        addCharm(run, item.id);
        finish();
        break;
      case 'add':
        addCard(run, item.card);
        finish();
        break;
      case 'moves':
        run.bonusMoves += item.n;
        finish();
        break;
      case 'item':
        run.consumables[item.id] = (run.consumables[item.id] ?? 0) + 1;
        toast(`${CONSUMABLES[item.id].name} in hand`, 'good');
        finish();
        break;
      case 'cell':
        run.bonusCells += 1;
        finish();
        break;
      case 'ench':
        void pickCard(run.deck, { title: 'Enchant which card?', allow: (c) => !c.ench }).then((uid) => {
          if (uid === null) return;
          enchantCard(run, uid, item.ench);
          finish();
        });
        break;
      case 'remove':
        void pickCard(run.deck, { title: 'Remove which card?' }).then((uid) => {
          if (uid === null) return;
          removeCard(run, uid);
          finish();
        });
        break;
      case 'uncurse':
        void pickCard(run.deck, { title: 'Lift which curse?', allow: (c) => !!c.curse }).then((uid) => {
          if (uid === null) return;
          uncurseCard(run, uid);
          finish();
        });
        break;
    }
  }

  private afterShop(): void {
    this.showQueue();
  }

  /* ------------------------------------------------------------ tutorial */

  private async startTutorial(): Promise<void> {
    this.stopTimer();
    this.run = null;
    this.tutorial = { tally: emptyCoachTally(), step: 0 };
    const level = buildTutorialLevel();
    this.level = level;
    this.initialSim = cloneSim(level.sim);
    this.offBookSpend = 0;
    this.history = [];
    this.tally = emptyTally();

    // The board must be on screen before it is measured, or every card is
    // laid out against a zero-width container.
    this.hud.setDealing(false);
    show('play');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    this.hud.mount(level);
    this.hud.setHintEnabled(false);
    this.board.mount(level);

    if (!store.settings().reduceMotion) {
      this.board.busy = true;
      sfx.deal();
      await this.board.dealIn();
      this.board.busy = false;
    }
    this.refresh();
    this.paintCoach();
  }

  private paintCoach(): void {
    const t = this.tutorial;
    const level = this.level;
    if (!t || !level) return;
    const step = COACH_STEPS[t.step];
    this.hud.setCoach(step.text);
    this.board.layout(true); // the banner changed how much room the tableau has
    this.board.setCoachMove(step.coach ? coachMove(level.sim, t.step) : null);
  }

  /** Folds one move into the tutorial's tally and advances the lesson. */
  private advanceTutorial(mv: Move, events: SimEvent[], toWasOccupied: boolean): void {
    const t = this.tutorial;
    const level = this.level;
    if (!t || !level) return;
    const sim = level.sim;
    if (mv.kind === 'd') t.tally.drew += 1;
    if (mv.kind === 'm') {
      if (toWasOccupied) t.tally.stacked += 1;
      const moved = events.find((e) => e.t === 'move');
      if (moved && moved.t === 'move' && moved.ids.length >= 2) t.tally.grouped += 1;
    }
    for (let c = 0; c < sim.tableau; c++) if (sim.cols[c].length === 0) t.tally.emptied += 1;

    const next = stepFor(sim, t.tally);
    if (next !== t.step) {
      t.step = next;
      sfx.boon();
    }
    this.paintCoach();
  }

  private async finishTutorial(): Promise<void> {
    this.board.busy = true;
    this.hud.setCoach(null);
    this.board.setCoachMove(null);
    sfx.win();
    haptic('success');
    store.stats().tutorialDone = true;
    if (store.unlock('taught')) toast('Unlocked — Taught', 'good');
    store.save();
    await this.playVictorySort();
    this.board.busy = false;
    this.tutorial = null;
    const choice = await modal({
      title: 'Board cleared',
      body: 'Real runs stack extra rules on top of that, and the move allowance actually bites. See how deep you get.',
      dismissable: false,
      actions: [
        { label: 'Begin a run', kind: 'primary', value: 'run' },
        { label: 'Back to the title', kind: 'ghost', value: 'title' },
      ],
    });
    this.hud.setHintEnabled(store.settings().showHint);
    if (choice === 'run') void this.startRun(randomSeed(), false);
    else this.toTitle();
  }

  /** Plays the solver's own line. Only reachable through the `?qa=1` bridge. */
  /**
   * Replay the solver's line, for the smoke test and the screenshot script.
   *
   * Skips ahead to wherever the board actually is rather than assuming it is
   * untouched: the screenshot run plays part of the line, poses the board for a
   * shot, then asks for the rest, and replaying from the top pushed moves whose
   * cards had already moved. Stops at the first move the board will not take,
   * which is also the honest thing to do now that a level's line can be null or
   * belong to a position the player has since left.
   */
  async qaSolve(limit = 999): Promise<void> {
    const line = this.level?.solution;
    if (!line) return;
    let played = 0;
    for (const mv of line) {
      if (!this.level || played >= limit) break;
      const legal = legalMoves(this.level.sim, false).some((m) => sameMove(m, mv));
      if (!legal) continue; // already played, or no longer reachable
      await this.doMove(mv);
      played++;
      await new Promise((r) => setTimeout(r, 12));
    }
  }

  /* --------------------------------------------------------------- timer */

  private startTimer(level: Level): void {
    this.stopTimer();
    if (!level.timeLimit) return;
    this.timeLeft = level.timeLimit;
    this.hud.setTime(this.timeLeft);
    this.timerId = window.setInterval(() => {
      this.timeLeft -= 1;
      this.hud.setTime(Math.max(0, this.timeLeft));
      if (this.timeLeft <= 0) {
        this.stopTimer();
        void this.onLose('Time ran out');
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = 0;
    }
  }

  /* ---------------------------------------------------------------- misc */

  private openPlayMenu(): void {
    const level = this.level!;
    if (!this.run) {
      menuSheet('Paused', [
        { label: 'How to play', fn: () => openHelp() },
        { label: 'Settings', fn: () => openSettings() },
        {
          label: 'Leave the tutorial',
          kind: 'danger',
          fn: () => {
            this.tutorial = null;
            this.hud.setCoach(null);
            this.board.setCoachMove(null);
            this.hud.setHintEnabled(store.settings().showHint);
            this.toTitle();
          },
        },
      ]);
      return;
    }
    const run = this.run;
    const facts = el('div', { class: 'level-facts' }, [
      el('p', {}, [
        `Level ${level.spec.stage} · ${level.columns} columns · ${level.stockSize} in the pile · ${level.sim.defs.length} cards`,
      ]),
      el('p', {}, [`Allowance ${level.budget} moves · seed ${seedToCode(level.spec.seed)}`]),
      ...level.modifiers.map((m) =>
        el('p', { class: 'rulenote' }, [`${MODIFIERS[m].glyph} ${MODIFIERS[m].name} — ${MODIFIERS[m].text}`]),
      ),
    ]);
    menuSheet(
      'Paused',
      [
        { label: 'View deck', fn: () => openDeck(run) },
        { label: 'How to play', fn: () => openHelp() },
        { label: 'Codex', fn: () => openCodex() },
        {
          label: 'Settings',
          fn: () => {
            openSettings();
            setTimeout(() => this.hud.setHintEnabled(store.settings().showHint), 100);
          },
        },
        { label: 'Abandon run', kind: 'danger', fn: () => void this.abandon() },
      ],
      facts,
    );
  }

  /**
   * The payoff: a cleared board sorts itself into the four foundations the
   * game never lets you use while playing. A tap anywhere cuts it short.
   */
  private async playVictorySort(): Promise<void> {
    const snap = this.board.victorySnapshot();
    const handle = playVictory(snap.layer, snap.cards, {
      cardW: snap.cardW,
      cardH: snap.cardH,
      reduceMotion: store.settings().reduceMotion,
      onLand: () => sfx.flip(),
    });
    const skip = (): void => handle.skip();
    this.hud.boardHost.addEventListener('pointerdown', skip);
    try {
      await handle.done;
      // A beat on the finished foundations before the reward screen takes over,
      // so the sorted board is something you actually get to look at.
      await new Promise((r) => setTimeout(r, 450));
    } finally {
      this.hud.boardHost.removeEventListener('pointerdown', skip);
    }
  }

  /** Evaluates every achievement against the current moment. */
  private award(): void {
    const st = store.stats();
    const ctx: AchieveCtx = {
      totals: { cardsTurned: st.cardsTurned, runs: st.runs },
      run: this.run,
      level: this.level,
      tally: this.tally,
      streak: this.streak,
    };
    for (const a of newlyEarned(ctx, st.achievements)) {
      if (!store.unlock(a.id)) continue;
      toast(`Unlocked — ${a.name}`, 'good');
      sfx.boon();
    }
  }

  private persist(): void {
    if (this.run) store.setRun(this.run);
    store.save();
  }
}

/** Structured clone turns typed arrays back into typed arrays, but a level that
 *  crossed a worker boundary still needs its derived state re-checked. */
function rehydrate(level: Level): void {
  const sim = level.sim;
  sim.up = sim.up instanceof Uint8Array ? sim.up : Uint8Array.from(Object.values(sim.up));
  sim.gone = sim.gone instanceof Uint8Array ? sim.gone : Uint8Array.from(Object.values(sim.gone));
  settle(sim, null);
}

function restoreSim(dst: Sim, src: Sim): void {
  dst.cols = src.cols.map((c) => c.slice());
  dst.up.set(src.up);
  dst.gone.set(src.gone);
  dst.hidden = src.hidden;
  dst.movesLeft = src.movesLeft;
  dst.movesUsed = src.movesUsed;
  dst.revealed = src.revealed;
  dst.gold = src.gold;
}
