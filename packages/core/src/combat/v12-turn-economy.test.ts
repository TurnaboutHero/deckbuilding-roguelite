import { describe, expect, it } from 'vitest';

import type { ContentDb, FlipSkillDef, SkillDef } from '../content-types';
import { validateContentDb } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import { legalCommands } from './commands';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const ladderSkill = (value: string, definition: Record<string, unknown>): FlipSkillDef =>
  ({
    id: id<SkillId>(value),
    name: value,
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    base: [],
    ...definition
  }) as unknown as FlipSkillDef;

const neutralLadder = ladderSkill('neutral-ladder', {
  cost: 1,
  successFace: 'heads',
  successLadder: [[], [{ kind: 'damage', amount: 4 }]]
});

const fireLadder = ladderSkill('fire-ladder', {
  cost: 1,
  element: 'fire',
  successFace: 'heads',
  successLadder: [[], [{ kind: 'damage', amount: 4 }]]
});

const legacySkill: FlipSkillDef = {
  id: id<SkillId>('legacy-skill'),
  name: 'legacy-skill',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  base: [{ kind: 'damage', amount: 1 }]
};

const testDb = (skills: readonly SkillDef[] = [neutralLadder, fireLadder, legacySkill]): ContentDb => {
  const db = {
    coins: {
      basic: { id: id<CoinDefId>('basic'), element: null },
      fire: { id: id<CoinDefId>('fire'), element: 'fire' as const },
      frost: { id: id<CoinDefId>('frost'), element: 'frost' as const }
    },
    skills: Object.fromEntries(skills.map((skill) => [String(skill.id), skill])),
    enemies: {
      target: {
        id: id<EnemyDefId>('target'),
        name: 'target',
        maxHp: 100,
        intents: [{ id: 'wait', actions: [] }]
      }
    },
    characters: {
      tester: {
        id: id<CharacterId>('tester'),
        name: 'tester',
        maxHp: 50,
        startingBag: Array.from({ length: 20 }, () => id<CoinDefId>('basic')),
        startingSkills: skills.map((skill) => skill.id),
        trait: { id: 'none', name: 'none', hook: 'combatStart' as const, effects: [] }
      }
    }
  };
  return { ...db, validate: () => validateContentDb(db) };
};

const combat = (db = testDb()): CombatState =>
  createCombat({ character: id<CharacterId>('tester'), enemies: [id<EnemyDefId>('target')] }, db, 'v1.2-turn-economy');

const redrawWith = (input: CombatState, db: ContentDb, penalty: number, bonus: number): CombatState => {
  const allCoins = Object.values(input.coins).map((coin) => coin.uid);
  const prepared: CombatState = {
    ...input,
    player: { ...input.player, nextDrawPenalty: penalty, nextDrawBonus: bonus },
    zones: { ...input.zones, hand: [], draw: allCoins, discard: [], exhausted: [] }
  };
  const ended = step(prepared, { type: 'endTurn' }, db);
  if (!ended.ok) throw new Error(ended.error);
  return ended.state;
};

const withCoin = (input: CombatState, coin: CoinUid, defId: string): CombatState => ({
  ...input,
  coins: {
    ...input.coins,
    [Number(coin)]: { ...input.coins[Number(coin)]!, defId: id<CoinDefId>(defId) }
  }
});

const canPlace = (state: CombatState, db: ContentDb, coin: CoinUid, skillSlot: number): boolean =>
  legalCommands(state, db).some(
    (command) => command.type === 'placeCoin' && command.coin === coin && command.slot === slot(skillSlot)
  );

describe('v1.2 turn-start draw economy', () => {
  it('draws exactly 3 coins on the first player turn', () => {
    expect(combat().zones.hand).toHaveLength(3);
  });

  it('applies draw penalty and bonus to base 3 while retaining the 0..8 clamps', () => {
    const db = testDb();
    const initial = combat(db);
    expect(redrawWith(initial, db, 1, 0).zones.hand).toHaveLength(2);
    expect(redrawWith(initial, db, 0, 2).zones.hand).toHaveLength(5);
    expect(redrawWith(initial, db, 10, 0).zones.hand).toHaveLength(0);
    expect(redrawWith(initial, db, 0, 10).zones.hand).toHaveLength(8);
  });
});

describe('v1.2 ladder placement legality', () => {
  const cases = [
    { coin: 'basic', skillSlot: 0, allowed: true, label: 'basic -> neutral ladder' },
    { coin: 'fire', skillSlot: 0, allowed: false, label: 'element -> neutral ladder' },
    { coin: 'basic', skillSlot: 1, allowed: true, label: 'basic -> element ladder' },
    { coin: 'fire', skillSlot: 1, allowed: true, label: 'matching element -> element ladder' },
    { coin: 'frost', skillSlot: 1, allowed: true, label: 'off-element -> element ladder' },
    { coin: 'basic', skillSlot: 2, allowed: true, label: 'basic -> legacy' },
    { coin: 'fire', skillSlot: 2, allowed: true, label: 'element -> legacy' }
  ] as const;

  for (const entry of cases) {
    it(`enforces ${entry.label} in legalCommands and step`, () => {
      const db = testDb();
      let state = combat(db);
      const coin = state.zones.hand[0]!;
      state = withCoin(state, coin, entry.coin);
      expect(canPlace(state, db, coin, entry.skillSlot)).toBe(entry.allowed);

      const snapshot = structuredClone(state);
      const placed = step(state, { type: 'placeCoin', coin, slot: slot(entry.skillSlot) }, db);
      expect(placed.ok).toBe(entry.allowed);
      expect(state).toEqual(snapshot);
    });
  }

  it('revalidates the rule when placed coins are moved or swapped between slots', () => {
    const db = testDb();
    let state = combat(db);
    const basic = state.zones.hand[0]!;
    const element = state.zones.hand[1]!;
    state = withCoin(state, element, 'fire');

    const basicPlaced = step(state, { type: 'placeCoin', coin: basic, slot: slot(0) }, db);
    if (!basicPlaced.ok) throw new Error(basicPlaced.error);
    const elementPlaced = step(basicPlaced.state, { type: 'placeCoin', coin: element, slot: slot(1) }, db);
    if (!elementPlaced.ok) throw new Error(elementPlaced.error);

    const basicUnplaced = step(elementPlaced.state, { type: 'unplaceCoin', coin: basic }, db);
    if (!basicUnplaced.ok) throw new Error(basicUnplaced.error);
    const elementUnplaced = step(basicUnplaced.state, { type: 'unplaceCoin', coin: element }, db);
    if (!elementUnplaced.ok) throw new Error(elementUnplaced.error);

    expect(step(elementUnplaced.state, { type: 'placeCoin', coin: element, slot: slot(0) }, db)).toMatchObject({
      ok: false
    });
    expect(step(elementUnplaced.state, { type: 'placeCoin', coin: basic, slot: slot(1) }, db)).toMatchObject({
      ok: true
    });
  });
});
