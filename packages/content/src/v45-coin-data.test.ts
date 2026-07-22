import { describe, expect, it } from 'vitest';
import { coins } from './index';

describe('v4.5 coin content data', () => {
  it('declares the v4.5 basic and elemental coin face effects exactly', () => {
    expect(coins.basic.procs).toEqual({
      heads: [{ kind: 'damage', amount: 4 }],
      tails: [{ kind: 'block', amount: 4 }]
    });
    expect(coins.fire.procs).toEqual({
      heads: [
        { kind: 'damage', amount: 3 },
        { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
      ],
      tails: [
        { kind: 'block', amount: 3 },
        { kind: 'damageIfTargetStatus', status: 'burn', amount: 2 }
      ]
    });
    expect(coins.mana.procs).toEqual({
      heads: [{ kind: 'addCoin', coin: coins.basic.id, zone: 'discard', count: 1 }],
      tails: [{ kind: 'nextTurnDraw', count: 1 }]
    });
    expect(coins.frost.procs).toEqual({
      heads: [{ kind: 'applyStatus', status: 'frost', stacks: 2, to: 'target' }],
      tails: [
        { kind: 'block', amount: 3 },
        { kind: 'nextTurnBlock', amount: 2 }
      ]
    });
    expect(coins.lightning.procs).toEqual({
      heads: [{ kind: 'fixedDamage', amount: 3 }],
      tails: [{ kind: 'applyStatus', status: 'shock', stacks: 2, to: 'target' }]
    });
    expect(coins.blood.procs?.heads).toEqual([
      { kind: 'loseHp', amount: 2 },
      { kind: 'coinDamage', amount: 7 }
    ]);
    expect(coins.blood.procs?.tails).toEqual([
      { kind: 'applyStatus', status: 'bleed', stacks: 2, to: 'target' }
    ]);
  });
});
