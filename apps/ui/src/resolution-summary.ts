import { isSuccessLadderFlipSkill } from '@game/core';
import type { CombatEvent, EffectAtom, Face, SkillDef } from '@game/core';

export interface ResolutionSummary {
  skillName: string;
  kind: 'flip' | 'consume';
  faces: Face[];
  costNote: string | null;
  baseLines: string[];
  bonusLines: string[];
  triggerLines: string[];
  statusLines: string[];
  totalLine: string;
}

const elementKo = (value: string): string =>
  ({
    fire: '화염',
    mana: '마나',
    frost: '냉기',
    lightning: '전기',
    blood: '혈액'
  })[value] ?? value;

export const statusKo = (value: string): string =>
  ({
    burn: '화상',
    poison: '중독',
    frostbite: '동상',
    shock: '감전',
    healLock: '회복 봉인'
  })[value] ?? value;

const faceKo = (face: Face): string => (face === 'heads' ? '앞면' : '뒷면');

const triggerKo = (value: string): string =>
  ({
    'flame-sword': '화염검',
    'heart-of-flame': '불의 심장'
  })[value] ?? value;

const effectLine = (atom: EffectAtom): string => {
  if (atom.kind === 'damage') return `피해 ${atom.amount}`;
  if (atom.kind === 'block') return `방어 ${atom.amount}`;
  if (atom.kind === 'applyStatus') return `${statusKo(atom.status)} ${atom.stacks}`;
  if (atom.kind === 'addCoin') return `임시 ${elementKo(String(atom.coin))} +${atom.count}`;
  if (atom.kind === 'selfDamage') return `자신 피해 ${atom.amount}`;
  if (atom.kind === 'grantElement') return `기본 코인 ${elementKo(atom.element)} 취급`;
  if (atom.kind === 'addTurnTrigger') {
    const hookKo = atom.trigger.hook === 'onDamageDealt' ? '피해마다' : '공격 스킬마다';
    const inner = atom.trigger.effects
      .map((effect) =>
        effect.kind === 'applyStatus' ? `${statusKo(effect.status)} +${effect.stacks}` : effectLine(effect)
      )
      .join(' / ');
    return `이번 턴 ${hookKo} ${inner}`;
  }
  return '특수';
};

const bonusEffectLine = (atoms: readonly EffectAtom[], repeats: number): string =>
  atoms
    .map((atom) => {
      if (atom.kind === 'damage') return `+${atom.amount * repeats} 피해`;
      if (atom.kind === 'block') return `+${atom.amount * repeats} 방어`;
      if (atom.kind === 'applyStatus') return `+${atom.stacks * repeats} ${statusKo(atom.status)}`;
      if (atom.kind === 'addCoin') return `임시 ${elementKo(String(atom.coin))} +${atom.count * repeats}`;
      if (atom.kind === 'selfDamage') return `자신 피해 ${atom.amount * repeats}`;
      if (atom.kind === 'grantElement') return `기본 코인 ${elementKo(atom.element)} 취급`;
      return '특수';
    })
    .join(' / ');

