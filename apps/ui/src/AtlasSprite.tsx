import { useEffect, useMemo, useState } from 'react';

import type { SpriteMotion, SpriteSide } from './sprite-motion';

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AnimationRow {
  frames: number;
  fps: number;
  loop: boolean;
}

export interface SpriteManifest {
  animation: { rows: Record<string, AnimationRow> };
  frame_layout: {
    sheetWidth: number;
    sheetHeight: number;
    rows: Record<string, FrameRect[]>;
  };
}

interface AtlasSpriteProps {
  atlasUrl: string;
  manifest: SpriteManifest;
  motion: SpriteMotion;
  playKey: number;
  side: SpriteSide;
}

const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
};

export const AtlasSprite = ({ atlasUrl, manifest, motion, playKey, side }: AtlasSpriteProps) => {
  const reducedMotion = useReducedMotion();
  const [frameIndex, setFrameIndex] = useState(0);
  const animation = manifest.animation.rows[motion] ?? manifest.animation.rows.idle;
  const frames = useMemo(
    () => manifest.frame_layout.rows[motion] ?? manifest.frame_layout.rows.idle ?? [],
    [manifest, motion]
  );

  useEffect(() => {
    setFrameIndex(0);
    if (reducedMotion || animation === undefined || frames.length < 2 || animation.fps <= 0) return undefined;

    let current = 0;
    let timer = 0;
    const advance = () => {
      const next = current + 1;
      if (next >= frames.length) {
        if (!animation.loop) return;
        current = 0;
      } else {
        current = next;
      }
      setFrameIndex(current);
      timer = window.setTimeout(advance, 1000 / animation.fps);
    };

    timer = window.setTimeout(advance, 1000 / animation.fps);
    return () => window.clearTimeout(timer);
  }, [animation, frames, playKey, reducedMotion]);

  const rect = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))];
  if (rect === undefined) return null;

  return (
    <svg
      aria-hidden="true"
      className={`sprite-frame ${side}`}
      focusable="false"
      pointerEvents="none"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
    >
      <image
        height={manifest.frame_layout.sheetHeight}
        href={atlasUrl}
        imageRendering="pixelated"
        pointerEvents="none"
        width={manifest.frame_layout.sheetWidth}
        onError={(event) => {
          // P5.4 자산 폴백: 아틀라스 로드 실패 시 깨진 사각형 대신 조용히 제거
          // (유닛 플레이트·전투 진행은 그대로 — 백지/차단 금지)
          event.currentTarget.closest("svg")?.remove();
        }}
      />
    </svg>
  );
};
