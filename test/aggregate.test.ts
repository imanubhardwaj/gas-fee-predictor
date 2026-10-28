import { describe, expect, it } from 'vitest';
import { evmBlocksToHourly, btcRowsToHourly, solSamplesToHourly, buildHeatmap } from '../src/aggregate';
import { quantile, weightedQuantile } from '../src/stats';
import { hourOfWeek } from '../src/time';
import type { EvmBlockRow, HourlyRow } from '../src/db';

const SUNDAY = 1_760_832_000; // 2025-10-19 00:00:00 UTC, a Sunday

describe('stats', () => {
  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.9)).toBe(10);
  });
  it('weighted quantile favours heavier samples', () => {
    expect(weightedQuantile([1, 100], [1, 1], 0.5)).toBe(1);
    expect(weightedQuantile([1, 100], [1, 10], 0.5)).toBe(100);
  });
});

describe('time', () => {
  it('maps Sunday 00:00 UTC to hour-of-week 0 and Monday 13:00 to 37', () => {
    expect(hourOfWeek(SUNDAY)).toBe(0);
    expect(hourOfWeek(SUNDAY + 37 * 3600)).toBe(37);
  });
});

describe('evmBlocksToHourly', () => {
  it('buckets blocks by UTC hour and converts wei to gwei', () => {
    const blocks: EvmBlockRow[] = [];
    for (let i = 0; i < 10; i++) {
      blocks.push({ number: i, ts: SUNDAY + i * 12, baseFee: (i + 1) * 1e9, tipP10: 0, tipP50: 2e9, tipP90: 0, gasUsedRatio: 0.5 });
    }
    blocks.push({ number: 99, ts: SUNDAY + 3600 + 5, baseFee: 50e9, tipP10: 0, tipP50: 1e9, tipP90: 0, gasUsedRatio: 0.5 });
    const rows = evmBlocksToHourly('eth', blocks);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ chain: 'eth', ts: SUNDAY, n: 10, p50: 5.5, tipP50: 2 });
    expect(rows[0]!.p10).toBeCloseTo(1.9);
    expect(rows[0]!.p90).toBeCloseTo(9.1);
    expect(rows[1]).toMatchObject({ ts: SUNDAY + 3600, n: 1, p50: 50, tipP50: 1 });
  });
});

describe('btcRowsToHourly', () => {
  it('takes the median of the per-row percentiles within the hour', () => {
    const rows = btcRowsToHourly([
      { ts: SUNDAY + 100, avgHeight: 1, p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
      { ts: SUNDAY + 900, avgHeight: 2, p10: 3, p25: 4, p50: 7, p75: 8, p90: 9 },
      { ts: SUNDAY + 1800, avgHeight: 3, p10: 2, p25: 3, p50: 5, p75: 6, p90: 7 },
    ]);
    expect(rows).toEqual([{ chain: 'btc', ts: SUNDAY, p10: 2, p50: 5, p90: 7, tipP50: null, n: 3 }]);
  });
});

describe('solSamplesToHourly', () => {
  it('buckets live samples by hour', () => {
    const rows = solSamplesToHourly([
      { ts: SUNDAY + 10, slot: 1, p10: 0, p50: 100, p90: 5000, n: 150 },
      { ts: SUNDAY + 70, slot: 2, p10: 0, p50: 300, p90: 7000, n: 150 },
    ]);
    expect(rows).toEqual([{ chain: 'sol', ts: SUNDAY, p10: 0, p50: 200, p90: 6000, tipP50: null, n: 2 }]);
  });
});

describe('buildHeatmap', () => {
  it('ranks cheapest and priciest hour-of-week cells', () => {
    const hourly: HourlyRow[] = [];
    const now = SUNDAY + 4 * 7 * 86400;
    for (let ts = SUNDAY; ts < now; ts += 3600) {
      const how = hourOfWeek(ts);
      hourly.push({ chain: 'eth', ts, p10: 1, p50: how === 10 ? 1 : how === 100 ? 50 : 10, p90: 20, tipP50: 1, n: 300 });
    }
    const hm = buildHeatmap('eth', hourly, now, 4);
    expect(hm.cells).toHaveLength(168);
    expect(hm.cells[10]!.n).toBe(4);
    expect(hm.cheapest[0]!.how).toBe(10);
    expect(hm.priciest[0]!.how).toBe(100);
    expect(hm.overallP50).toBe(10);
    expect(hm.cells[100]!.index).toBe(5);
    expect(hm.byHour).toHaveLength(24);
    expect(hm.byHour[10]!.n).toBe(4 * 7);
    expect(hm.byHour[10]!.p50).toBe(10);
  });
});