const totalLine = (events: readonly CombatEvent[]): string => {
  const totals = events.reduce(
    (sum, event) => {
      if (event.type === 'damageDealt' && event.target.type === 'enemy') {
        return { ...sum, damage: sum.damage + event.amount };
      }
      if (event.type === 'damageDealt' && event.target.type === 'player') {
        return { ...sum, selfDamage: sum.selfDamage + event.amount };
      }
      if (event.type === 'blockGained') return { ...sum, block: sum.block + event.amount };
      if (event.type === 'statusApplied' && event.status === 'burn') {
        return { ...sum, burn: sum.burn + event.stacks };
      }
      if (event.type === 'witherApplied') return { ...sum, wither: sum.wither + event.amount };
      if (event.type === 'coinCreated') return { ...sum, coinsCreated: sum.coinsCreated + 1 };
      return sum;
    },
    { damage: 0, block: 0, burn: 0, wither: 0, selfDamage: 0, coinsCreated: 0 }
  );
  const parts = [
    totals.damage > 0 ? `피해 ${totals.damage}` : '',
    totals.block > 0 ? `방어 ${totals.block}` : '',
    totals.burn > 0 ? `화상 ${totals.burn}` : '',
    totals.wither > 0 ? `위축 ${totals.wither}` : '',
    totals.selfDamage > 0 ? `자신 피해 ${totals.selfDamage}` : '',
    totals.coinsCreated > 0 ? `코인 생성 ${totals.coinsCreated}` : ''
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '효과 없음';
};

const statusLines = (events: readonly CombatEvent[]): string[] =>
  events
    .map((event) => {
      if (event.type === 'statusApplied') return `${statusKo(event.status)} +${event.stacks}`;
      if (event.type === 'witherApplied') return `위축 — 다음 드로우 -${event.nextDrawPenalty}`;
      return '';
    })
    .filter(Boolean);

// 트리거 라인은 이벤트 구간 귀속이 아니라 알려진 id의 고정 효과 매핑으로 만든다 —
// turnTriggerFired 뒤의 statusApplied가 스킬 자체 효과일 수 있어 구간 귀속은 오귀속을
// 낳는다 (감시자 발견). 코어 이벤트 스키마는 흔들지 않고, 미지 id는 이름만 표시한다.
const TRIGGER_EFFECT_KO: Record<string, string> = {
  'flame-sword': '화상 +1',
  'heart-of-flame': '화상 +2'
};

const triggerLines = (events: readonly CombatEvent[]): string[] =>
  events.flatMap((event) => {
    if (event.type !== 'turnTriggerFired') return [];
    const effect = TRIGGER_EFFECT_KO[event.trigger];
    return [effect === undefined ? triggerKo(event.trigger) : `${triggerKo(event.trigger)} → ${effect}`];
  });

export function buildResolutionSummary(
  skill: SkillDef,
  events: readonly CombatEvent[]
): ResolutionSummary {
  const faces = events.flatMap((event) => (event.type === 'coinFlipped' ? [event.face] : []));
  const kind = skill.type;
  const ladderSkill = skill.type === 'flip' && isSuccessLadderFlipSkill(skill) ? skill : undefined;
  const successCount = ladderSkill === undefined ? 0 : faces.filter((face) => face === ladderSkill.successFace).length;
  const resolvedAtoms =
    skill.type === 'consume'
      ? skill.effects
      : ladderSkill === undefined
        ? (skill.base ?? [])
        : (ladderSkill.successLadder[successCount] ?? []);
  const baseLines = resolvedAtoms.map(effectLine);
  const bonusLines: string[] = [];

  if (ladderSkill !== undefined) {
    const resonanceFired = events.some(
      (event) => event.type === 'resonanceTriggered' && event.skill === ladderSkill.id
    );
    if (resonanceFired && ladderSkill.resonance !== undefined) {
      bonusLines.push(`공명: ${ladderSkill.resonance.effects.map(effectLine).join(' / ')}`);
    }
  } else if (skill.type === 'flip') {
    const addBonus = (face: Face, bonus: typeof skill.heads): void => {
      const count = faces.filter((candidate) => candidate === face).length;
      if (bonus === undefined || count === 0) return;
      const repeats = bonus.mode === 'any' ? 1 : count;
      const countLabel = bonus.mode === 'per' && repeats > 1 ? ` ×${repeats}` : '';
      bonusLines.push(`${faceKo(face)}${countLabel} → ${bonusEffectLine(bonus.effects, repeats)}`);
    };
    addBonus('heads', skill.heads);
    addBonus('tails', skill.tails);
  }

  return {
    skillName: skill.name,
    kind,
    faces: [...faces],
    costNote:
      skill.type === 'consume' ? `${elementKo(skill.consume.element)} ×${skill.consume.count} 지불 — 플립 없음` : null,
    baseLines,
    bonusLines: skill.type === 'flip' && ladderSkill === undefined && bonusLines.length === 0 ? ['면 보너스 없음'] : bonusLines,
    triggerLines: triggerLines(events),
    statusLines: statusLines(events),
    totalLine: totalLine(events)
  };
}
