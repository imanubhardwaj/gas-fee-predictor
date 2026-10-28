import type { HourlyRow } from './db';
import { CHAINS, type ChainId } from './chains';
import { clamp, median, quantile, weightedQuantile } from './stats';
import { hourStart, hourOfWeek, HOUR, WEEK } from './time';

export interface ForecastOptions {
  /** Trailing weeks of history used for the seasonal profile and band calibration. */
  weeks?: number;
  /** Half-life, in weeks, of the recency weighting on the seasonal profile. */
  halfLifeWeeks?: number;
  /** Hours over which the current-level deviation decays back to the seasonal profile. */
  levelTauHours?: number;
  /** Trailing hours used to measure the current level. */
  levelWindowHours?: number;
  /** Minimum samples for an hour-of-week cell before falling back to the overall median. */
  minCellSamples?: number;
  /** 0 = ignore seasonality (pure persistence), 1 = full shrunken hour-of-week profile. */
  seasonalStrength?: number;
  /** Pseudo-count that shrinks each hour-of-week cell toward its hour-of-day cell, and that toward the overall median. */
  shrinkK?: number;
}

export interface ForecastPoint {
  ts: number;
  p10: number;
  p50: number;
  p90: number;
  /** Positive means cheaper than now. */
  savingVsNowPct: number;
}

export interface ForecastWindow {
  startTs: number;
  endTs: number;
  minTs: number;
  p50: number;
  savingVsNowPct: number;
}

export interface Forecast {
  chain: ChainId;
  unit: string;
  generatedAt: number;
  now: { ts: number; value: number; hoursUsed: number };
  /** Current level relative to the seasonal expectation; 1.0 = on-profile. */
  level: number;
  /** Smallest meaningful fee for this chain in the series unit; values at or below it cannot be timed. */
  floor: number;
  options: Required<ForecastOptions>;
  /** Number of (origin, horizon) residuals the band was calibrated on. */
  calibrationSamples: number;
  /** exp(p95 − p5) of the weekly profile: 1.15 means hour-of-week timing moves fees by about 15%. */
  seasonalRange: number;
  /**
   * Holdout check of the product claim (profile fit on the first half of the window, evaluated on
   * the second half): follow the model's cheapest hour in the next 24h and compare that hour's fee
   * with the fee at the origin. Median and quartiles of the realized saving, plus the oracle best.
   */
  timingEdge: { origins: number; medianSavingPct: number; p25SavingPct: number; p75SavingPct: number; oracleMedianSavingPct: number } | null;
  points: ForecastPoint[];
  best: { next24h: ForecastWindow | null; next7d: ForecastWindow | null };
}

const DEFAULTS: Required<ForecastOptions> = {
  weeks: 4,
  halfLifeWeeks: 2,
  levelTauHours: 168,
  levelWindowHours: 3,
  minCellSamples: 3,
  seasonalStrength: 0.6,
  shrinkK: 6,
};

/** Horizon buckets (upper bounds, hours) that share one calibrated band. */
const BUCKETS = [3, 6, 12, 24, 48, 96, 168, Infinity];
const bucketOf = (h: number) => BUCKETS.findIndex((b) => h <= b);

/**
 * Fees are multiplicative and spiky, so everything happens in log space. Zero is legal
 * (idle Solana slots, sub-1 sat/vB Bitcoin blocks reported as 0), hence the floor: the
 * chain's smallest meaningful fee, or 2% of the series median if that is higher, which
 * keeps a run of zeros from dragging the level or the profile to −∞.
 */
function logFloor(chain: ChainId, rows: readonly HourlyRow[]): number {
  const med = median(rows.map((r) => r.p50).filter((v) => v > 0));
  return Math.max(CHAINS[chain].valueFloor, Number.isFinite(med) && med > 0 ? med * 0.02 : 0);
}


interface Profile {
  overallLog: number;
  seasonalLog: number[];
}

/**
 * Seasonal profile in log space with hierarchical shrinkage: each hour-of-week cell is pulled
 * toward its hour-of-day cell (7x the samples), which is pulled toward the overall median.
 * With only a few weeks of data the raw 168-cell profile is mostly noise; this keeps the
 * signal that repeats and discards the rest. `seasonalStrength` scales the whole shape.
 */
