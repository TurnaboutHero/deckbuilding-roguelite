export type FlipSpeed = "normal" | "fast" | "instant";

export interface FlipTiming {
  animate: boolean;
  animationMs: number;
  queueDelayMs: number;
  revealVfxMs: number;
  resolveHoldMs: number;
}

export const FLIP_SPEED_STORAGE_KEY = "deckbuilding-roguelite.flip-speed";

export const isFlipSpeed = (value: unknown): value is FlipSpeed =>
  value === "normal" || value === "fast" || value === "instant";

export const loadFlipSpeed = (
  storage?: Pick<Storage, "getItem">,
): FlipSpeed => {
  try {
    const source =
      storage ??
      (typeof window === "undefined" ? undefined : window.localStorage);
    const saved = source?.getItem(FLIP_SPEED_STORAGE_KEY);
    return isFlipSpeed(saved) ? saved : "normal";
  } catch {
    return "normal";
  }
};

export const saveFlipSpeed = (
  speed: FlipSpeed,
  storage?: Pick<Storage, "setItem">,
): void => {
  try {
    const target =
      storage ??
      (typeof window === "undefined" ? undefined : window.localStorage);
    target?.setItem(FLIP_SPEED_STORAGE_KEY, speed);
  } catch {
    // 저장소를 사용할 수 없어도 현재 세션의 설정 변경은 유지한다.
  }
};

export const flipTiming = (
  speed: FlipSpeed,
  reducedMotion = false,
): FlipTiming => {
  if (reducedMotion || speed === "instant") {
    return {
      animate: false,
      animationMs: 0,
      queueDelayMs: 0,
      revealVfxMs: 0,
      resolveHoldMs: 0,
    };
  }
  if (speed === "fast") {
    return {
      animate: true,
      animationMs: 240,
      queueDelayMs: 340,
      revealVfxMs: 160,
      resolveHoldMs: 240,
    };
  }
  return {
    animate: true,
    animationMs: 600,
    queueDelayMs: 900,
    revealVfxMs: 330,
    resolveHoldMs: 650,
  };
};
