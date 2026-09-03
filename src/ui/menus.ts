/** Every non-board screen: title, the fork, rewards, the shop and the epitaph. */
import { CHARMS, CONSUMABLES, CURSES, ENCHANTS, MODIFIER_LIST } from '../game/content.ts';
import { columnsFor, describeModifiers, threatOf, type LevelSpec, type NodeKind } from '../game/deal.ts';
import { seedToCode } from '../game/rng.ts';
import {
  computeScore,
  deckSummary,
  shopLabel,
  type QueuedStage,
  type Reward,
  type RunState,
  type ShopItem,
} from '../game/run.ts';
import { QUESTIONS, type Answer, type QuestionId } from '../game/oracle.ts';
import { RANK_LABEL, SUIT_GLYPH, type DeckCard } from '../game/types.ts';
import { ACHIEVEMENTS, ACHIEVEMENT_COUNT } from '../game/achievements.ts';
import { DEFAULT_SETTINGS, load, save, settings, stats, wipe, type RunRecord } from '../storage.ts';
import { charmChip, menuSheet, miniCard, modChip, screen, sheetPanel, statRow } from './shell.ts';
import { el } from './dom.ts';

export interface MenuCtx {
  newRun(): void;
  continueRun(): void;
  daily(): void;
  tutorial(): void;
  playStage(): void;
  skipStage(): void;
  takeReward(r: Reward): void;
  buy(item: ShopItem, index: number): void;
  leaveShop(): void;
  toTitle(): void;
  abandon(): void;
}

const KIND_LABEL: Record<NodeKind, string> = {
  trial: 'Trial',
  gauntlet: 'Gauntlet',
  cache: 'Cache',
  boss: 'Warden',
  sunken: 'Resurfaced',
  shop: 'Market',
  respite: 'Respite',
  tutorial: 'First Deal',
};

const KIND_BLURB: Record<NodeKind, string> = {
  trial: 'A standard board.',
  gauntlet: 'Harsher rules, richer spoils.',
  cache: 'A gentle board and a quiet reward.',
  boss: 'The floor’s keeper. Everything at once.',
  sunken: 'The board you walked past. It came back with less room.',
  shop: '',
  respite: '',
  tutorial: 'A short board with a guide.',
};

/* ------------------------------------------------------------------ title */

export function renderTitle(ctx: MenuCtx, hasRun: boolean): void {
  const s = screen('title');
  const m = stats();
  s.replaceChildren(
    el('div', { class: 'title-wrap' }, [
      el('div', { class: 'logo' }, [
        el('div', { class: 'logo-cards' }, [
          el('span', { class: 'lc lc1' }, ['♠']),
          el('span', { class: 'lc lc2' }, ['♥']),
          el('span', { class: 'lc lc3' }, ['♦']),
        ]),
        el('h1', { class: 'wordmark' }, ['FACEDOWN']),
        el('p', { class: 'tagline' }, ['A solitaire roguelite. Turn every card.']),
      ]),
      el('div', { class: 'menu' }, [
        hasRun ? btn('Continue run', 'primary', () => ctx.continueRun()) : null,
        btn(hasRun ? 'New run' : 'Begin a run', hasRun ? 'ghost' : 'primary', () => ctx.newRun()),
        btn('Daily deal', 'ghost', () => ctx.daily()),
        el('div', { class: 'menu-row' }, [
          btn(m.tutorialDone ? 'Tutorial' : 'Learn to play', 'small', () => ctx.tutorial()),
          btn('How to play', 'small', () => openHelp()),
        ]),
        el('div', { class: 'menu-row' }, [
          btn('Codex', 'small', () => openCodex()),
          btn('Settings', 'small', () => openSettings()),
        ]),
      ]),
      (() => {
        const earned = Object.keys(m.achievements).length;
        const panel = el('button', { class: 'title-stats', type: 'button' }, [
          statRow('Deepest run', m.bestDepth ? `Level ${m.bestDepth}` : '—'),
          statRow('Best score', m.bestScore ? m.bestScore.toLocaleString() : '—'),
          statRow('Achievements', `${earned} / ${ACHIEVEMENT_COUNT}`),
          el('span', { class: 'title-stats-more' }, ['Records →']),
        ]);
        panel.addEventListener('click', () => openRecords());
        return panel;
      })(),
    ]),
  );
}

