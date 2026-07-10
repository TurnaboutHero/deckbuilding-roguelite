import type { CombatEvent } from '@game/core';
import { describe, expect, it } from 'vitest';

import { spriteMotionForEvent } from './sprite-motion';

const damage = (event: Omit<Extract<CombatEvent, { type: 'damageDealt' }>, 'type'>): CombatEvent => ({
  type: 'damageDealt',
  ...event
});

describe('spriteMotionForEvent', () => {
  it('pairs a player attack with an enemy hurt reaction', () => {
    const event = damage({ target: { type: 'enemy', index: 0 }, amount: 7, blocked: 0, source: 'skill' });

    expect(spriteMotionForEvent('player', event)).toBe('attack');
    expect(spriteMotionForEvent('enemy', event)).toBe('hurt');
  });

  it('pairs an enemy attack with a player hurt reaction', () => {
    const event = damage({ target: { type: 'player' }, amount: 4, blocked: 1, source: 'enemy' });

    expect(spriteMotionForEvent('enemy', event)).toBe('attack');
    expect(spriteMotionForEvent('player', event)).toBe('hurt');
  });

  it('keeps a fully blocked target out of the hurt state', () => {
    const event = damage({ target: { type: 'player' }, amount: 0, blocked: 5, source: 'enemy' });

    expect(spriteMotionForEvent('enemy', event)).toBe('attack');
    expect(spriteMotionForEvent('player', event)).toBe('idle');
  });

  it('shows only the target reaction for burn damage', () => {
    const event = damage({ target: { type: 'enemy', index: 0 }, amount: 3, blocked: 0, source: 'burn' });

    expect(spriteMotionForEvent('player', event)).toBe('idle');
    expect(spriteMotionForEvent('enemy', event)).toBe('hurt');
  });
});
