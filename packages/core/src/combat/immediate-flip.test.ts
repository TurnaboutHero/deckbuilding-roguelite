import { describe, expect, it } from 'vitest';

import type { ContentDb, SkillDef } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, SkillId, SlotId } from '../ids';
import { rngFrom, seedFromString } from '../rng';
import { legalCommands } from './commands';
import type { Command } from './commands';
import { createCombat, step } from './reducer';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const immediateDb = (): ContentDb => {
  const skills: SkillDef[] = [
    {
      id: id<SkillId>('strike'), name: 'Strike', rarity: 'common', tags: ['attack'], targetType: 'single-enemy',
      type: 'flip', cooldown: 0, cost: 1, successFace: 'heads', successLadder: [[{ kind: 'damage', amount: 2 }], [{ kind: 'damage', amount: 4 }]]
    },
    {
      id: id<SkillId>('guard'), name: 'Guard', rarity: 'common', tags: ['defense'], targetType: 'self',
      type: 'flip', cooldown: 0, cost: 1, successFace: 'tails', successLadder: [[{ kind: 'block', amount: 2 }], [{ kind: 'block', amount: 4 }]]
    }
  ];
  return {
    coins: {
      basic: {
        id: id<CoinDefId>('basic'), element: null,
        procs: { heads: [{ kind: 'damage', amount: 4 }], tails: [{ kind: 'block', amount: 4 }] }
      },
      fire: { id: id<CoinDefId>('fire'), element: 'fire', procs: { heads: [{ kind: 'fixedDamage', amount: 3 }], tails: [] } },
      frost: { id: id<CoinDefId>('frost'), element: 'frost', procs: { heads: [], tails: [{ kind: 'block', amount: 3 }, { kind: 'nextTurnBlock', amount: 2 }] } }
    },
    skills: Object.fromEntries(skills.map((skill) => [String(skill.id), skill])),
    enemies: {
      first: { id: id<EnemyDefId>('first'), name: 'First', maxHp: 20, intents: [{ id: 'wait', actions: [] }] },
      second: { id: id<EnemyDefId>('second'), name: 'Second', maxHp: 20, intents: [{ id: 'wait', actions: [] }] }
    },
    characters: {
      hero: {
        id: id<CharacterId>('hero'), name: 'Hero', maxHp: 30,
        startingBag: [id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('fire')],
        startingSkills: [id<SkillId>('strike'), id<SkillId>('guard')],
        trait: { id: 'none', name: 'None', hook: 'combatStart', effects: [] }
      }
    },
    validate: () => []
  };
};

const ready = (db: ContentDb, enemies: readonly EnemyDefId[] = [id<EnemyDefId>('first')]) =>
  createCombat({ character: id<CharacterId>('hero'), enemies, bag: [id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('fire')] }, db, 'immediate');

const withNextFace = (state: ReturnType<typeof ready>, face: 'heads' | 'tails') => {
  for (let index = 0; ; index += 1) {
    const flip = seedFromString(`immediate-${face}-${index}`);
    if (rngFrom(flip).flip() === face) return { ...state, rng: { ...state.rng, flip } };
  }
};

describe('immediate predictive flip commands', () => {
  it('resolves selected hand coins immediately without placement or a reservation', () => {
    const db = immediateDb();
    const state = withNextFace(ready(db), 'heads');
    const coin = state.zones.hand.find((candidate) => String(state.coins[Number(candidate)]!.defId) === 'basic')!;
    const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [coin], target: 0 }, db);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.state.flipReservations).toEqual([]);
    expect(result.state.zones.placed[slot(0)]).toEqual([]);
    expect(result.state.zones.hand).not.toContain(coin);
    expect(result.state.zones.discard).toContain(coin);
    // The basic coin's v4.5 heads proc is resolved in addition to the skill tier.
    expect(result.state.enemies[0]!.hp).toBe(12);
  });

  it('always uses and advances combat RNG instead of accepting a caller-selected face', () => {
    const db = immediateDb();
    const state = ready(db);
    const coin = state.zones.hand[0]!;
    const expectedFace = rngFrom(state.rng.flip).flip();
    const attemptedFace = expectedFace === 'heads' ? 'tails' : 'heads';
    const malformed = {
      type: 'useImmediateFlipSkill',
      slot: slot(0),
      coins: [coin],
      target: 0,
      declaredFaces: [attemptedFace]
    } as unknown as Command;

    const result = step(state, malformed, db);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.events).toContainEqual({ type: 'coinFlipped', coin, face: expectedFace });
    expect(result.events).not.toContainEqual({ type: 'coinFlipped', coin, face: attemptedFace });
    expect(result.state.rng.flip).not.toEqual(state.rng.flip);
  });

  it('surfaces only direct immediate flip commands instead of placement or reservations', () => {
    const commands = legalCommands(ready(immediateDb()), immediateDb());

    expect(commands.some((command) => command.type === 'placeCoin' || command.type === 'unplaceCoin' || command.type === 'useFlipSkill')).toBe(false);
    const immediate = commands.filter((command): command is Extract<Command, { type: 'useImmediateFlipSkill' }> => command.type === 'useImmediateFlipSkill');
    expect(immediate).toContainEqual(expect.objectContaining({ type: 'useImmediateFlipSkill', slot: slot(0) }));
    expect(immediate.every((command) => !('declaredFaces' in command))).toBe(true);
  });

  it('allows a zero-cooldown repeat skill to be used again this turn with a new target', () => {
    const db = immediateDb();
    const state = withNextFace(ready(db, [id<EnemyDefId>('first'), id<EnemyDefId>('second')]), 'heads');
    const [firstCoin, secondCoin] = state.zones.hand.filter((candidate) => String(state.coins[Number(candidate)]!.defId) === 'basic');
    const first = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [firstCoin!], target: 1 }, db);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    expect(first.state.lastTargetedEnemy).toBe(1);
    const second = step(first.state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [secondCoin!], target: 0 }, db);
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    expect(second.state.lastTargetedEnemy).toBe(0);
    expect(second.state.enemies[1]!.hp).toBe(12);
  });

  it('accepts an elemental coin in a neutral predictive skill and applies its RNG face proc', () => {
    const db = immediateDb();
    const state = withNextFace(ready(db), 'heads');
    const fire = state.zones.hand.find((coin) => String(state.coins[Number(coin)]!.defId) === 'fire')!;
    const blocked = { ...state, enemies: state.enemies.map((enemy) => ({ ...enemy, block: 5 })) };
    const result = step(blocked, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [fire], target: 0 }, db);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    // The skill packet is blocked, while the fixed coin proc is not.
    expect(result.state.enemies[0]!.hp).toBe(17);
  });

  it('stores next-turn block from a neutral skill using an elemental coin', () => {
    const db = immediateDb();
    const state = withNextFace(ready(db), 'tails');
    const coin = state.zones.hand[0]!;
    const frostState = {
      ...state,
      coins: { ...state.coins, [Number(coin)]: { ...state.coins[Number(coin)]!, defId: id<CoinDefId>('frost') } }
    };
    const result = step(frostState, { type: 'useImmediateFlipSkill', slot: slot(1), coins: [coin] }, db);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.state.player.nextTurnBlock).toBe(2);
  });
});
