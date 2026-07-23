import { describe, it, expect } from "vitest";
import { decodePolyline, encodePolyline, polylineToPath } from "../polyline";

describe("encodePolyline", () => {
  it("encodes the canonical reference points", () => {
    expect(
      encodePolyline([
        [38.5, -120.2],
        [40.7, -120.95],
        [43.252, -126.453],
      ])
    ).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("round-trips through decode within precision", () => {
    const pts: [number, number][] = [
      [50.8503, 4.3517],
      [50.8511, 4.3529],
      [50.852, 4.354],
    ];
    const back = decodePolyline(encodePolyline(pts));
    expect(back).toHaveLength(pts.length);
    back.forEach(([lat, lng], i) => {
      expect(lat).toBeCloseTo(pts[i][0], 4);
      expect(lng).toBeCloseTo(pts[i][1], 4);
    });
  });

  it("encodes empty input as empty", () => {
    expect(encodePolyline([])).toBe("");
  });
});

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
