import { contentDb } from "@game/content";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CardEffectRows, skillDisplayName } from "./card-effects";
import { ShopScreen } from "./shop-screen";

const renderShopWithSkill = (skillId: string): string => {
  const skill = contentDb.skills[skillId];
  if (skill === undefined) throw new Error(`missing skill ${skillId}`);

  return renderToStaticMarkup(
    createElement(ShopScreen, {
      gold: 200,
      removalPrice: 75,
      coinOffers: [],
      skillOffers: [
        {
          id: skillId,
          name: skill.name,
          price: 80,
          rarityName: "고급",
          card: createElement("span", { "aria-hidden": true }, "skill"),
          effects: createElement(CardEffectRows, {
            displayName: skillDisplayName(skill),
            skill,
          }),
        },
      ],
      passiveOffers: [],
      bagCoins: [],
      rejection: null,
      skillPick: null,
      slotLabels: [],
      lockedSlots: [],
      onBuyCoin: () => undefined,
      onBuyPassive: () => undefined,
      onPickSkill: () => undefined,
      onConfirmSkill: () => undefined,
      onCancelSkill: () => undefined,
      onRemoveCoin: () => undefined,
      onLeave: () => undefined,
    }),
  );
};

describe("ShopScreen skill details", () => {
  it("renders data-generated effect rows for a shop skill offer", () => {
    const html = renderShopWithSkill("ignite-sword");

    expect(html).toContain('data-testid="shop-skill-ignite-sword"');
    expect(html).toContain("화염 ×1 소비");
    expect(html).toContain("화상 2");
  });

  it("keeps keyword text in an accessible button with tooltip wiring", () => {
    const html = renderShopWithSkill("ignite-sword");

    expect(html).toMatch(/<button[^>]*aria-describedby="[^"]+"[^>]*>화염 ×1 소비<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-describedby="[^"]+"[^>]*>화상 2<\/button>/);
  });
});
