import { describe, expect, it } from 'vitest';
import { computeOverpaid } from '../src/overpaid';
import { dayStart, HOUR } from '../src/time';
import type { HourlyRow } from '../src/db';
import type { WalletTx } from '../src/sources/txs';

const SUNDAY = 1_760_832_000;
const ADDR = '0xAbC0000000000000000000000000000000000001';

function hourly(prices: number[]): HourlyRow[] {
  return prices.map((p50, i) => ({ chain: 'eth', ts: SUNDAY + i * HOUR, p10: p50, p50, p90: p50, tipP50: 1, n: 300 }));
}

const tx = (ts: number, gasPriceGwei: number, gasUsed = 100_000): WalletTx => ({
  hash: `0x${ts.toString(16)}`,
  ts,
  blockNumber: 1,
  from: ADDR.toLowerCase(),
  to: null,
  gasUsed: BigInt(gasUsed),
  gasPrice: BigInt(Math.round(gasPriceGwei * 1e9)),
  isError: false,
});

describe('computeOverpaid', () => {
  it('compares what was paid with the cheapest hourly median inside the wait window', () => {
    // hour 0: 20 gwei base, hour 3: 4 gwei base (cheapest), later hours 20. tip 1 everywhere.
    const rows = hourly([20, 20, 20, 4, 20, 20, 20, 20, 20, 20, 20, 20, 20]);
    const prices = new Map([[dayStart(SUNDAY), 2000]]);
    const r = computeOverpaid({ address: ADDR, txs: [tx(SUNDAY + 600, 21)], hourly: rows, prices, waitHours: 12 });
    expect(r.txCount).toBe(1);
    expect(r.coveredCount).toBe(1);
    // paid 100k gas * 21 gwei = 0.0021 ETH; cheapest 5 gwei → 0.0005 ETH; saving 0.0016 ETH = $3.20
    expect(r.paidEth).toBeCloseTo(0.0021, 9);
    expect(r.overpaidEth).toBeCloseTo(0.0016, 9);
    expect(r.overpaidUsd).toBeCloseTo(3.2, 6);
    expect(r.overpaidPct).toBeCloseTo(0.0016 / 0.0021, 6);
    expect(r.worst!.bestTs).toBe(SUNDAY + 3 * HOUR);
    expect(r.worst!.bestGwei).toBe(5);
    expect(r.habit!.how).toBe(0);
  });

  it('never reports negative savings and skips txs without enough coverage', () => {
    const rows = hourly([20, 20]);
    const prices = new Map<number, number>();
    const cheapTx = tx(SUNDAY + 60, 5); // paid below the median: saving 0
    const r = computeOverpaid({ address: ADDR, txs: [cheapTx], hourly: rows, prices, waitHours: 1 });
    expect(r.coveredCount).toBe(1);
    expect(r.overpaidEth).toBe(0);
    expect(r.paidUsd).toBeNull();
    const r2 = computeOverpaid({ address: ADDR, txs: [cheapTx], hourly: rows, prices, waitHours: 24 });
    expect(r2.coveredCount).toBe(0);
    expect(r2.overpaidPct).toBeNull();
  });

  it('uses the nearest available daily price', () => {
    const rows = hourly([10, 10]);
    const prices = new Map([[dayStart(SUNDAY) + 2 * 86400, 1000]]);
    const r = computeOverpaid({ address: ADDR, txs: [tx(SUNDAY, 12)], hourly: rows, prices, waitHours: 1 });
    expect(r.pricedCount).toBe(1);
    expect(r.paidUsd).toBeCloseTo(0.0012 * 1000, 6);
  });
});
