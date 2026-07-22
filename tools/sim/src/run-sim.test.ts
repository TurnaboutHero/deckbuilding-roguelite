import { describe, expect, it } from 'vitest';
import type { CoinDefId, RunState } from '@game/core';

import {
  M6_BUILD_POLICIES,
  preferredCoinReward,
  resolveBuildPolicy,
  simulateRun,
  simulatePolicyRun,
} from './run-sim';

const coin = (value: string): CoinDefId => value as CoinDefId;
const rewardRun = (coinOptions: readonly string[]): RunState =>
  ({ pendingRewards: { coinOptions: coinOptions.map(coin) } }) as RunState;

describe('M5 full-run simulator', () => {
  it('produces a byte-equivalent normalized summary for the same seed', () => {
    const first = JSON.stringify(simulateRun('42').summary);
    const second = JSON.stringify(simulateRun('42').summary);

    expect(second).toBe(first);
  });

  it('can parameterize the full-run simulator by character without changing the default', () => {
    expect(simulateRun('42')).toEqual(simulateRun('42', 'warrior'));
    const sorcerer = simulateRun('42', 'sorcerer');

    expect(sorcerer.summary.seed).toBe('42');
    expect(sorcerer.summary.result === 'victory' || sorcerer.summary.result === 'defeat').toBe(true);
    // P7 D2: 장착 슬롯은 항상 8 (빈 슬롯 = null, summary 직렬화는 String()으로 "null")
    expect(sorcerer.summary.finalEquippedSkills).toHaveLength(8);
  });

  it('completes the deterministic generated-graph run with boundary state intact', () => {
    // P12 재고정: 기본+대표 속성 전용 동전 보상 정책을 포함한 결정론 런 골든.
    // P13 reward-pool opening (basic+signature → all-element weighted) — 의도된 재앵커.
    // warrior 시작 셋 = jab·fist-guard·burning-fist·inner-passion + 빈 슬롯 4(null).
    // v4.5 즉시 사용 정책의 결정론 골든. 예약/배치 명령은 시뮬레이션 경로에 없다.
    const simulation = simulateRun('42');

    expect(simulation.summary.result).toBe('defeat');
    expect(simulation.summary.combatsCompleted).toBe(1);
    expect(simulation.combats).toHaveLength(1);
    for (let index = 0; index < simulation.combats.length; index += 1) {
      const combat = simulation.combats[index];
      if (combat === undefined) throw new Error('missing combat record');
      expect([...combat.permanentCoinsAtStart].sort()).toEqual([...combat.startingBag].sort());
      expect(combat.temporaryCoinsAtStart).toBe(1);
      if (index > 0) {
        // P6: 전투 사이 회복은 휴식(30% 내림) 또는 막 보스 클리어(전체) — 그 외 이월 불변
        const previous = simulation.combats[index - 1]!.endingHp;
        expect(combat.startingHp).toBeGreaterThanOrEqual(previous);
        expect(combat.startingHp).toBeLessThanOrEqual(70);
      }
    }

    expect(simulation.summary).toEqual({
      seed: '42',
      result: 'defeat',
      combatsCompleted: 1,
      turnsPerCombat: [7],
      carriedHp: 0,
      finalBag: [
        'basic',
        'basic',
        'basic',
        'basic',
        'basic',
        'basic',
        'basic',
        'basic',
        'fire',
        'fire'
      ],
      finalEquippedSkills: ['jab', 'fist-guard', 'fire-fist', 'direct-hit', 'null', 'null', 'null', 'null'],
      encounterOrder: [
        ['raider']
      ]
    });
  });
});

// 감시자 필수 회귀 2건 (P3.2 시뮬 재작업 수용 조건)
describe('build policy resolution regressions', () => {
  it('keeps legacy variant coin priority when no explicit build is given (M6 byte invariance)', () => {
    // basic-first가 fire-build로 흡수되면 M6 CRN 의미가 깨진다 — variant 우선순위 보존
    expect([...resolveBuildPolicy('warrior', 'basic-first').coinRewardPriority]).toEqual(['basic', 'mana', 'fire']);
    // baseline도 레거시 variant 우선순위를 보존하고, 명시 fire-build만 새 완전 목록을 쓴다
    expect([...resolveBuildPolicy('warrior', 'baseline').coinRewardPriority]).toEqual(['fire', 'mana', 'basic']);
    expect(resolveBuildPolicy('warrior', 'baseline', 'fire-build')).toEqual(M6_BUILD_POLICIES['fire-build']);
    // 명시 지정이 항상 이긴다
    expect(resolveBuildPolicy('arcanist', 'baseline', 'fire-build').id).toBe('fire-build');
    expect(resolveBuildPolicy('arcanist', 'baseline').id).toBe('mana-build');
    expect(resolveBuildPolicy('sorcerer', 'baseline').id).toBe('lightning-build');
    expect(resolveBuildPolicy('frost-knight', 'baseline').id).toBe('frost-build');
  });

  it('starts sorcerer simulation with its lightning build rather than a fire hardcode', () => {
    const { summary } = simulateRun('SORC-V12-0', 'sorcerer');
    const lightningCount = summary.finalBag.filter((coin) => coin === 'lightning').length;
    expect(lightningCount).toBe(2);
    expect(summary.finalBag).not.toContain('fire');
  });
});

describe('v4.5 simulator command budget', () => {
  it('allows the turtle episode to reach its deterministic terminal outcome', () => {
    const simulation = simulatePolicyRun({
      baseSeed: '1',
      runSeed: 'm6:3075543026:394851719:1604709081:787312973',
      episodeId: 'episode-00000024-60dee827',
      episodeIndex: 24,
      policyId: 'turtle',
    });

    expect(simulation.trace.result).toBe('defeat');
    expect(simulation.trace.combats[0]?.turns).toHaveLength(6);
  });
});

describe('M6 build policy coin rewards', () => {
  const completeCoinRewardSet = [
    'basic',
    'fire',
    'mana',
    'frost',
    'lightning',
    'blood',
  ];

  it('declares every basic and elemental coin in each build policy priority list', () => {
    for (const policy of Object.values(M6_BUILD_POLICIES)) {
      expect(new Set(policy.coinRewardPriority)).toEqual(
        new Set(completeCoinRewardSet),
      );
      expect(policy.coinRewardPriority).toHaveLength(
        completeCoinRewardSet.length,
      );
    }
  });

  it('selects the first available coin by the new complete build priority lists', () => {
    expect(
      preferredCoinReward(
        rewardRun(['blood', 'lightning', 'fire']),
        M6_BUILD_POLICIES['fire-build'],
      ),
    ).toBe('fire');
    expect(
      preferredCoinReward(
        rewardRun(['blood', 'basic', 'mana']),
        M6_BUILD_POLICIES['mana-build'],
      ),
    ).toBe('mana');
    expect(
      preferredCoinReward(
        rewardRun(['blood', 'mana', 'frost']),
        M6_BUILD_POLICIES['frost-build'],
      ),
    ).toBe('frost');
    expect(
      preferredCoinReward(
        rewardRun(['blood', 'frost', 'lightning']),
        M6_BUILD_POLICIES['lightning-build'],
      ),
    ).toBe('lightning');
  });

  it('keeps the first-option fallback when no priority entry is offered', () => {
    expect(
      preferredCoinReward(
        rewardRun(['unknown-coin']),
        M6_BUILD_POLICIES['fire-build'],
      ),
    ).toBe('unknown-coin');
    expect(
      preferredCoinReward(rewardRun([]), M6_BUILD_POLICIES['fire-build']),
    ).toBeNull();
  });
});
