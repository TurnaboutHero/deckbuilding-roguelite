import type {
  CoinUid,
  Command,
  CombatState,
  ContentDb,
  SlotId,
} from "@game/core";
import { legalCommands, step } from "@game/core";

type PlaceCoinCommand = Extract<Command, { type: "placeCoin" }>;

export interface RecommendedPlacement {
  coin: CoinUid;
  slot: SlotId;
  order: number;
}

export interface RecommendedLoadProposal {
  commands: PlaceCoinCommand[];
  placements: RecommendedPlacement[];
  requiresConfirmation: boolean;
}

/**
 * Builds a conservative placement-only preview.
 *
 * Each command is reducer-validated against the result of the previous
 * placement. The proposal never fires a skill and therefore cannot silently
 * choose a target, coin effect, equipment, summon, or preservation option.
 */
export const recommendedLoadProposal = (
  state: CombatState,
  db: ContentDb,
): RecommendedLoadProposal => {
  if (state.phase !== "player") {
    return { commands: [], placements: [], requiresConfirmation: false };
  }

  let simulated = state;
  const commands: PlaceCoinCommand[] = [];
  const placements: RecommendedPlacement[] = [];

  for (let index = 0; index < state.slots.length; index += 1) {
    const target = index as SlotId;
    let command = legalCommands(simulated, db).find(
      (candidate): candidate is PlaceCoinCommand =>
        candidate.type === "placeCoin" && candidate.slot === target,
    );
    while (command !== undefined) {
      const result = step(simulated, command, db);
      if (!result.ok) break;
      commands.push(command);
      placements.push({
        coin: command.coin,
        slot: command.slot,
        order: placements.length + 1,
      });
      simulated = result.state;
      command = legalCommands(simulated, db).find(
        (candidate): candidate is PlaceCoinCommand =>
          candidate.type === "placeCoin" && candidate.slot === target,
      );
    }
  }

  return {
    commands,
    placements,
    requiresConfirmation: commands.length > 0,
  };
};
