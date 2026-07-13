import { describe, expect, it } from 'vitest';

import {
  M6_BUILD_POLICIES,
  resolveBuildPolicy,
  simulateRun,
} from './run-sim';

describe('M5 full-run simulator', () => {
  it('produces a byte-equivalent normalized summary for the same seed', () => {
    const first = JSON.stringify(simulateRun('42').summary);
    const second = JSON.stringify(simulateRun('42').summary);

    expect(second).toBe(first);
  });

  it('can parameterize the full-run simulator by character without changing the default', () => {
    expect(simulateRun('42')).toEqual(simulateRun('42', 'warrior'));
    const guardian = simulateRun('42', 'guardian');

    expect(guardian.summary.seed).toBe('42');
    expect(guardian.summary.result === 'victory' || guardian.summary.result === 'defeat').toBe(true);
    // P6 재고정: 3막 그래프에서 guardian fight-first는 더 길게 생존하며 보상
    // 코인으로 가방이 26까지 자란다 — balance-provisional 관측치.
    expect(guardian.summary.finalBag).toHaveLength(26);
    // P7 D2: 장착 슬롯은 항상 8 (빈 슬롯 = null, summary 직렬화는 String()으로 "null")
    expect(guardian.summary.finalEquippedSkills).toHaveLength(8);
  });

  it('completes the deterministic generated-graph run with boundary state intact', () => {
    // P9 재고정 (1.3.0-p9 결속): 신규 캐릭터 콘텐츠를 포함한 현재 결정론 런 골든.
    // warrior 시작 셋 = jab·fist-guard·burning-fist·inner-passion + 빈 슬롯 4(null).
    // seed 42 fight-first는 여전히 11번째 전투에서 패배한다 — balance-provisional 관측치
    // (baseline 정책 우선순위가 신규 격투 스킬 ID를 모른다는 한계 포함, 백로그 보고).
    const simulation = simulateRun('42');

    expect(simulation.summary.result).toBe('defeat');
    expect(simulation.summary.combatsCompleted).toBe(11);
    expect(simulation.combats).toHaveLength(11);
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

    // P6 보상 신스펙: 제거 단계가 사라져 시작 basic 8개가 그대로 남는다
    expect(simulation.combats[1]?.startingBag.filter((coin) => coin === 'fire')).toHaveLength(3);
    expect(simulation.combats[1]?.startingBag.filter((coin) => coin === 'basic')).toHaveLength(8);
    expect(simulation.summary).toEqual({
      seed: '42',
      result: 'defeat',
      combatsCompleted: 11,
      turnsPerCombat: [3, 3, 4, 2, 3, 3, 3, 4, 4, 4, 2], // P9 워리어 시작 세트(잿불 베기) 반영 결정론 골든 (balance-provisional)
      carriedHp: 0,
      finalBag: ["basic", "basic", "basic", "basic", "basic", "basic", "basic", "basic", "fire", "fire", "fire", "fire", "basic", "fire", "fire", "fire", "basic", "basic", "basic", "basic"],
      finalEquippedSkills: ["jab", "fist-guard", "burning-fist", "flame-hook", "null", "null", "null", "conflagration"],
      encounterOrder: [
        ['raider'],
        ['gatekeeper'],
        ['goblin', 'ghoul'],
        ['thief', 'goblin'],
        ['gatekeeper-plus'],
        ['shaman'],
        ['gatekeeper'],
        ['gatekeeper-plus'],
        ['raider-plus'],
        ['gatekeeper-plus'],
        ['raider-plus', 'gatekeeper-plus']
      ]
    });
  });
});

// 감시자 필수 회귀 2건 (P3.2 시뮬 재작업 수용 조건)
describe('build policy resolution regressions', () => {
  it('keeps legacy variant coin priority when no explicit build is given (M6 byte invariance)', () => {
    // basic-first가 fire-build로 흡수되면 M6 CRN 의미가 깨진다 — variant 우선순위 보존
    expect([
      ...resolveBuildPolicy('warrior', 'basic-first').coinRewardPriority,
    ]).toEqual(['basic', 'mana', 'fire']);
    // baseline은 fire-build와 완전 동일 (레거시 바이트 불변)
    expect(resolveBuildPolicy('warrior', 'baseline')).toEqual(
      M6_BUILD_POLICIES['fire-build'],
    );
    // 명시 지정이 항상 이긴다
    expect(resolveBuildPolicy('guardian', 'baseline', 'fire-build').id).toBe(
      'fire-build',
    );
    expect(resolveBuildPolicy('guardian', 'baseline').id).toBe('mana-build');
    expect(resolveBuildPolicy('sorcerer', 'baseline').id).toBe('lightning-build');
    expect(resolveBuildPolicy('frost-knight', 'baseline').id).toBe('frost-build');
  });

  it('drives simulateRun guardian rewards with the mana build (path consistency)', () => {
    // simulateRun이 fire-build 하드코딩이면 policy run과 보상 경로가 어긋난다.
    // mana-build는 코인 보상에서 항상 mana를 고르므로, 승리 전투마다 가방 mana가 는다.
    const { summary } = simulateRun('GUARDIAN-BUILD-REG', 'guardian');
    const manaCount = summary.finalBag.filter((coin) => coin === 'mana').length;
    if (summary.combatsCompleted >= 2) {
      expect(manaCount).toBeGreaterThan(2);
    } else {
      // 시드가 조기 패배하면 회귀 검증력이 없다 — 시드를 바꿔야 한다
      expect.fail(
        `seed GUARDIAN-BUILD-REG finished only ${summary.combatsCompleted} combats — pick a longer-surviving seed`,
      );
    }
  });
});