function btn(label: string, kind: string, fn: () => void): HTMLElement {
  const b = el('button', { class: `btn ${kind}`, type: 'button' }, [label]);
  b.addEventListener('click', fn);
  return b;
}

/* ------------------------------------------------------------------- fork */

const THREAT_WORD = ['Calm', 'Steady', 'Tense', 'Grim', 'Dire', 'Lethal'];

function threatBar(n: number): HTMLElement {
  const level = Math.max(0, Math.min(5, Math.round(n / 4)));
  const wrap = el('div', { class: 'threat', 'aria-label': `Threat ${level} of 5` }, [
    el('span', { class: 'threat-word' }, [THREAT_WORD[level]]),
  ]);
  const pips = el('div', { class: 'threat-pips' });
  for (let i = 0; i < 5; i++) pips.append(el('span', { class: i < level ? 'pip on' : 'pip' }));
  wrap.append(pips);
  return wrap;
}

const KIND_REWARD: Record<NodeKind, string> = {
  trial: 'Standard spoils',
  gauntlet: 'Rich spoils · more gold',
  cache: 'A modest reward',
  boss: 'A charm, guaranteed',
  sunken: 'Standard spoils',
  shop: '',
  respite: '',
  tutorial: '',
};

export function runBar(run: RunState, opts: { onDeck: () => void } = { onDeck: () => {} }): HTMLElement {
  const d = deckSummary(run.deck);
  const bar = el('div', { class: 'runbar' }, [
    el('button', { class: 'runbar-deck', type: 'button' }, [
      el('span', { class: 'rb-num' }, [String(d.size)]),
      el('span', { class: 'rb-lbl' }, ['cards']),
    ]),
    // The bank is the run's real health bar, so it sits beside the gold rather
    // than being something you only discover once a board is already dealt.
    el('div', { class: 'runbar-bank', title: 'Moves carried into the next board' }, [
      el('span', { class: 'rb-num' }, [String(run.bank)]),
      el('span', { class: 'rb-lbl' }, ['banked']),
    ]),
    el('div', { class: 'runbar-gold' }, [el('span', { class: 'coin' }, ['⛁']), String(run.gold)]),
    el('div', { class: 'runbar-charms' }, run.charms.slice(0, 6).map((c) => charmChip(c))),
  ]);
  bar.querySelector('.runbar-deck')!.addEventListener('click', opts.onDeck);
  return bar;
}

