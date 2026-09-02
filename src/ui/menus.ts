/** Every non-board screen: title, the fork, rewards, the shop and the epitaph. */
import { CHARMS, CURSES, ENCHANTS, MODIFIER_LIST } from '../game/content.ts';
import { columnsFor, describeModifiers, threatOf, type LevelSpec, type NodeKind } from '../game/deal.ts';
import { seedToCode } from '../game/rng.ts';
import {
  computeScore,
  deckSummary,
  shopLabel,
  type Reward,
  type RunState,
  type ShopItem,
} from '../game/run.ts';
import { RANK_LABEL, SUIT_GLYPH, type DeckCard } from '../game/types.ts';
import { DEFAULT_SETTINGS, load, save, settings, stats, wipe } from '../storage.ts';
import { charmChip, menuSheet, miniCard, modChip, screen, sheetPanel, statRow } from './shell.ts';
import { el } from './dom.ts';

export interface MenuCtx {
  newRun(): void;
  continueRun(): void;
  daily(): void;
  tutorial(): void;
  pickNode(spec: LevelSpec): void;
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
  shop: 'Market',
  respite: 'Respite',
  tutorial: 'First Deal',
};

const KIND_BLURB: Record<NodeKind, string> = {
  trial: 'A standard board.',
  gauntlet: 'Harsher rules, richer spoils.',
  cache: 'A gentle board and a quiet reward.',
  boss: 'The floor’s keeper. Everything at once.',
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
      el('div', { class: 'title-stats' }, [
        statRow('Deepest run', m.bestDepth ? `Level ${m.bestDepth}` : '—'),
        statRow('Best score', m.bestScore ? m.bestScore.toLocaleString() : '—'),
        statRow('Cards turned', m.cardsTurned.toLocaleString()),
      ]),
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
    el('div', { class: 'runbar-gold' }, [el('span', { class: 'coin' }, ['⛁']), String(run.gold)]),
    el('div', { class: 'runbar-charms' }, run.charms.slice(0, 6).map((c) => charmChip(c))),
  ]);
  bar.querySelector('.runbar-deck')!.addEventListener('click', opts.onDeck);
  return bar;
}

export function renderFork(ctx: MenuCtx, run: RunState): void {
  const s = screen('fork');
  const depth = run.depth + 1;
  const nodes = el('div', { class: 'fork-nodes' });

  for (const spec of run.fork) {
    const mods = describeModifiers(spec.modifiers);
    const cols = columnsFor(run.deck.length, spec.modifiers, run.charms);
    const card = el('button', { class: `node node-${spec.kind}`, type: 'button' }, [
      el('div', { class: 'node-head' }, [
        el('span', { class: 'node-kind' }, [KIND_LABEL[spec.kind]]),
        threatBar(threatOf(spec)),
      ]),
      el('p', { class: 'node-blurb' }, [KIND_BLURB[spec.kind]]),
      el('div', { class: 'node-mods' }, mods.length
        ? spec.modifiers.map((m) => modChip(m))
        : [el('span', { class: 'chip plain' }, ['Standard rules'])]),
      el('div', { class: 'node-foot' }, [
        el('span', { class: 'node-stats' }, [`${cols} columns · ${run.deck.length} cards`]),
        el('span', { class: 'node-reward' }, [KIND_REWARD[spec.kind]]),
      ]),
      el('div', { class: 'node-go' }, ['Deal →']),
    ]);
    card.addEventListener('click', () => ctx.pickNode(spec));
    nodes.append(card);
  }

  s.replaceChildren(
    el('div', { class: 'pad' }, [
      el('header', { class: 'screen-head' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow' }, ['Descending']),
          el('h2', {}, [`Level ${depth}`]),
        ]),
        btn('Menu', 'small', () => openRunMenu(ctx, run)),
      ]),
      runBar(run, { onDeck: () => openDeck(run) }),
      nodes,
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
    const row = el('button', { class: `shop-item${item.sold ? ' sold' : ''}${affordable ? '' : ' broke'}`, type: 'button' }, [
      el('span', { class: 'shop-glyph' }, [face.glyph]),
      el('span', { class: 'shop-body' }, [el('strong', {}, [face.title]), el('span', {}, [face.text])]),
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

export function renderOver(
  run: RunState,
  reason: string,
  isBest: boolean,
  actions: { again(): void; replay(): void; title(): void },
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

export function openHelp(): void {
  const body = el('div', { class: 'prose' }, [
    el('h3', {}, ['The goal']),
    el('p', {}, ['Turn every card face up. There are no foundation piles — nothing leaves the board. A level is won the instant the last face-down card turns.']),
    el('h3', {}, ['Moving cards']),
    el('ul', {}, [
      el('li', {}, ['Stack a card on one that is one rank higher and the opposite colour — 7♥ onto 8♠.']),
      el('li', {}, ['A properly ordered run moves as a single unit for a single move.']),
      el('li', {}, ['Tap a card to pick it up and see where it can go, then tap a target. Tap it twice to send it to the obvious place. Or just drag it.']),
      el('li', {}, ['Uncovering a face-down card turns it automatically.']),
    ]),
    el('h3', {}, ['Moves are the clock']),
    el('p', {}, ['Every level gives you a fixed allowance of moves. Run out and the run ends. The allowance is set by actually solving the board first, so every deal you are given can be cleared — the question is whether you find the line.']),
    el('h3', {}, ['The run']),
    el('ul', {}, [
      el('li', {}, ['Each level offers a choice of boards. Safer ones pay less; gauntlets bite harder and pay more.']),
      el('li', {}, ['Clearing a level lets you enchant, add or remove a card, or take a charm.']),
      el('li', {}, ['Your deck IS the board. Thin it and levels get short and brittle; grow it and you get more cards carrying more power.']),
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
