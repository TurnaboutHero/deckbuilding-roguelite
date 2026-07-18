import { describe, expect, it, vi } from "vitest";
import { createCombat, type CombatState } from "@game/core";
import { contentDb } from "@game/content";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enemyIntentDamageTotal, IntentBadge, UnitPanel, unusedElementalCoinCount } from "./App";
import { KEYWORD_GLOSSARY } from "./keywords";

const enemy = (overrides: Partial<CombatState["enemies"][number]>): CombatState["enemies"][number] => ({
  block: 0,
  defId: "silverbell-healer" as never,
  enemyUid: 0,
  hp: 20,
  intent: { id: "idle", actions: [] },
  intentIndex: 0,
  maxHp: 30,
  nextAttackBonus: 0,
  slot: 0,
  statuses: {},
  ...overrides,
});

const sprite = {
  atlasUrl: "about:blank",
  manifest: {
    animation: { rows: { idle: { frames: 1, fps: 1, loop: true } } },
    frame_layout: { sheetHeight: 1, sheetWidth: 1, rows: { idle: [{ h: 1, w: 1, x: 0, y: 0 }] } },
  },
};

describe("enemy telegraph UI", () => {
  it("renders windup countdown, forecast, cancel threshold, vulnerability and bound heal target", () => {
    const mend = {
      id: "silver-mend",
      cancelOn: { damageThreshold: 10 },
      vulnerableWhileWindup: 1.5,
      actions: [{ kind: "healAlly" as const, amount: 12, target: "lowestHpAlly" as const, cleanse: 2 }],
    };
    const html = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemies: [
          enemy({
            boundHealAlly: 1,
            intent: mend,
            windup: { boundHealAlly: 1, cancelThreshold: 10, intent: mend, startHp: 20, turnsLeft: 1 },
          }),
          enemy({ defId: "chalice-thrall" as never }),
        ],
        enemy: enemy({
          boundHealAlly: 1,
          intent: mend,
          windup: { boundHealAlly: 1, cancelThreshold: 10, intent: mend, startHp: 20, turnsLeft: 1 },
        }),
      }),
    );

    expect(html).toContain("준비 1턴");
    expect(html).toContain("10 피해로 취소");
    expect(html).toContain("취약 ×1.5");
    expect(html).toContain("회복 12");
    expect(html).toContain("정화 2");
    expect(html).toContain("붉은성배 흡혈귀 시종");
  });

  it("precommunicates conditional status thresholds in the intent text and aria label", () => {
    const intent = {
      id: "grave-seal",
      actions: [
        { kind: "applyStatus" as const, status: "healLock" as const, stacks: 1, requiresLastAttackHpDamage: true },
        { kind: "applyStatus" as const, status: "frostbite" as const, stacks: 2, requiresPlayerStatus: { status: "healLock" as const, atLeast: 1 } },
      ],
    };
    const html = renderToStaticMarkup(createElement(IntentBadge, { enemies: [enemy({ intent })], enemy: enemy({ intent }) }));

    expect(html).toContain("회복 봉인 1 (실제 체력 피해 시)");
    expect(html).toContain("동상 2 (회복 봉인 1 이상 시)");
    expect(html).toContain("실제 체력 피해 시");
    expect(html).toContain("회복 봉인 1 이상 시");
  });

  it("renders enemy phase and growth chips without index selectors", () => {
    vi.stubGlobal("window", {
      clearTimeout,
      matchMedia: () => ({ addEventListener: () => undefined, matches: true, removeEventListener: () => undefined }),
      setTimeout,
    });
    const html = renderToStaticMarkup(
      createElement(UnitPanel, {
        block: 0,
        floats: [],
        growthStacks: 3,
        growthLabel: "기세",
        hp: 20,
        maxHp: 30,
        motion: "idle",
        name: "쇠사슬 광전사",
        phaseIndex: 0,
        damageTakenMultiplier: 1.25,
        playKey: 0,
        side: "enemy",
        sprite,
        statuses: { poison: { kind: "stack", stacks: 2 }, healLock: { kind: "duration", turns: 1 } },
        unitKey: "enemy-0",
        vfx: new Set<string>(),
        playerTurnEndPunishment: { threshold: 4, status: "frostbite", stacks: 1 },
        unusedElementalCoins: 4,
        roundGrowth: {
          gainPerRound: 1,
          maxStacks: 5,
          damageReductionPerStack: 0.08,
          healMaxHpFractionPerStack: 0.03,
          removeOneAtHpFraction: 0.15,
          removeTwoAtHpFraction: 0.25,
        },
        damageTakenThisRound: 17,
      }),
    );

    expect(html).toContain("광란 1");
    expect(html).toContain("취약 ×1.25");
    expect(html).toContain("속성 코인 4/4");
    expect(html).toContain("발동");
    expect(html).toContain("나이테 3/5");
    expect(html).toContain("감소 24%");
    expect(html).toContain("재생 +3");
    expect(html).toContain("피해 17/5·8");
    expect(html).toContain("중독 2");
    expect(html).toContain("회복 봉인 1");
  });

  it("renders Batch C protection, petrify and banner mechanics with stable labels", () => {
    vi.stubGlobal("window", {
      clearTimeout,
      matchMedia: () => ({ addEventListener: () => undefined, matches: true, removeEventListener: () => undefined }),
      setTimeout,
    });
    const common = {
      block: 4,
      floats: [],
      hp: 60,
      maxHp: 80,
      motion: "idle" as const,
      name: "아이젠발 성채수호병",
      playKey: 0,
      side: "enemy" as const,
      sprite,
      statuses: {},
      unitKey: "enemy-0",
      vfx: new Set<string>(),
    };
    const activeHtml = renderToStaticMarkup(
      createElement(UnitPanel, {
        ...common,
        enemyIndex: 0,
        protectionLink: {
          active: true,
          brokenDamageTakenMultiplier: 1.2,
          brokenTurns: 2,
          durability: 3,
          restoreDurability: 2,
          redirectFraction: 0.4,
          target: 1,
          turnsUntilRestore: 0,
        },
        protectionTargetName: "그리폰 왕가의 전쟁기수",
        protectedBy: { name: "그리폰 왕가의 전쟁기수", redirectPercent: 40 },
        petrify: {
          active: true,
          crackedPercent: 30,
          crackedTurns: 0,
          diveCancelled: false,
          divePrepared: true,
          rawDamage: 8,
          reductionPercent: 70,
          threshold: 16,
        },
        warBannerAuraPercent: 10,
        auraSourceName: "그리폰 왕가의 전쟁기수",
        auraSourcePercent: 10,
        march: { attackPercent: 20, shield: 6, sourceName: "그리폰 왕가의 전쟁기수", turns: 2 },
      }),
    );
    expect(activeHtml).toContain('data-testid="protection-link-0"');
    expect(activeHtml).toContain("보호 → 그리폰 왕가의 전쟁기수 40% · 내구 3");
    expect(activeHtml).toContain("석화 70% · 원피해 8/16 · 낙하 취소 가능");
    expect(activeHtml).toContain('data-testid="war-banner-aura-0"');
    expect(activeHtml).toContain("군기 오라 · 다른 적 +10%");
    expect(activeHtml).toContain('data-testid="royal-march-0"');
    expect(activeHtml).toContain("진군 · +20% · 2턴 · 방패 6 (그리폰 왕가의 전쟁기수)");

    const recoveryHtml = renderToStaticMarkup(
      createElement(UnitPanel, {
        ...common,
        enemyIndex: 1,
        petrify: {
          active: false,
          crackedPercent: 30,
          crackedTurns: 1,
          diveCancelled: true,
          divePrepared: false,
          rawDamage: 16,
          reductionPercent: 70,
          threshold: 16,
        },
        protectionLink: {
          active: false,
          brokenDamageTakenMultiplier: 1.2,
          brokenTurns: 2,
          durability: 0,
          restoreDurability: 2,
          redirectFraction: 0.4,
          target: 0,
          turnsUntilRestore: 2,
        },
      }),
    );
    expect(recoveryHtml).toContain("보호 파괴 · 복구 2턴 · 취약 +20%");
    expect(recoveryHtml).toContain("균열 1턴 · 취약 +30% · 낙하 취소");
    expect(recoveryHtml).toContain('data-testid="petrify-status-1"');
  });

  it("telegraphs Batch C petrify and royal march before they resolve", () => {
    const gargoyle = createCombat(
      { character: "warrior" as never, enemies: ["cathedral-gargoyle" as never] },
      contentDb,
      "batch-c-petrify-intent",
    ).enemies[0];
    const rider = createCombat(
      { character: "warrior" as never, enemies: ["war-banner-rider" as never] },
      contentDb,
      "batch-c-march-intent",
    ).enemies[0];
    if (gargoyle === undefined || rider === undefined) throw new Error("missing Batch C enemy");

    const petrifyHtml = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: { ...gargoyle, intent: contentDb.enemies["cathedral-gargoyle"]!.intents[1]! },
      }),
    );
    const marchIntent = contentDb.enemies["war-banner-rider"]!.intents[1]!;
    const marchHtml = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: {
          ...rider,
          intent: marchIntent,
          windup: { intent: marchIntent, turnsLeft: 1, startHp: rider.hp },
        },
      }),
    );

    expect(petrifyHtml).toContain('data-testid="petrify-intent"');
    expect(petrifyHtml).toContain("석화 70% · 원피해 20%로 파쇄");
    expect(marchHtml).toContain('data-testid="royal-march-intent"');
    expect(marchHtml).toContain("진군 · 전체 +20% 2턴 · 방패 8%");
  });

  it("defines glossary entries for telegraph terms", () => {
    expect(KEYWORD_GLOSSARY.windup.label).toBe("준비(예고)");
    expect(KEYWORD_GLOSSARY.vulnerable.label).toBe("취약");
    expect(KEYWORD_GLOSSARY.frenzy.label).toBe("광란(페이즈)");
    expect(KEYWORD_GLOSSARY.growth.label).toBe("성장");
    expect(KEYWORD_GLOSSARY.poison.label).toBe("중독");
    expect(KEYWORD_GLOSSARY.healLock.label).toBe("회복 봉인");
    expect(KEYWORD_GLOSSARY.unusedElementalThreshold.label).toBe("미사용 속성 코인 경고");
    expect(KEYWORD_GLOSSARY.ringGrowth.label).toBe("나이테");
  });

  it("includes growth-scaled attacks in the visible incoming-damage total", () => {
    expect(
      enemyIntentDamageTotal([
        enemy({
          growthStacks: 2,
          intent: { id: "charge", actions: [{ kind: "attack", damage: 20, damagePerGrowthPercent: 0.15 }] },
        }),
      ]),
    ).toBe(26);
  });

  it("counts post-return elemental coins across hand and placed slots exactly once for M12", () => {
    const base = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "m12-ui-preview",
    );
    const [handCoin, placedCoin] = base.zones.hand;
    if (handCoin === undefined || placedCoin === undefined) throw new Error("missing hand coins");
    const preview: CombatState = {
      ...base,
      coins: {
        ...base.coins,
        [Number(handCoin)]: { ...base.coins[Number(handCoin)]!, defId: "fire" as never },
        [Number(placedCoin)]: { ...base.coins[Number(placedCoin)]!, grants: ["mana"] },
      },
      zones: {
        ...base.zones,
        hand: [handCoin],
        placed: { ...base.zones.placed, [0 as never]: [handCoin, placedCoin] },
      },
    };

    expect(unusedElementalCoinCount(preview)).toBe(2);
  });
});
