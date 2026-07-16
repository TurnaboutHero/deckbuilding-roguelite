import { describe, expect, it } from 'vitest';

import type { ContentDb, SkillDef } from '@game/core';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '@game/core';

import { buildResolutionSummary } from './resolution-summary';

const id = <T extends string>(value: string) => value as T;
const coin = (value: number) => value as CoinUid;
const slot = (value: number) => value as SlotId;

const skillOf = (db: ContentDb, skillId: string): SkillDef => {
  const skill = db.skills[skillId];
  if (skill === undefined) throw new Error(`missing test skill: ${skillId}`);
  return skill;
};

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' }
  },
  skills: {
    slash: {
      id: id<SkillId>('slash'),
      name: '공격',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'damage', amount: 6 }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
    },
    guard: {
      id: id<SkillId>('guard'),
      name: '방어',
      type: 'flip',
      rarity: 'common',
      tags: ['defense'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'block', amount: 5 }],
      tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
    },
    strike: {
      id: id<SkillId>('strike'),
      name: '불타는 일격',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 2,
      base: [{ kind: 'damage', amount: 8 }],
      heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] }
    },
    rampage: {
      id: id<SkillId>('rampage'),
      name: '화염 폭주',
      type: 'flip',
      rarity: 'rare',
      tags: ['utility'],
      targetType: 'self',
      oncePerCombat: true,
      cost: 1,
      base: [{ kind: 'grantElement', element: 'fire', scope: 'allBasicInHand' }],
      heads: {
        mode: 'any',
        effects: [{ kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'hand', count: 1 }]
      },
      tails: { mode: 'any', effects: [{ kind: 'selfDamage', amount: 2 }] }
    },
    consumeFire: {
      id: id<SkillId>('consumeFire'),
      name: '점화 검술',
      type: 'consume',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      consume: { element: 'fire', count: 1 },
      effects: [
        { kind: 'damage', amount: 5 },
        { kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }
      ]
    }
  },
  enemies: {
    raider: {
      id: id<EnemyDefId>('raider'),
      name: '약탈자',
      maxHp: 75,
      intents: [{ id: 'slam', actions: [{ kind: 'attack', damage: 11 }] }]
    }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: '전사',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [
        id<SkillId>('slash'),
        id<SkillId>('guard'),
        id<SkillId>('strike'),
        id<SkillId>('rampage'),
        id<SkillId>('consumeFire')
      ],
      trait: {
        id: 'ember-pouch',
        name: '불씨 주머니',
        hook: 'combatStart',
        effects: []
      }
    }
  },
  validate: () => []
});