function fitProfile(rows: readonly HourlyRow[], asOf: number, lg: (v: number) => number, o: Required<ForecastOptions>): Profile {
  const cellVals: number[][] = Array.from({ length: 168 }, () => []);
  const cellW: number[][] = Array.from({ length: 168 }, () => []);
  const dayVals: number[][] = Array.from({ length: 24 }, () => []);
  const dayW: number[][] = Array.from({ length: 24 }, () => []);
  const allVals: number[] = [];
  const allW: number[] = [];
  for (const r of rows) {
    const w = Math.pow(0.5, (asOf - r.ts) / WEEK / o.halfLifeWeeks);
    const k = hourOfWeek(r.ts);
    const v = lg(r.p50);
    (cellVals[k] as number[]).push(v);
    (cellW[k] as number[]).push(w);
    (dayVals[k % 24] as number[]).push(v);
    (dayW[k % 24] as number[]).push(w);
    allVals.push(v);
    allW.push(w);
  }
  const overallLog = weightedQuantile(allVals, allW, 0.5);
  const sumW = (ws: number[]) => ws.reduce((a, b) => a + b, 0);
  const dayLog: number[] = dayVals.map((vals, h) => {
    if (vals.length < o.minCellSamples) return overallLog;
    const n = sumW(dayW[h] as number[]);
    return (n * weightedQuantile(vals, dayW[h] as number[], 0.5) + o.shrinkK * overallLog) / (n + o.shrinkK);
  });
  const seasonalLog: number[] = cellVals.map((vals, k) => {
    const parent = dayLog[k % 24] as number;
    if (vals.length < o.minCellSamples) return overallLog + o.seasonalStrength * (parent - overallLog);
    const n = sumW(cellW[k] as number[]);
    const shrunk = (n * weightedQuantile(vals, cellW[k] as number[], 0.5) + o.shrinkK * parent) / (n + o.shrinkK);
    return overallLog + o.seasonalStrength * (shrunk - overallLog);
  });
  return { overallLog, seasonalLog };
}

const LEVEL_MIN = Math.log(0.05);
const LEVEL_MAX = Math.log(20);

/**
 * Holdout check of the product claim: fit the profile on the first half of the window, then at
 * every origin in the second half follow the model's cheapest hour within 24h and compare that
 * hour's actual fee with the fee at the origin. Positive = following the call saved money.
 */
function holdoutTimingEdge(rows: readonly HourlyRow[], byTs: Map<number, number>, lg: (v: number) => number, o: Required<ForecastOptions>): Forecast['timingEdge'] {
  if (rows.length < 14 * 24) return null;
  const first = rows[0] as HourlyRow;
  const last = rows[rows.length - 1] as HourlyRow;
  const midTs = first.ts + Math.floor((last.ts - first.ts) / 2);
  const train = rows.filter((r) => r.ts < midTs);
  if (train.length < 7 * 24) return null;
  const prof = fitProfile(train, midTs, lg, o);
  const seasonalAt = (ts: number) => prof.seasonalLog[hourOfWeek(ts)] as number;
  const realized: number[] = [];
  const oracle: number[] = [];
  for (const origin of rows) {
    if (origin.ts < midTs || origin.p50 <= 0) continue;
    const originLog = lg(origin.p50);
    const levelLog = clamp(originLog - seasonalAt(origin.ts), LEVEL_MIN, LEVEL_MAX);
    let bestTs = -1;
    let bestPred = Infinity;
    let oracleBest = Infinity;
    let seen = 0;
    for (let h = 1; h <= 24; h++) {
      const ts = origin.ts + h * HOUR;
      const actual = byTs.get(ts);
      if (actual == null) continue;
      seen++;
      const pred = seasonalAt(ts) + levelLog * Math.exp(-h / o.levelTauHours);
      if (pred < bestPred) {
        bestPred = pred;
        bestTs = ts;
      }
      oracleBest = Math.min(oracleBest, actual);
    }
    if (seen < 12 || bestTs < 0) continue;
    realized.push((1 - Math.exp((byTs.get(bestTs) as number) - originLog)) * 100);
    oracle.push((1 - Math.exp(oracleBest - originLog)) * 100);
  }
  if (realized.length < 24) return null;
  return { origins: realized.length, medianSavingPct: quantile(realized, 0.5), p25SavingPct: quantile(realized, 0.25), p75SavingPct: quantile(realized, 0.75), oracleMedianSavingPct: quantile(oracle, 0.5) };
}

/**
 * Seasonal-shape persistence. The forecast for hour h is
 *   seasonal(h) × level^(exp(−h/τ))
 * where seasonal(h) is the weighted hour-of-week median and level is how far the current
 * fee sits from its own seasonal expectation. The p10–p90 band is not the seasonal spread:
 * it is calibrated from the log residuals this very predictor would have made at past
 * origins in the window, bucketed by horizon, so the band widens with horizon the way the
 * data says it should. The backtest CLI reports how well that holds out of sample.
 */
