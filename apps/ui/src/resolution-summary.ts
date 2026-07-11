import type { CombatEvent, EffectAtom, Face, SkillDef } from '@game/core';

export interface ResolutionSummary {
  skillName: string;
  kind: 'flip' | 'consume';
  faces: Face[];
  costNote: string | null;
  baseLines: string[];
  bonusLines: string[];
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

const statusKo = (value: string): string =>
  ({
    burn: '화상',
    frostbite: '동상',
    shock: '감전'
  })[value] ?? value;

const faceKo = (face: Face): string => (face === 'heads' ? '앞면' : '뒷면');

const effectLine = (atom: EffectAtom): string => {
  if (atom.kind === 'damage') return `피해 ${atom.amount}`;
  if (atom.kind === 'block') return `방어 ${atom.amount}`;
  if (atom.kind === 'applyStatus') return `${statusKo(atom.status)} ${atom.stacks}`;
  if (atom.kind === 'addCoin') return `임시 ${elementKo(String(atom.coin))} +${atom.count}`;
  if (atom.kind === 'selfDamage') return `자신 피해 ${atom.amount}`;
  if (atom.kind === 'grantElement') return `기본 코인 ${elementKo(atom.element)} 취급`;
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

export function buildResolutionSummary(
  skill: SkillDef,
  events: readonly CombatEvent[]
): ResolutionSummary {
  const faces = events.flatMap((event) => (event.type === 'coinFlipped' ? [event.face] : []));
  const kind = skill.type;
  const baseLines = (skill.type === 'consume' ? skill.effects : skill.base).map(effectLine);
  const bonusLines: string[] = [];

  if (skill.type === 'flip') {
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
    bonusLines: skill.type === 'flip' && bonusLines.length === 0 ? ['면 보너스 없음'] : bonusLines,
    statusLines: statusLines(events),
    totalLine: totalLine(events)
  };
}
