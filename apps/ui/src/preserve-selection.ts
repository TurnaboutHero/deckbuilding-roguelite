import { MAX_PRESERVED_COINS } from "@game/core";
import type { CoinUid, CombatState, Command, ContentDb } from "@game/core";

export const PRESERVE_SELECTION_INSTRUCTIONS =
  "보존할 동전을 선택한 뒤 턴 종료를 다시 누르거나 Enter로 확정하세요. Escape로 취소합니다.";

export interface PreserveSelection {
  candidates: CoinUid[];
  locked: CoinUid[];
  coins: CoinUid[];
  newCapacity: number;
}

const unique = (coins: readonly CoinUid[]): CoinUid[] => [...new Set(coins)];

export function beginPreserveSelection(
  state: CombatState,
  db: ContentDb,
): PreserveSelection | null {
  const baseCapacity =
    db.characters[String(state.characterId)]?.trait.mechanic === "preserveHand"
      ? 1
      : 0;
  const candidates = unique([
    ...state.zones.hand,
    ...Object.values(state.zones.placed).flat(),
  ]);
  if (candidates.length === 0) return null;
  const locked = candidates.filter(
    (coin) => state.coins[Number(coin)]?.preserved === true,
  );
  const newCapacity = Math.min(
    baseCapacity + Math.min(2, state.player.additionalPreserveThisTurn),
    Math.max(0, MAX_PRESERVED_COINS - locked.length),
  );
  if (newCapacity <= 0) return null;
  return { candidates, locked, coins: [...locked], newCapacity };
}

export function togglePreservedCoin(
  selection: PreserveSelection,
  coin: CoinUid,
): PreserveSelection {
  if (!selection.candidates.includes(coin) || selection.locked.includes(coin))
    return selection;
  if (selection.coins.includes(coin)) {
    return {
      ...selection,
      coins: selection.coins.filter((candidate) => candidate !== coin),
    };
  }
  const selectedNew = selection.coins.filter(
    (candidate) => !selection.locked.includes(candidate),
  ).length;
  if (
    selectedNew >= selection.newCapacity ||
    selection.coins.length >= MAX_PRESERVED_COINS
  )
    return selection;
  return { ...selection, coins: [...selection.coins, coin] };
}

export const preserveSelectionCommand = (
  selection: PreserveSelection,
): Extract<Command, { type: "endTurn" }> => ({
  type: "endTurn",
  preserve: [...selection.coins],
});
