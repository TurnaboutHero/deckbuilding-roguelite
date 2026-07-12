// P5.2 사운드 — 런타임 Web Audio 합성 (오디오 자산 0바이트, provenance = 이 코드).
// 라이선스 리스크 0: 모든 소리를 오실레이터+엔벨로프로 즉석 합성한다.
// 실패는 전부 무음 폴백 — AudioContext 부재/생성 실패/재생 오류가 게임 진행을
// 절대 막지 않는다 (P5.4 복구 원칙 선반영). 기본은 음소거(자동재생 정책 회피).

export type SfxKind =
  | "flip-heads"
  | "flip-tails"
  | "hit"
  | "block"
  | "purchase"
  | "victory"
  | "defeat";

const MUTE_KEY = "deckbuilding-roguelite.muted";

const readMuted = (): boolean => {
  try {
    // 저장값이 없으면 기본 음소거 (명시적으로 켠 사용자만 소리)
    return window.localStorage.getItem(MUTE_KEY) !== "false";
  } catch {
    return true;
  }
};

let muted = readMuted();
let ctx: AudioContext | null = null;

export const isMuted = (): boolean => muted;

export const setMuted = (value: boolean): void => {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, String(value));
  } catch {
    // 저장 실패는 세션 한정 설정으로 동작 — 차단하지 않는다
  }
};

const ensureContext = (): AudioContext | null => {
  try {
    if (ctx === null) {
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor === undefined) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
};

interface Tone {
  freq: number;
  /** 시작 오프셋 (초) */
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** 지정 시 freq → slide 로 지수 슬라이드 */
  slide?: number;
}

const playTones = (tones: Tone[]): void => {
  const audio = ensureContext();
  if (audio === null) return;
  try {
    const now = audio.currentTime;
    for (const tone of tones) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const start = now + (tone.at ?? 0);
      const level = tone.gain ?? 0.08;
      osc.type = tone.type ?? "square";
      osc.frequency.setValueAtTime(tone.freq, start);
      if (tone.slide !== undefined)
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(1, tone.slide),
          start + tone.dur,
        );
      gain.gain.setValueAtTime(level, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + tone.dur + 0.02);
    }
  } catch {
    // 무음 폴백
  }
};

const SFX: Record<SfxKind, Tone[]> = {
  "flip-heads": [{ freq: 880, slide: 1320, dur: 0.09 }],
  "flip-tails": [{ freq: 440, slide: 320, dur: 0.09 }],
  hit: [{ freq: 220, slide: 70, dur: 0.12, type: "sawtooth", gain: 0.09 }],
  block: [{ freq: 520, dur: 0.06, type: "triangle" }],
  purchase: [
    { freq: 660, dur: 0.07, type: "triangle" },
    { freq: 990, at: 0.08, dur: 0.09, type: "triangle" },
  ],
  victory: [
    { freq: 523, dur: 0.11, type: "triangle" },
    { freq: 659, at: 0.11, dur: 0.11, type: "triangle" },
    { freq: 784, at: 0.22, dur: 0.2, type: "triangle" },
  ],
  defeat: [{ freq: 196, slide: 82, dur: 0.45, type: "sawtooth", gain: 0.07 }],
};

export const playSfx = (kind: SfxKind): void => {
  if (muted) return;
  playTones(SFX[kind]);
};
