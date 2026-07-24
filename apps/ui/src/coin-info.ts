import { effectiveElements } from "@game/core";
import type { CoinInstance, ContentDb, EffectAtom } from "@game/core";

import { statusKo } from "./resolution-summary";

const elementLabel = (value: string): string =>
  ({ fire: "화염", mana: "마나", frost: "냉기", lightning: "전기", blood: "혈액" })[value] ?? value;

export const coinNameFor = (db: ContentDb, coin: string): string => {
  const element = db.coins[coin]?.element;
  return element === null || element === undefined ? "기본 코인" : `${elementLabel(element)} 코인`;
};

const procEffectText = (effect: { kind: string } & Record<string, unknown>): string => {
  if (effect.kind === "block") return `방어 +${effect.amount as number}`;
  if (effect.kind === "damage" || effect.kind === "coinDamage") return `피해 ${effect.amount as number}`;
  if (effect.kind === "fixedDamage") return `고정 피해 ${effect.amount as number}`;
  if (effect.kind === "loseHp") return `체력 ${effect.amount as number} 상실`;
  if (effect.kind === "heal") return `회복 ${effect.amount as number}`;
  if (effect.kind === "nextTurnDraw") return `다음 턴 뽑기 +${effect.count as number}`;
  if (effect.kind === "nextTurnBlock") return `다음 턴 방어 +${effect.amount as number}`;
  if (effect.kind === "addCoin") return `버림 더미에 임시 기본 코인 +${effect.count as number}`;
  if (effect.kind === "damageIfTargetStatus") {
    return `대상이 ${statusKo(effect.status as never)}이면 피해 ${effect.amount as number}`;
  }
  if (effect.kind === "applyStatus") {
    const name = statusKo(effect.status as never);
    if (name !== effect.status) return `${name} +${effect.stacks as number}`;
  }
  return "속성 효과";
};

export const coinRewardDetailFor = (db: ContentDb, coin: string): string => {
  const procs = db.coins[coin]?.procs;
  if (procs === undefined) return "속성 효과 없음";
  const parts: string[] = [];
  if ((procs.heads ?? []).length > 0) parts.push(`앞면 ${(procs.heads ?? []).map(procEffectText).join(" + ")}`);
  if ((procs.tails ?? []).length > 0) parts.push(`뒷면 ${(procs.tails ?? []).map(procEffectText).join(" + ")}`);
  return parts.length === 0 ? "속성 효과 없음" : parts.join(" · ");
};

export const coinFaceEffectsFor = (
  db: ContentDb,
  coin: CoinInstance,
): { heads: EffectAtom[]; tails: EffectAtom[] } => {
  const base = db.coins[String(coin.defId)];
  const definitions = [
    base,
    ...effectiveElements(coin, db).flatMap((element) =>
      Object.values(db.coins).filter((definition) => definition.element === element),
    ),
  ];
  const unique = [
    ...new Map(
      definitions
        .filter((definition): definition is NonNullable<typeof definition> => definition !== undefined)
        .map((definition) => [String(definition.id), definition]),
    ).values(),
  ];
  return {
    heads: unique.flatMap((definition) => definition.procs?.heads ?? []),
    tails: unique.flatMap((definition) => definition.procs?.tails ?? []),
  };
};