function stageCard(
  ctx: MenuCtx,
  run: RunState,
  q: QueuedStage,
  position: 'now' | 'ahead',
): HTMLElement {
  const spec = q.spec;
  const mods = describeModifiers(spec.modifiers);
  const cols = columnsFor(run.deck.length, spec.modifiers, run.charms);
  const chips = mods.length
    ? spec.modifiers.map((m) => modChip(m))
    : [el('span', { class: 'chip plain' }, ['Standard rules'])];

  if (position === 'ahead') {
    return el('div', { class: `stage ahead stage-${spec.kind}` }, [
      el('div', { class: 'stage-head' }, [
        el('span', { class: 'stage-no' }, [`Stage ${spec.stage}`]),
        el('span', { class: 'stage-kind' }, [KIND_LABEL[spec.kind]]),
        threatBar(threatOf(spec)),
      ]),
      el('div', { class: 'node-mods' }, chips),
    ]);
  }

  const play = el('button', { class: 'btn primary', type: 'button' }, ['Play it']);
  play.addEventListener('click', () => ctx.playStage());

  const skip = q.canSkip
    ? (() => {
        const b = el('button', { class: 'btn skip', type: 'button' }, [
          el('span', { class: 'skip-label' }, ['Walk past it']),
          el('span', { class: 'skip-take' }, ['nothing now — the market pays out if you clear the next one']),
        ]);
        b.addEventListener('click', () => ctx.skipStage());
        return b;
      })()
    : el('p', { class: 'stage-locked' }, [
        spec.kind === 'sunken'
          ? 'It came back for you. There is no walking past it twice.'
          : 'The Warden has to be faced.',
      ]);

  return el('div', { class: `stage now stage-${spec.kind}` }, [
    el('div', { class: 'stage-head' }, [
      el('span', { class: 'stage-no' }, [`Stage ${spec.stage}`]),
      el('span', { class: 'stage-kind' }, [KIND_LABEL[spec.kind]]),
      threatBar(threatOf(spec)),
    ]),
    el('p', { class: 'node-blurb' }, [KIND_BLURB[spec.kind]]),
    el('div', { class: 'node-mods' }, chips),
    el('div', { class: 'node-foot' }, [
      el('span', { class: 'node-stats' }, [`${cols} columns · ${run.deck.length} cards`]),
      el('span', { class: 'node-reward' }, [KIND_REWARD[spec.kind]]),
    ]),
    el('div', { class: 'stage-actions' }, [play, skip]),
  ]);
}

export function renderQueue(ctx: MenuCtx, run: RunState, queue: QueuedStage[], warden: LevelSpec): void {
  const s = screen('fork');
  const showWarden = warden.stage !== queue[0].spec.stage;

  s.replaceChildren(
    el('div', { class: 'pad' }, [
      el('header', { class: 'screen-head' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow' }, [`${run.depth} cleared`]),
          el('h2', {}, ['What is next']),
        ]),
        btn('Menu', 'small', () => openRunMenu(ctx, run)),
      ]),
      runBar(run, { onDeck: () => openDeck(run) }),
      run.skipsPending || run.marketCredit
        ? el('div', { class: 'owed' }, [
            run.marketCredit
              ? `The market owes you ${run.marketCredit} ${run.marketCredit === 1 ? 'item' : 'items'}.`
              : `${run.skipsPending} skipped. Clear a board and the market makes it good.`,
          ])
        : null,
      run.sunken.length
        ? el('div', { class: 'sunk' }, [
            run.sunken.length === 1
              ? `A board you walked past resurfaces at stage ${run.sunken[0].at}.`
              : `${run.sunken.length} boards you walked past resurface at stages ${run.sunken.map((b) => b.at).sort((a, b) => a - b).join(', ')}.`,
          ])
        : null,
      showWarden
        ? el('div', { class: 'warden-banner' }, [
            el('span', { class: 'warden-when' }, [`Warden at stage ${warden.stage}`]),
            el('div', { class: 'node-mods' }, warden.modifiers.length
              ? warden.modifiers.map((m) => modChip(m))
              : [el('span', { class: 'chip plain' }, ['Standard rules'])]),
          ])
        : null,
      stageCard(ctx, run, queue[0], 'now'),
      queue.length > 1
        ? el('p', { class: 'section-label' }, ['Then'])
        : null,
      ...queue.slice(1).map((q) => stageCard(ctx, run, q, 'ahead')),
    ]),
  );
}

/* ---------------------------------------------------------------- rewards */

