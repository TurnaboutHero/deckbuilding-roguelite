import { contentDb } from '@game/content';
import type { CoinUid, EffectAtom, SlotId } from '@game/core';
import { createCombat, legalCommands, previewFlip, step } from '@game/core';
import type { CombatEvent, CombatState, Command } from '@game/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import './App.css';
import { EmberIcon, FlameIcon, HeartIcon, ShieldIcon, SkullIcon, SwordIcon } from './icons';
import bgForest from './assets/bg-forest.webp';
import spriteWarrior from './assets/sprite-warrior.png';
import spriteGoblin from './assets/sprite-goblin.png';
import cardSlash from './assets/card-slash.webp';
import cardGuard from './assets/card-guard.webp';
import cardBurningStrike from './assets/card-burning-strike.webp';
import cardIgnite from './assets/card-ignite.webp';
import cardIgniteSword from './assets/card-ignite-sword.webp';
import cardFlameRampage from './assets/card-flame-rampage.webp';

// 생성 에셋 (docs/ui/combat-ui-v2.png 앵커 스타일 — image_gen 산출, 후처리: 크로마 키·리사이즈)
const CARD_ART: Record<string, string> = {
  slash: cardSlash,
  guard: cardGuard,
  'burning-strike': cardBurningStrike,
  ignite: cardIgnite,
  'ignite-sword': cardIgniteSword,
  'flame-rampage': cardFlameRampage
};

const WORDS = ['BRAVE', 'EMBER', 'IRON', 'MOSS', 'RIVER', 'DUSK', 'SPARK', 'VALE'];

type FloatText = { id: number; text: string; target: 'player' | 'enemy'; kind: 'damage' | 'block' | 'status' | 'coin' };
type CombatAction = { type: 'set'; state: CombatState } | { type: 'restart'; seed: string };

const slot = (value: number): SlotId => value as SlotId;

const createState = (seed: string): CombatState =>
  createCombat({ character: 'warrior' as never, enemies: ['raider' as never] }, contentDb, seed);

const randomSeed = (): string =>
  Array.from({ length: 3 }, () => WORDS[Math.floor(Math.random() * WORDS.length)] ?? 'EMBER').join('-') +
  `-${Math.floor(Math.random() * 90 + 10)}`;

const seedFromUrl = (): string => {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get('seed');
  if (existing !== null && existing.trim().length > 0) return existing;
  const seed = randomSeed();
  url.searchParams.set('seed', seed);
  window.history.replaceState(null, '', url);
  return seed;
};

const combatReducer = (_state: CombatState, action: CombatAction): CombatState => {
  if (action.type === 'restart') return createState(action.seed);
  return action.state;
};

const sameCommand = (left: Command, right: Command): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === 'placeCoin' && right.type === 'placeCoin') return left.coin === right.coin && left.slot === right.slot;
  if (left.type === 'unplaceCoin' && right.type === 'unplaceCoin') return left.coin === right.coin;
  if (left.type === 'useFlipSkill' && right.type === 'useFlipSkill') return left.slot === right.slot && left.target === right.target;
  if (left.type === 'endTurn' && right.type === 'endTurn') return true;
  if (left.type === 'useConsumeSkill' && right.type === 'useConsumeSkill') {
    return (
      left.slot === right.slot &&
      left.target === right.target &&
      left.coins.length === right.coins.length &&
      left.coins.every((coin, index) => coin === right.coins[index])
    );
  }
  return false;
};

const IntentBadge = ({ enemy }: { enemy: CombatState['enemies'][number] }) => (
  <div aria-label="다음 행동 의도" className="intent">
    {enemy.intent.actions.map((action, index) =>
      action.kind === 'attack' ? (
        <span key={index}>
          <SwordIcon scale={1.6} />
          {action.hits !== undefined && action.hits > 1 ? `${action.damage}×${action.hits}` : action.damage}
        </span>
      ) : (
        <span key={index}>
          <ShieldIcon scale={1.6} tone="steel" />
          {action.amount}
        </span>
      )
    )}
  </div>
);

const effectText = (skillId: string): string => {
  const skill = contentDb.skills[skillId];
  const atomText = (atom: EffectAtom): string => {
    if (atom.kind === 'damage') return `피해 ${atom.amount}`;
    if (atom.kind === 'block') return `방어 ${atom.amount}`;
    if (atom.kind === 'applyStatus' && atom.status === 'burn') return `화상 ${atom.stacks}`;
    if (atom.kind === 'addCoin') return `임시 ${elementKo(String(atom.coin))} +${atom.count}`;
    if (atom.kind === 'selfDamage') return `자신 피해 ${atom.amount}`;
    if (atom.kind === 'grantElement') return `기본 코인 ${elementKo(atom.element)} 취급`;
    return '특수';
  };
  if (skill?.type === 'consume') return skill.effects.map(atomText).join(' / ');
  if (skill?.type !== 'flip') return '';
  const parts = skill.base.map(atomText);
  if (skill.heads !== undefined) {
    parts.push(...skill.heads.effects.map((atom) => (atom.kind === 'damage' ? `앞면 +${atom.amount}` : `앞면 ${atomText(atom)}`)));
  }
  if (skill.tails !== undefined) {
    parts.push(...skill.tails.effects.map((atom) => (atom.kind === 'block' ? `뒷면 +${atom.amount}` : `뒷면 ${atomText(atom)}`)));
  }
  return parts.join(' / ');
};

