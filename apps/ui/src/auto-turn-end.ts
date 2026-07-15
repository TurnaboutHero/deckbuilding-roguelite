import type { SlotId } from "@game/core";

export type ExecutionOrder = SlotId[];

export type ExecutionSlotClassification = "loaded" | "partial" | "not-queued";

export interface ExecutionSlotLoad {
  slot: SlotId;
  loadedCount: number;
  requiredCount: number;
  queueable: boolean;
}

export interface ClassifiedExecutionSlot extends ExecutionSlotLoad {
  classification: ExecutionSlotClassification;
}

export interface ExecutionQueueSnapshot {
  order: ExecutionOrder;
  loaded: ClassifiedExecutionSlot[];
  partial: ClassifiedExecutionSlot[];
  notQueued: ClassifiedExecutionSlot[];
}

export type AutoTurnEndPhase =
  | "idle"
  | "running"
  | "choosing"
  | "preserving"
  | "blocked"
  | "cancelled"
  | "finished";

export type ExecutionChoice =
  | "coin"
  | "equipment"
  | "summon"
  | "enemy-target";

export interface ActiveExecution {
  slot: SlotId;
  token: string;
}

export interface AutoTurnEndState {
  phase: AutoTurnEndPhase;
  workflowId: string | null;
  order: ExecutionOrder;
  pending: SlotId[];
  completed: SlotId[];
  active: ActiveExecution | null;
  choice: ExecutionChoice | null;
  blockedReason: string | null;
  nextTokenOrdinal: number;
}

const uniqueSlots = (slots: readonly SlotId[]): SlotId[] => {
  const seen = new Set<number>();
  const unique: SlotId[] = [];
  for (const slot of slots) {
    const key = Number(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slot);
  }
  return unique;
};

const uniqueLoads = (
  loads: readonly ExecutionSlotLoad[],
): ExecutionSlotLoad[] => {
  const seen = new Set<number>();
  const unique: ExecutionSlotLoad[] = [];
  for (const load of loads) {
    const key = Number(load.slot);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(load);
  }
  return unique;
};

export const classifyExecutionSlot = (
  load: ExecutionSlotLoad,
): ExecutionSlotClassification => {
  if (!load.queueable || load.requiredCount <= 0 || load.loadedCount <= 0)
    return "not-queued";
  return load.loadedCount >= load.requiredCount ? "loaded" : "partial";
};

export const reconcileExecutionOrder = (
  currentOrder: readonly SlotId[],
  loads: readonly ExecutionSlotLoad[],
): ExecutionOrder => {
  const loadedSlots = uniqueLoads(loads)
    .filter((load) => classifyExecutionSlot(load) === "loaded")
    .map((load) => load.slot);
  const loadedKeys = new Set(loadedSlots.map(Number));
  const retained = uniqueSlots(currentOrder).filter((slot) =>
    loadedKeys.has(Number(slot)),
  );
  const retainedKeys = new Set(retained.map(Number));
  return [
    ...retained,
    ...loadedSlots.filter((slot) => !retainedKeys.has(Number(slot))),
  ];
};

export const moveExecutionSlot = (
  currentOrder: readonly SlotId[],
  target: SlotId,
  destinationIndex: number,
): ExecutionOrder => {
  const order = uniqueSlots(currentOrder);
  const sourceIndex = order.findIndex((slot) => slot === target);
  if (sourceIndex < 0) return order;
  const [removed] = order.splice(sourceIndex, 1);
  if (removed === undefined) return order;
  const boundedIndex = Math.max(0, Math.min(destinationIndex, order.length));
  order.splice(boundedIndex, 0, removed);
  return order;
};

export const swapExecutionSlots = (
  currentOrder: readonly SlotId[],
  left: SlotId,
  right: SlotId,
): ExecutionOrder => {
  const order = uniqueSlots(currentOrder);
  const leftIndex = order.findIndex((slot) => slot === left);
  const rightIndex = order.findIndex((slot) => slot === right);
  if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) return order;
  [order[leftIndex], order[rightIndex]] = [order[rightIndex]!, order[leftIndex]!];
  return order;
};

