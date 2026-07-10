import { contentDb } from '@game/content';
import type { CoinUid, EffectAtom, Face, SlotId } from '@game/core';
import { createCombat, legalCommands, previewFlip, step } from '@game/core';
import type { CombatEvent, CombatState, Command } from '@game/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import './App.css';
import { AtlasSprite } from './AtlasSprite';
import { EmberIcon, FlameIcon, HeartIcon, ShieldIcon, SkullIcon, SwordIcon } from './icons';
import bgForest from './assets/bg-forest.webp';
import cardSlash from './assets/card-slash.webp';
import cardGuard from './assets/card-guard.webp';
import cardBurningStrike from './assets/card-burning-strike.webp';
import cardIgnite from './assets/card-ignite.webp';
import cardIgniteSword from './assets/card-ignite-sword.webp';
import cardFlameRampage from './assets/card-flame-rampage.webp';
import goblinAtlas from './assets/generated/sprites/goblin/sprite-sheet-alpha.png';
import goblinManifestJson from './assets/generated/sprites/goblin/manifest.json';
import warriorAtlas from './assets/generated/sprites/warrior/sprite-sheet-alpha.png';
import warriorManifestJson from './assets/generated/sprites/warrior/manifest.json';
import { spriteMotionForEvent } from './sprite-motion';
import type { SpriteManifest } from './AtlasSprite';
import { coinFacesAfterEvent, dragTargetSlots, drawPileComposition, dropCommands, sameCommand, stepSequence } from './interaction';
import type { CoinFaces, DragSource } from './interaction';

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

const SPRITES = {
  player: { atlasUrl: warriorAtlas, manifest: warriorManifestJson as SpriteManifest },
  enemy: { atlasUrl: goblinAtlas, manifest: goblinManifestJson as SpriteManifest }
};

type FloatText = { id: number; text: string; target: 'player' | 'enemy'; kind: 'damage' | 'block' | 'status' | 'coin' };
type CombatAction = { type: 'set'; state: CombatState } | { type: 'restart'; seed: string };
type DragState = {
  coin: CoinUid;
  source: DragSource;
  started: boolean;
  x: number;
  y: number;
  targets: Set<number>;
  over: number | null; // 합법 목적지 위일 때만
  overCard: number | null; // 합법 여부와 무관하게 포인터 아래의 카드
  overTray: boolean;
};

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

const coinVisualClasses = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : contentDb.coins[String(instance.defId)];
  return [
    def?.element === 'fire' ? 'fire' : '',
    instance?.grants.includes('fire') === true && def?.element !== 'fire' ? 'granted-fire' : '',
    instance?.permanent === false ? 'temporary' : ''
  ]
    .filter(Boolean)
    .join(' ');
};

// 소켓·고스트·드래그 프록시가 공유하는 동전 원판 — 면(face)은 플립 결과가 있을 때만 노출
const CoinDisc = ({
  state,
  coin,
  face,
  flipping
}: {
  state: CombatState;
  coin: CoinUid;
  face?: Face;
  flipping?: boolean;
}) => (
  <span
    className={`socket-coin ${coinVisualClasses(state, coin)} ${flipping === true ? 'flipping' : ''} ${
      face !== undefined ? `face-${face}` : ''
    }`}
  >
    {face !== undefined ? <span className={`coin-face-mark ${face}`}>{face === 'heads' ? '앞' : '뒤'}</span> : null}
  </span>
);