export function rewardFace(r: Reward): { glyph: string; title: string; text: string; cls: string } {
  switch (r.t) {
    case 'gold':
      return { glyph: '⛁', title: `${r.n} gold`, text: 'Spend it at the market.', cls: 'gold' };
    case 'moves':
      return { glyph: '↑', title: `+${r.n} moves`, text: 'On every level, for the rest of the run.', cls: 'moves' };
    case 'ench':
      return { glyph: ENCHANTS[r.ench].glyph, title: ENCHANTS[r.ench].name, text: ENCHANTS[r.ench].text, cls: `ench ${ENCHANTS[r.ench].rarity}` };
    case 'charm':
      return { glyph: CHARMS[r.id].glyph, title: CHARMS[r.id].name, text: CHARMS[r.id].text, cls: `charm ${CHARMS[r.id].rarity}` };
    case 'add':
      return {
        glyph: `${RANK_LABEL[r.card.rank]}${SUIT_GLYPH[r.card.suit]}`,
        title: 'Add a card',
        text: r.card.ench ? `Arrives with ${ENCHANTS[r.card.ench].name}.` : 'A plain card for your deck.',
        cls: 'add',
      };
    case 'cell':
      return { glyph: '▣', title: '+1 reserve cell', text: 'One more place to park a card, for the rest of the run.', cls: 'cell' };
    case 'remove':
      return { glyph: '✂', title: 'Remove a card', text: 'A thinner deck is a shorter board.', cls: 'remove' };
    case 'uncurse':
      return { glyph: '✧', title: 'Lift a curse', text: 'Clean one card in your deck.', cls: 'uncurse' };
    case 'bargain':
      return { glyph: '☽', title: `Bargain: ${r.n} gold`, text: 'One of your cards is cursed in return.', cls: 'bargain' };
  }
}

export function renderReward(ctx: MenuCtx, run: RunState, rewards: Reward[], summary: string[]): void {
  const s = screen('reward');
  const list = el('div', { class: 'reward-list' });
  for (const r of rewards) {
    const f = rewardFace(r);
    const card = el('button', { class: `reward ${f.cls}`, type: 'button' }, [
      el('span', { class: 'reward-glyph' }, [f.glyph]),
      el('span', { class: 'reward-body' }, [
        el('strong', {}, [f.title]),
        el('span', {}, [f.text]),
      ]),
    ]);
    card.addEventListener('click', () => ctx.takeReward(r));
    list.append(card);
  }
  s.replaceChildren(
    el('div', { class: 'pad' }, [
      el('header', { class: 'screen-head' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow good' }, ['Level cleared']),
          el('h2', {}, [`Level ${run.depth} down`]),
        ]),
      ]),
      el('div', { class: 'clear-summary' }, summary.map((t) => el('span', { class: 'tally' }, [t]))),
      el('p', { class: 'section-label' }, ['Choose one']),
      list,
    ]),
  );
}

/* ------------------------------------------------------------------- shop */

export function renderShop(ctx: MenuCtx, run: RunState): void {
  const s = screen('shop');
  const list = el('div', { class: 'shop-list' });
  run.shop.forEach((item, i) => {
    const face = shopFace(item);
    const affordable = run.gold >= item.price && !item.sold;
    const setAside = (item as { setAside?: boolean }).setAside === true;
    const row = el('button', {
      class: `shop-item${item.sold ? ' sold' : ''}${affordable ? '' : ' broke'}${setAside ? ' set-aside' : ''}`,
      type: 'button',
    }, [
      el('span', { class: 'shop-glyph' }, [face.glyph]),
      el('span', { class: 'shop-body' }, [
        el('strong', {}, [face.title, setAside ? el('em', { class: 'tag' }, ['set aside']) : null]),
        el('span', {}, [face.text]),
      ]),
      el('span', { class: 'shop-price' }, [item.sold ? 'sold' : `⛁ ${item.price}`]),
    ]);
    if (affordable) row.addEventListener('click', () => ctx.buy(item, i));
    list.append(row);
  });

  s.replaceChildren(
    el('div', { class: 'pad' }, [
      el('header', { class: 'screen-head' }, [
        el('div', {}, [el('p', { class: 'eyebrow' }, ['Between levels']), el('h2', {}, ['The Market'])]),
        el('div', { class: 'gold-badge' }, [el('span', { class: 'coin' }, ['⛁']), String(run.gold)]),
      ]),
      list,
      el('div', { class: 'menu-row wide' }, [
        btn('View deck', 'small', () => openDeck(run)),
        btn('Move on', 'primary', () => ctx.leaveShop()),
      ]),
    ]),
  );
}

