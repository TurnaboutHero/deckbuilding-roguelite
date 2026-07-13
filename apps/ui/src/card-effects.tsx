import type { EffectAtom, SkillDef } from "@game/core";

import { Keyword } from "./keywords";
import type { KeywordTerm } from "./keywords";

import "./card-effects.css";

export interface EffectRowModel {
  kind: "base" | "heads" | "tails" | "mixed" | "cost" | "effect" | "element-face" | "overheat";
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
  if (atom.kind === "applyStatus" && atom.status === "frostbite") {
    return { text: `동상 ${atom.stacks}`, term: "frostbite" };
  }
  if (atom.kind === "applyStatus" && atom.status === "shock") {
    return { text: `감전 ${atom.stacks}`, term: "shock" };
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
  // P6 — 참조/소환 원자
  if (atom.kind === "damagePerTargetBurn") {
    return { text: `화상 1당 피해 ${atom.amountPerStack}`, term: "burn" };
  }
  if (atom.kind === "heal") {
    return { text: `회복 ${atom.amount}` };
  }
  if (atom.kind === "draw") {
    return { text: `코인 ${atom.count}개 뽑기` };
  }
  if (atom.kind === "nextTurnDraw") {
    return { text: `다음 턴 뽑기 +${atom.count}` };
  }
  if (atom.kind === "reduceCooldown") {
    return { text: `다른 스킬 쿨다운 -${atom.amount}` };
  }
  if (atom.kind === "enterOverheat") {
    return { text: "과열 진입", term: "overheat" };
  }
  if (atom.kind === "damagePerBlock") {
    return { text: `현재 방어 1당 피해 ${atom.amountPerBlock}`, term: "block" };
  }
  if (atom.kind === "blockFromCurrent") {
    return { text: `현재 방어만큼 방어 (최대 ${atom.cap})`, term: "block" };
  }
  if (atom.kind === "damagePlusBlock") {
    return { text: `피해 ${atom.base} + 현재 방어 (최대 +${atom.cap})`, term: "block" };
  }
  if (atom.kind === "prepareNextAttackDamage") {
    return { text: `이번 턴 다음 공격 피해 +${atom.amount}` };
  }
  if (atom.kind === "scheduleEndTurnBlockAoe") {
    return { text: `소환 행동 후 현재 방어만큼 전체 피해 (최대 ${atom.cap})`, term: "block" };
  }
  if (atom.kind === "summonEquipment") {
    return {
      text:
        atom.equipment === "chosen"
          ? `선택 장비 소환 (지속 ${atom.duration})`
          : `장비 소환 (지속 ${atom.duration})`,
    };
  }
  if (atom.kind === "commandChosenSummon") {
    return { text: "소환 장비 즉시 행동 (지속 -1)" };
  }
  if (atom.kind === "empowerSummons") {
    return { text: `소환 장비 강화 +${atom.amount}` };
  }
  if (atom.kind === "increaseWeaponOutput") return { text: `병기 출력 +${atom.amount}` };
  if (atom.kind === "extendAllSummons") return { text: `모든 소환 지속 +${atom.amount}` };
  if (atom.kind === "extendChosenSummon") return { text: `선택 소환 지속 +${atom.amount}` };
  if (atom.kind === "grantChosenSummonAoe") return { text: `선택 소환 광역 행동 ${atom.uses}회` };
  if (atom.kind === "cloneChosenSummon") return { text: `선택 소환 복제 (지속 ${atom.duration})` };
  if (atom.kind === "virtualManaSwordVolley") return { text: `임시 마나 검 ${atom.baseCount ?? 3}개 + 소환 수만큼 일제 공격 (피해 ${atom.baseDamage})` };
  if (atom.kind === "doubleTargetShock") return { text: "대상의 감전 2배", term: "shock" };
  if (atom.kind === "blockPerTargetShock") return { text: `방어 ${atom.base} + 감전 (최대 +${atom.cap})`, term: "shock" };
  if (atom.kind === "executeOrDischargeShock") return { text: "감전이 HP보다 높으면 처형, 아니면 감전만큼 피해 후 제거", term: "shock" };
  if (atom.kind === "damageIfTargetShocked") return { text: `감전 대상 피해 +${atom.amount}`, term: "shock" };
  if (atom.kind === "damageIfReused") return { text: `무료 재사용 시 피해 +${atom.amount}` };
  if (atom.kind === "readyRemise") return { text: `이번 턴 르미즈 기회 +${atom.amount ?? 1}` };
  return { text: "효과" };
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
  if (atom.kind === "applyStatus" && atom.status === "frostbite") {
    return { text: `동상 +${atom.stacks}`, term: "frostbite" };
  }
  if (atom.kind === "applyStatus" && atom.status === "shock") {
    return { text: `감전 +${atom.stacks}`, term: "shock" };
  }
  if (atom.kind === "selfDamage") return { text: `자신 피해 +${atom.amount}` };
  if (atom.kind === "empowerSummons") return { text: `강화 +${atom.amount}` };
  return atomSegment(atom);
};

const bonusSegments = (
  atoms: readonly EffectAtom[],
): Array<{ text: string; term?: KeywordTerm }> => atoms.map(bonusSegment);

export function skillEffectRows(skill: SkillDef): EffectRowModel[] {
  if (skill.type === "consume") {
    const rows: EffectRowModel[] = [
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
    // P7 D5 — 과열 강화 분기 (있을 때만)
    if (skill.overheatBonus !== undefined && skill.overheatBonus.length > 0) {
      rows.push({
        kind: "overheat",
        badge: "과열",
        segments: bonusSegments(skill.overheatBonus).map((segment) => ({
          ...segment,
          term: segment.term ?? "overheat",
        })),
      });
    }
    return rows;
  }

  const rows: EffectRowModel[] = [
    ...(skill.requiredElement === undefined
      ? []
      : [{
          kind: "cost" as const,
          badge: "비용",
          segments: [{ text: `${elementKo(skill.requiredElement)} ×${skill.cost} 장전` }],
        }]),
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
  if (skill.mixed !== undefined) {
    rows.push({
      kind: "mixed",
      badge: "앞/뒤",
      segments: bonusSegments(skill.mixed.effects),
    });
  }
  // P7 D5 — 특정 속성 코인 면 보너스 (예: 화염 앞면 추가 +1)
  for (const bonus of skill.elementFaces ?? []) {
    rows.push({
      kind: "element-face",
      badge: `${elementKo(bonus.element)} ${bonus.face === "heads" ? "앞면" : "뒷면"}`,
      segments: bonusSegments(bonus.effects),
    });
  }
  // P7 D5 — 과열 강화 분기
  if (skill.overheatBonus !== undefined && skill.overheatBonus.length > 0) {
    rows.push({
      kind: "overheat",
      badge: "과열",
      segments: bonusSegments(skill.overheatBonus).map((segment) => ({
        ...segment,
        term: segment.term ?? "overheat",
      })),
    });
  }

  return rows;
}

export function CardEffectRows(props: { skill: SkillDef }): JSX.Element {
  return (
    <div className="card-effects" aria-label={`${props.skill.name} 효과`}>
      {skillEffectRows(props.skill).map((row, rowIndex) => (
        <div className={`card-effect-row ${row.kind}`} key={`${row.kind}-${rowIndex}`}>
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
