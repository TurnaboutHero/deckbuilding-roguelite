import type { TurnTriggerInstance } from "@game/core";
import { describe, expect, it } from "vitest";

import { turnBuffTestHooks } from "./turn-buff";

describe("turn buff display text", () => {
  it("names known triggers and summarizes their effect", () => {
    const trigger: TurnTriggerInstance = {
      uid: 1,
      trigger: {
        id: "flame-sword",
        hook: "onDamageDealt",
        effects: [
          { kind: "applyStatus", status: "burn", stacks: 1, to: "target" },
        ],
      },
    };

    expect(turnBuffTestHooks.triggerName(trigger.trigger.id)).toBe("화염검");
    expect(turnBuffTestHooks.triggerEffectText(trigger.trigger)).toBe("화상 +1");
  });
});