function shopFace(item: ShopItem): { glyph: string; title: string; text: string } {
  switch (item.t) {
    case 'item':
      return { glyph: CONSUMABLES[item.id].glyph, title: CONSUMABLES[item.id].name, text: CONSUMABLES[item.id].text };
    case 'ench':
      return { glyph: ENCHANTS[item.ench].glyph, title: ENCHANTS[item.ench].name, text: ENCHANTS[item.ench].text };
    case 'charm':
      return { glyph: CHARMS[item.id].glyph, title: CHARMS[item.id].name, text: CHARMS[item.id].text };
    case 'add':
      return {
        glyph: `${RANK_LABEL[item.card.rank]}${SUIT_GLYPH[item.card.suit]}`,
        title: shopLabel(item),
        text: item.card.ench ? `Comes with ${ENCHANTS[item.card.ench].name}.` : 'A plain card.',
      };
    case 'remove':
      return { glyph: '✂', title: shopLabel(item), text: 'Thin the deck by one.' };
    case 'uncurse':
      return { glyph: '✧', title: shopLabel(item), text: 'Clean a cursed card.' };
    case 'moves':
      return { glyph: '↑', title: shopLabel(item), text: 'Applies to every remaining level.' };
    case 'cell':
      return { glyph: '▣', title: shopLabel(item), text: 'One more parking space, every level.' };
  }
}

/* ------------------------------------------------------------------- over */

/** What the solver worked out about how the run actually ended. */
export interface Epitaph {
  verdict: string;
  lines: string[];
}

export function renderOver(
  run: RunState,
  reason: string,
  isBest: boolean,
  actions: { again(): void; replay(): void; title(): void },
  epitaph: Epitaph | null = null,
): void {
  const s = screen('over');
  const score = computeScore(run);
  s.replaceChildren(
    el('div', { class: 'pad over' }, [
      el('div', { class: 'over-head' }, [
        el('p', { class: 'eyebrow bad' }, [reason]),
        el('h2', { class: 'depth-big' }, [String(run.depth)]),
        el('p', { class: 'depth-lbl' }, [run.depth === 1 ? 'level cleared' : 'levels cleared']),
        isBest ? el('p', { class: 'record' }, ['New personal best']) : null,
      ]),
      epitaph
        ? el('div', { class: 'epitaph' }, [
            el('p', { class: 'epitaph-verdict' }, [epitaph.verdict]),
            epitaph.lines.length
              ? el('ul', { class: 'epitaph-lines' }, epitaph.lines.map((l) => el('li', {}, [l])))
              : null,
          ])
        : null,
      el('div', { class: 'over-stats' }, [
        statRow('Score', score.toLocaleString()),
        statRow('Cards turned', String(run.stats.cardsTurned)),
        statRow('Moves spent', String(run.stats.movesSpent)),
        statRow('Gold earned', String(run.stats.goldEarned)),
        statRow('Deck at the end', `${run.deck.length} cards`),
        statRow('Seed', seedToCode(run.seed)),
      ]),
      el('div', { class: 'menu over-actions' }, [
        btn('New run', 'primary', actions.again),
        el('div', { class: 'menu-row' }, [
          btn('Replay this seed', 'small', actions.replay),
          btn('Title', 'small', actions.title),
        ]),
      ]),
      run.charms.length
        ? el('div', { class: 'over-charms' }, run.charms.map((c) => charmChip(c)))
        : null,
      el('p', { class: 'section-label centred' }, ['The deck you died with']),
      el('div', { class: 'deck-grid small' }, [...run.deck].sort((a, b) => a.suit - b.suit || a.rank - b.rank).map((c) => miniCard(c))),
    ]),
  );
}

/* ---------------------------------------------------------------- panels */

