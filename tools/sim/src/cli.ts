import { contentDb } from '@game/content';
import {
  createCombat,
  legalCommands,
  rngFrom,
  seedFromString,
  step,
  zoneCoinCount
} from '@game/core';
import type { Command, CombatEvent, CombatState } from '@game/core';

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

const arg = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const eventText = (event: CombatEvent): string => {
  switch (event.type) {
    case 'coinsDrawn':
      return `draw ${event.coins.join(',')}`;
    case 'coinFlipped':
      return `flip c${event.coin} ${event.face}`;
    case 'skillUsed':
      return `use ${String(event.skill)} slot ${Number(event.slot)}`;
    case 'damageDealt':
      return `damage ${event.target.type}${event.target.type === 'enemy' ? event.target.index : ''} ${event.amount} blocked ${event.blocked}`;
    case 'blockGained':
      return `block ${event.target.type} +${event.amount}`;
    case 'intentRevealed':
      return `intent e${event.enemy} ${event.intent.id}`;
    case 'combatEnded':
      return `ended ${event.result} turns ${event.turns}`;
    default:
      return event.type;
  }
};

const assertInvariants = (state: CombatState, initialCoins: number): string | undefined => {
  if (zoneCoinCount(state.zones) !== Object.keys(state.coins).length) return 'zone coin count mismatch';
  if (Object.keys(state.coins).length !== initialCoins) return 'unexpected coin creation/removal in M1';
  if (state.player.hp > state.player.maxHp || state.player.hp < 0) return 'player hp out of bounds';
  if (state.player.block < 0) return 'player block is negative';
  for (const enemy of state.enemies) {
    if (enemy.hp > enemy.maxHp || enemy.hp < 0) return 'enemy hp out of bounds';
    if (enemy.block < 0) return 'enemy block is negative';
  }
  return undefined;
};

const chooseAuto = (state: CombatState): Command => {
  const enemyAttacking = state.enemies.some((enemy) =>
    enemy.intent.actions.some((action) => action.kind === 'attack' && enemy.hp > 0)
  );
  const commands = legalCommands(state, contentDb);
  const useGuard = commands.find((cmd) => cmd.type === 'useFlipSkill' && Number(cmd.slot) === 1);
  const useSlash = commands.find((cmd) => cmd.type === 'useFlipSkill' && Number(cmd.slot) === 0);
  if (enemyAttacking && useGuard !== undefined) return useGuard;
  if (useSlash !== undefined) return useSlash;

  const preferredSlot = enemyAttacking ? 1 : 0;
  const place = commands.find((cmd) => cmd.type === 'placeCoin' && Number(cmd.slot) === preferredSlot);
  if (place !== undefined) return place;
  const anyPlace = commands.find((cmd) => cmd.type === 'placeCoin');
  return anyPlace ?? { type: 'endTurn' };
};

const runPlay = () => {
  const seed = arg('--seed', '42') ?? '42';
  let state = createCombat({ character: 'warrior' as never, enemies: ['raider' as never] }, contentDb, seed);
  const log: string[] = [];
  const initialCoins = Object.keys(state.coins).length;

  for (let i = 0; i < 200 && state.phase === 'player'; i += 1) {
    const cmd = chooseAuto(state);
    const result = step(state, cmd, contentDb);
    if (!result.ok) {
      console.error(`error: ${result.error}`);
      process.exit(1);
    }
    state = result.state;
    log.push(...result.events.map(eventText));
    const invariant = assertInvariants(state, initialCoins);
    if (invariant !== undefined) {
      console.error(`invariant: ${invariant}`);
      process.exit(1);
    }
  }

  console.log(log.join('\n'));
  console.log(`result=${state.phase} turns=${state.turn}`);
  if (state.phase !== 'victory' && state.phase !== 'defeat') process.exit(1);
};

const runFuzz = () => {
  const games = Number(arg('--games', '100') ?? '100');
  const seed = arg('--seed', '42') ?? '42';
  const rng = rngFrom(seedFromString(seed));
  for (let game = 0; game < games; game += 1) {
    let state = createCombat({ character: 'warrior' as never, enemies: ['raider' as never] }, contentDb, `${seed}-${game}`);
    const initialCoins = Object.keys(state.coins).length;
    const commands: Command[] = [];
    for (let stepIndex = 0; stepIndex < 200 && state.phase === 'player'; stepIndex += 1) {
      const legal = legalCommands(state, contentDb);
      const cmd = legal[rng.int(legal.length)];
      if (cmd === undefined) break;
      commands.push(cmd);
      const result = step(state, cmd, contentDb);
      if (!result.ok) {
        console.error(`seed=${seed} game=${game} error=${result.error}`);
        console.error(JSON.stringify(commands));
        process.exit(1);
      }
      state = result.state;
      const invariant = assertInvariants(state, initialCoins);
      if (invariant !== undefined) {
        console.error(`seed=${seed} game=${game} invariant=${invariant}`);
        console.error(JSON.stringify(commands));
        process.exit(1);
      }
    }
    if (state.phase !== 'victory' && state.phase !== 'defeat') {
      console.error(`seed=${seed} game=${game} did not terminate`);
      console.error(JSON.stringify(commands));
      process.exit(1);
    }
  }
  console.log(`fuzz ok games=${games} seed=${seed}`);
};

const mode = process.argv[2];
if (mode === 'play' && process.argv.includes('--auto')) {
  runPlay();
} else if (mode === 'fuzz') {
  runFuzz();
} else {
  console.error('usage: play --seed S --auto | fuzz --games N --seed S');
  process.exit(1);
}
