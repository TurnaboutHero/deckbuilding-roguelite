import { describe, expect, it } from 'vitest';

import type { CoinDefId, CharacterId, EnemyDefId, Face, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import type { ContentDb, FlipSkillDef, SkillDef } from '../content-types';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const scriptedFlips = (faces: readonly Face[]): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      const face = faces[index];
      if (face === undefined) throw new Error('scripted flip exhausted');
      index += 1;
      return face;
    },
    shuffle: <T>(items: readonly T[]) => [...items],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const attack = (extra: Partial<FlipSkillDef> = {}): FlipSkillDef => ({
  id: id<SkillId>('fire-fist'),
  name: 'fire-fist',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  base: [{ kind: 'damage', amount: 2 }],
  overheatBonus: [{ kind: 'damage', amount: 3 }],
  elementFaces: [{ element: 'fire', face: 'heads', effects: [{ kind: 'scheduleOverheat' }] }],
  ...extra
});

const dbFor = (skills: readonly SkillDef[], enemyHp = 30): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: {
      id: id<CoinDefId>('fire'),
      element: 'fire',
      procs: { heads: [{ kind: 'damage', amount: 1 }], tails: [{ kind: 'block', amount: 1 }] }
    }
  },
  skills: Object.fromEntries(skills.map((skill) => [String(skill.id), skill])),
  enemies: {
    dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: enemyHp, intents: [{ id: 'idle', actions: [] }] }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: 'warrior',
      maxHp: 40,
      startingBag: [id<CoinDefId>('fire'), id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic')],
      startingSkills: skills.map((skill) => skill.id),
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  passives: {
    residual: {
      id: id('residual'),
      name: 'residual',
      description: 'residual',
      element: 'fire',
      hook: 'combatStart',
      effects: [],
      mechanic: 'residualHeat',
      price: 1
    }
  },
  validate: () => []
});

const combat = (db: ContentDb, faces: readonly Face[] = ['heads']): CombatState => ({
  ...createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('dummy')] }, db, 'overheat-pending'),
  zones: { draw: [], hand: [1 as never, 2 as never, 3 as never, 4 as never, 5 as never], placed: createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('dummy')] }, db, 'overheat-pending').zones.placed, discard: [], exhausted: [] },
  rngImpl: { flip: scriptedFlips(faces) }
});

const useFlip = (state: CombatState, db: ContentDb, slotIndex = 0): ReturnType<typeof step> & { ok: true } => {
  const placed = step(state, { type: 'placeCoin', coin: state.zones.hand[0]!, slot: slot(slotIndex) }, db);
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slot(slotIndex), target: 0 }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

describe('pending overheat', () => {
  it('schedules overheat and activates it at the next player turn start', () => {
    const db = dbFor([attack()]);
    const scheduled = useFlip(combat(db), db);
    expect(scheduled.events).toContainEqual({ type: 'overheatScheduled' });
    expect(scheduled.state.player.pendingOverheat).toBe(true);
    expect(scheduled.state.player.overheat).toBe(false);

    const ended = step(scheduled.state, { type: 'endTurn' }, db);
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.events).toContainEqual({ type: 'overheatActivated' });
    expect(ended.state.player.pendingOverheat).toBe(false);
    expect(ended.state.player.overheat).toBe(true);
  });

  it('drops a pending reservation without stacking when overheat is already active at turn start', () => {
    const db = dbFor([attack()]);
    const ended = step({ ...combat(db), player: { ...combat(db).player, overheat: true, pendingOverheat: true } }, { type: 'endTurn' }, db);
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.events.some((event) => event.type === 'overheatActivated')).toBe(false);
    expect(ended.state.player.pendingOverheat).toBe(false);
    expect(ended.state.player.overheat).toBe(true);
  });

  it('clears pending overheat when combat ends', () => {
    const db = dbFor([attack({ base: [{ kind: 'scheduleOverheat' }, { kind: 'damage', amount: 99 }] })], 3);
    const result = useFlip(combat(db), db);
    expect(result.state.phase).toBe('victory');
    expect(result.state.player.pendingOverheat).toBe(false);
  });

  it('does not schedule while overheat is active', () => {
    const db = dbFor([attack()]);
    const result = useFlip({ ...combat(db), player: { ...combat(db).player, overheat: true } }, db);
    expect(result.events.some((event) => event.type === 'overheatScheduled')).toBe(false);
    expect(result.state.player.pendingOverheat).toBe(false);
    expect(result.state.player.overheat).toBe(false);
    expect(result.events).toContainEqual({ type: 'overheatConsumed', skill: id<SkillId>('fire-fist') });
  });

  it('residualHeat schedules once for a non-overheated attack using a fire coin', () => {
    const db = dbFor([attack({ elementFaces: [] })]);
    const first = useFlip({ ...combat(db), passives: [id('residual')] }, db);
    expect(first.events).toContainEqual({ type: 'overheatScheduled' });
    expect(first.state.player.residualHeatUsed).toBe(true);
  });
});