export function openDeck(run: RunState): void {
  const d = deckSummary(run.deck);
  const grid = el('div', { class: 'deck-grid' }, [...run.deck]
    .sort((a, b) => a.suit - b.suit || a.rank - b.rank)
    .map((c) => miniCard(c)));
  const body = el('div', {}, [
    el('div', { class: 'deck-summary' }, [
      statRow('Cards', String(d.size)),
      statRow('Enchanted', String(d.enchanted)),
      statRow('Cursed', String(d.cursed)),
    ]),
    run.charms.length ? el('p', { class: 'section-label' }, ['Charms']) : null,
    run.charms.length ? el('div', { class: 'chip-row' }, run.charms.map((c) => charmChip(c))) : null,
    el('p', { class: 'section-label' }, ['Deck']),
    grid,
  ]);
  sheetPanel({ title: 'Your deck', body });
}

function openRunMenu(ctx: MenuCtx, run: RunState): void {
  menuSheet('Run menu', [
    { label: 'View deck', fn: () => openDeck(run) },
    { label: 'How to play', fn: () => openHelp() },
    { label: 'Codex', fn: () => openCodex() },
    { label: 'Settings', fn: () => openSettings() },
    { label: 'Abandon run', kind: 'danger', fn: () => ctx.abandon() },
  ]);
}

