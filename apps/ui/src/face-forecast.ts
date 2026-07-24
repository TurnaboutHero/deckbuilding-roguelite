import { isSuccessLadderFlipSkill } from "@game/core";
import type { EffectAtom, Element, Face, FlipSkillDef } from "@game/core";

import { statusKo } from "./resolution-summary";

export interface ForecastCoin {
  elements: readonly Element[];
  heads: readonly EffectAtom[];
  tails: readonly EffectAtom[];
}

export interface FaceForecast {
  heads: string;
  tails: string;
  multi: boolean;
}

const repeated = (effects: readonly EffectAtom[], count: number): EffectAtom[] =>
  Array.from({ length: count }, () => effects).flat();

const skillEffectsFor = (
  skill: FlipSkillDef,
  coins: readonly ForecastCoin[],
  face: Face,
): EffectAtom[] => {
  if (isSuccessLadderFlipSkill(skill)) {
    const successes = skill.successFace === face ? coins.length : 0;
    const resonance =
      skill.resonance !== undefined &&
      face === skill.successFace &&
      coins.some((coin) => coin.elements.includes(skill.resonance!.element))
        ? skill.resonance.effects
        : [];
    return [...(skill.successLadder[successes] ?? []), ...resonance];
  }

  const faceLine = face === "heads" ? skill.heads : skill.tails;
  const effects = [
    ...(skill.base ?? []),
    ...(faceLine === undefined
      ? []
      : repeated(faceLine.effects, faceLine.mode === "per" ? coins.length : 1)),
  ];
  for (const bonus of skill.elementFaces ?? []) {
    if (bonus.face !== face) continue;
    for (const coin of coins) {
      if (coin.elements.includes(bonus.element)) effects.push(...bonus.effects);
    }
  }
  return effects;
};

const atomText = (atom: EffectAtom): string => {
  if (atom.kind === "fixedDamage") return `고정 피해 ${atom.amount}`;
  if (atom.kind === "damageIfTargetStatus")
    return `${statusKo(atom.status)} 대상이면 피해 ${atom.amount}`;
  if (atom.kind === "nextTurnBlock") return `다음 턴 방어 ${atom.amount}`;
  if (atom.kind === "loseHp") return `체력 ${atom.amount} 지불`;
  if (atom.kind === "heal") return `회복 ${atom.amount}`;
  if (atom.kind === "nextTurnDraw") return `다음 턴 드로우 +${atom.count}`;
  if (atom.kind === "addCoin") return `임시 코인 ${atom.count}`;
  if (atom.kind === "applyStatus") return `${statusKo(atom.status)} ${atom.stacks}`;
  if (atom.kind === "draw") return `드로우 ${atom.count}`;
  if (atom.kind === "drawSpecific") return `지정 코인 드로우 ${atom.count}`;
  if (atom.kind === "selfDamage") return `자신 피해 ${atom.amount}`;
  if (atom.kind === "payHp") return `체력 ${atom.amount} 지불`;
  if (atom.kind === "aoeDamage") return `전체 피해 ${atom.amount}`;
  return "특수 효과";
};

export const summarizeFaceEffects = (effects: readonly EffectAtom[]): string => {
  let damage = 0;
  let block = 0;
  const remaining: EffectAtom[] = [];
  for (const atom of effects) {
    if (atom.kind === "damage" || atom.kind === "coinDamage") damage += atom.amount;
    else if (atom.kind === "block") block += atom.amount;
    else remaining.push(atom);
  }
  const parts = [
    damage > 0 ? `피해 ${damage}` : "",
    block > 0 ? `방어 ${block}` : "",
    ...remaining.map(atomText),
  ].filter(Boolean);
  return parts.length === 0 ? "효과 없음" : parts.join(" · ");
};

export function buildFaceForecast(
  skill: FlipSkillDef,
  coins: readonly ForecastCoin[],
): FaceForecast | null {
  if (coins.length === 0) return null;
  const effectsFor = (face: Face): EffectAtom[] => [
    ...skillEffectsFor(skill, coins, face),
    ...coins.flatMap((coin) => coin[face]),
  ];
  return {
    heads: summarizeFaceEffects(effectsFor("heads")),
    tails: summarizeFaceEffects(effectsFor("tails")),
    multi: coins.length > 1,
  };
}
