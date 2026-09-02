/**
 * Application controller: owns the run, drives the state machine between
 * screens, and mediates between the rules engine and the views.
 */
import { sfx, unlock } from './audio.ts';
import { CHARMS, MODIFIERS } from './game/content.ts';
import { dealLevelAsync, hintAsync, warmUp } from './game/dealAsync.ts';
import type { Level, LevelSpec } from './game/deal.ts';
import { Rng, randomSeed, seedFromString, seedToCode } from './game/rng.ts';
import {
  addCard,
  addCharm,
  computeScore,
  curseRandomCard,
  enchantCard,
  gainGold,
  makeFork,
  makeRewards,
  makeShop,
  newRun,
  removeCard,
  rewardCount,
  SHOP_EVERY,
  uncurseCard,
  type Reward,
  type RunState,
  type ShopItem,
} from './game/run.ts';
import { applyMove, cloneSim, isWon, legalMoves, settle, type Sim, type SimEvent } from './game/sim.ts';
import type { Move } from './game/types.ts';
import { haptic } from './haptics.ts';
import { hideSplash, initNative } from './native.ts';
import * as store from './storage.ts';
import { BoardView } from './ui/board.ts';
import { describeCard } from './ui/cardview.ts';
import { el } from './ui/dom.ts';
import { Hud } from './ui/hud.ts';
import {
  applySettingsToDocument,
  openDeck,
  openHelp,
  openSettings,
  openCodex,
  renderFork,
  renderOver,
  renderReward,
  renderShop,
  renderTitle,
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
  undosLeft: number;
  peeksLeft: number;
}

export class App {
  private run: RunState | null = null;
  private level: Level | null = null;
  private history: Snapshot[] = [];
  private board!: BoardView;
  private hud!: Hud;
  private timerId = 0;
  private timeLeft = 0;
  private freeHints = 0;
  private dealing = false;
  private ctx: MenuCtx;