function relativeDay(at: number): string {
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

function runRow(r: RunRecord): HTMLElement {
  return el('div', { class: 'record-row' }, [
    el('span', { class: 'record-depth' }, [String(r.depth)]),
    el('span', { class: 'record-body' }, [
      el('strong', {}, [`${r.score.toLocaleString()} points`, r.daily ? el('em', { class: 'tag' }, ['daily']) : null]),
      el('span', {}, [`${r.reason} · ${seedToCode(r.seed)} · ${relativeDay(r.at)}`]),
    ]),
  ]);
}

export function openRecords(): void {
  const m = stats();
  const earned = Object.keys(m.achievements).length;

  const badges = el('div', { class: 'badges' }, ACHIEVEMENTS.map((a) => {
    const got = !!m.achievements[a.id];
    return el('div', { class: `badge-row${got ? ' got' : ''}` }, [
      el('span', { class: 'badge-mark' }, [got ? '★' : '☆']),
      el('span', {}, [el('strong', {}, [a.name]), el('span', {}, [a.text])]),
    ]);
  }));

  const body = el('div', {}, [
    el('p', { class: 'section-label' }, ['Lifetime']),
    el('div', {}, [
      statRow('Deepest run', m.bestDepth ? `Level ${m.bestDepth}` : '—'),
      statRow('Best score', m.bestScore ? m.bestScore.toLocaleString() : '—'),
      statRow('Runs begun', String(m.runs)),
      statRow('Levels cleared', String(m.levelsCleared)),
      statRow('Cards turned', m.cardsTurned.toLocaleString()),
      statRow('Moves spent', m.movesSpent.toLocaleString()),
      m.dailyDepth ? statRow('Best daily', `Level ${m.dailyDepth}`) : null,
    ].filter(Boolean) as Node[]),
    el('p', { class: 'section-label' }, [`Achievements — ${earned} of ${ACHIEVEMENT_COUNT}`]),
    badges,
    el('p', { class: 'section-label' }, ['Recent runs']),
    m.history.length
      ? el('div', { class: 'records' }, m.history.map(runRow))
      : el('p', { class: 'hint' }, ['No finished runs yet.']),
  ]);
  sheetPanel({ title: 'Records', body });
}

/**
 * The Oracle's sheet. Questions stay on screen with their answers beneath, so a
 * reading reads like a consultation rather than a popup.
 */
export function openOracle(opts: {
  insight: () => number;
  ask: (id: QuestionId) => Promise<Answer>;
  rewind: (moves: number) => void;
  undosLeft: () => number;
}): void {
  const tally = el('p', { class: 'oracle-insight' });
  const answer = el('div', { class: 'oracle-answer' });
  const rows = el('div', { class: 'oracle-questions' });

  const paint = (): void => {
    const left = opts.insight();
    tally.textContent = `${left} ${left === 1 ? 'reading' : 'readings'} left`;
    rows.replaceChildren(
      ...QUESTIONS.map((q) => {
        const b = el('button', { class: 'oracle-q', type: 'button' }, [
          el('span', {}, [el('strong', {}, [q.label]), el('span', {}, [q.blurb])]),
          el('span', { class: 'oracle-cost' }, [String(q.cost)]),
        ]) as HTMLButtonElement;
        b.disabled = left < q.cost;
        b.addEventListener('click', () => {
          void (async () => {
            b.disabled = true;
            answer.replaceChildren(el('p', { class: 'oracle-thinking' }, ['Reading…']));
            const a = await opts.ask(q.id);
            paint();
            const parts: (Node | null)[] = [el('p', { class: `oracle-said ${a.tone}` }, [a.text])];
            if (a.rewind && a.rewind > 0) {
              const need = a.rewind;
              const rb = el('button', { class: 'btn ghost', type: 'button' }, [
                `Step back ${need} ${need === 1 ? 'move' : 'moves'} (${need} ${need === 1 ? 'undo' : 'undos'})`,
              ]) as HTMLButtonElement;
              rb.disabled = opts.undosLeft() < need;
              rb.addEventListener('click', () => opts.rewind(need));
              parts.push(rb);
            }
            answer.replaceChildren(...(parts.filter(Boolean) as Node[]));
          })();
        });
        return b;
      }),
    );
  };
  paint();

  sheetPanel({ title: 'The Oracle', body: el('div', {}, [tally, rows, answer]) });
}

export function openHelp(): void {
  const body = el('div', { class: 'prose' }, [
    el('h3', {}, ['The goal']),
    el('p', {}, ['Get every card face-up in a column. There are no foundation piles — nothing leaves the board, and a card seen on the waste is not a card sorted, so the draw pile has to be played out onto the tableau, not just turned over.']),
    el('h3', {}, ['Moving cards']),
    el('ul', {}, [
      el('li', {}, ['Stack a card on one that is one rank higher and the opposite colour — 7♥ onto 8♠.']),
      el('li', {}, ['A properly ordered run moves as a single unit for a single move.']),
      el('li', {}, ['Tap a card to pick it up and see where it can go, then tap a target. Tap it twice to send it to the obvious place. Or just drag it.']),
      el('li', {}, ['Uncovering a face-down card turns it automatically.']),
      el('li', {}, ['Tap the draw pile to turn its next card. Once it runs dry you can turn the waste back over, but only a couple of times.']),
    ]),
    el('h3', {}, ['The Oracle']),
    el('p', {}, ['Every board was solved before it was dealt to you, so the game knows things it can be asked: whether a line still exists from where you are standing, what the next move of it is, or which move threw it away and how far back to step. Readings are paid for in moves, out of the same spare you would otherwise spend on mistakes. That is the trade — certainty now, or room to be wrong later.']),
    el('h3', {}, ['Moves are the clock']),
    el('p', {}, ['Every level gives you par plus a surplus. Par is what the board costs — the length of a line the solver actually found, so every deal you are given can be cleared. The surplus on top is the only part that is yours: it pays for mistakes, for exploring a line that turns out wrong, and for anything you ask the Oracle. The counter at the top tells you how much of it is left. Spend it all and the run ends.']),
    el('h3', {}, ['The run']),
    el('ul', {}, [
      el('li', {}, ['Each level offers a choice of boards. Safer ones pay less; gauntlets bite harder and pay more.']),
      el('li', {}, ['Clearing a level lets you enchant, add or remove a card, or take a charm.']),
      el('li', {}, ['Your deck IS the board. Thin it and levels get short and brittle; grow it and you get more cards carrying more power.']),
      el('li', {}, ['Par is the length of a line that exists. Beating it pays.']),
      el('li', {}, ['Every third level the market opens. Every fifth, a Warden.']),
    ]),
    el('h3', {}, ['Your score']),
    el('p', {}, ['How deep you got. Everything else is decoration.']),
  ]);
  sheetPanel({ title: 'How to play', body });
}

export function openCodex(): void {
  const section = (title: string, rows: { glyph: string; name: string; text: string; tag?: string }[]): HTMLElement =>
    el('div', {}, [
      el('p', { class: 'section-label' }, [title]),
      el('div', { class: 'codex' }, rows.map((r) =>
        el('div', { class: 'codex-row' }, [
          el('span', { class: 'codex-glyph' }, [r.glyph]),
          el('span', {}, [el('strong', {}, [r.name, r.tag ? el('em', { class: 'tag' }, [r.tag]) : null]), el('span', {}, [r.text])]),
        ]),
      )),
    ]);

  const body = el('div', {}, [
    section('Enchantments', Object.values(ENCHANTS).map((e) => ({ glyph: e.glyph, name: e.name, text: e.text, tag: e.rarity }))),
    section('Curses', Object.values(CURSES).map((c) => ({ glyph: c.glyph, name: c.name, text: c.text }))),
    section('Charms', Object.values(CHARMS).map((c) => ({ glyph: c.glyph, name: c.name, text: c.text, tag: c.rarity }))),
    section('Readings', QUESTIONS.map((q) => ({ glyph: String(q.cost), name: q.label, text: q.blurb }))),
    section('Level rules', MODIFIER_LIST.map((m) => ({ glyph: m.glyph, name: m.name, text: m.text, tag: m.threat < 0 ? 'boon' : undefined }))),
  ]);
  sheetPanel({ title: 'Codex', body });
}

export function openSettings(): void {
  const st = settings();
  const rows: { key: keyof typeof st; label: string; note?: string }[] = [
    { key: 'sound', label: 'Sound effects' },
    { key: 'haptics', label: 'Haptics' },
    { key: 'reduceMotion', label: 'Reduce motion', note: 'Shorter animations, no deal flourish.' },
    { key: 'leftHanded', label: 'Left-handed controls', note: 'Mirrors the action bar.' },
    { key: 'highContrast', label: 'High contrast' },
    { key: 'fourColour', label: 'Four-colour suits', note: 'Distinct colour per suit.' },
    { key: 'showHint', label: 'Hint button' },
    { key: 'confirmRestart', label: 'Confirm before restarting' },
  ];
  const body = el('div', {}, [
    el('div', { class: 'toggles' }, rows.map((r) => {
      const input = el('input', { type: 'checkbox', id: `set-${r.key}` });
      input.checked = st[r.key];
      input.addEventListener('change', () => {
        (settings() as any)[r.key] = input.checked;
        save();
        applySettingsToDocument();
      });
      return el('label', { class: 'toggle', for: `set-${r.key}` }, [
        el('span', {}, [el('strong', {}, [r.label]), r.note ? el('span', { class: 'note' }, [r.note]) : null]),
        input,
        el('span', { class: 'switch' }),
      ]);
    })),
    el('p', { class: 'section-label' }, ['Data']),
    (() => {
      const b = el('button', { class: 'btn danger', type: 'button' }, ['Erase all progress']);
      b.addEventListener('click', () => {
        if (confirm('Erase your save, statistics and current run?')) {
          wipe();
          location.reload();
        }
      });
      return b;
    })(),
    el('p', { class: 'fineprint' }, ['Facedown stores everything on this device. No account, no network, no ads.']),
  ]);
  sheetPanel({ title: 'Settings', body });
}

export function applySettingsToDocument(): void {
  const st = settings();
  const c = document.documentElement.classList;
  c.toggle('reduce-motion', st.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  c.toggle('left-handed', st.leftHanded);
  c.toggle('high-contrast', st.highContrast);
  c.toggle('four-colour', st.fourColour);
}

export function resetSettings(): void {
  load().settings = { ...DEFAULT_SETTINGS };
  save();
  applySettingsToDocument();
}

export function deckOf(run: RunState): DeckCard[] {
  return run.deck;
}
