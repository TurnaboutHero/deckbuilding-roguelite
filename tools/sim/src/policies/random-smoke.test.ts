import { contentDb } from "@game/content";
import {
  createCombat,
  legalCommands,
  step,
  zoneCoinCount,
  type CoinUid,
  type CombatState,
} from "@game/core";
import { describe, expect, it } from "vitest";

import { commandKey, createRandomPolicy } from "./index";

const GAME_COUNT = 500;
const MAX_COMMANDS_PER_GAME = 500;

interface EpisodeResult {
  readonly seed: string;
  readonly result: "victory" | "defeat";
  readonly commands: readonly string[];
  readonly turns: number;
  readonly playerHp: number;
  readonly enemyHp: readonly number[];
}

const zoneCoins = (state: CombatState): CoinUid[] => [
  ...state.zones.draw,
  ...state.zones.hand,
  ...Object.values(state.zones.placed).flat(),
  ...state.zones.discard,
  ...state.zones.exhausted,
  ...state.custody.flatMap((entry) => entry.coins),
];

const assertInvariants = (state: CombatState, expectedCoins: number): void => {
  const ledgerSize = Object.keys(state.coins).length;
  const zoned = zoneCoins(state);
  if (zoneCoinCount(state.zones, state.custody) !== ledgerSize) {
    throw new Error("zone coin count mismatch");
  }
  if (ledgerSize !== expectedCoins) throw new Error("coin ledger mismatch");
  if (zoned.length !== new Set(zoned.map(Number)).size) {
    throw new Error("coin appears in more than one zone");
  }
  if (state.player.hp < 0 || state.player.hp > state.player.maxHp) {
    throw new Error("player HP out of range");
  }
  if (state.player.block < 0) throw new Error("player block is negative");
  for (const enemy of state.enemies) {
    if (enemy.hp < 0 || enemy.hp > enemy.maxHp) {
      throw new Error("enemy HP out of range");
    }
    if (enemy.block < 0) throw new Error("enemy block is negative");
  }
};

const playEpisode = (seed: string): EpisodeResult => {
  let state = createCombat(
    { character: "warrior" as never, enemies: ["raider" as never] },
    contentDb,
    seed,
  );
  const policy = createRandomPolicy({ runSeed: seed });
  const commands: string[] = [];
  let expectedCoins = Object.keys(state.coins).length;

  for (
    let commandIndex = 0;
    commandIndex < MAX_COMMANDS_PER_GAME && state.phase === "player";
    commandIndex += 1
  ) {
    const legalKeys = new Set(legalCommands(state, contentDb).map(commandKey));
    const command = policy.choose(state, contentDb);
    const key = commandKey(command);
    if (!legalKeys.has(key))
      throw new Error(`policy chose illegal command: ${key}`);

    const result = step(state, command, contentDb);
    if (!result.ok)
      throw new Error(`step rejected legal command: ${result.error}`);
    commands.push(key);
    state = result.state;
    expectedCoins += result.events.filter(
      (event) => event.type === "coinCreated",
    ).length;
    assertInvariants(state, expectedCoins);
  }

  if (state.phase !== "victory" && state.phase !== "defeat") {
    throw new Error(
      `${seed} did not terminate within ${MAX_COMMANDS_PER_GAME} commands`,
    );
  }
  return {
    seed,
    result: state.phase,
    commands,
    turns: state.turn,
    playerHp: state.player.hp,
    enemyHp: state.enemies.map((enemy) => enemy.hp),
  };
};

describe("random policy deterministic smoke", () => {
  it("replays the same seed command-for-command", () => {
    expect(playEpisode("M6-RANDOM-REPLAY")).toEqual(
      playEpisode("M6-RANDOM-REPLAY"),
    );
  });

  it("terminates exactly 500 deterministic seeds with core invariants intact", () => {
    const results = Array.from({ length: GAME_COUNT }, (_, index) =>
      playEpisode(`M6-RANDOM-${index}`),
    );
    const victories = results.filter(
      (result) => result.result === "victory",
    ).length;
    const defeats = results.length - victories;
    const commandCounts = results.map((result) => result.commands.length);
    const maxCommands = Math.max(...commandCounts);
    const maxCommandSeed = results[commandCounts.indexOf(maxCommands)]?.seed;
    const totalCommands = commandCounts.reduce(
      (total, count) => total + count,
      0,
    );
    const summary = {
      games: results.length,
      terminal: results.filter(
        (result) => result.result === "victory" || result.result === "defeat",
      ).length,
      victories,
      defeats,
      totalCommands,
      maxCommands,
      maxCommandSeed,
      maxTurns: Math.max(...results.map((result) => result.turns)),
    };

    expect(summary.games).toBe(GAME_COUNT);
    expect(summary.terminal).toBe(GAME_COUNT);
    expect(maxCommands).toBeLessThanOrEqual(MAX_COMMANDS_PER_GAME);
    console.info(`M6_RANDOM_500 ${JSON.stringify(summary)}`);
  });
});
