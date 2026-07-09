import { contentDb } from '@game/content';
import type { CoinUid, SlotId } from '@game/core';
import { createCombat, legalCommands, previewFlip, step } from '@game/core';
import type { CombatEvent, CombatState, Command } from '@game/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import './App.css';

const WORDS = ['BRAVE', 'EMBER', 'IRON', 'MOSS', 'RIVER', 'DUSK', 'SPARK', 'VALE'];

type FloatText = { id: number; text: string; target: 'player' | 'enemy'; kind: 'damage' | 'block' };
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
    return left.slot === right.slot && left.coins.every((coin, index) => coin === right.coins[index]);
  }
  return false;
};

const intentText = (enemy: CombatState['enemies'][number]): string =>
  enemy.intent.actions
    .map((action) => {
      if (action.kind === 'attack') return `⚔${action.damage * (action.hits ?? 1)}`;
      return `◆${action.amount}`;
    })
    .join(' ');

const effectText = (skillId: string): string => {
  const skill = contentDb.skills[skillId];
  if (skill?.type !== 'flip') return '소비형 예약';
  const parts = skill.base.map((atom) => (atom.kind === 'damage' ? `피해 ${atom.amount}` : atom.kind === 'block' ? `방어 ${atom.amount}` : '특수'));
  if (skill.heads !== undefined) {
    parts.push(...skill.heads.effects.map((atom) => (atom.kind === 'damage' ? `앞면 +${atom.amount}` : `앞면 효과`)));
  }
  if (skill.tails !== undefined) {
    parts.push(...skill.tails.effects.map((atom) => (atom.kind === 'block' ? `뒷면 +${atom.amount}` : `뒷면 효과`)));
  }
  return parts.join(' / ');
};

const coinLabel = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : contentDb.coins[String(instance.defId)];
  return def?.element ?? '기본';
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
  const legal = useMemo(() => legalCommands(state, contentDb), [state]);

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
    const showFloat = (text: string, target: 'player' | 'enemy', kind: 'damage' | 'block') => {
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
    dispatchState({ type: 'restart', seed: nextSeed });
  };

  const playerHp = `${state.player.hp}/${state.player.maxHp}`;
  const enemy = state.enemies[0];
  const ended = state.phase === 'victory' || state.phase === 'defeat';

  return (
    <main className="combat-shell" aria-label="전투 화면">
      <section className="battlefield">
        <UnitPanel side="player" name="전사" hp={playerHp} block={state.player.block} floats={floats} />
        {enemy !== undefined ? (
          <UnitPanel
            side="enemy"
            name={contentDb.enemies[String(enemy.defId)]?.name ?? '적'}
            hp={`${enemy.hp}/${enemy.maxHp}`}
            block={enemy.block}
            intent={intentText(enemy)}
            floats={floats}
          />
        ) : null}
      </section>

      <section className="skill-row" aria-label="스킬 카드">
        {state.slots.slice(0, 2).map((slotState, index) => {
          const skill = contentDb.skills[String(slotState.skillId)];
          const placed = state.zones.placed[slot(index)] ?? [];
          const use = findLegal({ type: 'useFlipSkill', slot: slot(index), target: skill?.targetType === 'single-enemy' ? 0 : undefined });
          const canPlace = selectedCoin !== null && findLegal({ type: 'placeCoin', coin: selectedCoin, slot: slot(index) }) !== undefined;
          const preview = placed.length > 0 && skill?.type === 'flip' ? previewFlip(state, slot(index), contentDb) : null;
          return (
            <article
              className={`skill-card ${use !== undefined ? 'ready' : ''} ${slotState.usedThisTurn ? 'spent' : ''}`}
              key={String(slotState.skillId)}
              onClick={() => (use !== undefined ? runCommand(use) : undefined)}
            >
              <header>{skill?.name ?? '빈 슬롯'}</header>
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
              <div className="card-art" aria-hidden="true">
                {skill?.tags.includes('attack') ? '⚔' : '▣'}
              </div>
              <p>{effectText(String(slotState.skillId))}</p>
              {slotState.usedThisTurn ? <span className="spent-label">사용됨</span> : null}
              {preview !== null ? (
                <div className="preview-tip" role="tooltip">
                  피해 {preview.byAxis.damage.min}~{preview.byAxis.damage.max} (기대 {preview.expected.damage})
                  <br />
                  방어 {preview.byAxis.block.min}~{preview.byAxis.block.max} (기대 {preview.expected.block})
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
              className={`coin ${selectedCoin === coin ? 'selected' : ''} ${flipping[Number(coin)] ? 'flipping' : ''}`}
              disabled={locked}
              key={coin}
              type="button"
              onClick={() => setSelectedCoin(selectedCoin === coin ? null : coin)}
            >
              <span>{coinFaces[Number(coin)] ?? 'B'}</span>
              <small>{coinLabel(state, coin)}</small>
            </button>
          ))}
        </div>
        <div className="pile-counts">
          <span>버림 {state.zones.discard.length}</span>
          <span>소모 {state.zones.exhausted.length}</span>
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
  hp: string;
  block: number;
  intent?: string;
  floats: FloatText[];
}

const UnitPanel = ({ side, name, hp, block, intent, floats }: UnitPanelProps) => (
  <div className={`unit ${side}`}>
    {intent !== undefined ? <div className="intent">{intent}</div> : null}
    <div className="hp-bar">
      <span>{name}</span>
      <strong>{hp}</strong>
      <em>▣ {block}</em>
    </div>
    <div className="sprite" aria-label={`${name} 스프라이트`}>
      <span className="head" />
      <span className="body" />
      <span className="arm left" />
      <span className="arm right" />
      <span className="leg left" />
      <span className="leg right" />
    </div>
    {floats
      .filter((item) => item.target === side)
      .map((item) => (
        <b className={`float-text ${item.kind}`} key={item.id}>
          {item.text}
        </b>
      ))}
  </div>
);
