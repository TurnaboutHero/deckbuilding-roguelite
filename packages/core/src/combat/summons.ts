// P6 D6 — 소환 장비 엔진 (명시 규칙: 결정 로그 §D6)
// · 최대 3 슬롯, 배열 순서 = 소환 순서(선입) = 자동 행동 순서
// · 슬롯 초과 시 가장 오래된 소환(배열 첫 항목) 교체
// · 행동 대상: 살아있는 최소 인덱스 적 (사망 시 자동 재타깃, 전멸 시 무시)
// · 플레이어 턴 종료 시 자동 행동 → 지속 1 감소 → 0이면 소멸
// · 전투 종료 시 전체 소멸 (전투는 저장 대상이 아니므로 별도 정리 불요)
import type { ContentDb, EquipmentDef } from '../content-types';
import type { EquipmentDefId } from '../ids';
import type { CombatEvent } from './events';
import type { CombatState, SummonState } from './state';
import { applyBlock, applyDamage, checkCombatEnd } from './resolve/flip';

export const SUMMON_SLOT_CAP = 3;

const firstLivingEnemyIndex = (state: CombatState): number | undefined => {
  for (let index = 0; index < state.enemies.length; index += 1) {
    if ((state.enemies[index]?.hp ?? 0) > 0) return index;
  }
  return undefined;
};

export const equipmentDefOf = (
  db: ContentDb,
  defId: EquipmentDefId,
): EquipmentDef => {
  const def = (db.equipment ?? {})[String(defId)];
  if (def === undefined) throw new Error(`unknown equipment: ${String(defId)}`);
  return def;
};

// 'chosen' 소환의 기본 장비 — 정렬 첫 키 (결정론; 명시 선택은 커맨드 파라미터가 우선)
export const defaultEquipmentId = (db: ContentDb): EquipmentDefId | undefined => {
  const keys = Object.keys(db.equipment ?? {}).sort();
  return keys.length === 0 ? undefined : (keys[0] as EquipmentDefId);
};

export const addSummon = (
  input: CombatState,
  defId: EquipmentDefId,
  duration: number,
  db: ContentDb,
  events: CombatEvent[],
): CombatState => {
  equipmentDefOf(db, defId);
  if (!Number.isInteger(duration) || duration < 1)
    throw new Error('summon duration must be a positive integer');
  const summon: SummonState = {
    uid: input.nextSummonUid,
    defId,
    duration,
    enhance: 0,
    aoeUses: 0,
  };
  let summons = [...input.summons];
  if (summons.length >= SUMMON_SLOT_CAP) {
    const oldest = summons[0]!;
    events.push({
      type: 'summonReplaced',
      uid: oldest.uid,
      equipment: String(oldest.defId),
    });
    summons = summons.slice(1);
  }
  summons = [...summons, summon];
  events.push({
    type: 'summonAdded',
    uid: summon.uid,
    equipment: String(defId),
    duration,
  });
  return { ...input, summons, nextSummonUid: input.nextSummonUid + 1 };
};

// 소환 1개 행동 실행 (자동/명령 공용). bonus = 명령의 뒷면 보너스 + 영구 enhance.
export const actSummon = (
  input: CombatState,
  summonIndex: number,
  commandBonus: number,
  db: ContentDb,
  events: CombatEvent[],
): CombatState => {
  const summon = input.summons[summonIndex];
  if (summon === undefined) return input;
  const def = equipmentDefOf(db, summon.defId);
  const bonus = commandBonus + summon.enhance + input.player.weaponOutput;
  let state = input;
  if (def.action.kind === 'strike') {
    const target = firstLivingEnemyIndex(state);
    if (target === undefined) return state;
    events.push({
      type: 'summonActed',
      uid: summon.uid,
      equipment: String(summon.defId),
      bonus,
    });
    const targets = summon.aoeUses > 0
      ? state.enemies.flatMap((enemy, index) => enemy.hp > 0 ? [index] : [])
      : [target];
    for (const index of targets) {
      state = applyDamage(state, { type: 'enemy', index }, def.action.damage + bonus, 'skill', events, { type: 'player' });
    }
    if (summon.aoeUses > 0) {
      state = { ...state, summons: state.summons.map((item) => item.uid === summon.uid ? { ...item, aoeUses: item.aoeUses - 1 } : item) };
    }
    return checkCombatEnd(state, events);
  }
  events.push({
    type: 'summonActed',
    uid: summon.uid,
    equipment: String(summon.defId),
    bonus,
  });
  return applyBlock(state, { type: 'player' }, def.action.block + bonus, events);
};

// 지속 1 감소 → 0 소멸. index 기준 단일 소환에 적용.
export const tickSummonDuration = (
  input: CombatState,
  summonUid: number,
  events: CombatEvent[],
): CombatState => {
  const summons: SummonState[] = [];
  for (const summon of input.summons) {
    if (summon.uid !== summonUid) {
      summons.push(summon);
      continue;
    }
    const duration = summon.duration - 1;
    if (duration <= 0) {
      events.push({
        type: 'summonExpired',
        uid: summon.uid,
        equipment: String(summon.defId),
      });
    } else {
      summons.push({ ...summon, duration });
    }
  }
  return { ...input, summons };
};

// 플레이어 턴 종료 훅: 슬롯 순서대로 자동 행동 → 지속 감소/소멸
export const runSummonPhase = (
  input: CombatState,
  db: ContentDb,
): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state = input;
  const uids = state.summons.map((summon) => summon.uid);
  for (const uid of uids) {
    const index = state.summons.findIndex((summon) => summon.uid === uid);
    if (index < 0) continue;
    state = actSummon(state, index, 0, db, events);
    state = tickSummonDuration(state, uid, events);
    if (state.phase === 'victory' || state.phase === 'defeat') break;
  }
  return { state, events };
};
