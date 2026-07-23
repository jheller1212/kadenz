// ── Training-intensity distribution (polarized / pyramidal / …) ────────────────
// Collapses the 5 HR zones into the 3-band model used across the endurance
// literature and by intervals.icu — Low = Z1+Z2, Moderate = Z3+Z4, High = Z5 —
// then classifies the pattern and computes the Polarization Index.
//
// Sources:
//  • intervals.icu hierarchical classification (S1=Z1+Z2, S2=Z3+Z4, S3=Z5+):
//    HIIT → Polarized → Base → Pyramidal → Threshold → Unique, highest match wins.
//  • Polarization Index, Treff et al. 2019 (Front. Physiol.):
//    PI = log10(Z1 / Z2 × Z3 × 100) on fractions; > 2.00 ⇒ polarized (needs
//    Z1 > Z3 > Z2). CISS 2023 commentary refinement: round fractions to 2 dp and
//    treat sub-1% zones as zero to avoid rounding-driven false positives.

export type DistributionType =
  | "polarized"
  | "pyramidal"
  | "threshold"
  | "base"
  | "hiit"
  | "unique";

export interface ThreeZone {
  /** Seconds at low intensity (Z1 + Z2). */
  low: number;
  /** Seconds at moderate intensity (Z3 + Z4). */
  moderate: number;
  /** Seconds at high intensity (Z5). */
  high: number;
  /** low + moderate + high. */
  total: number;
}

/** Collapse a 5-element per-zone seconds array into the 3-band model. */
export function collapseToThreeZones(zoneSeconds: number[]): ThreeZone {
  const low = (zoneSeconds[0] ?? 0) + (zoneSeconds[1] ?? 0);
  const moderate = (zoneSeconds[2] ?? 0) + (zoneSeconds[3] ?? 0);
  const high = zoneSeconds[4] ?? 0;
  return { low, moderate, high, total: low + moderate + high };
}

/** Each band's share of total time, as whole percentages summing to ~100. */
export function bandPercents(z: ThreeZone): { low: number; moderate: number; high: number } {
  if (z.total <= 0) return { low: 0, moderate: 0, high: 0 };
  const pct = (s: number) => Math.round((s / z.total) * 100);
  return { low: pct(z.low), moderate: pct(z.moderate), high: pct(z.high) };
}

/**
 * Polarization Index (Treff et al. 2019). Returns null when it isn't meaningful
 * — no data, or no high-intensity time (PI is undefined/uninformative then).
 * PI > 2.00 ⇒ polarized.
 */
export function polarizationIndex(z: ThreeZone): number | null {
  if (z.total <= 0) return null;
  // Fractions of total, rounded to 2 dp; sub-1% treated as 0 (CISS refinement).
  const round2 = (x: number) => Math.round((x / z.total) * 100) / 100;
  const f1 = round2(z.low);
  const f2 = round2(z.moderate);
  const f3 = round2(z.high);
  if (f3 <= 0) return null; // no high-intensity → PI not informative
  const denom = f2 > 0 ? f2 : 0.01; // clamp: f2≈0 means highly polarized, not ÷0
  return Math.round(Math.log10((f1 / denom) * f3 * 100) * 100) / 100;
}

export interface Classification {
  type: DistributionType;
  /** Short badge label. */
  label: string;
  /** One-line plain-language description. */
  description: string;
}

const DETAIL: Record<DistributionType, Omit<Classification, "type">> = {
  polarized: {
    label: "Polarized",
    description: "Mostly easy with a hard minority and little in between — the classic ~80/20 split.",
  },
  pyramidal: {
    label: "Pyramidal",
    description: "Most time easy, less moderate, least hard — a descending pyramid.",
  },
  threshold: {
    label: "Threshold",
    description: "A notable share of moderate/threshold work relative to easy volume.",
  },
  base: {
    label: "Base",
    description: "Almost all easy volume — aerobic base building, very little intensity.",
  },
  hiit: {
    label: "High-intensity",
    description: "High-intensity work dominates — a lot of time above threshold.",
  },
  unique: {
    label: "Mixed",
    description: "Doesn't fit a standard pattern this period.",
  },
};

/**
 * Classify the 3-band distribution using intervals.icu's hierarchical ratios.
 * The first matching rule (highest in the hierarchy) wins.
 */
export function classifyDistribution(z: ThreeZone): Classification | null {
  const { low: s1, moderate: s2, high: s3, total } = z;
  if (total <= 0) return null;
  const of = (type: DistributionType): Classification => ({ type, ...DETAIL[type] });

  if (s3 > s2 && s3 > 0.499 * (s2 + s1)) return of("hiit");
  if (s3 > s2 && s1 > s2) return of("polarized");
  if (s1 > 3.99 * s2 && s1 > 3 * (s2 + s3)) return of("base");
  if (1.4 * s2 < s1 && s1 < 3.01 * s2 && s2 > 1.4 * s3) return of("pyramidal");
  if (s1 < 4 * s2 && s2 > 0.5 * s3) return of("threshold");
  return of("unique");
}
