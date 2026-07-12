import { CONTENT_VERSION, contentDb } from "../../../content/src/index";
import { describe, expect, it } from "vitest";

import type { EventDefId } from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import {
  acceptEvent,
  createRun,
  declineEvent,
  startRunCombat,
} from "./run";
import type { RunState } from "./types";

const eventId = (value: string): EventDefId => value as EventDefId;

const eventLayerChoice = (run: RunState): { layer: number; choice: number } => {
  for (let layer = 0; layer < run.graph.layers.length; layer += 1) {
    const choice = (run.graph.layers[layer] ?? []).findIndex(
      (node) => node.kind === "event",
    );
    if (choice >= 0) return { layer, choice };
  }
  throw new Error("run graph must contain an event node");
};

const runAtEvent = (seed: string, eventKey: string): RunState => {
  const base = createRun(
    { contentVersion: CONTENT_VERSION, runSeed: seed, character: "warrior" as never },
    contentDb,
  );
  const { layer, choice } = eventLayerChoice(base);
  const nodeChoices = base.nodeChoices.map((nodeChoice, index) =>
    index === layer ? choice : nodeChoice,
  );
  return {
    ...base,
    combatIndex: layer,
    nodeChoices,
    phase: "event",
    pendingEvent: { eventId: eventId(eventKey) },
  };
};

describe("P4.4 verification worker - event stream and sim policy", () => {
  it("uses the same event-N stream for event roll and ambush elite roll without an off-by-one consume", () => {
    const seed = "P44-WORKER-EVENT-STREAM";
    const run = runAtEvent(seed, "ambush-bounty");
    const accepted = acceptEvent(run, contentDb);
    const started = startRunCombat(accepted, contentDb);

    const eventIds = Object.keys(contentDb.events ?? {}).sort();
    const event = contentDb.events?.["ambush-bounty"];
    if (event?.risk !== "combat") throw new Error("ambush event missing");
    const rng = rngFrom(derive(seedFromString(seed), `event-${run.combatIndex}`));
    rng.int(eventIds.length);
    const expected = event.elitePool[rng.int(event.elitePool.length)]!.map(String);

    expect(started.combat.enemies.map((enemy) => String(enemy.defId))).toEqual(
      expected,
    );
  });

  it("keeps event acceptance effects explicit while advancing to the same next combat node", () => {
    const accepted = acceptEvent(runAtEvent("P44-WORKER-HP-A", "blood-offering"), contentDb);
    const declined = declineEvent(runAtEvent("P44-WORKER-HP-A", "blood-offering"), contentDb);

    expect(accepted.currentHp).toBe(declined.currentHp - 5);
    expect(accepted.bag.length).toBe(declined.bag.length + 1);
    expect(accepted.combatIndex).toBe(declined.combatIndex);
    expect(
      accepted.graph.layers[accepted.combatIndex]?.[accepted.nodeChoices[accepted.combatIndex] ?? 0],
    ).toEqual(
      declined.graph.layers[declined.combatIndex]?.[declined.nodeChoices[declined.combatIndex] ?? 0],
    );
  });

  it("rejects forged transmute accepts that omit the paid bag choice", () => {
    expect(() =>
      acceptEvent(runAtEvent("P44-WORKER-0", "transmute-altar"), contentDb),
    ).toThrow("bagIndex is required");
  });
});