export const executionQueueSnapshot = (
  currentOrder: readonly SlotId[],
  loads: readonly ExecutionSlotLoad[],
): ExecutionQueueSnapshot => {
  const classified = uniqueLoads(loads).map(
    (load): ClassifiedExecutionSlot => ({
      ...load,
      classification: classifyExecutionSlot(load),
    }),
  );
  const order = reconcileExecutionOrder(currentOrder, classified);
  const bySlot = new Map(classified.map((entry) => [Number(entry.slot), entry]));
  return {
    order,
    loaded: order.flatMap((slot) => {
      const entry = bySlot.get(Number(slot));
      return entry === undefined ? [] : [entry];
    }),
    partial: classified.filter((entry) => entry.classification === "partial"),
    notQueued: classified.filter(
      (entry) => entry.classification === "not-queued",
    ),
  };
};

export const createIdleAutoTurnEnd = (
  order: readonly SlotId[] = [],
): AutoTurnEndState => ({
  phase: "idle",
  workflowId: null,
  order: uniqueSlots(order),
  pending: [],
  completed: [],
  active: null,
  choice: null,
  blockedReason: null,
  nextTokenOrdinal: 0,
});

export const beginAutoTurnEnd = (
  workflowId: string,
  order: readonly SlotId[],
): AutoTurnEndState => {
  const normalizedOrder = uniqueSlots(order);
  return {
    phase: normalizedOrder.length === 0 ? "preserving" : "running",
    workflowId,
    order: normalizedOrder,
    pending: [...normalizedOrder],
    completed: [],
    active: null,
    choice: null,
    blockedReason: null,
    nextTokenOrdinal: 0,
  };
};

export const activateNextExecution = (
  state: AutoTurnEndState,
): AutoTurnEndState => {
  if (state.phase !== "running" || state.active !== null) return state;
  const next = state.pending[0];
  if (next === undefined) return { ...state, phase: "preserving" };
  const ordinal = state.nextTokenOrdinal;
  return {
    ...state,
    active: {
      slot: next,
      token: `${state.workflowId ?? "workflow"}:${ordinal}:${Number(next)}`,
    },
    nextTokenOrdinal: ordinal + 1,
  };
};

export const pauseForExecutionChoice = (
  state: AutoTurnEndState,
  token: string,
  choice: ExecutionChoice,
): AutoTurnEndState => {
  if (
    state.phase !== "running" ||
    state.active === null ||
    state.active.token !== token
  )
    return state;
  return { ...state, phase: "choosing", choice };
};

export const resumeExecutionChoice = (
  state: AutoTurnEndState,
  token: string,
): AutoTurnEndState =>
  state.phase === "choosing" && state.active?.token === token
    ? { ...state, phase: "running", choice: null }
    : state;

export const completeActiveExecution = (
  state: AutoTurnEndState,
  token: string,
): AutoTurnEndState => {
  if (
    state.phase !== "running" ||
    state.active === null ||
    state.active.token !== token
  )
    return state;
  const pending = state.pending.slice(1);
  return {
    ...state,
    phase: pending.length === 0 ? "preserving" : "running",
    pending,
    completed: [...state.completed, state.active.slot],
    active: null,
    choice: null,
  };
};

export const blockActiveExecution = (
  state: AutoTurnEndState,
  token: string,
  reason: string,
): AutoTurnEndState => {
  if (
    (state.phase !== "running" && state.phase !== "choosing") ||
    state.active === null ||
    state.active.token !== token
  )
    return state;
  return {
    ...state,
    phase: "blocked",
    choice: null,
    blockedReason: reason,
  };
};

export const retryBlockedExecution = (
  state: AutoTurnEndState,
): AutoTurnEndState =>
  state.phase === "blocked"
    ? {
        ...state,
        phase: "running",
        active: null,
        blockedReason: null,
      }
    : state;

export const cancelAutoTurnEnd = (
  state: AutoTurnEndState,
): AutoTurnEndState => {
  if (
    state.phase === "idle" ||
    state.phase === "cancelled" ||
    state.phase === "finished"
  )
    return state;
  return {
    ...state,
    phase: "cancelled",
    active: null,
    choice: null,
    blockedReason: null,
  };
};

export const abandonPendingExecutions = (
  state: AutoTurnEndState,
): AutoTurnEndState => {
  if (state.phase !== "blocked" && state.phase !== "running") return state;
  return {
    ...state,
    phase: "preserving",
    active: null,
    choice: null,
    blockedReason: null,
  };
};

export const finishAutoTurnEnd = (
  state: AutoTurnEndState,
): AutoTurnEndState =>
  state.phase === "preserving" ? { ...state, phase: "finished" } : state;
