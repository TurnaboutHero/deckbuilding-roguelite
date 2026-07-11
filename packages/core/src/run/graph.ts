import type { EnemyDefId } from "../ids";

import { RUN_ENCOUNTERS } from "./encounters";

export type RunNodeKind = "combat" | "elite" | "shop" | "event" | "boss";

export interface RunNode {
  id: string;
  kind: RunNodeKind;
  encounter?: EnemyDefId[];
  eventId?: string;
}

export interface RunGraph {
  layers: RunNode[][];
}

export const legacyRunGraph = (): RunGraph => ({
  layers: RUN_ENCOUNTERS.map((encounter, index) => ({
    id: `legacy-combat-${index}`,
    // P4.1 keeps the byte-stable legacy flow. D3 elite/boss rewards are
    // reserved for P4.2+ graph activation, so plus encounters stay combat.
    kind: "combat" as const,
    encounter: [...encounter],
  })).map((node) => [node]),
});

export const nodeGoldReward = (kind: RunNodeKind): number => {
  switch (kind) {
    case "combat":
      return 35;
    case "elite":
      return 70;
    case "boss":
      return 100;
    case "shop":
    case "event":
      return 0;
  }
};
