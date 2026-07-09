import type { ContentDb } from '../content-types';
import type { Face, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import type { CombatEvent } from './events';
import { resolveFlip } from './resolve/flip';
import { cloneState } from './state';
import type { CombatState } from './state';

export interface PreviewBranch {
  faces: Face[];
  probability: number;
  damage: number;
  block: number;
  selfDamage: number;
}

export interface PreviewFlipResult {
  branches: PreviewBranch[];
  byAxis: {
    damage: { min: number; max: number };
    block: { min: number; max: number };
  };
  expected: { damage: number; block: number };
}

const scriptedFlips = (faces: readonly Face[]): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      const face = faces[index];
      if (face === undefined) throw new Error('scripted flip exhausted');
      index += 1;
      return face;
    },
    shuffle: <T>(xs: readonly T[]) => [...xs],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const enumerateFaces = (count: number): Face[][] => {
  if (count > 5) throw new Error('preview supports up to 5 placed coins');
  const branchCount = 2 ** count;
  return Array.from({ length: branchCount }, (_, branch) =>
    Array.from({ length: count }, (_unused, bit) => ((branch & (1 << bit)) === 0 ? 'heads' : 'tails'))
  );
};

const sumBranch = (events: readonly CombatEvent[]): Omit<PreviewBranch, 'faces' | 'probability'> =>
  events.reduce(
    (total, event) => {
      if (event.type === 'damageDealt' && event.source === 'skill') {
        return { ...total, damage: total.damage + event.amount };
      }
      if (event.type === 'damageDealt' && event.source === 'self') {
        return { ...total, selfDamage: total.selfDamage + event.amount };
      }
      if (event.type === 'blockGained' && event.target.type === 'player') {
        return { ...total, block: total.block + event.amount };
      }
      return total;
    },
    { damage: 0, block: 0, selfDamage: 0 }
  );

const minMax = (values: readonly number[]): { min: number; max: number } => ({
  min: Math.min(...values),
  max: Math.max(...values)
});

export const previewFlip = (state: CombatState, slot: SlotId, db: ContentDb): PreviewFlipResult => {
  const slotState = state.slots[Number(slot)];
  if (slotState === undefined) throw new Error('slot does not exist');
  const skill = db.skills[String(slotState.skillId)];
  if (skill === undefined || skill.type !== 'flip') throw new Error('slot is not a flip skill');

  const placed = state.zones.placed[slot] ?? [];
  const faceBranches = enumerateFaces(placed.length);
  const probability = 1 / faceBranches.length;

  const branches = faceBranches.map((faces): PreviewBranch => {
    const branchState = cloneState(state);
    const result = resolveFlip(
      { ...branchState, rngImpl: { ...branchState.rngImpl, flip: scriptedFlips(faces) } },
      slot,
      skill,
      skill.targetType === 'single-enemy' ? 0 : undefined,
      db
    );
    return { faces, probability, ...sumBranch(result.events) };
  });

  return {
    branches,
    byAxis: {
      damage: minMax(branches.map((branch) => branch.damage)),
      block: minMax(branches.map((branch) => branch.block))
    },
    expected: {
      damage: branches.reduce((sum, branch) => sum + branch.damage * branch.probability, 0),
      block: branches.reduce((sum, branch) => sum + branch.block * branch.probability, 0)
    }
  };
};
