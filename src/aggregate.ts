import type { EvmBlockRow, BtcFeeRow, SolSampleRow, HourlyRow, Store } from './db';
import { CHAINS, type ChainId } from './chains';
import { quantile, median } from './stats';
import { hourStart, hourOfWeek, labelHow, DAY, WEEK } from './time';

const GWEI = 1e9;

export function evmBlocksToHourly(chain: ChainId, blocks: readonly EvmBlockRow[]): HourlyRow[] {
  const plusTip = CHAINS[chain].evmSeries === 'base_plus_tip';
  const byHour = new Map<number, { base: number[]; tip: number[] }>();
  for (const b of blocks) {
    const h = hourStart(b.ts);
    let bucket = byHour.get(h);
    if (!bucket) byHour.set(h, (bucket = { base: [], tip: [] }));
    bucket.base.push((b.baseFee + (plusTip ? b.tipP50 : 0)) / GWEI);
    bucket.tip.push(b.tipP50 / GWEI);
  }
  return [...byHour]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, { base, tip }]) => {
      const sorted = base.sort((a, b) => a - b);
      return { chain, ts, p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), tipP50: median(tip), n: base.length };
    });
}

export function btcRowsToHourly(rows: readonly BtcFeeRow[]): HourlyRow[] {
  const byHour = new Map<number, BtcFeeRow[]>();
  for (const r of rows) {
    const h = hourStart(r.ts);
    const bucket = byHour.get(h);
    if (bucket) bucket.push(r);
    else byHour.set(h, [r]);
  }
  return [...byHour]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, rs]) => ({ chain: 'btc', ts, p10: median(rs.map((r) => r.p10)), p50: median(rs.map((r) => r.p50)), p90: median(rs.map((r) => r.p90)), tipP50: null, n: rs.length }));
}

export function solSamplesToHourly(rows: readonly SolSampleRow[]): HourlyRow[] {
  const byHour = new Map<number, SolSampleRow[]>();
  for (const r of rows) {
    const h = hourStart(r.ts);
    const bucket = byHour.get(h);
    if (bucket) bucket.push(r);
    else byHour.set(h, [r]);
  }
  return [...byHour]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, rs]) => ({ chain: 'sol', ts, p10: median(rs.map((r) => r.p10)), p50: median(rs.map((r) => r.p50)), p90: median(rs.map((r) => r.p90)), tipP50: null, n: rs.length }));
}

/** Rebuild hourly rows for [fromTs, toTs) one day at a time to bound memory. */
export function rebuildHourly(store: Store, chain: ChainId, fromTs: number, toTs: number): number {
  const kind = CHAINS[chain].kind;
  let written = 0;
  for (let day = hourStart(fromTs); day < toTs; day += DAY) {
    const end = Math.min(toTs, day + DAY);
    const rows =
      kind === 'evm' ? evmBlocksToHourly(chain, store.getEvmBlocks(chain, day, end)) : kind === 'btc' ? btcRowsToHourly(store.getBtcRows(day, end)) : solSamplesToHourly(store.getSolSamples(day, end));
    store.upsertHourly(rows);
    written += rows.length;
  }
  return written;
}

export interface HeatmapCell {
  how: number;
  label: string;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  n: number;
  /** p50 relative to the overall median, 1.0 = typical. */
  index: number | null;
}

export interface DayProfileCell {
  hour: number;
  p50: number | null;
  n: number;
  index: number | null;
}

export interface Heatmap {
  chain: ChainId;
  unit: string;
  weeks: number;
  fromTs: number;
  toTs: number;
  overallP50: number;
  /** 168 cells, index = hour-of-week (UTC, Sunday 00:00 = 0). */
  cells: HeatmapCell[];
  /** 24 cells: typical fee by hour of day across all days in the window. */
  byHour: DayProfileCell[];
  cheapest: HeatmapCell[];
  priciest: HeatmapCell[];
}

export function buildHeatmap(chain: ChainId, hourly: readonly HourlyRow[], nowTs: number, weeks = 4): Heatmap {
  const fromTs = nowTs - weeks * WEEK;
  const buckets: number[][] = Array.from({ length: 168 }, () => []);
  const hourBuckets: number[][] = Array.from({ length: 24 }, () => []);
  const all: number[] = [];
  for (const r of hourly) {
    if (r.ts < fromTs || r.ts >= nowTs) continue;
    const how = hourOfWeek(r.ts);
    (buckets[how] as number[]).push(r.p50);
    (hourBuckets[how % 24] as number[]).push(r.p50);
    all.push(r.p50);
  }
  const overallP50 = all.length ? median(all) : NaN;
  const idx = (p50: number) => (overallP50 > 0 ? p50 / overallP50 : null);
  const cells: HeatmapCell[] = buckets.map((vals, how) => {
    if (vals.length === 0) return { how, label: labelHow(how), p10: null, p50: null, p90: null, n: 0, index: null };
    const sorted = vals.sort((a, b) => a - b);
    const p50 = quantile(sorted, 0.5);
    return { how, label: labelHow(how), p10: quantile(sorted, 0.1), p50, p90: quantile(sorted, 0.9), n: vals.length, index: idx(p50) };
  });
  const byHour: DayProfileCell[] = hourBuckets.map((vals, hour) => {
    if (vals.length === 0) return { hour, p50: null, n: 0, index: null };
    const p50 = median(vals);
    return { hour, p50, n: vals.length, index: idx(p50) };
  });
  const ranked = cells.filter((c) => c.p50 != null).sort((a, b) => (a.p50 as number) - (b.p50 as number));
  return { chain, unit: CHAINS[chain].unit, weeks, fromTs, toTs: nowTs, overallP50, cells, byHour, cheapest: ranked.slice(0, 5), priciest: ranked.slice(-5).reverse() };
}
