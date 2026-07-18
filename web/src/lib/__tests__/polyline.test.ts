import { describe, it, expect } from "vitest";
import { decodePolyline, polylineToPath } from "../polyline";

describe("decodePolyline", () => {
  it("decodes the canonical reference polyline", () => {
    // Reference example from the encoded-polyline format spec.
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("tolerates truncated input without throwing", () => {
    expect(() => decodePolyline("_p~iF~ps|U_ul")).not.toThrow();
  });
});

describe("polylineToPath", () => {
  it("returns null for fewer than 2 points", () => {
    expect(polylineToPath([[50, 5]], 320, 200)).toBeNull();
  });

  it("fits points inside the padded box", () => {
    const result = polylineToPath(
      [
        [50.85, 5.68],
        [50.86, 5.7],
        [50.84, 5.71],
      ],
      320,
      200,
      12
    );
    expect(result).not.toBeNull();
    const { path, start, end } = result!;
    expect(path.startsWith("M")).toBe(true);
    for (const [x, y] of [start, end]) {
      expect(x).toBeGreaterThanOrEqual(12);
      expect(x).toBeLessThanOrEqual(308);
      expect(y).toBeGreaterThanOrEqual(12);
      expect(y).toBeLessThanOrEqual(188);
    }
  });

  it("puts the northernmost point at the top", () => {
    const result = polylineToPath(
      [
        [50.0, 5.0], // south → larger y
        [51.0, 5.0], // north → smaller y
      ],
      320,
      200
    );
    expect(result!.start[1]).toBeGreaterThan(result!.end[1]);
  });
});