export const App = () => {
  const initialSeed = useMemo(seedFromUrl, []);
  const [seed, setSeed] = useState(initialSeed);
  const [state, dispatchState] = useReducer(combatReducer, initialSeed, createState);
  const [selectedCoin, setSelectedCoin] = useState<CoinUid | null>(null);
  const [queue, setQueue] = useState<CombatEvent[]>([]);
  const [locked, setLocked] = useState(false);
  const [coinFaces, setCoinFaces] = useState<CoinFaces>({});
  const [flipping, setFlipping] = useState<Record<number, boolean>>({});
  const [resolving, setResolving] = useState<{ slot: number; coins: CoinUid[] } | null>(null);
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [shakeCoin, setShakeCoin] = useState<CoinUid | null>(null);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [pouchOpen, setPouchOpen] = useState(false);
  const pouchRef = useRef<HTMLDivElement | null>(null);
  const resultPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const nextFloatId = useRef(1);
  const initialEventsQueued = useRef(false);
  const suppressClick = useRef(false);
  const legal = useMemo(() => legalCommands(state, contentDb), [state]);

  useEffect(() => {
    if (!initialEventsQueued.current && state.events.length > 0) {
      initialEventsQueued.current = true;
      setLocked(true);
      setQueue(state.events);
    }
  }, [state.events]);

  // 주머니 팝오버 — Escape·바깥 클릭으로 닫힘
  useEffect(() => {
    if (!pouchOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPouchOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (pouchRef.current !== null && event.target instanceof Node && !pouchRef.current.contains(event.target)) {
        setPouchOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [pouchOpen]);

  const findLegal = (cmd: Command): Command | undefined => legal.find((candidate) => sameCommand(candidate, cmd));

  const commit = (nextState: CombatState, events: CombatEvent[]) => {
    dispatchState({ type: 'set', state: nextState });
    setSelectedCoin(null);
    // 장전/회수는 상태 반영이 곧 피드백 — 큐·잠금 없이 즉답해 연속 장전이 끊기지 않는다
    const animated = events.filter((event) => event.type !== 'coinPlaced' && event.type !== 'coinUnplaced');
    if (animated.length > 0) {
      setLocked(true);
      setQueue((pending) => [...pending, ...animated]);
    }
    if (events.some((event) => event.type === 'coinPlaced')) setHintStage((stage) => (stage === 0 ? 1 : stage));
    if (events.some((event) => event.type === 'skillUsed')) setHintStage(2);
  };

  const runCommand = (cmd: Command): boolean => {
    if (locked) return false;
    const legalCommand = findLegal(cmd);
    if (legalCommand === undefined) return false;
    const result = step(state, legalCommand, contentDb);
    if (!result.ok) return false;
    commit(result.state, result.events);
    return true;
  };

  const runSequence = (commands: readonly Command[]): boolean => {
    if (locked || commands.length === 0) return false;
    const result = stepSequence(state, commands, contentDb);
    if (result === null) return false;
    commit(result.state, result.events);
    return true;
  };

  // 사용 선언 — 플립 스킬은 해결 직전의 장전 코인을 고스트로 붙잡아 연출 대상이 되게 한다
  const useSkill = (cmd: Command) => {
    if (cmd.type === 'useFlipSkill') {
      const ghosts = [...(state.zones.placed[cmd.slot] ?? [])];
      if (runCommand(cmd) && ghosts.length > 0) setResolving({ slot: Number(cmd.slot), coins: ghosts });
      return;
    }
    runCommand(cmd);
  };

  useEffect(() => {
    if (!locked) return undefined;
    if (queue.length === 0) {
      // 플립 결과 면을 잠시 붙잡아 읽을 시간을 준 뒤 고스트 해제와 함께 잠금을 푼다
      if (resolving !== null) {
        const hold = window.setTimeout(() => {
          setResolving(null);
          setLocked(false);
        }, 650);
        return () => window.clearTimeout(hold);
      }
      setLocked(false);
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
        setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
        setFlipping((items) => ({ ...items, [Number(event.coin)]: false }));
      }, 600);
    } else if (event?.type === 'coinsDrawn') {
      setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
      delay = 220;
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
  }, [locked, queue, resolving]);

  const restart = (nextSeed: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', nextSeed);
    window.history.replaceState(null, '', url);
    setSeed(nextSeed);
    setQueue([]);
    setLocked(false);
    setSelectedCoin(null);
    setCoinFaces({});
    setFlipping({});
    setResolving(null);
    setFloats([]);
    setDrag(null);
    setShakeCoin(null);
    setPouchOpen(false);
    suppressClick.current = false;
    initialEventsQueued.current = true;
    const nextState = createState(nextSeed);
    dispatchState({ type: 'set', state: nextState });
    if (nextState.events.length > 0) {
      setLocked(true);
      setQueue(nextState.events);
    }
  };

  // ---- 드래그 장전 (포인터 공통 — 마우스/터치, 6px 이하 이동은 클릭으로 취급) ----
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, coin: CoinUid, source: DragSource) => {
    if (locked || drag !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      coin,
      source,
      started: false,
      x: event.clientX,
      y: event.clientY,
      targets: dragTargetSlots(state, coin, source, contentDb),
      over: null,
      overCard: null,
      overTray: false
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag === null) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.started && Math.hypot(dx, dy) < 6) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const card = under?.closest('[data-slot]') ?? null;
    const overSlot = card === null ? null : Number(card.getAttribute('data-slot'));
    setDrag({
      ...drag,
      started: true,
      x: event.clientX,
      y: event.clientY,
      over: overSlot !== null && drag.targets.has(overSlot) ? overSlot : null,
      overCard: overSlot,
      overTray: (under?.closest('.hand-tray') ?? null) !== null
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.started) {
      // 이동 없는 눌림 = 클릭 — click 핸들러가 선택/회수를 처리한다
      setDrag(null);
      return;
    }
    suppressClick.current = true;
    // 자기 카드 위에 놓기 = 취소 (장전 유지) — 밖으로 끌어내야 회수
    if (drag.source.kind === 'socket' && drag.overCard === Number(drag.source.slot) && drag.over === null) {
      setDrag(null);
      return;
    }
    const target =
      drag.over !== null
        ? ({ kind: 'slot', slot: slot(drag.over) } as const)
        : drag.overTray
          ? ({ kind: 'tray' } as const)
          : ({ kind: 'none' } as const);
    const commands = dropCommands(drag.coin, drag.source, target);
    const committed = commands !== null && runSequence(commands);
    // 무효 드롭 피드백 — 손패 코인을 트레이에 되돌린 경우는 자연스러운 취소라 흔들지 않는다
    if (!committed && !(drag.source.kind === 'hand' && drag.overTray)) {
      setShakeCoin(drag.coin);
      window.setTimeout(() => setShakeCoin(null), 320);
    }
    setDrag(null);
  };

  const cancelDrag = () => {
    setDrag(null);
  };

  const clickGuard = (): boolean => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return true;
    }
    return false;
  };

  const enemy = state.enemies[0];
  const ended = state.phase === 'victory' || state.phase === 'defeat';
  const showResult = ended && !locked && queue.length === 0 && resolving === null && floats.length === 0;
  const activeEvent = queue[0];
  const spritePlayKey = activeEvent?.type === 'damageDealt' ? queue.length : 0;
  const playerMotion = spriteMotionForEvent('player', activeEvent);
  const enemyMotion = spriteMotionForEvent('enemy', activeEvent);
  const dragging = drag !== null && drag.started;

  useEffect(() => {
    if (showResult) resultPrimaryRef.current?.focus();
  }, [showResult]);

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
          motion={playerMotion}
          playKey={playerMotion === 'idle' ? 0 : spritePlayKey}
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
            motion={enemyMotion}
            playKey={enemyMotion === 'idle' ? 0 : spritePlayKey}
          />
        ) : null}
      </section>

      <section className={`skill-row ${locked ? 'dimmed' : ''}`} aria-label="스킬 카드">
        {state.slots.slice(0, 6).map((slotState, index) => {
          const skill = contentDb.skills[String(slotState.skillId)];
          const placed = state.zones.placed[slot(index)] ?? [];
          const consumeUse = legal.find((command): command is Extract<Command, { type: 'useConsumeSkill' }> => command.type === 'useConsumeSkill' && command.slot === slot(index));
          const use =
            skill?.type === 'consume'
              ? consumeUse
              : findLegal({ type: 'useFlipSkill', slot: slot(index), target: skill?.targetType === 'single-enemy' ? 0 : undefined });
          const canPlaceSelected =
            selectedCoin !== null && findLegal({ type: 'placeCoin', coin: selectedCoin, slot: slot(index) }) !== undefined;
          const dropTarget = dragging && drag.targets.has(index);
          const canPlace = canPlaceSelected || dropTarget;
          // 프리뷰는 사용 커맨드가 합법일 때만 (§3.5 preview → Preview | null) — 부분 장전·
          // 턴 3회 캡·재사용·전투 종료 등 코어가 해결을 거부하는 모든 상태를 legalCommands가 거른다
          const preview =
            skill?.type === 'flip' && placed.length === skill.cost && use !== undefined
              ? previewFlip(state, slot(index), contentDb)
              : null;
          const consumeReady = skill?.type === 'consume' && consumeUse !== undefined;
          const lockedOnce = skill?.oncePerCombat === true && slotState.usedThisCombat;
          const isResolving = resolving !== null && resolving.slot === index;
          const socketCoins = isResolving ? resolving.coins : placed;
          return (
            <article
              className={`skill-card ${use !== undefined ? 'ready' : ''} ${slotState.usedThisTurn ? 'spent' : ''} ${lockedOnce ? 'combat-locked' : ''} ${placed.length > 0 || isResolving ? 'lifted' : ''} ${isResolving ? 'resolving' : ''} ${dropTarget && drag?.over === index ? 'drop-target' : ''}`}
              data-slot={index}
              key={String(slotState.skillId)}
              onClick={() => {
                if (clickGuard()) return;
                // 동전을 고른 동안 카드 클릭은 장전 전용 — 장전 불가면 아무 것도 하지 않는다
                // (연속 장전 중 오클릭이 스킬을 발동시키는 오발 방지). 사용은 선택 해제 후 클릭 또는 제목 버튼
                if (selectedCoin !== null) {
                  if (canPlaceSelected) runCommand({ type: 'placeCoin', coin: selectedCoin, slot: slot(index) });
                  return;
                }
                if (use !== undefined) useSkill(use);
              }}
            >
              {/* 접근성: 카드의 키보드 진입점은 이 실제 버튼 하나 — 소켓 버튼과 형제 관계라
                  중첩 인터랙티브가 없고, 소켓의 Enter/Space가 카드 사용으로 번지지 않는다.
                  사용 불가여도 포커스 가능(aria-disabled)해 카드 열람(상승)은 항상 키보드로 가능 */}
              <button
                aria-disabled={use === undefined}
                aria-label={`${skill?.name ?? '빈 슬롯'}${use !== undefined ? ' 사용' : ''}`}
                className="card-title"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (clickGuard()) return;
                  if (use !== undefined) useSkill(use);
                }}
              >
                {skill?.name ?? '빈 슬롯'}
              </button>
              {skill?.oncePerCombat === true ? <span className="once-badge">전투당 1회</span> : null}
              <div className="sockets" aria-label={`${skill?.name ?? '스킬'} 코스트 소켓`}>
                {Array.from({ length: skill?.type === 'flip' ? skill.cost : 0 }, (_unused, socketIndex) => {
                  const coin = socketCoins[socketIndex];
                  return (
                    <button
                      aria-label={
                        coin === undefined
                          ? selectedCoin !== null
                            ? '선택한 동전 장전'
                            : '동전 장전'
                          : '장전된 동전 회수'
                      }
                      className={`socket ${coin !== undefined ? 'loaded' : ''} ${coin === undefined && canPlace ? 'accept' : ''}`}
                      key={socketIndex}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (clickGuard()) return;
                        if (isResolving) return;
                        if (coin !== undefined) runCommand({ type: 'unplaceCoin', coin });
                        else if (selectedCoin !== null) runCommand({ type: 'placeCoin', coin: selectedCoin, slot: slot(index) });
                      }}
                      onPointerDown={(event) => {
                        if (coin !== undefined && !isResolving) beginDrag(event, coin, { kind: 'socket', slot: slot(index) });
                      }}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                    >
                      {coin !== undefined ? (
                        <CoinDisc
                          coin={coin}
                          face={isResolving ? coinFaces[Number(coin)] : undefined}
                          flipping={isResolving && flipping[Number(coin)] === true}
                          state={state}
                        />
                      ) : null}
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

      {hintStage < 2 && !ended ? (
        <div aria-live="polite" className="hint-strip">
          {hintStage === 0 ? '동전을 클릭해 고르고 카드를 눌러 장전 — 드래그로도 됩니다' : '카드 제목을 누르면 사용 · 장전된 동전을 누르면 회수'}
        </div>
      ) : null}

      <section className="bottom-hud">
        <div className="pouch" ref={pouchRef}>
          <button
            aria-controls="pouch-pop"
            aria-expanded={pouchOpen}
            aria-label={`코인 주머니 — 남은 동전 ${state.zones.draw.length}닢, 구성 보기`}
            className="pouch-circle"
            type="button"
            onClick={() => setPouchOpen((open) => !open)}
          >
            {state.zones.draw.length}
          </button>
          <span>주머니</span>
          {pouchOpen ? (
            <div aria-label="뽑을 더미 구성" className="pouch-pop" id="pouch-pop" role="dialog">
              <strong>주머니 속 — 순서는 비밀</strong>
              {state.zones.draw.length === 0 ? (
                <p className="pop-empty">비었음 · 드로우 때 버림 더미를 섞어 채운다</p>
              ) : (
                <ul>
                  {drawPileComposition(state, contentDb).map((group) => (
                    <li key={`${group.defId}-${String(group.temporary)}`}>
                      <span
                        aria-hidden="true"
                        className={`pop-coin ${group.element === 'fire' ? 'fire' : ''} ${group.temporary ? 'temporary' : ''}`}
                      />
                      {group.element === null ? '기본' : elementKo(group.element)}
                      {group.temporary ? ' (임시)' : ''} ×{group.count}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
        <div className="hand-tray" aria-label="손패 동전 트레이">
          {state.zones.hand.map((coin) => (
            <button
              aria-label={`${coinLabel(state, coin)} 동전 선택`}
              aria-pressed={selectedCoin === coin}
              className={`coin ${coinVisualClasses(state, coin)} ${selectedCoin === coin ? 'selected' : ''} ${
                drag !== null && drag.started && drag.coin === coin ? 'drag-origin' : ''
              } ${shakeCoin === coin ? 'drag-cancel' : ''}`}
              disabled={locked}
              key={coin}
              type="button"
              onClick={() => {
                if (clickGuard()) return;
                setSelectedCoin(selectedCoin === coin ? null : coin);
              }}
              onPointerDown={(event) => beginDrag(event, coin, { kind: 'hand' })}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            >
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

      {dragging ? (
        <div aria-hidden="true" className="drag-proxy" style={{ left: drag.x, top: drag.y }}>
          <CoinDisc coin={drag.coin} state={state} />
        </div>
      ) : null}

      {showResult ? (
        <div aria-label="전투 결과" aria-modal="true" className="result-overlay" role="dialog">
          <div className="result-panel">
            <h1>{state.phase === 'victory' ? '승리' : '패배'}</h1>
            <p>턴 수 {state.turn}</p>
            <p>시드 {seed}</p>
            <button ref={resultPrimaryRef} aria-label="같은 시드로 재시작" type="button" onClick={() => restart(seed)}>
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
  motion: 'idle' | 'attack' | 'hurt';
  playKey: number;
}

const UnitPanel = ({ side, name, hp, maxHp, block, statuses, intent, floats, motion, playKey }: UnitPanelProps) => (
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
      <AtlasSprite
        atlasUrl={SPRITES[side].atlasUrl}
        key={`${side}-${motion}-${playKey}`}
        manifest={SPRITES[side].manifest}
        motion={motion}
        playKey={playKey}
        side={side}
      />
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
