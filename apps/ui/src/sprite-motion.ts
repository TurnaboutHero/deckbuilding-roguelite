import type { CombatEvent } from '@game/core';

export type SpriteMotion = 'idle' | 'attack' | 'hurt';
export type SpriteSide = 'player' | 'enemy';

export const spriteMotionForEvent = (side: SpriteSide, event: CombatEvent | undefined): SpriteMotion => {
  if (event?.type !== 'damageDealt') return 'idle';

  const isTarget =
    side === 'player'
      ? event.target.type === 'player'
      : event.target.type === 'enemy' && event.target.index === 0;

  if (isTarget && event.amount > 0) return 'hurt';
  if (side === 'player' && event.source === 'skill') return 'attack';
  if (side === 'enemy' && event.source === 'enemy') return 'attack';
  return 'idle';
};
