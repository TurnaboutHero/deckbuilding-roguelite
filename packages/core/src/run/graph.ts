import type { EnemyDefId } from "../ids";
import type { ContentDb } from "../content-types";
import { derive, rngFrom, seedFromString } from "../rng";
import type { Rng } from "../rng";

import { RUN_ENCOUNTERS } from "./encounters";

export type RunNodeKind =
  | "combat"
  | "elite"
  | "shop"
  | "event"
  | "boss"
  | "rest"
  | "treasure";

export interface RunNode {
  id: string;
  kind: RunNodeKind;
  encounter?: EnemyDefId[];
}

// P6 D1 — 3막 구조: layers는 평탄 배열 유지(전 코드가 layers[combatIndex] 인덱스),
// acts 메타가 막 경계를 표기한다. acts 부재 = 레거시 단일 막 그래프(v5 저장 래핑).
export interface RunGraph {
  layers: RunNode[][];
  acts?: { start: number }[];
}

export const ACT_COUNT = 3;
export const VISITS_PER_ACT = 10;
export const REST_VISIT_INDEX = 8; // 0-based 방문 9
export const BOSS_VISIT_INDEX = 9; // 0-based 방문 10

// 후보 생성 분포 (요구 A — 생성 분포이며 실제 방문 분포와 구분해 기록한다)
export const CANDIDATE_KIND_WEIGHTS: readonly {
  kind: Exclude<RunNodeKind, "boss">;
  weight: number;
}[] = [
  { kind: "combat", weight: 50 },
  { kind: "elite", weight: 10 },
  { kind: "treasure", weight: 2 },
  { kind: "shop", weight: 15 },
  { kind: "rest", weight: 3 },
  { kind: "event", weight: 20 },
];

const enemy = (id: string): EnemyDefId => id as EnemyDefId;

const requireEnemies = (db: ContentDb, encounter: readonly EnemyDefId[]): void => {
  for (const enemyId of encounter) {
    if (db.enemies[String(enemyId)] === undefined) {
      throw new Error(`missing graph enemy: ${String(enemyId)}`);
    }
  }
};

const SINGLE_POOL = [
  [enemy("raider")],
  [enemy("shaman")],
  [enemy("gatekeeper")],
] as const;
const TWO_POOL = [
  [enemy("goblin"), enemy("ghoul")],
  [enemy("thief"), enemy("goblin")],
] as const;
const THREE_POOL = [[enemy("ghoul"), enemy("goblin"), enemy("slime")]] as const;
const ELITE_POOL = [[enemy("raider-plus")], [enemy("gatekeeper-plus")]] as const;

// 막 보스 (P6 D1 — 재사용+수치 변형, balance-provisional):
// act1 수문장+ 단일 승격 / act2 약탈자+·수문장+ 2체 / act3 잿불 마도왕.
const ACT_BOSSES = [
  [enemy("gatekeeper-plus")],
  [enemy("raider-plus"), enemy("gatekeeper-plus")],
  [enemy("ember-archmage")],
] as const;

// 방문 깊이별 전투 조우 풀 — 막 내 방문 1~3 단일, 4~6 2체, 7~8 2~3체 혼합
const combatPoolFor = (visit: number): readonly (readonly EnemyDefId[])[] => {
  if (visit <= 2) return SINGLE_POOL;
  if (visit <= 5) return TWO_POOL;
  return [...TWO_POOL, ...THREE_POOL];
};

const rollKind = (
  rng: Rng,
  excludeElite: boolean,
): Exclude<RunNodeKind, "boss"> => {
  const pool = CANDIDATE_KIND_WEIGHTS.filter(
    (entry) => !(excludeElite && entry.kind === "elite"),
  );
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.float() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return entry.kind;
  }
  return pool[pool.length - 1]!.kind;
};

const candidateNode = (
  db: ContentDb,
  id: string,
  kind: Exclude<RunNodeKind, "boss">,
  visit: number,
  rng: Rng,
): RunNode => {
  if (kind === "combat") {
    const pool = combatPoolFor(visit);
    const encounter = pool[rng.int(pool.length)]!;
    requireEnemies(db, encounter);
    return { id, kind, encounter: [...encounter] };
  }
  if (kind === "elite") {
    const encounter = ELITE_POOL[rng.int(ELITE_POOL.length)]!;
    requireEnemies(db, encounter);
    return { id, kind, encounter: [...encounter] };
  }
  return { id, kind };
};

// P6 D1 — 3막×10방문 그래프. 결정론: derive(runSeed,'graph') 단일 스트림,
// 막·방문·후보 순서로 소비 순서 고정. 가드레일(설계 보충, 결정 로그 §D1):
// 1막 방문1은 combat 단일 강제, 1막 방문1~2 후보에서 elite 제외.
export const generateRunGraph = (runSeed: string, db: ContentDb): RunGraph => {
  const rng = rngFrom(derive(seedFromString(runSeed), "graph"));
  const layers: RunNode[][] = [];
  const acts: { start: number }[] = [];

  for (let act = 0; act < ACT_COUNT; act += 1) {
    acts.push({ start: layers.length });
    for (let visit = 0; visit < VISITS_PER_ACT; visit += 1) {
      const layerId = `a${act + 1}-v${visit + 1}`;
      if (visit === REST_VISIT_INDEX) {
        layers.push([{ id: `${layerId}-rest`, kind: "rest" }]);
        continue;
      }
      if (visit === BOSS_VISIT_INDEX) {
        const encounter = ACT_BOSSES[act]!;
        requireEnemies(db, encounter);
        layers.push([
          { id: `${layerId}-boss`, kind: "boss", encounter: [...encounter] },
        ]);
        continue;
      }
      if (act === 0 && visit === 0) {
        layers.push([
          candidateNode(db, `${layerId}-c1`, "combat", visit, rng),
        ]);
        continue;
      }
      const excludeElite = act === 0 && visit <= 1;
      const count = rng.float() < 0.6 ? 2 : 3;
      const nodes: RunNode[] = [];
      for (let candidate = 0; candidate < count; candidate += 1) {
        nodes.push(
          candidateNode(
            db,
            `${layerId}-c${candidate + 1}`,
            rollKind(rng, excludeElite),
            visit,
            rng,
          ),
        );
      }
      layers.push(nodes);
    }
  }

  return { layers, acts };
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

// 막 인덱스 (0-based). acts 부재 = 레거시 그래프 = 항상 0막.
export const actOfLayer = (graph: RunGraph, layerIndex: number): number => {
  const acts = graph.acts;
  if (acts === undefined || acts.length === 0) return 0;
  let act = 0;
  for (let index = 0; index < acts.length; index += 1) {
    if (layerIndex >= acts[index]!.start) act = index;
  }
  return act;
};

// P6 D1 — 막별 적 수치 스케일. 조정 이력(전부 결정론 스모크 증거, balance-provisional):
// ×1.4/1.8 → 0/500 → ×1.25/1.5 → 0/500 → 진단: 1막(×1.0)이 이미 구 런 전체 난이도라
// 3막 복리로 봇 완주 ~0. 막 보스 전체 회복 보충 후에도 동일 → ×1.15/1.3으로 최종 완화.
// 사람 데이터 전 확정 금지 — 3막 완주 밸런스는 사람 게이트 대상.
export const enemyScaleForAct = (act: number): number => 1 + 0.15 * act;

export const nodeGoldReward = (kind: RunNodeKind): number => {
  switch (kind) {
    case "combat":
      return 35;
    case "elite":
      return 70;
    case "boss":
      return 100;
    case "treasure":
      return 100;
    case "shop":
    case "event":
    case "rest":
      return 0;
  }
};