describe('buildResolutionSummary', () => {
  it('summarizes one-coin slash heads with one bonus and damage 10', () => {
    const skill = skillOf(testDb(), 'slash');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(0), skill: skill.id, kind: 'flip' },
      { type: 'coinFlipped', coin: coin(1), face: 'heads' },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 10, blocked: 0, source: 'skill' }
    ]);

    expect(summary.bonusLines).toEqual(['앞면 → +4 피해']);
    expect(summary.totalLine).toBe('피해 10');
  });

  it('summarizes slash tails as no face bonus and damage 6', () => {
    const skill = skillOf(testDb(), 'slash');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(0), skill: skill.id, kind: 'flip' },
      { type: 'coinFlipped', coin: coin(1), face: 'tails' },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 6, blocked: 0, source: 'skill' }
    ]);

    expect(summary.bonusLines).toEqual(['면 보너스 없음']);
    expect(summary.totalLine).toBe('피해 6');
  });

  it('summarizes strike per heads twice with multiplier and damage 14', () => {
    const skill = skillOf(testDb(), 'strike');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(2), skill: skill.id, kind: 'flip' },
      { type: 'coinFlipped', coin: coin(1), face: 'heads' },
      { type: 'coinFlipped', coin: coin(2), face: 'heads' },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 14, blocked: 0, source: 'skill' }
    ]);

    expect(summary.bonusLines).toEqual(['앞면 ×2 → +6 피해']);
    expect(summary.totalLine).toBe('피해 14');
  });

  it('summarizes rampage any bonus, self damage, and coin creation from events', () => {
    const skill = skillOf(testDb(), 'rampage');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(3), skill: skill.id, kind: 'flip' },
      { type: 'coinFlipped', coin: coin(1), face: 'heads' },
      { type: 'coinFlipped', coin: coin(2), face: 'tails' },
      { type: 'elementGranted', coins: [coin(3)], element: 'fire' },
      { type: 'coinCreated', coin: coin(11), defId: 'fire', zone: 'hand' },
      { type: 'damageDealt', target: { type: 'player' }, amount: 2, blocked: 0, source: 'self' }
    ]);

    expect(summary.baseLines).toEqual(['기본 코인 화염 취급']);
    expect(summary.bonusLines).toEqual(['앞면 → 임시 화염 +1', '뒷면 → 자신 피해 2']);
    expect(summary.totalLine).toBe('자신 피해 2 · 코인 생성 1');
  });

  it('summarizes consume skill without faces and with cost note', () => {
    const skill = skillOf(testDb(), 'consumeFire');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(4), skill: skill.id, kind: 'consume' },
      { type: 'coinsConsumed', coins: [coin(1)] },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 5, blocked: 0, source: 'skill' },
      { type: 'statusApplied', target: { type: 'enemy', index: 0 }, status: 'burn', stacks: 1 }
    ]);

    expect(summary.kind).toBe('consume');
    expect(summary.faces).toEqual([]);
    expect(summary.costNote).toBe('화염 ×1 지불 — 플립 없음');
    expect(summary.totalLine).toBe('피해 5 · 화상 1');
  });

  it('adds trigger causality lines from turnTriggerFired events', () => {
    const skill = skillOf(testDb(), 'slash');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(0), skill: skill.id, kind: 'flip' },
      { type: 'coinFlipped', coin: coin(1), face: 'tails' },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 6, blocked: 0, source: 'skill' },
      { type: 'turnTriggerFired', trigger: 'flame-sword', hook: 'onDamageDealt' },
      { type: 'statusApplied', target: { type: 'enemy', index: 0 }, status: 'burn', stacks: 1 }
    ]);

    expect(summary.triggerLines).toEqual(['화염검 → 화상 +1']);
  });

  // 오귀속 회귀 (감시자 필수): 트리거 직후 스킬 자체 statusApplied가 이어져도
  // 트리거 라인은 고정 효과만 표시한다 — 구간 귀속 방식이면 이 테스트가 잡는다
  it('does not attribute the skill own status effects to the trigger line', () => {
    const skill = skillOf(testDb(), 'consumeFire');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(4), skill: skill.id, kind: 'consume' },
      { type: 'coinsConsumed', coins: [coin(1)] },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 5, blocked: 0, source: 'skill' },
      { type: 'turnTriggerFired', trigger: 'flame-sword', hook: 'onDamageDealt' },
      { type: 'statusApplied', target: { type: 'enemy', index: 0 }, status: 'burn', stacks: 1 },
      // 스킬 자체의 후속 화상 3 — 트리거 몫이 아니다
      { type: 'statusApplied', target: { type: 'enemy', index: 0 }, status: 'burn', stacks: 3 }
    ]);

    expect(summary.triggerLines).toEqual(['화염검 → 화상 +1']);
    // 상태 라인·합계에는 둘 다 정상 반영된다 (이벤트 정본)
    expect(summary.statusLines).toEqual(['화상 +1', '화상 +3']);
    expect(summary.totalLine).toBe('피해 5 · 화상 4');
  });

  it('shows only the trigger name for unknown trigger ids', () => {
    const skill = skillOf(testDb(), 'slash');
    const summary = buildResolutionSummary(skill, [
      { type: 'skillUsed', slot: slot(0), skill: skill.id, kind: 'flip' },
      { type: 'coinFlipped', coin: coin(1), face: 'tails' },
      { type: 'turnTriggerFired', trigger: 'future-trigger', hook: 'onDamageDealt' }
    ]);

    expect(summary.triggerLines).toEqual(['future-trigger']);
  });
});
