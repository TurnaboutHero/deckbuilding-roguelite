import type { CoinDefId, CoinUid } from '../ids';
import { rngFrom } from '../rng';
import type { CombatEvent } from './events';
import { MAX_PRESERVED_COINS } from './state';
import type { CombatState } from './state';

// 손 상한 — addCoin(zone hand)과 드로우가 공유하는 단일 한계 (P7 감사 보정)
export const HAND_LIMIT = 10;

// P7 D3 — reducer(턴 시작 드로우)와 resolve(draw 원자)가 공유하는 단일 드로우 구현.
// 손 상한 10을 넘겨 뽑지 않는다 (초과분은 뽑기 더미에 남는다).
export const drawCards = (input: CombatState, count: number): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state = input;
  let draw = [...state.zones.draw];
  let discard = [...state.zones.discard];
  const rng = state.rngImpl?.shuffle ?? rngFrom(state.rng.shuffle);
  const drawn: CoinUid[] = [];
  let remaining = Math.min(count, Math.max(0, HAND_LIMIT - state.zones.hand.length));

  while (remaining > 0) {
    if (draw.length === 0) {
      if (discard.length === 0) break;
      events.push({ type: 'pileShuffled', count: discard.length });
      draw = rng.shuffle(discard);
      discard = [];
    }
    const coin = draw.shift();
    if (coin === undefined) break;
    drawn.push(coin);
    remaining -= 1;
  }

  if (drawn.length > 0) events.push({ type: 'coinsDrawn', coins: drawn });
  state = {
    ...state,
    rng: { ...state.rng, shuffle: rng.snapshot() },
    zones: { ...state.zones, draw, discard, hand: [...state.zones.hand, ...drawn] }
  };
  return { state, events };
};

/** P11 — 더미를 섞거나 순서를 바꾸지 않고 요청한 실제 동전 정의만 찾는다. */
export const drawSpecificCoin = (
  input: CombatState,
  defId: CoinDefId,
  count: number,
  preserve = false
): { state: CombatState; events: CombatEvent[]; drawn: CoinUid[] } => {
  const available = Math.max(0, HAND_LIMIT - input.zones.hand.length);
  if (available === 0 || count <= 0) return { state: input, events: [], drawn: [] };
  const draw = [...input.zones.draw];
  const drawn: CoinUid[] = [];
  for (let index = 0; index < draw.length && drawn.length < Math.min(count, available);) {
    const candidate = draw[index]!;
    if (String(input.coins[Number(candidate)]?.defId) !== String(defId)) {
      index += 1;
      continue;
    }
    drawn.push(candidate);
    draw.splice(index, 1);
  }
  if (drawn.length === 0) return { state: input, events: [], drawn };
  const preservedBefore = Object.values(input.coins).filter((coin) => coin.preserved === true).length;
  const newlyPreserved = preserve
    ? drawn.filter((coin) => input.coins[Number(coin)]?.preserved !== true)
      .slice(0, Math.max(0, MAX_PRESERVED_COINS - preservedBefore))
    : [];
  const preservedSet = new Set(newlyPreserved);
  return {
    state: {
      ...input,
      coins: preserve
        ? Object.fromEntries(Object.entries(input.coins).map(([key, coin]) => [
            key,
            preservedSet.has(coin.uid) ? { ...coin, preserved: true } : coin
          ]))
        : input.coins,
      zones: { ...input.zones, draw, hand: [...input.zones.hand, ...drawn] }
    },
    events: [
      { type: 'coinsDrawn', coins: drawn },
      ...(newlyPreserved.length > 0
        ? [{ type: 'coinsPreserved' as const, coins: newlyPreserved }]
        : [])
    ],
    drawn
  };
};
