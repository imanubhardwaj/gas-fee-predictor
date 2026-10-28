/** Quantile with linear interpolation over an already-sorted ascending array. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function quantile(values: readonly number[], q: number): number {
  return quantileSorted([...values].sort((a, b) => a - b), q);
}

export const median = (values: readonly number[]) => quantile(values, 0.5);

/** Weighted quantile: smallest value whose cumulative weight reaches q of the total. */
export function weightedQuantile(values: readonly number[], weights: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const idx = values.map((_, i) => i).sort((a, b) => (values[a] as number) - (values[b] as number));
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return quantile(values, q);
  let cum = 0;
  for (const i of idx) {
    cum += weights[i] as number;
    if (cum / total >= q) return values[i] as number;
  }
  return values[idx[idx.length - 1] as number] as number;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
