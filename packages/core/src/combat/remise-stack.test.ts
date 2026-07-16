import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, Face, Rng, RngSnapshot, SkillId, SlotId } from '../index';
import type { ConsumeSkillDef, ContentDb, FlipSkillDef, SkillDef } from '../content-types';
import { previewFlip } from './preview';
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

const attack = (skillId: string, extra: Partial<FlipSkillDef> = {}): FlipSkillDef => ({
  id: id<SkillId>(skillId),
  name: skillId,
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  base: [{ kind: 'damage', amount: 6 }],
  ...extra
});

const defense: FlipSkillDef = {
  id: id<SkillId>('guard'),
  name: 'guard',
  type: 'flip',
  rarity: 'common',
  tags: ['defense'],
  targetType: 'self',
  cost: 1,
  base: [{ kind: 'block', amount: 2 }]
};

const consume: ConsumeSkillDef = {
  id: id<SkillId>('consume'),
  name: 'consume',
  type: 'consume',
  rarity: 'common',
  tags: ['utility'],
  targetType: 'none',
  consume: { element: 'lightning', count: 1 },
  effects: [{ kind: 'block', amount: 1 }]
};

const dbFor = (skills: readonly SkillDef[], passives: ContentDb['passives'] = {}): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    lightning: { id: id<CoinDefId>('lightning'), element: 'lightning', procs: { heads: [{ kind: 'damage', amount: 1 }], tails: [{ kind: 'block', amount: 1 }] } }
  },
  skills: Object.fromEntries(skills.map((skill) => [String(skill.id), skill])),
  enemies: {
    dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: 200, intents: [{ id: 'idle', actions: [] }] }
  },
  characters: {
    duelist: {
      id: id<CharacterId>('duelist'),
      name: 'duelist',
      maxHp: 40,
      startingBag: [id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('lightning')],
      startingSkills: skills.map((skill) => skill.id),
      trait: { id: 'remise', name: 'remise', hook: 'combatStart', effects: [], mechanic: 'remise' }
    }
  },
  passives,
  validate: () => []
});

const combat = (db: ContentDb, faces: readonly Face[], skillCount = 1): CombatState => {
  const state = createCombat(
    {
      character: id<CharacterId>('duelist'),
      enemies: [id<EnemyDefId>('dummy')],
      bag: [id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('lightning')],
      equippedSkills: Array.from({ length: skillCount }, (_unused, index) => id<SkillId>(`attack-${index}`))
    },
    db,
    'remise-stack'
  );
  return {
    ...state,
    zones: { ...state.zones, hand: [1, 2, 3, 4].map((value) => value as CoinUid), draw: [], discard: [] },
    rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
  };
};

const useFlip = (state: CombatState, db: ContentDb, slotId: SlotId, coin: CoinUid): ReturnType<typeof step> & { ok: true } => {
  const placed = step(state, { type: 'placeCoin', coin, slot: slotId }, db);
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slotId, target: 0 }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

const skillDamage = (events: CombatState['events']): number =>
  events.reduce((sum, event) => (event.type === 'damageDealt' && event.source === 'skill' ? sum + event.amount : sum), 0);

describe('stack remise contract', () => {
  it('matches the acceptance math and spends stacks even on tails', () => {
    const skills = [attack('attack-0'), attack('attack-1'), attack('attack-2')];
    const db = dbFor(skills);
    const state = { ...combat(db, ['heads', 'heads', 'tails', 'heads', 'heads'], 3), player: { ...combat(db, [], 3).player, remiseCharges: 3 } };
    const preview = previewFlip({ ...state, zones: { ...state.zones, placed: { ...state.zones.placed, [slot(0)]: [1 as CoinUid] } } }, slot(0), db);
    const repeatProbability = preview.branches.filter((branch) => branch.damage === 12).reduce((sum, branch) => sum + branch.probability, 0);

    let current = state;
    const damages: number[] = [];
    const allEvents: CombatState['events'] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = useFlip(current, db, slot(index), (index + 1) as CoinUid);
      damages.push(skillDamage(result.events));
      allEvents.push(...result.events);
      current = result.state;
    }

    expect(repeatProbability).toBe(0.5);
    expect(preview.expected.damage * 3).toBe(27);
    expect(0.5 ** 3).toBe(0.125);
    expect(preview.byAxis.damage.max * 3).toBe(36);
    expect(damages).toEqual([12, 6, 12]);
    expect(current.player.remiseCharges).toBe(0);
    expect(allEvents.filter((event) => event.type === 'remiseSpent' && event.firstFace === 'tails')).toHaveLength(1);
  });

  it('caps at three, grants once at player turn start, clears at turn end, and ignores non-attacks', () => {
    const db = dbFor([attack('attack-0'), defense, consume]);
    const started = combat(db, ['tails'], 1);
    expect(started.player.remiseCharges).toBe(1);
    const capped = step({ ...started, player: { ...started.player, remiseCharges: 3 } }, { type: 'endTurn' }, db);
    if (!capped.ok) throw new Error(capped.error);
    expect(capped.state.player.remiseCharges).toBe(1);

    const guarded = useFlip({ ...started, slots: started.slots.map((item, index) => (index === 0 ? { ...item, skillId: defense.id } : item)) }, db, slot(0), 1 as CoinUid);
    expect(guarded.state.player.remiseCharges).toBe(1);
    expect(guarded.events.some((event) => event.type === 'remiseSpent')).toBe(false);

    const consumeState = { ...started, slots: started.slots.map((item, index) => (index === 0 ? { ...item, skillId: consume.id } : item)) };
    const consumed = step(consumeState, { type: 'useConsumeSkill', slot: slot(0), coins: [4 as CoinUid] }, db);
    if (!consumed.ok) throw new Error(consumed.error);
    expect(consumed.state.player.remiseCharges).toBe(1);
    expect(consumed.events.some((event) => event.type === 'remiseSpent')).toBe(false);
  });

  it('does not recurse repeats and keeps draw/create/remise gain original-only while damageIfReused is repeat-only', () => {
    const skill = attack('attack-0', {
      base: [
        { kind: 'damage', amount: 2 },
        { kind: 'draw', count: 1 },
        { kind: 'addCoin', coin: id<CoinDefId>('basic'), zone: 'hand', count: 1 },
        { kind: 'readyRemise' },
        { kind: 'damageIfReused', amount: 5 }
      ]
    });
    const db = dbFor([skill]);
    const result = useFlip({ ...combat(db, ['heads', 'tails']), player: { ...combat(db, []).player, remiseCharges: 1 } }, db, slot(0), 1 as CoinUid);

    expect(skillDamage(result.events)).toBe(9);
    expect(result.events.filter((event) => event.type === 'coinsDrawn')).toHaveLength(0);
    expect(result.events.filter((event) => event.type === 'coinCreated')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'remiseSpent')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'remiseRepeatResolved')).toHaveLength(1);
    expect(result.state.player.remiseCharges).toBe(1);
  });

  it('keeps remise repeat RNG on the flip stream only', () => {
    const db = dbFor([attack('attack-0')]);
    const base = { ...combat(db, ['heads', 'tails']), player: { ...combat(db, []).player, remiseCharges: 1 } };
    const beforeShuffle = JSON.stringify(base.rng.shuffle);
    const beforeAi = JSON.stringify(base.rng.ai);
    const result = useFlip(base, db, slot(0), 1 as CoinUid);

    expect(JSON.stringify(result.state.rng.shuffle)).toBe(beforeShuffle);
    expect(JSON.stringify(result.state.rng.ai)).toBe(beforeAi);
  });
});
