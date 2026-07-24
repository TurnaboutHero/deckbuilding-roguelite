import type { CSSProperties, ReactNode, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { placeAnchoredOverlay } from "./overlay-position";
import type { OverlayPlacement } from "./overlay-position";

import "./overlay.css";

export type OverlayLayer =
  | "popover"
  | "tooltip"
  | "modal"
  | "notice";

interface OverlayPortalProps {
  children: ReactNode;
  className?: string;
  layer: OverlayLayer;
}

const overlayRoot = (): HTMLElement | null =>
  typeof document === "undefined"
    ? null
    : document.getElementById("overlay-root");

export const OverlayPortal = ({
  children,
  className,
  layer,
}: OverlayPortalProps): JSX.Element | null => {
  const root = overlayRoot();
  if (root === null) return null;
  return createPortal(
    <div
      className={`overlay-layer overlay-layer-${layer} ${className ?? ""}`}
      data-overlay-layer={layer}
    >
      {children}
    </div>,
    root,
  );
};

interface AnchoredOverlayProps {
  anchorRef: RefObject<HTMLElement>;
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  id?: string;
  interactive?: boolean;
  open: boolean;
  role: "dialog" | "tooltip";
}

interface MeasuredPosition {
  left: number;
  placement: OverlayPlacement;
  top: number;
}

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 8;

export const AnchoredOverlay = ({
  anchorRef,
  ariaLabel,
  children,
  className,
  id,
  interactive = false,
  open,
  role,
}: AnchoredOverlayProps): JSX.Element | null => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MeasuredPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = anchorRef.current;
        const overlay = overlayRef.current;
        if (
          anchor === null ||
          overlay === null ||
          !anchor.isConnected ||
          !overlay.isConnected
        ) {
          setPosition(null);
          return;
        }
        const anchorRect = anchor.getBoundingClientRect();
        const plate =
          anchor.closest(".unit-plate") ??
          anchor.closest(".unit")?.querySelector(".unit-plate");
        const plateRect = plate?.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        setPosition(
          placeAnchoredOverlay({
            anchor:
              plateRect === undefined
                ? anchorRect
                : {
                    left: anchorRect.left,
                    right: anchorRect.right,
                    top: Math.min(anchorRect.top, plateRect.top),
                    bottom: Math.max(anchorRect.bottom, plateRect.bottom),
                  },
            overlayHeight: overlayRect.height,
            overlayWidth: overlayRect.width,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
            gap: ANCHOR_GAP,
            padding: VIEWPORT_PADDING,
          }),
        );
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = new ResizeObserver(update);
    if (anchorRef.current !== null) observer.observe(anchorRef.current);
    if (overlayRef.current !== null) observer.observe(overlayRef.current);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open]);

  if (!open) return null;
  const style: CSSProperties =
    position === null
      ? { left: 0, top: 0, visibility: "hidden" }
      : { left: position.left, top: position.top };

  return (
    <OverlayPortal layer={role === "dialog" ? "popover" : "tooltip"}>
      <div
        aria-label={ariaLabel}
        className={`anchored-overlay ${interactive ? "interactive" : ""} ${className}`}
        data-placement={position?.placement}
        id={id}
        ref={overlayRef}
        role={role}
        style={style}
      >
        {children}
      </div>
    </OverlayPortal>
  );
};