  constructor(root: HTMLElement) {
    registerScreens(root);
    applySettingsToDocument();

    this.ctx = {
      newRun: () => void this.startRun(randomSeed(), false),
      continueRun: () => void this.resume(),
      daily: () => void this.startDaily(),
      pickNode: (spec) => void this.enterNode(spec),
      takeReward: (r) => void this.takeReward(r),
      buy: (item, i) => this.buy(item, i),
      leaveShop: () => this.afterShop(),
      toTitle: () => this.toTitle(),
      abandon: () => void this.abandon(),
    };

    this.hud = new Hud({
      menu: () => this.openPlayMenu(),
      undo: () => this.undo(),
      hint: () => void this.hint(),
      peek: () => this.peek(),
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
      openHelp();
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

  /* --------------------------------------------------------------- routing */

  private toTitle(): void {
    this.stopTimer();
    renderTitle(this.ctx, !!store.getRun());
    show('title');
  }

  private async startRun(seed: number, daily: boolean): Promise<void> {
    const run = newRun(seed, daily);
    store.stats().runs += 1;
    this.run = run;
    store.setRun(run);
    this.showFork();
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
        else this.showFork();
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
        this.showFork();
    }
  }

  private showFork(): void {
    const run = this.run!;
    if (!run.fork.length) run.fork = makeFork(run);
    run.phase = 'fork';
    run.current = null;
    run.levelMoves = [];
    this.persist();
    renderFork(this.ctx, run);
    show('fork');
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
    });
    rehydrate(level);

    this.level = level;
    this.history = [];
    this.freeHints = spec.depth <= 2 ? 3 : 0;
    this.hud.mount(level);
    this.hud.setHintEnabled(store.settings().showHint);
    this.board.mount(level);
    this.hud.setDealing(false);

    if (replay?.length) {
      // Rebuild the undo stack as we replay, so a resumed level plays exactly
      // like one that was never interrupted.
      for (const m of replay) {
        this.history.push({ sim: cloneSim(level.sim), undosLeft: level.undosLeft, peeksLeft: level.peeksLeft });
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
    this.hud.update(level, level.sim, {
      hintCost: this.freeHints > 0 ? 0 : 1,
      canUndo: this.history.length > 0,
    });
  }

  private async doMove(mv: Move): Promise<void> {
    const level = this.level;
    if (!level || this.board.busy) return;
    const sim = level.sim;
    const run = this.run!;

    let cost = mv.cost;
    if (level.freeFirstMove && sim.movesUsed === 0) cost = 0;
    const applied: Move = { ...mv, cost };

    this.history.push({ sim: cloneSim(sim), undosLeft: level.undosLeft, peeksLeft: level.peeksLeft });
    if (this.history.length > 400) this.history.shift();

    const events: SimEvent[] = [];
    const before = sim.movesLeft;
    applyMove(sim, applied, events);
    run.levelMoves.push(applied);
    run.stats.movesSpent += Math.max(0, before - sim.movesLeft);

    this.board.clearSelection();
    this.board.clearHint();
    if (applied.kind === 'b') {
      const burned = events.find((e) => e.t === 'burn');
      if (burned && burned.t === 'burn') this.board.flashBurn(burned.id);
      sfx.burn();
    } else if (applied.kind === 'f') {
      sfx.flip();
    } else {
      sfx.place();
    }
    haptic('light');

    this.board.layout(true);
    const flips = events.filter((e) => e.t === 'flip').map((e) => (e.t === 'flip' ? e.id : -1));
    if (flips.length) {
      this.board.pulseFlip(flips);
      setTimeout(() => sfx.flip(), 90);
      haptic('medium');
    }
    for (const e of events) {
      if (e.t === 'gold') {
        sfx.gold();
        toast(`+${e.n} gold`, 'good');
      }
      if (e.t === 'moves') {
        sfx.boon();
        this.hud.flashMoves(e.n);
        toast(`+${e.n} moves`, 'good');
      }
    }
    if (sim.movesLeft < before) this.hud.flashMoves(-1);

    this.refresh();
    this.persist();

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
    restoreSim(level.sim, snap.sim);
    level.undosLeft = snap.undosLeft - 1;
    level.peeksLeft = snap.peeksLeft;
    if (level.undoCostsMove) level.sim.movesLeft -= 1;
    this.run!.levelMoves.pop();
    this.board.clearSelection();
    this.board.clearHint();
    this.board.layout(true);
    this.refresh();
    this.persist();
    sfx.tap();
    haptic('light');
  }

  private async hint(): Promise<void> {
    const level = this.level;
    if (!level || this.board.busy) return;
    const cost = this.freeHints > 0 ? 0 : 1;
    if (level.sim.movesLeft < cost) return;
    this.board.busy = true;
    this.hud.setDealing(true);
    const mv = await hintAsync(level.sim);
    this.hud.setDealing(false);
    this.board.busy = false;
    if (!mv) {
      toast('No line found from here.', 'bad');
      sfx.deny();
      return;
    }
    if (cost > 0) {
      level.sim.movesLeft -= cost;
      this.run!.stats.movesSpent += cost;
      this.hud.flashMoves(-1);
    } else {
      this.freeHints -= 1;
    }
    this.board.showHint(mv);
    sfx.boon();
    this.refresh();
    this.persist();
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

  private async onStuck(): Promise<void> {
    const level = this.level!;
    const canUndo = level.undosLeft > 0 && this.history.length > 0;
    const outOfMoves = level.sim.movesLeft <= 0;
    if (canUndo) {
      const choice = await modal({
        title: outOfMoves ? 'Out of moves' : 'No legal moves',
        body: outOfMoves
          ? 'Step back and try a different line, or let the run end here.'
          : 'Nothing can be played from this position.',
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

  private async onWin(): Promise<void> {
    const level = this.level!;
    const run = this.run!;
    this.stopTimer();
    this.board.busy = true;
    this.board.celebrate();
    sfx.win();
    haptic('success');

    run.depth = level.spec.depth;
    run.stats.levelsCleared += 1;
    run.stats.cardsTurned += level.sim.revealed;

    const spare = Math.max(0, level.sim.movesLeft);
    let gold = level.baseGold + level.sim.gold;
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

    await new Promise((r) => setTimeout(r, 900));
    this.board.busy = false;

    const rewards = makeRewards(run, level.spec.kind, rewardCount(run, level.spec.kind));
    run.rewards = rewards;
    run.phase = 'reward';
    run.levelMoves = [];
    run.current = null;
    this.persist();

    renderReward(this.ctx, run, rewards, [
      `+${gained} gold`,
      `${spare} ${spare === 1 ? 'move' : 'moves'} to spare`,
      `${level.sim.revealed} turned`,
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
    store.setRun(null);
    store.save();

    renderOver(run, reason, isBest, {
      again: () => void this.startRun(randomSeed(), false),
      replay: () => void this.startRun(run.seed, false),
      title: () => this.toTitle(),
    });
    show('over');
    this.board.busy = false;
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
        toast('Reserve expanded', 'good');
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
        if (uid === null) return;
        enchantCard(run, uid, r.ench);
        break;
      }
      case 'remove': {
        const uid = await pickCard(run.deck, { title: 'Remove which card?', hint: 'A smaller deck is a smaller board.' });
        if (uid === null) return;
        removeCard(run, uid);
        break;
      }
      case 'uncurse': {
        const uid = await pickCard(run.deck, { title: 'Lift which curse?', allow: (c) => !!c.curse });
        if (uid === null) return;
        uncurseCard(run, uid);
        break;
      }
      case 'bargain': {
        toast(`+${gainGold(run, r.n)} gold`, 'good');
        const cursed = curseRandomCard(run, new Rng((run.seed ^ (run.depth * 7919)) >>> 0));
        if (cursed) toast('A card in your deck was cursed', 'bad');
        break;
      }
    }
    sfx.boon();
    run.rewards = [];
    this.afterReward();
  }

  private afterReward(): void {
    const run = this.run!;
    if (run.depth % SHOP_EVERY === 0) {
      run.shop = makeShop(run);
      run.phase = 'shop';
      this.persist();
      renderShop(this.ctx, run);
      show('shop');
      return;
    }
    run.fork = makeFork(run);
    this.showFork();
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
    const run = this.run!;
    run.fork = makeFork(run);
    this.showFork();
  }

  /** Plays the solver's own line. Only reachable through the `?qa=1` bridge. */
  async qaSolve(limit = 999): Promise<void> {
    const line = this.level?.solution;
    if (!line) return;
    for (const mv of line.slice(0, limit)) {
      if (!this.level) break;
      await this.doMove(mv);
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
    const run = this.run!;
    const level = this.level!;
    const facts = el('div', { class: 'level-facts' }, [
      el('p', {}, [
        `Level ${level.spec.depth} · ${level.columns} columns · ${level.cells} reserve · ${level.sim.defs.length} cards`,
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