const ELEMENT_KO: Record<string, string> = { fire: '화염', mana: '마나', frost: '냉기', lightning: '전기', blood: '혈액' };
const elementKo = (value: string): string => ELEMENT_KO[value] ?? value;

const coinLabel = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : contentDb.coins[String(instance.defId)];
  const granted = instance?.grants.includes('fire') === true && def?.element !== 'fire';
  return granted ? '기본+화염' : def?.element !== null && def?.element !== undefined ? elementKo(def.element) : '기본';
};

const coinClasses = (state: CombatState, coin: CoinUid, selected: boolean, flipping: boolean): string => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : contentDb.coins[String(instance.defId)];
  return [
    'coin',
    selected ? 'selected' : '',
    flipping ? 'flipping' : '',
    def?.element === 'fire' ? 'fire' : '',
    instance?.grants.includes('fire') === true ? 'granted-fire' : '',
    instance?.permanent === false ? 'temporary' : ''
  ]
    .filter(Boolean)
    .join(' ');
};

export const App = () => {
  const initialSeed = useMemo(seedFromUrl, []);
  const [seed, setSeed] = useState(initialSeed);
  const [state, dispatchState] = useReducer(combatReducer, initialSeed, createState);
  const [selectedCoin, setSelectedCoin] = useState<CoinUid | null>(null);
  const [queue, setQueue] = useState<CombatEvent[]>([]);
  const [locked, setLocked] = useState(false);
  const [coinFaces, setCoinFaces] = useState<Record<number, string>>({});
  const [flipping, setFlipping] = useState<Record<number, boolean>>({});
  const [floats, setFloats] = useState<FloatText[]>([]);
  const nextFloatId = useRef(1);
  const initialEventsQueued = useRef(false);
  const legal = useMemo(() => legalCommands(state, contentDb), [state]);

  useEffect(() => {
    if (!initialEventsQueued.current && state.events.length > 0) {
      initialEventsQueued.current = true;
      setLocked(true);
      setQueue(state.events);
    }
  }, [state.events]);

  const findLegal = (cmd: Command): Command | undefined => legal.find((candidate) => sameCommand(candidate, cmd));
  const runCommand = (cmd: Command) => {
    if (locked) return;
    const legalCommand = findLegal(cmd);
    if (legalCommand === undefined) return;
    const result = step(state, legalCommand, contentDb);
    if (!result.ok) return;
    dispatchState({ type: 'set', state: result.state });
    setSelectedCoin(null);
    if (result.events.length > 0) {
      setLocked(true);
      setQueue((events) => [...events, ...result.events]);
    }
  };

  useEffect(() => {
    if (!locked || queue.length === 0) {
      if (locked && queue.length === 0) setLocked(false);
      return undefined;
    }

    const [event, ...rest] = queue;
    const showFloat = (text: string, target: 'player' | 'enemy', kind: FloatText['kind']) => {
      const id = nextFloatId.current;
      nextFloatId.current += 1;
      setFloats((items) => [...items, { id, text, target, kind }]);
      window.setTimeout(() => setFloats((items) => items.filter((item) => item.id !== id)), 900);
    };

    let delay = 180;
    if (event?.type === 'coinFlipped') {
      setFlipping((items) => ({ ...items, [Number(event.coin)]: true }));
      delay = 750;
      window.setTimeout(() => {
        setCoinFaces((items) => ({ ...items, [Number(event.coin)]: event.face === 'heads' ? 'H' : 'T' }));
        setFlipping((items) => ({ ...items, [Number(event.coin)]: false }));
      }, 600);
    } else if (event?.type === 'damageDealt') {
      showFloat(`-${event.amount}`, event.target.type === 'player' ? 'player' : 'enemy', 'damage');
      delay = event.source === 'enemy' ? 520 : 420;
    } else if (event?.type === 'blockGained') {
      showFloat(`+${event.amount}`, event.target.type === 'player' ? 'player' : 'enemy', 'block');
      delay = 360;
    } else if (event?.type === 'statusApplied') {
      showFloat(`화상 +${event.stacks}`, event.target.type === 'player' ? 'player' : 'enemy', 'status');
      delay = 380;
    } else if (event?.type === 'statusTicked') {
      showFloat(`화상 -${event.amount}`, event.target.type === 'player' ? 'player' : 'enemy', 'status');
      delay = 460;
    } else if (event?.type === 'coinCreated') {
      showFloat('임시 코인', 'player', 'coin');
      delay = 320;
    } else if (event?.type === 'intentRevealed') {
      delay = 260;
    }

    const timer = window.setTimeout(() => setQueue(rest), delay + 150);
    return () => window.clearTimeout(timer);
  }, [locked, queue]);

  const restart = (nextSeed: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', nextSeed);
    window.history.replaceState(null, '', url);
    setSeed(nextSeed);
    setQueue([]);
    setLocked(false);
    setSelectedCoin(null);
    setCoinFaces({});
    initialEventsQueued.current = true;
    const nextState = createState(nextSeed);
    dispatchState({ type: 'set', state: nextState });
    if (nextState.events.length > 0) {
      setLocked(true);
      setQueue(nextState.events);
    }
  };

  const enemy = state.enemies[0];
  const ended = state.phase === 'victory' || state.phase === 'defeat';

  return (
    <main className="combat-shell" aria-label="전투 화면">
      <div className="backdrop" aria-hidden="true">
        <img alt="" className="backdrop-img" src={bgForest} />
      </div>
      <section className="battlefield">
        <UnitPanel
          side="player"
          name="전사"
          hp={state.player.hp}
          maxHp={state.player.maxHp}
          block={state.player.block}
          statuses={state.player.statuses}
          floats={floats}
        />
        {enemy !== undefined ? (
          <UnitPanel
            side="enemy"
            name={contentDb.enemies[String(enemy.defId)]?.name ?? '적'}
            hp={enemy.hp}
            maxHp={enemy.maxHp}
            block={enemy.block}
            statuses={enemy.statuses}
            intent={<IntentBadge enemy={enemy} />}
            floats={floats}
          />
        ) : null}
      </section>

      <section className="skill-row" aria-label="스킬 카드">
        {state.slots.slice(0, 6).map((slotState, index) => {
          const skill = contentDb.skills[String(slotState.skillId)];
          const placed = state.zones.placed[slot(index)] ?? [];
          const consumeUse = legal.find((command): command is Extract<Command, { type: 'useConsumeSkill' }> => command.type === 'useConsumeSkill' && command.slot === slot(index));
          const use =
            skill?.type === 'consume'
              ? consumeUse
              : findLegal({ type: 'useFlipSkill', slot: slot(index), target: skill?.targetType === 'single-enemy' ? 0 : undefined });
          const canPlace = selectedCoin !== null && findLegal({ type: 'placeCoin', coin: selectedCoin, slot: slot(index) }) !== undefined;
          const preview = placed.length > 0 && skill?.type === 'flip' ? previewFlip(state, slot(index), contentDb) : null;
          const consumeReady = skill?.type === 'consume' && consumeUse !== undefined;
          const lockedOnce = skill?.oncePerCombat === true && slotState.usedThisCombat;
          return (
            <article
              className={`skill-card ${use !== undefined ? 'ready' : ''} ${slotState.usedThisTurn ? 'spent' : ''} ${lockedOnce ? 'combat-locked' : ''}`}
              key={String(slotState.skillId)}
              onClick={() => (use !== undefined ? runCommand(use) : undefined)}
            >
              <header>{skill?.name ?? '빈 슬롯'}</header>
              {skill?.oncePerCombat === true ? <span className="once-badge">전투당 1회</span> : null}
              <div className="sockets" aria-label={`${skill?.name ?? '스킬'} 코스트 소켓`}>
                {Array.from({ length: skill?.type === 'flip' ? skill.cost : 0 }, (_unused, socketIndex) => {
                  const coin = placed[socketIndex];
                  return (
                    <button
                      aria-label={coin === undefined ? '동전 장전' : '장전된 동전 회수'}
                      className={`socket ${coin !== undefined ? 'loaded' : ''} ${canPlace ? 'accept' : ''}`}
                      key={socketIndex}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (coin !== undefined) runCommand({ type: 'unplaceCoin', coin });
                        else if (selectedCoin !== null) runCommand({ type: 'placeCoin', coin: selectedCoin, slot: slot(index) });
                      }}
                    >
                      {coin !== undefined ? coinFaces[Number(coin)] ?? '●' : ''}
                    </button>
                  );
                })}
              </div>
              {skill?.type === 'consume' ? (
                <div aria-label={`화염 코인 ${skill.consume.count}개 소비`} className={`consume-condition ${consumeReady ? 'met' : ''}`}>
                  <FlameIcon scale={1.6} />
                  <span>×{skill.consume.count} 소비</span>
                </div>
              ) : null}
              <div className="card-art" aria-hidden="true">
                {skill !== undefined && CARD_ART[String(skill.id)] !== undefined ? (
                  <img alt="" className="card-art-img" src={CARD_ART[String(skill.id)]} />
                ) : (
                  <SwordIcon scale={4.2} />
                )}
              </div>
              <p>{effectText(String(slotState.skillId))}</p>
              {slotState.usedThisTurn ? <span className="spent-label">사용됨</span> : null}
              {lockedOnce ? <span className="locked-label">잠금</span> : null}
              {preview !== null ? (
                <div className="preview-tip" role="tooltip">
                  피해 {preview.byAxis.damage.min}~{preview.byAxis.damage.max} (기대 {preview.expected.damage})
                  <br />
                  방어 {preview.byAxis.block.min}~{preview.byAxis.block.max} (기대 {preview.expected.block})
                  <br />
                  화상 {preview.byAxis.burn.min}~{preview.byAxis.burn.max} (기대 {preview.expected.burn})
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="bottom-hud">
        <div className="pouch" aria-label="코인 주머니">
          <div className="pouch-circle">{state.zones.draw.length}</div>
          <span>주머니</span>
        </div>
        <div className="hand-tray" aria-label="손패 동전 트레이">
          {state.zones.hand.map((coin) => (
            <button
              aria-label={`${coinLabel(state, coin)} 동전 선택`}
              className={coinClasses(state, coin, selectedCoin === coin, flipping[Number(coin)] === true)}
              disabled={locked}
              key={coin}
              type="button"
              onClick={() => setSelectedCoin(selectedCoin === coin ? null : coin)}
            >
              <span className="coin-face">
                {coinFaces[Number(coin)] !== undefined ? (coinFaces[Number(coin)] === 'H' ? '앞' : '뒤') : null}
              </span>
              <small>{coinLabel(state, coin)}</small>
            </button>
          ))}
        </div>
        <div className="pile-counts">
          <span aria-label={`버림 더미 ${state.zones.discard.length}`}>
            <SkullIcon scale={1.6} /> 버림 {state.zones.discard.length}
          </span>
          <span aria-label={`소모 더미 ${state.zones.exhausted.length}`}>
            <EmberIcon scale={1.6} /> 소모 {state.zones.exhausted.length}
          </span>
        </div>
        <button aria-label="턴 종료" className="end-turn" disabled={locked || findLegal({ type: 'endTurn' }) === undefined} type="button" onClick={() => runCommand({ type: 'endTurn' })}>
          턴 종료
        </button>
      </section>

      <div className="seed-strip">SEED {seed}</div>

      {ended ? (
        <div className="result-overlay" role="dialog" aria-label="전투 결과">
          <div className="result-panel">
            <h1>{state.phase === 'victory' ? '승리' : '패배'}</h1>
            <p>턴 수 {state.turn}</p>
            <p>시드 {seed}</p>
            <button aria-label="같은 시드로 재시작" type="button" onClick={() => restart(seed)}>
              같은 시드로 재시작
            </button>
            <button aria-label="새 시드" type="button" onClick={() => restart(randomSeed())}>
              새 시드
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
};

interface UnitPanelProps {
  side: 'player' | 'enemy';
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  statuses: CombatState['player']['statuses'];
  intent?: ReactNode;
  floats: FloatText[];
}

const UnitPanel = ({ side, name, hp, maxHp, block, statuses, intent, floats }: UnitPanelProps) => (
  <div className={`unit ${side}`}>
    <div className="unit-plate">
      <div className="plate-row">
        <span className="unit-name">{name}</span>
        {block > 0 ? (
          <em aria-label={`방어 ${block}`} className="block-chip">
            <ShieldIcon scale={1.4} />
            {block}
          </em>
        ) : null}
        {(statuses.burn ?? 0) > 0 ? (
          <em aria-label={`화상 ${statuses.burn}`} className="burn-chip">
            <EmberIcon scale={1.4} />
            {statuses.burn}
          </em>
        ) : null}
      </div>
      <div aria-label={`체력 ${hp}/${maxHp}`} className="hp-bar">
        <HeartIcon scale={1.4} />
        <div className="hp-track">
          <div className="hp-fill" style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
        </div>
        <strong className="hp-num">
          {hp}/{maxHp}
        </strong>
      </div>
    </div>
    {intent !== undefined ? intent : null}
    <div className="sprite" aria-label={`${name} 스프라이트`}>
      <img alt="" className={`sprite-img ${side}`} src={side === 'player' ? spriteWarrior : spriteGoblin} />
    </div>
    {floats
      .filter((item) => item.target === side)
      .map((item) => (
        <b className={`float-text kind-${item.kind}`} key={item.id}>
          {item.text}
        </b>
      ))}
  </div>
);
