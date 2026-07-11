import type { EnemyDefId } from "../ids";
import type { ContentDb } from "../content-types";
import { derive, rngFrom, seedFromString } from "../rng";

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

const enemy = (id: string): EnemyDefId => id as EnemyDefId;

const requireEncounter = (
  db: ContentDb,
  id: string,
  encounter: readonly EnemyDefId[],
): RunNode => {
  for (const enemyId of encounter) {
    if (db.enemies[String(enemyId)] === undefined) {
      throw new Error(`missing graph enemy: ${String(enemyId)}`);
    }
  }
  return { id, kind: "combat", encounter: [...encounter] };
};

const rollEncounter = (
  db: ContentDb,
  id: string,
  pool: readonly (readonly EnemyDefId[])[],
  rng: ReturnType<typeof rngFrom>,
): RunNode => requireEncounter(db, id, pool[rng.int(pool.length)]!);

const rollElite = (
  db: ContentDb,
  id: string,
  rng: ReturnType<typeof rngFrom>,
): RunNode => {
  const encounter = [[enemy("raider-plus")], [enemy("gatekeeper-plus")]][
    rng.int(2)
  ]!;
  for (const enemyId of encounter) {
    if (db.enemies[String(enemyId)] === undefined) {
      throw new Error(`missing graph enemy: ${String(enemyId)}`);
    }
  }
  return { id, kind: "elite", encounter: [...encounter] };
};

export const generateRunGraph = (runSeed: string, db: ContentDb): RunGraph => {
  const rng = rngFrom(derive(seedFromString(runSeed), "graph"));
  const singlePool = [
    [enemy("raider")],
    [enemy("shaman")],
    [enemy("gatekeeper")],
  ] as const;
  const twoEnemyPool = [
    [enemy("goblin"), enemy("ghoul")],
    [enemy("thief"), enemy("goblin")],
  ] as const;
  const threeEnemyPool = [[enemy("ghoul"), enemy("goblin"), enemy("slime")]] as const;
  const boss = [enemy("ember-archmage")] as const;

  return {
    layers: [
      [rollEncounter(db, "combat-1", singlePool, rng)],
      [rollEncounter(db, "combat-2", twoEnemyPool, rng)],
      [
        { id: "shop-3", kind: "shop" },
        rollEncounter(db, "combat-3b", twoEnemyPool, rng),
      ],
      [rollEncounter(db, "combat-4", twoEnemyPool, rng)],
      [rollElite(db, "elite-5", rng)],
      [
        { id: "shop-6", kind: "shop" },
        rollEncounter(db, "combat-6b", threeEnemyPool, rng),
      ],
      [rollEncounter(db, "combat-7", threeEnemyPool, rng)],
      [rollEncounter(db, "combat-8", twoEnemyPool, rng)],
      [{ id: "shop-9", kind: "shop" }],
      [{ id: "boss-10", kind: "boss", encounter: [...boss] }],
    ],
  };
};

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