export function forecast(chain: ChainId, hourly: readonly HourlyRow[], nowTs: number, horizonHours = 168, opts: ForecastOptions = {}): Forecast {
  const o = { ...DEFAULTS, ...opts };
  const cutoff = nowTs - o.weeks * WEEK;
  const rows = hourly.filter((r) => r.ts >= cutoff && r.ts < nowTs).sort((a, b) => a.ts - b.ts);
  if (rows.length === 0) throw new Error(`no ${chain} hourly data in the trailing ${o.weeks} weeks`);
  const floor = logFloor(chain, rows);
  const lg = (v: number) => Math.log(Math.max(v, floor));

  const prof = fitProfile(rows, nowTs, lg, o);
  const seasonalLog = prof.seasonalLog;
  const seasonalAt = (ts: number) => seasonalLog[hourOfWeek(ts)] as number;

  // Current level relative to the seasonal expectation.
  const recent = rows.filter((r) => r.ts >= nowTs - o.levelWindowHours * HOUR);
  const lastRow = rows[rows.length - 1] as HourlyRow;
  const nowVal = recent.length ? median(recent.map((r) => r.p50)) : lastRow.p50;
  const nowLog = lg(nowVal);
  const nowSeasonal = recent.length ? median(recent.map((r) => seasonalAt(r.ts))) : seasonalAt(lastRow.ts);
  const levelLog = clamp(nowLog - nowSeasonal, LEVEL_MIN, LEVEL_MAX);
  const decay = (h: number) => Math.exp(-h / o.levelTauHours);
  const predictLog = (originLog: number, originSeasonal: number, ts: number, h: number) => seasonalAt(ts) + clamp(originLog - originSeasonal, LEVEL_MIN, LEVEL_MAX) * decay(h);

  // Band calibration: residuals of this predictor at past origins, bucketed by horizon.
  const byTs = new Map<number, number>();
  for (const r of rows) byTs.set(r.ts, lg(r.p50));
  const residuals: number[][] = BUCKETS.map(() => []);
  let calibrationSamples = 0;
  const originStep = rows.length > 500 ? 3 : 1;
  for (let i = 0; i < rows.length; i += originStep) {
    const origin = rows[i] as HourlyRow;
    const originLog = lg(origin.p50);
    const originSeasonal = seasonalAt(origin.ts);
    for (let h = 1; h <= Math.min(horizonHours, 168); h++) {
      const ts = origin.ts + h * HOUR;
      const actual = byTs.get(ts);
      if (actual == null) continue;
      (residuals[bucketOf(h)] as number[]).push(actual - predictLog(originLog, originSeasonal, ts, h));
      calibrationSamples++;
    }
  }
  const bandFor = (h: number): [number, number] => {
    let b = bucketOf(h);
    while (b >= 0 && (residuals[b] as number[]).length < 20) b--;
    if (b < 0) {
      const all = residuals.flat();
      return all.length >= 20 ? [quantile(all, 0.1), quantile(all, 0.9)] : [-0.7, 0.7];
    }
    const rs = residuals[b] as number[];
    return [quantile(rs, 0.1), quantile(rs, 0.9)];
  };

  const timingEdge = holdoutTimingEdge(rows, byTs, lg, o);

  const base = hourStart(nowTs);
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizonHours; h++) {
    const ts = base + h * HOUR;
    const p50Log = seasonalAt(ts) + levelLog * decay(h);
    const [lo, hi] = bandFor(h);
    const p50 = Math.max(floor, Math.exp(p50Log));
    const nowFloored = Math.max(floor, nowVal);
    points.push({ ts, p10: Math.max(floor, Math.exp(p50Log + lo)), p50, p90: Math.max(floor, Math.exp(p50Log + hi)), savingVsNowPct: (1 - p50 / nowFloored) * 100 });
  }

  return {
    chain,
    unit: CHAINS[chain].unit,
    generatedAt: nowTs,
    now: { ts: recent.length ? (recent[recent.length - 1] as HourlyRow).ts : lastRow.ts, value: Math.max(floor, nowVal), hoursUsed: recent.length },
    level: Math.exp(levelLog),
    floor,
    options: o,
    calibrationSamples,
    seasonalRange: Math.exp(quantile(seasonalLog, 0.95) - quantile(seasonalLog, 0.05)),
    timingEdge,
    points,
    best: { next24h: bestWindow(points.slice(0, 24)), next7d: bestWindow(points) },
  };
}

/** Cheapest hour plus the contiguous run around it that stays within 10% of that minimum. */
export function bestWindow(points: readonly ForecastPoint[]): ForecastWindow | null {
  if (points.length === 0) return null;
  let minIdx = 0;
  for (let i = 1; i < points.length; i++) if ((points[i] as ForecastPoint).p50 < (points[minIdx] as ForecastPoint).p50) minIdx = i;
  const min = points[minIdx] as ForecastPoint;
  const limit = min.p50 * 1.1;
  let s = minIdx;
  let e = minIdx;
  while (s > 0 && (points[s - 1] as ForecastPoint).p50 <= limit) s--;
  while (e < points.length - 1 && (points[e + 1] as ForecastPoint).p50 <= limit) e++;
  return { startTs: (points[s] as ForecastPoint).ts, endTs: (points[e] as ForecastPoint).ts + HOUR, minTs: min.ts, p50: min.p50, savingVsNowPct: min.savingVsNowPct };
}
