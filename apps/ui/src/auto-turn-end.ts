import type { FlipReservation, SlotId } from "@game/core";

/**
 * Keep the UI boundary structural: core reservations can be passed directly,
 * while slot remains presentation metadata rather than execution identity.
 */
export type ExecutionReservation = Pick<
  FlipReservation,
  "id" | "slot" | "coinUids"
>;

export type ExecutionOrder = string[];

export interface ExecutionQueueSnapshot {
  order: ExecutionOrder;
  loaded: ExecutionReservation[];
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
  reservationId: string;
  /** Presentation metadata copied from the reservation at activation time. */
  slot: SlotId;
  token: string;
}

export interface AutoTurnEndState {
  phase: AutoTurnEndPhase;
  workflowId: string | null;
  order: ExecutionOrder;
  pending: string[];
  completed: string[];
  blocked: string[];
  cancelled: string[];
  reservations: Record<string, Pick<ExecutionReservation, "slot">>;
  active: ActiveExecution | null;
  choice: ExecutionChoice | null;
  blockedReason: string | null;
  nextTokenOrdinal: number;
}

const uniqueReservationIds = (ids: readonly string[]): string[] => [
  ...new Set(ids),
];

const uniqueReservations = (
  reservations: readonly ExecutionReservation[],
): ExecutionReservation[] => {
  const seen = new Set<string>();
  return reservations.filter((reservation) => {
    if (seen.has(reservation.id)) return false;
    seen.add(reservation.id);
    return true;
  });
};

export const reconcileExecutionOrder = (
  currentOrder: readonly string[],
  reservations: readonly ExecutionReservation[],
): ExecutionOrder => {
  const reservationIds = uniqueReservations(reservations).map(
    (reservation) => reservation.id,
  );
  const available = new Set(reservationIds);
  const retained = uniqueReservationIds(currentOrder).filter((id) =>
    available.has(id),
  );
  const retainedIds = new Set(retained);
  return [
    ...retained,
    ...reservationIds.filter((id) => !retainedIds.has(id)),
  ];
};

export const moveExecutionSlot = (
  currentOrder: readonly string[],
  reservationId: string,
  destinationIndex: number,
): ExecutionOrder => {
  const order = uniqueReservationIds(currentOrder);
  const sourceIndex = order.indexOf(reservationId);
  if (sourceIndex < 0) return order;
  const [removed] = order.splice(sourceIndex, 1);
  if (removed === undefined) return order;
  order.splice(Math.max(0, Math.min(destinationIndex, order.length)), 0, removed);
  return order;
};

export const swapExecutionSlots = (
  currentOrder: readonly string[],
  left: string,
  right: string,
): ExecutionOrder => {
  const order = uniqueReservationIds(currentOrder);
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) return order;
  [order[leftIndex], order[rightIndex]] = [order[rightIndex]!, order[leftIndex]!];
  return order;
};

export const executionQueueSnapshot = (
  currentOrder: readonly string[],
  reservations: readonly ExecutionReservation[],
  executableReservationIds?: readonly string[],
): ExecutionQueueSnapshot => {
  const executable =
    executableReservationIds === undefined
      ? null
      : new Set(executableReservationIds);
  const availableReservations = uniqueReservations(reservations).filter(
    (reservation) => executable === null || executable.has(reservation.id),
  );
  const order = reconcileExecutionOrder(currentOrder, availableReservations);
  const byId = new Map(
    availableReservations.map((reservation) => [reservation.id, reservation]),
  );
  return {
    order,
    loaded: order.flatMap((id) => {
      const reservation = byId.get(id);
      return reservation === undefined ? [] : [reservation];
    }),
  };
};

export const createIdleAutoTurnEnd = (): AutoTurnEndState => ({
  phase: "idle",
  workflowId: null,
  order: [],
  pending: [],
  completed: [],
  blocked: [],
  cancelled: [],
  reservations: {},
  active: null,
  choice: null,
  blockedReason: null,
  nextTokenOrdinal: 0,
});

