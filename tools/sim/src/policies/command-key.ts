import type { Command } from "@game/core";

const numericKey = (value: number): string => String(value).padStart(10, "0");
const targetKey = (target: number | undefined): string =>
  target === undefined ? "none" : numericKey(target);
const summonKey = (summon: number | undefined): string =>
  summon === undefined ? "none" : numericKey(summon);
const coinsKey = (coins: readonly number[] | undefined): string =>
  coins === undefined
    ? "none"
    : coins
        .map(Number)
        .sort((left, right) => left - right)
        .map(numericKey)
        .join(",");
const orderedCoinsKey = (coins: readonly number[] | undefined): string =>
  coins === undefined ? "none" : coins.map(Number).map(numericKey).join(",");

export const commandKey = (command: Command): string => {
  switch (command.type) {
    case "endTurn":
      return "0:endTurn";
    case "useImmediateFlipSkill":
      return `3:useImmediateFlipSkill:slot=${numericKey(Number(command.slot))}:target=${targetKey(command.target)}:coins=${orderedCoinsKey(command.coins)}:chosen=${coinsKey(command.chosen)}:equipment=${String(command.chosenEquipment ?? "none")}:summon=${summonKey(command.chosenSummon)}`;
    case "useConsumeSkill": {
      const coins = coinsKey(command.coins);
      return `5:useConsumeSkill:slot=${numericKey(Number(command.slot))}:target=${targetKey(command.target)}:coins=${coins}:summon=${summonKey(command.chosenSummon)}`;
    }
  }
};

export const compareCommands = (left: Command, right: Command): number => {
  const leftKey = commandKey(left);
  const rightKey = commandKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

export const stableCommandOrder = (commands: readonly Command[]): Command[] =>
  [...commands].sort(compareCommands);

export const canonicalFallbackCommand = (
  commands: readonly Command[],
): Command | undefined => {
  const ordered = stableCommandOrder(commands);
  return ordered.find((command) => command.type === "endTurn") ?? ordered[0];
};
