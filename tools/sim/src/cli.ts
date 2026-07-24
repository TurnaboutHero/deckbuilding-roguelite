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
import {
  M6_VARIANT_IDS,
  runBulk,
  runCrnComparison,
  type M6BulkReport,
  type M6VariantId
} from './bulk';
import { POLICY_IDS, type PolicyId } from './policies';
import { simulateRun } from './run-sim';

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

const assertInvariants = (state: CombatState, expectedCoins: number): string | undefined => {
  if (zoneCoinCount(state.zones, state.custody) !== Object.keys(state.coins).length) return 'zone coin count mismatch';
  // 총량 원장: 전 영역 합 = 초기 코인 수 + coinCreated 누적 (§8.1 불변식 1)
  if (Object.keys(state.coins).length !== expectedCoins) return 'coin ledger mismatch';
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
  const useGuard = commands.find((cmd) => cmd.type === 'useImmediateFlipSkill' && Number(cmd.slot) === 1);
  const useSlash = commands.find((cmd) => cmd.type === 'useImmediateFlipSkill' && Number(cmd.slot) === 0);
  if (enemyAttacking && useGuard !== undefined) return useGuard;
  if (useSlash !== undefined) return useSlash;

  const anyImmediate = commands.find((cmd) => cmd.type === 'useImmediateFlipSkill');
  return anyImmediate ?? { type: 'endTurn' };
};

const runPlay = () => {
  const seed = arg('--seed', '42') ?? '42';
  let state = createCombat({ character: 'warrior' as never, enemies: ['raider' as never] }, contentDb, seed);
  const log: string[] = [];
  let expectedCoins = Object.keys(state.coins).length;

  for (let i = 0; i < 200 && state.phase === 'player'; i += 1) {
    const cmd = chooseAuto(state);
    const result = step(state, cmd, contentDb);
    if (!result.ok) {
      console.error(`error: ${result.error}`);
      process.exit(1);
    }
    state = result.state;
    expectedCoins += result.events.filter((event) => event.type === 'coinCreated').length;
    log.push(...result.events.map(eventText));
    const invariant = assertInvariants(state, expectedCoins);
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
    let expectedCoins = Object.keys(state.coins).length;
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
      expectedCoins += result.events.filter((event) => event.type === 'coinCreated').length;
      const invariant = assertInvariants(state, expectedCoins);
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

const runFullRun = () => {
  const seed = arg('--seed', '42') ?? '42';
  console.log(JSON.stringify(simulateRun(seed).summary));
};

const positiveIntegerArg = (name: string): number => {
  const raw = arg(name);
  const parsed = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(parsed) || parsed <= 0) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
  return parsed;
};

const policyArgs = (): PolicyId[] => {
  const raw = arg('--policy');
  if (raw === undefined) {
    console.error('--policy is required with --games');
    process.exit(1);
  }
  if (raw === 'all') return [...POLICY_IDS];
  const values = raw.split(',');
  const allowed = new Set<string>(POLICY_IDS);
  if (values.length === 0 || values.some((value) => !allowed.has(value))) {
    console.error(`--policy must be all or one/more of ${POLICY_IDS.join(',')}`);
    process.exit(1);
  }
  return values as PolicyId[];
};

const variantArg = (name: string, fallback: M6VariantId): M6VariantId => {
  const value = arg(name, fallback) ?? fallback;
  if (!(M6_VARIANT_IDS as readonly string[]).includes(value)) {
    console.error(`${name} must be one of ${M6_VARIANT_IDS.join(',')}`);
    process.exit(1);
  }
  return value as M6VariantId;
};

const printBulkTable = (report: M6BulkReport): void => {
  const outcomes = report.metrics.outcomes;
  const turns = report.metrics.turns.overall;
  console.error('M6 bulk simulation');
  console.error(`seed=${report.baseSeed} games=${report.games} traces=${outcomes.runs}`);
  console.error(
    `terminal=${outcomes.terminalRuns}/${outcomes.runs} wins=${outcomes.wins} crashes=${outcomes.crashRuns} invariants=${outcomes.invariantViolationCount}`
  );
  console.error(
    `turns mean=${turns.mean ?? 'n/a'} p50=${turns.p50 ?? 'n/a'} p99=${turns.p99 ?? 'n/a'} anomalies=${report.anomalySeeds.length}`
  );
};

const runBulkCli = () => {
  const seed = arg('--seed', '1') ?? '1';
  const games = positiveIntegerArg('--games');
  const policies = policyArgs();
  const variant = variantArg('--variant', 'baseline');
  const compareValue = arg('--compare');

  if (compareValue !== undefined) {
    if (policies.length !== 1) {
      console.error('--compare requires exactly one policy');
      process.exit(1);
    }
    const policy = policies[0];
    if (policy === undefined) process.exit(1);
    const compareVariant = variantArg('--compare', 'basic-first');
    const report = runCrnComparison({
      baseSeed: seed,
      games,
      policyId: policy,
      variantA: variant,
      variantB: compareVariant
    });
    if (process.argv.includes('--table')) {
      printBulkTable(report.a);
      printBulkTable(report.b);
      console.error(`A=A ${report.aa.fingerprint} bytes=${report.aa.byteLength}`);
    }
    console.log(JSON.stringify(report));
    return;
  }

  const result = runBulk({
    baseSeed: seed,
    games,
    policyIds: policies,
    variantIds: [variant],
    captureTranscripts: process.argv.includes('--include-traces')
  });
  if (process.argv.includes('--table')) printBulkTable(result.report);
  console.log(
    JSON.stringify(
      process.argv.includes('--include-traces')
        ? result
        : result.report
    )
  );
};

const mode = process.argv[2];
if (mode === 'run' && process.argv.includes('--auto')) {
  runFullRun();
} else if (mode === 'run' && process.argv.includes('--games')) {
  runBulkCli();
} else if (mode === 'play' && process.argv.includes('--auto')) {
  runPlay();
} else if (mode === 'fuzz') {
  runFuzz();
} else {
  console.error(
    'usage: run --seed S --auto | run --games N --policy random|aggro|turtle|greedy|all --seed S [--variant baseline|basic-first] [--compare basic-first] [--table] [--include-traces] | play --seed S --auto | fuzz --games N --seed S'
  );
  process.exit(1);
}
