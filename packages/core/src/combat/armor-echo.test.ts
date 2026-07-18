import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import type { ConsumeSkillDef, ContentDb, SkillDef } from '../content-types';
import { createCombat, step } from './reducer';
import type { CombatEvent } from './events';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const consume = (skillId: string, effects: ConsumeSkillDef['effects'], targetType: ConsumeSkillDef['targetType'] = 'single-enemy'): ConsumeSkillDef => ({
  id: id<SkillId>(skillId),
  name: skillId,
  type: 'consume',
  rarity: 'common',
  tags: ['attack'],
  targetType,
  consume: { element: 'mana', count: 1 },
  effects
});

const dbFor = (skills: readonly SkillDef[], enemyActions: ContentDb['enemies'][string]['intents'][number]['actions']): ContentDb => ({
  coins: {
    mana: {
      id: id<CoinDefId>('mana'),
      element: 'mana',
      procs: { heads: [{ kind: 'damage', amount: 1 }], tails: [{ kind: 'block', amount: 1 }] }
    }
  },
  skills: Object.fromEntries(skills.map((skill) => [String(skill.id), skill])),
  enemies: {
    dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: 80, intents: [{ id: 'attack', actions: enemyActions }] }
  },
  characters: {
    arcanist: {
      id: id<CharacterId>('arcanist'),
      name: 'arcanist',
      maxHp: 50,
      startingBag: [id<CoinDefId>('mana'), id<CoinDefId>('mana'), id<CoinDefId>('mana'), id<CoinDefId>('mana'), id<CoinDefId>('mana')],
      startingSkills: skills.map((skill) => skill.id),
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (db: ContentDb): CombatState => ({
  ...createCombat({ character: id<CharacterId>('arcanist'), enemies: [id<EnemyDefId>('dummy')] }, db, 'armor-echo'),
  zones: { ...createCombat({ character: id<CharacterId>('arcanist'), enemies: [id<EnemyDefId>('dummy')] }, db, 'armor-echo').zones, draw: [], hand: [1, 2, 3, 4, 5].map((value) => value as CoinUid), discard: [] }
});

const endTurnWithBlock = (state: CombatState, db: ContentDb, block: number): ReturnType<typeof step> & { ok: true } => {
  const ended = step({ ...state, player: { ...state.player, block } }, { type: 'endTurn' }, db);
  if (!ended.ok) throw new Error(ended.error);
  return ended;
};

const useConsume = (state: CombatState, db: ContentDb, slotIndex: number, target = 0): ReturnType<typeof step> & { ok: true } => {
  const used = step(state, { type: 'useConsumeSkill', slot: slot(slotIndex), coins: [state.zones.hand[0]!], target }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

const echoComputed = (events: readonly CombatEvent[]) => {
  const event = events.find((candidate) => candidate.type === 'echoComputed');
  if (event?.type !== 'echoComputed') throw new Error('missing echoComputed');
  return event;
};

const hpLoss = (before: CombatState, after: CombatState): number => (before.enemies[0]?.hp ?? 0) - (after.enemies[0]?.hp ?? 0);

describe('armor echo', () => {
  it('computes base echo as min(absorbed, 6)', () => {
    const db = dbFor([], [{ kind: 'attack', damage: 9 }]);
    const ended = endTurnWithBlock(combat(db), db, 20);
    expect(echoComputed(ended.events)).toMatchObject({ base: 6, preheat: 0, precision: 0, total: 6 });
    expect(ended.state.player.armorEcho).toBe(6);
    expect(ended.state.player.armorEchoAvailable).toBe(true);
  });

  it('ignores preheat and precision bonuses when no damage was absorbed', () => {
    const db = dbFor([consume('arm', [{ kind: 'echoPreheat', amount: 4 }, { kind: 'precisionDefenseArm' }], 'none')], []);
    const armed = useConsume(combat(db), db, 0);
    const ended = endTurnWithBlock(armed.state, db, 0);
    expect(echoComputed(ended.events)).toMatchObject({ base: 0, preheat: 0, precision: 0, total: 0 });
    expect(ended.state.player.armorEcho).toBe(0);
  });

  it('adds preheat and precision bonuses with a final cap of 12', () => {
    const db = dbFor([consume('arm', [{ kind: 'echoPreheat', amount: 5 }, { kind: 'precisionDefenseArm' }], 'none')], [{ kind: 'attack', damage: 11 }]);
    const armed = useConsume(combat(db), db, 0);
    const ended = endTurnWithBlock(armed.state, db, 12);
    expect(echoComputed(ended.events)).toMatchObject({ base: 6, preheat: 5, precision: 4, total: 12 });
    expect(ended.state.player.echoPreheat).toBe(0);
    expect(ended.state.player.precisionDefenseArmed).toBe(false);
  });

  it('keeps echo through the next player turn and clears unused echo at player turn end', () => {
    const db = dbFor([], [{ kind: 'attack', damage: 4 }]);
    const echoed = endTurnWithBlock(combat(db), db, 10).state;
    expect(echoed.player.block).toBe(0);
    expect(echoed.player.armorEcho).toBe(4);

    const endedAgain = step(echoed, { type: 'endTurn' }, db);
    if (!endedAgain.ok) throw new Error(endedAgain.error);
    expect(endedAgain.state.player.armorEcho).toBe(0);
    expect(endedAgain.state.player.armorEchoAvailable).toBe(false);
  });

  it('spends echo amplification availability once without consuming the echo value', () => {
    const db = dbFor(
      [
        consume('smash', [{ kind: 'damagePlusEcho', base: 6 }]),
        consume('release', [{ kind: 'aoeDamagePlusEcho', base: 4 }], 'all-enemies')
      ],
      [{ kind: 'attack', damage: 4 }]
    );
    let state = endTurnWithBlock(combat(db), db, 10).state;
    const beforeFirst = state;
    const first = useConsume(state, db, 0);
    expect(hpLoss(beforeFirst, first.state)).toBe(10);
    expect(first.events).toContainEqual({ type: 'echoSpent', skill: id<SkillId>('smash'), amount: 4 });
    expect(first.state.player.armorEcho).toBe(4);
    expect(first.state.player.armorEchoAvailable).toBe(false);

    state = first.state;
    const beforeSecond = state;
    const second = useConsume(state, db, 1);
    expect(hpLoss(beforeSecond, second.state)).toBe(4);
    expect(second.events.some((event) => event.type === 'echoSpent')).toBe(false);
  });

  it('reduces Armor Smash authored base before adding the unscaled echo contribution', () => {
    const db = dbFor([consume('armor-smash', [{ kind: 'damagePlusEcho', base: 6 }])], [{ kind: 'attack', damage: 4 }]);
    const echoed = endTurnWithBlock(combat(db), db, 10).state;
    const sealed = {
      ...echoed,
      player: {
        ...echoed.player,
        skillSeals: { 0: { turns: 1, effectMultiplier: 0.75, fallback: true } }
      }
    };

    const used = useConsume(sealed, db, 0);

    expect(hpLoss(sealed, used.state)).toBe(8);
    expect(used.events).toContainEqual({ type: 'echoSpent', skill: id<SkillId>('armor-smash'), amount: 4 });
  });

  it('does not consume current block when echo damage atoms resolve', () => {
    const db = dbFor([consume('smash', [{ kind: 'damagePlusEcho', base: 6 }])], [{ kind: 'attack', damage: 4 }]);
    const state = { ...endTurnWithBlock(combat(db), db, 10).state, player: { ...endTurnWithBlock(combat(db), db, 10).state.player, block: 7 } };
    const result = useConsume(state, db, 0);
    expect(result.state.player.block).toBe(7);
  });

  it('excludes block-ignoring damage from absorbed tracking', () => {
    const db = dbFor([], [{ kind: 'applyStatus', status: 'burn', stacks: 3 }]);
    const state = { ...combat(db), player: { ...combat(db).player, statuses: { burn: { kind: 'stack' as const, stacks: 3 } } } };
    const ended = endTurnWithBlock(state, db, 10);
    expect(echoComputed(ended.events)).toMatchObject({ base: 0, preheat: 0, precision: 0, total: 0 });
  });
});
