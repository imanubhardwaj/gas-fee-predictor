import { describe, expect, it } from 'vitest';
import { forecast, bestWindow } from '../src/forecast';
import { hourOfWeek, HOUR, WEEK } from '../src/time';
import type { HourlyRow } from '../src/db';

const SUNDAY = 1_760_832_000;

/** Weekly pattern: cheap at hour-of-week 20 (Sun 20:00), expensive at 60 (Tue 12:00), 10 elsewhere. */
function synthetic(weeks: number, scaleLastHours = 1, scaledHours = 0): HourlyRow[] {
  const rows: HourlyRow[] = [];
  const end = SUNDAY + weeks * WEEK;
  for (let ts = SUNDAY; ts < end; ts += HOUR) {
    const how = hourOfWeek(ts);
    const base = how === 20 ? 2 : how === 60 ? 40 : 10;
    const scale = ts >= end - scaledHours * HOUR ? scaleLastHours : 1;
    rows.push({ chain: 'eth', ts, p10: base * 0.8 * scale, p50: base * scale, p90: base * 1.2 * scale, tipP50: 1, n: 300 });
  }
  return rows;
}

describe('forecast', () => {
  it('recovers the weekly pattern and finds the cheapest window', () => {
    const rows = synthetic(6);
    const now = SUNDAY + 6 * WEEK;
    const f = forecast('eth', rows, now, 168, { seasonalStrength: 1, shrinkK: 0 });
    expect(f.points).toHaveLength(168);
    expect(f.level).toBeCloseTo(1, 3);
    expect(f.seasonalRange).toBeGreaterThanOrEqual(1); // p95–p5 range ignores the two outlier cells by design
    expect(f.timingEdge).not.toBeNull();
    expect(f.timingEdge!.medianSavingPct).toBeGreaterThanOrEqual(0);
    expect(f.timingEdge!.oracleMedianSavingPct).toBeGreaterThanOrEqual(f.timingEdge!.medianSavingPct - 1e-9);
    const cheap = f.points.find((p) => hourOfWeek(p.ts) === 20)!;
    const pricey = f.points.find((p) => hourOfWeek(p.ts) === 60)!;
    expect(cheap.p50).toBeCloseTo(2, 3);
    expect(pricey.p50).toBeCloseTo(40, 3);
    expect(f.best.next7d!.p50).toBeCloseTo(2, 3);
    expect(hourOfWeek(f.best.next7d!.minTs)).toBe(20);
    expect(cheap.savingVsNowPct).toBeCloseTo(80, 2);
    for (const p of f.points) {
      expect(p.p10).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p90);
    }
  });

  it('lifts the near horizon when the current level is elevated, and decays back', () => {
    const rows = synthetic(6, 3, 6); // last 6 hours are 3x normal
    const now = SUNDAY + 6 * WEEK;
    const f = forecast('eth', rows, now, 168, { seasonalStrength: 1, shrinkK: 0, levelTauHours: 48 });
    expect(f.level).toBeCloseTo(3, 2);
    const h1 = f.points[0]!;
    const h150 = f.points[149]!;
    const seasonalH1 = hourOfWeek(h1.ts) === 20 ? 2 : hourOfWeek(h1.ts) === 60 ? 40 : 10;
    const seasonalH150 = hourOfWeek(h150.ts) === 20 ? 2 : hourOfWeek(h150.ts) === 60 ? 40 : 10;
    expect(h1.p50 / seasonalH1).toBeGreaterThan(2.5);
    expect(h150.p50 / seasonalH150).toBeLessThan(1.3);
    expect(h150.p50 / seasonalH150).toBeLessThan(h1.p50 / seasonalH1);
  });

  it('shrinks sparse extreme cells toward the daily profile by default', () => {
    const rows = synthetic(3);
    const now = SUNDAY + 3 * WEEK;
    const f = forecast('eth', rows, now, 168);
    const cheap = f.points.find((p) => hourOfWeek(p.ts) === 20)!;
    expect(cheap.p50).toBeGreaterThan(2);
    expect(cheap.p50).toBeLessThan(10);
    expect(f.seasonalRange).toBeGreaterThan(1);
    expect(f.seasonalRange).toBeLessThan(20);
    for (const p of f.points) expect(p.p10 <= p.p50 && p.p50 <= p.p90).toBe(true);
  });

  it('throws without data', () => {
    expect(() => forecast('eth', [], SUNDAY, 24)).toThrow(/no eth hourly data/);
  });
});

describe('bestWindow', () => {
  it('extends around the minimum while within 10%', () => {
    const pts = [30, 12, 10, 10.5, 11.5, 25].map((p50, i) => ({ ts: SUNDAY + i * HOUR, p10: p50, p50, p90: p50, savingVsNowPct: 0 }));
    const w = bestWindow(pts)!;
    expect(w.minTs).toBe(SUNDAY + 2 * HOUR);
    expect(w.startTs).toBe(SUNDAY + 2 * HOUR);
    expect(w.endTs).toBe(SUNDAY + 4 * HOUR); // includes 10.5, excludes 11.5 and 12
    expect(bestWindow([])).toBeNull();
  });
});
