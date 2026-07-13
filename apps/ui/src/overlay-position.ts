export type OverlayPlacement = "top" | "bottom";

export interface OverlayAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface OverlayPositionInput {
  anchor: OverlayAnchorRect;
  overlayWidth: number;
  overlayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap: number;
  padding: number;
}

export interface OverlayPosition {
  left: number;
  top: number;
  placement: OverlayPlacement;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const placeAnchoredOverlay = ({
  anchor,
  overlayWidth,
  overlayHeight,
  viewportWidth,
  viewportHeight,
  gap,
  padding,
}: OverlayPositionInput): OverlayPosition => {
  const centeredLeft = (anchor.left + anchor.right - overlayWidth) / 2;
  const left = clamp(
    centeredLeft,
    padding,
    viewportWidth - padding - overlayWidth,
  );
  const topCandidate = anchor.top - gap - overlayHeight;
  const bottomCandidate = anchor.bottom + gap;
  const topFits = topCandidate >= padding;
  const bottomFits =
    bottomCandidate + overlayHeight <= viewportHeight - padding;
  const spaceAbove = anchor.top - padding - gap;
  const spaceBelow = viewportHeight - padding - anchor.bottom - gap;
  const placement: OverlayPlacement =
    topFits || (!bottomFits && spaceAbove >= spaceBelow) ? "top" : "bottom";
  const preferredTop = placement === "top" ? topCandidate : bottomCandidate;
  const top = clamp(
    preferredTop,
    padding,
    viewportHeight - padding - overlayHeight,
  );

  return { left, top, placement };
};
