import { contentDb } from "@game/content";
import type { CharacterId, EnemyDefId } from "@game/core";
import { createCombat } from "@game/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ArmorEchoHud,
  armorEchoPreview,
  enemyIntentDamageTotal,
  shouldShowArmorEchoHud,
  shouldShowOverheatBadges,
} from "./App";

const id = <T extends string>(value: string): T => value as T;

describe("overheat and armor echo HUD projection", () => {
  it("previews intent damage, remaining block, precision and echo total for the arcanist HUD", () => {
    const state = createCombat(
      { character: id<CharacterId>("arcanist"), enemies: [id<EnemyDefId>("raider")] },
      contentDb,
      "echo-hud",
    );
    const player = {
      ...state.player,
      block: 9,
      armorEcho: 5,
      armorEchoAvailable: true,
      echoPreheat: 2,
      precisionDefenseArmed: true,
    };
    const intentDamage = 11;
    const preview = armorEchoPreview(player, intentDamage);

    expect(preview).toEqual({ absorbed: 9, remainingBlock: 0, precision: true, total: 12 });
    expect(
      renderToStaticMarkup(
        createElement(ArmorEchoHud, {
          hud: {
            current: player.armorEcho,
            available: player.armorEchoAvailable,
            armed: player.precisionDefenseArmed,
            preheat: player.echoPreheat,
            totalIntentDamage: intentDamage,
            preview,
          },
        }),
      ),
    ).toContain("갑주 반향 5, 반향 증폭 가능, 적 의도 피해 11, 예상 잔여 방어 0, 반향 미리보기 12, 정밀 방어 성립");
  });

  it("keeps armor echo HUD scoped to arcanist and overheat badges scoped to fire character", () => {
    expect(shouldShowArmorEchoHud(id<CharacterId>("arcanist"))).toBe(true);
    expect(shouldShowArmorEchoHud(id<CharacterId>("sorcerer"))).toBe(false);
    expect(shouldShowArmorEchoHud(id<CharacterId>("warrior"))).toBe(false);

    expect(shouldShowOverheatBadges(id<CharacterId>("warrior"))).toBe(true);
    expect(shouldShowOverheatBadges(id<CharacterId>("arcanist"))).toBe(false);
    expect(shouldShowOverheatBadges(id<CharacterId>("sorcerer"))).toBe(false);
  });

  it("totals enemy attack intent without index selectors or hidden cells", () => {
    const state = createCombat(
      { character: id<CharacterId>("arcanist"), enemies: [id<EnemyDefId>("raider"), id<EnemyDefId>("gatekeeper")] },
      contentDb,
      "echo-intent-total",
    );

    expect(enemyIntentDamageTotal(state.enemies)).toBe(
      state.enemies.reduce(
        (sum, enemy) =>
          sum +
          enemy.intent.actions.reduce(
            (intentSum, action) =>
              action.kind === "attack" ? intentSum + action.damage * (action.hits ?? 1) : intentSum,
            0,
          ),
        0,
      ),
    );
  });
});
