/** Builds and updates a single card element. */
import { CURSES, ENCHANTS } from '../game/content.ts';
import { RANK_LABEL, SUIT_GLYPH, type CardDef } from '../game/types.ts';
import { el } from './dom.ts';

export function makeCardEl(def: CardDef, index: number): HTMLElement {
  const suit = SUIT_GLYPH[def.suit];
  const rank = RANK_LABEL[def.rank];
  const front = el('div', { class: `face front s${def.suit}` }, [
    el('div', { class: 'corner tl' }, [el('span', { class: 'r' }, [rank]), el('span', { class: 'p' }, [suit])]),
    el('div', { class: 'centre' }, [suit]),
  ]);

  if (def.ench) {
    const e = ENCHANTS[def.ench];
    front.append(el('div', { class: 'badge ench', 'aria-label': e.name }, [e.glyph]));
  }
  if (def.curse) {
    const c = CURSES[def.curse];
    front.append(el('div', { class: 'badge curse', 'aria-label': c.name }, [c.glyph]));
  }

  const back = el('div', { class: 'face back' }, [el('div', { class: 'weave' })]);

  const node = el(
    'div',
    {
      class: 'card down',
      'data-id': String(index),
      role: 'button',
      'aria-label': `${rank} of ${['spades', 'hearts', 'diamonds', 'clubs'][def.suit]}`,
    },
    [el('div', { class: 'flip' }, [front, back])],
  );
  return node;
}

export function describeCard(def: CardDef): string {
  const bits = [`${RANK_LABEL[def.rank]}${SUIT_GLYPH[def.suit]}`];
  if (def.ench) bits.push(`${ENCHANTS[def.ench].name} — ${ENCHANTS[def.ench].text}`);
  if (def.curse) bits.push(`${CURSES[def.curse].name} — ${CURSES[def.curse].text}`);
  return bits.join('\n');
}
