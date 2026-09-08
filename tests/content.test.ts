/**
 * Guards against content that exists but does nothing.
 *
 * Locksmith is the case that prompted these: a 60-gold rare reading
 * "Empty-column restrictions never apply to you" which set `RuleSet.empty` to
 * the value it already had, because nothing in the game ever set it away from
 * 'any'. It shipped that way for months. Keystone had the same problem from the
 * other side and its own comment recorded the symptom without finding the
 * cause: "under standard rules there are none to bypass — measured, it saved 0
 * of 19 lost boards."
 *
 * Two different tests, because they catch two different failures. A grep finds
 * an id nothing reads. It does NOT find an id that is read by a line with no
 * effect, which is exactly what Locksmith was — so the second test asserts the
 * rule charms change the rules in the situation their own text names.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARMS, CONSUMABLES, ENCHANTS, MODIFIERS } from '../src/game/content.ts';
import { buildRules } from '../src/game/deal.ts';
import { DEFAULT_RULES } from '../src/game/types.ts';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith('.ts') && e.name !== 'content.ts') out.push(p);
  }
  return out;
}

const SRC = sourceFiles('src').map((f) => readFileSync(f, 'utf8')).join('\n');

describe('every piece of content is read by something', () => {
  const cases: [string, string[]][] = [
    ['charm', Object.keys(CHARMS)],
    ['enchantment', Object.keys(ENCHANTS)],
    ['modifier', Object.keys(MODIFIERS)],
    ['consumable', Object.keys(CONSUMABLES)],
  ];

  for (const [kind, ids] of cases) {
    it(`names every ${kind} somewhere outside its definition`, () => {
      const dead = ids.filter((id) => !SRC.includes(`'${id}'`));
      expect(dead, `${kind}s nothing reads: ${dead.join(', ')}`).toEqual([]);
    });
  }
});

describe('the rule charms actually change the rules', () => {
  const ranks = [1, 2, 3, 4, 5, 6, 7];

  it('Locksmith lifts an empty-column restriction that is actually there', () => {
    // The bug it is named for: measured against DEFAULT rules this charm is a
    // no-op, because the default already admits anything into an empty column.
    // It has to be tested against a board that restricts them, which is the
    // situation its text describes.
    expect(buildRules(['royalGates'], [], ranks).empty).toBe('top');
    expect(buildRules(['royalGates'], ['locksmith'], ranks).empty).toBe('any');
  });

  it('Sorter lifts the group-size cap that Gridlock imposes', () => {
    expect(buildRules(['gridlock'], [], ranks).maxGroup).toBe(3);
    expect(buildRules(['gridlock'], ['sorter'], ranks).maxGroup).toBe(0);
  });

  it('leaves the rules alone when no charm and no modifier ask for a change', () => {
    const plain = buildRules([], [], ranks);
    expect(plain.empty).toBe(DEFAULT_RULES.empty);
    expect(plain.maxGroup).toBe(DEFAULT_RULES.maxGroup);
    expect(plain.drawCount).toBe(DEFAULT_RULES.drawCount);
    expect(plain.passes).toBe(DEFAULT_RULES.passes);
  });
});

describe('every rule a modifier claims is one the sim reads', () => {
  // The four fields wired this session had sat unused for months: the sim
  // honoured drawCount, empty, groups and passes, and nothing ever set them.
  it('has a modifier for each RuleSet field the sim branches on', () => {
    const wired = {
      drawCount: buildRules(['draw3'], [], ranksOf()).drawCount,
      empty: buildRules(['royalGates'], [], ranksOf()).empty,
      passes: buildRules(['onepass'], [], ranksOf()).passes,
      maxGroup: buildRules(['gridlock'], [], ranksOf()).maxGroup,
      maxHeight: buildRules(['ceiling'], [], ranksOf()).maxHeight,
      emptyCost: buildRules(['tithe'], [], ranksOf()).emptyCost,
      drawCost: buildRules(['heavydraw'], [], ranksOf()).drawCost,
      match: buildRules(['sameSuit'], [], ranksOf()).match,
      dir: buildRules(['ascend'], [], ranksOf()).dir,
    };
    const unchanged = Object.entries(wired).filter(
      ([k, v]) => v === (DEFAULT_RULES as unknown as Record<string, unknown>)[k],
    );
    expect(unchanged, `no modifier moves these off their default: ${unchanged.map(([k]) => k).join(', ')}`).toEqual([]);
  });
});

function ranksOf(): number[] {
  return [1, 2, 3, 4, 5, 6, 7];
}
