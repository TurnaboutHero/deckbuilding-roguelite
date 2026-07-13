import { describe, expect, it } from "vitest";

import { placeAnchoredOverlay } from "./overlay-position";

const viewport = {
  viewportWidth: 320,
  viewportHeight: 240,
  gap: 8,
  padding: 8,
};

describe("placeAnchoredOverlay", () => {
  it("centers above the anchor when there is room", () => {
    expect(
      placeAnchoredOverlay({
        ...viewport,
        anchor: { left: 100, right: 140, top: 100, bottom: 120 },
        overlayWidth: 80,
        overlayHeight: 40,
      }),
    ).toEqual({ left: 80, top: 52, placement: "top" });
  });

  it("flips below when the top would cross viewport padding", () => {
    expect(
      placeAnchoredOverlay({
        ...viewport,
        anchor: { left: 20, right: 60, top: 12, bottom: 32 },
        overlayWidth: 100,
        overlayHeight: 60,
      }),
    ).toEqual({ left: 8, top: 40, placement: "bottom" });
  });

  it("clamps the right edge inside viewport padding", () => {
    expect(
      placeAnchoredOverlay({
        ...viewport,
        anchor: { left: 290, right: 310, top: 150, bottom: 170 },
        overlayWidth: 120,
        overlayHeight: 40,
      }).left,
    ).toBe(192);
  });

  it("keeps an oversized overlay aligned to viewport padding", () => {
    expect(
      placeAnchoredOverlay({
        ...viewport,
        anchor: { left: 120, right: 160, top: 150, bottom: 170 },
        overlayWidth: 400,
        overlayHeight: 40,
      }).left,
    ).toBe(8);
  });

  it("uses the side with more space when neither side fully fits", () => {
    expect(
      placeAnchoredOverlay({
        ...viewport,
        anchor: { left: 120, right: 160, top: 70, bottom: 90 },
        overlayWidth: 100,
        overlayHeight: 180,
      }).placement,
    ).toBe("bottom");
  });
});
