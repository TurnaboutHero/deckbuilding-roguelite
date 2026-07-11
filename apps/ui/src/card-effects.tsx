import type { EffectAtom, SkillDef } from "@game/core";

import { Keyword } from "./keywords";
import type { KeywordTerm } from "./keywords";

import "./card-effects.css";

export interface EffectRowModel {
  kind: "base" | "heads" | "tails" | "cost" | "effect";
  badge: string;
  modeNote?: string;
  segments: Array<{ text: string; term?: KeywordTerm }>;
}

const ELEMENT_KO: Record<string, string> = {
  fire: "화염",
  mana: "마나",
  frost: "냉기",
  lightning: "전기",
  blood: "혈액",
};

const elementKo = (value: string): string => ELEMENT_KO[value] ?? value;

// any 모드는 기본 읽기("하나라도 나오면")라 표기 생략 — per만 "동전마다"로 구분한다.
// 좁은 카드에서 값이 접미 라벨에 밀려 줄바꿈·클리핑되는 것을 막는 표기 결정 (UX_FEEDBACK_DECISIONS).
const modeNote = (mode: "any" | "per"): string | undefined =>
  mode === "per" ? "동전마다" : undefined;

const atomSegment = (atom: EffectAtom): { text: string; term?: KeywordTerm } => {
  if (atom.kind === "damage") return { text: `피해 ${atom.amount}` };
  if (atom.kind === "block") return { text: `방어 ${atom.amount}` };
  if (atom.kind === "applyStatus" && atom.status === "burn") {
    return { text: `화상 ${atom.stacks}`, term: "burn" };
  }
  if (atom.kind === "applyStatus") {
    return { text: `${atom.status} ${atom.stacks}` };
  }
  if (atom.kind === "addCoin") {
    return {
      text: `임시 ${elementKo(String(atom.coin))} +${atom.count}`,
      term: "temporary",
    };
  }
  if (atom.kind === "selfDamage") return { text: `자신 피해 ${atom.amount}` };
  if (atom.kind === "addTurnTrigger") {
    // 트리거 정의에서 데이터 주도로 유도 — '특수'는 인과 가독성 원칙 위반 (P3.3 시각 검수)
    const hookKo =
      atom.trigger.hook === "onDamageDealt" ? "피해마다" : "공격 스킬마다";
    const inner = atom.trigger.effects
      .map((effect) =>
        effect.kind === "applyStatus" && effect.status === "burn"
          ? `화상 +${effect.stacks}`
          : atomSegment(effect).text,
      )
      .join(" / ");
    return { text: `이번 턴 ${hookKo} ${inner}`, term: "trigger" };
  }
  if (atom.kind === "grantElement") {
    return { text: `기본 코인 ${elementKo(atom.element)} 취급` };
  }
  return { text: "특수" };
};

const atomSegments = (
  atoms: readonly EffectAtom[],
): Array<{ text: string; term?: KeywordTerm }> => atoms.map(atomSegment);

// 면 보너스는 "더해지는 값"임을 +로 명시 — 값이 행의 첫 자리에 오도록 접미 표기와 짝을 이룬다
const bonusSegment = (
  atom: EffectAtom,
): { text: string; term?: KeywordTerm } => {
  if (atom.kind === "damage") return { text: `피해 +${atom.amount}` };
  if (atom.kind === "block") return { text: `방어 +${atom.amount}` };
  if (atom.kind === "applyStatus" && atom.status === "burn") {
    return { text: `화상 +${atom.stacks}`, term: "burn" };
  }
  if (atom.kind === "selfDamage") return { text: `자신 피해 +${atom.amount}` };
  return atomSegment(atom);
};

const bonusSegments = (
  atoms: readonly EffectAtom[],
): Array<{ text: string; term?: KeywordTerm }> => atoms.map(bonusSegment);

export function skillEffectRows(skill: SkillDef): EffectRowModel[] {
  if (skill.type === "consume") {
    return [
      {
        kind: "cost",
        badge: "비용",
        segments: [
          {
            text: `${elementKo(skill.consume.element)} ×${skill.consume.count} 소비`,
            term: "consume",
          },
        ],
      },
      {
        kind: "effect",
        badge: "효과",
        segments: atomSegments(skill.effects),
      },
    ];
  }

  const rows: EffectRowModel[] = [
    {
      kind: "base",
      badge: "기본",
      segments: atomSegments(skill.base),
    },
  ];

  if (skill.heads !== undefined) {
    rows.push({
      kind: "heads",
      badge: "앞면",
      modeNote: modeNote(skill.heads.mode),
      segments: bonusSegments(skill.heads.effects),
    });
  }
  if (skill.tails !== undefined) {
    rows.push({
      kind: "tails",
      badge: "뒷면",
      modeNote: modeNote(skill.tails.mode),
      segments: bonusSegments(skill.tails.effects),
    });
  }

  return rows;
}

export function CardEffectRows(props: { skill: SkillDef }): JSX.Element {
  return (
    <div className="card-effects" aria-label={`${props.skill.name} 효과`}>
      {skillEffectRows(props.skill).map((row) => (
        <div className={`card-effect-row ${row.kind}`} key={row.kind}>
          <span className="card-effect-badge">{row.badge}</span>
          <span className="card-effect-copy">
            {/* 값이 먼저, 발동 조건은 접미 — 좁은 카드에서 잘려도 수치는 항상 보인다 */}
            {row.segments.map((segment, index) => (
              <span className="card-effect-segment" key={index}>
                {index > 0 ? " / " : ""}
                {segment.term !== undefined ? (
                  <Keyword term={segment.term}>{segment.text}</Keyword>
                ) : (
                  segment.text
                )}
              </span>
            ))}
            {row.modeNote !== undefined ? (
              <small className="card-effect-mode"> · {row.modeNote}</small>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
