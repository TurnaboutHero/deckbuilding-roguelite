import { describe, expect, it } from 'vitest';

import {
  M6_BUILD_POLICIES,
  expectedEncounterOrder,
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
    expect(guardian.summary.finalBag).toHaveLength(10);
    expect(guardian.summary.finalEquippedSkills).toHaveLength(6);
  });

  it('completes the deterministic five-combat run with boundary state intact', () => {
    const simulation = simulateRun('42');

    expect(simulation.summary.result).toBe('victory');
    expect(simulation.summary.combatsCompleted).toBe(5);
    expect(simulation.summary.encounterOrder).toEqual(expectedEncounterOrder());
    expect(simulation.combats).toHaveLength(5);
    for (let index = 0; index < simulation.combats.length; index += 1) {
      const combat = simulation.combats[index];
      if (combat === undefined) throw new Error('missing combat record');
      expect([...combat.permanentCoinsAtStart].sort()).toEqual([...combat.startingBag].sort());
      expect(combat.temporaryCoinsAtStart).toBe(1);
      if (index > 0) {
        expect(combat.startingHp).toBe(simulation.combats[index - 1]?.endingHp);
      }
    }

    expect(simulation.combats[1]?.startingBag.filter((coin) => coin === 'fire')).toHaveLength(3);
    expect(simulation.combats[1]?.startingBag.filter((coin) => coin === 'basic')).toHaveLength(7);
    expect(simulation.summary.finalBag).toHaveLength(10);
    expect(simulation.summary.finalEquippedSkills).toHaveLength(6);
    expect(simulation.summary.carriedHp).toBeGreaterThan(0);
    expect(simulation.summary).toEqual({
      seed: '42',
      result: 'victory',
      combatsCompleted: 5,
      turnsPerCombat: [4, 3, 4, 5, 9],
      carriedHp: 27,
      finalBag: ['basic', 'basic', 'basic', 'basic', 'fire', 'fire', 'fire', 'fire', 'fire', 'fire'],
      finalEquippedSkills: ['conflagration', 'guard', 'burning-strike', 'flame-sword', 'ignite-sword', 'smash'],
      encounterOrder: [['raider'], ['shaman'], ['gatekeeper'], ['raider-plus'], ['gatekeeper-plus']]
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