export const beginAutoTurnEnd = (
  workflowId: string,
  reservations: readonly ExecutionReservation[],
): AutoTurnEndState => {
  const queuedReservations = uniqueReservations(reservations);
  const order = queuedReservations.map((reservation) => reservation.id);
  return {
    ...createIdleAutoTurnEnd(),
    phase: order.length === 0 ? "preserving" : "running",
    workflowId,
    order,
    pending: [...order],
    reservations: Object.fromEntries(
      queuedReservations.map((reservation) => [
        reservation.id,
        { slot: reservation.slot },
      ]),
    ),
  };
};

export const activateNextExecution = (
  state: AutoTurnEndState,
): AutoTurnEndState => {
  if (state.phase !== "running" || state.active !== null) return state;
  const reservationId = state.pending[0];
  if (reservationId === undefined) return { ...state, phase: "preserving" };
  const reservation = state.reservations[reservationId];
  if (reservation === undefined) {
    return { ...state, pending: state.pending.slice(1) };
  }
  const ordinal = state.nextTokenOrdinal;
  return {
    ...state,
    active: {
      reservationId,
      slot: reservation.slot,
      token: `${state.workflowId ?? "workflow"}:${ordinal}:${reservationId}`,
    },
    nextTokenOrdinal: ordinal + 1,
  };
};

export const pauseForExecutionChoice = (
  state: AutoTurnEndState,
  token: string,
  choice: ExecutionChoice,
): AutoTurnEndState =>
  state.phase === "running" && state.active?.token === token
    ? { ...state, phase: "choosing", choice }
    : state;

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
  if (state.phase !== "running" || state.active?.token !== token) return state;
  const { reservationId } = state.active;
  const pending = state.pending.filter((id) => id !== reservationId);
  return {
    ...state,
    phase: pending.length === 0 ? "preserving" : "running",
    pending,
    completed: uniqueReservationIds([...state.completed, reservationId]),
    blocked: state.blocked.filter((id) => id !== reservationId),
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
    state.active?.token !== token
  ) {
    return state;
  }
  return {
    ...state,
    phase: "blocked",
    blocked: uniqueReservationIds([
      ...state.blocked,
      state.active.reservationId,
    ]),
    choice: null,
    blockedReason: reason,
  };
};

export const retryBlockedExecution = (
  state: AutoTurnEndState,
): AutoTurnEndState => {
  if (state.phase !== "blocked" || state.active === null) return state;
  const { reservationId } = state.active;
  return {
    ...state,
    phase: "running",
    active: null,
    blocked: state.blocked.filter((id) => id !== reservationId),
    blockedReason: null,
  };
};

const clearRemainingReservations = (
  state: AutoTurnEndState,
  phase: Extract<AutoTurnEndPhase, "cancelled" | "preserving">,
): AutoTurnEndState => {
  const remaining = state.pending.filter((id) => !state.completed.includes(id));
  return {
    ...state,
    phase,
    pending: [],
    blocked: [],
    cancelled: uniqueReservationIds([...state.cancelled, ...remaining]),
    active: null,
    choice: null,
    blockedReason: null,
  };
};

export const cancelAutoTurnEnd = (
  state: AutoTurnEndState,
): AutoTurnEndState => {
  if (
    state.phase === "idle" ||
    state.phase === "cancelled" ||
    state.phase === "finished"
  ) {
    return state;
  }
  return clearRemainingReservations(state, "cancelled");
};

/** Used by abort and victory paths: no pending reservation survives the transition. */
export const abandonPendingExecutions = (
  state: AutoTurnEndState,
): AutoTurnEndState =>
  state.phase === "blocked" || state.phase === "running"
    ? clearRemainingReservations(state, "preserving")
    : state;

export const finishAutoTurnEnd = (
  state: AutoTurnEndState,
): AutoTurnEndState =>
  state.phase === "preserving" ? { ...state, phase: "finished" } : state;
