import type { HourlyRow } from './db';
import type { WalletTx } from './sources/txs';
import { median } from './stats';
import { dayStart, hourStart, hourOfWeek, labelHow, DAY, HOUR } from './time';

export interface OverpaidInput {
  address: string;
  txs: readonly WalletTx[];
  /** EVM hourly rows (gwei) covering the tx window plus `waitHours` after the last tx. */
  hourly: readonly HourlyRow[];
  /** Native asset USD price by UTC day start. */
  prices: ReadonlyMap<number, number>;
  /** How long the user could plausibly have waited. */
  waitHours?: number;
  /** Required share of hours present in the wait window for a tx to count. */
  minCoverage?: number;
}

export interface OverpaidTx {
  hash: string;
  ts: number;
  paidEth: number;
  paidUsd: number | null;
  /** Cheapest hourly median (base + tip) within the wait window, gwei. */
  bestGwei: number;
  bestTs: number;
  /** Effective price actually paid, gwei. */
  paidGwei: number;
  savingEth: number;
  savingUsd: number | null;
}

export interface OverpaidReport {
  address: string;
  waitHours: number;
  txCount: number;
  coveredCount: number;
  pricedCount: number;
  paidEth: number;
  paidUsd: number | null;
  overpaidEth: number;
  overpaidUsd: number | null;
  /** overpaidEth / paidEth over covered txs. */
  overpaidPct: number | null;
  worst: OverpaidTx | null;
  /** Up to five transactions with the largest saving, largest first. */
  topTxs: OverpaidTx[];
  habit: { how: number; label: string; count: number; indexVsMedian: number | null } | null;
  coverage: { fromTs: number | null; toTs: number | null };
}

function priceOn(prices: ReadonlyMap<number, number>, ts: number): number | null {
  const d = dayStart(ts);
  for (let k = 0; k <= 3; k++) {
    const a = prices.get(d - k * DAY);
    if (a != null) return a;
    const b = prices.get(d + k * DAY);
    if (b != null) return b;
  }
  return null;
}

/** Pure computation so it can be unit-tested without network or DB. */
export function computeOverpaid(input: OverpaidInput): OverpaidReport {
  const waitHours = input.waitHours ?? 24;
  const minCoverage = input.minCoverage ?? 0.5;
  const cheapByHour = new Map<number, number>();
  for (const r of input.hourly) cheapByHour.set(r.ts, r.p50 + (r.tipP50 ?? 0));
  const hourlyTs = input.hourly.map((r) => r.ts);

  const details: OverpaidTx[] = [];
  const habitCounts = new Array<number>(168).fill(0);
  let paidEth = 0;
  let paidUsd = 0;
  let overpaidEth = 0;
  let overpaidUsd = 0;
  let pricedCount = 0;

  for (const tx of input.txs) {
    habitCounts[hourOfWeek(tx.ts)] = (habitCounts[hourOfWeek(tx.ts)] as number) + 1;
    const h0 = hourStart(tx.ts);
    let best = Infinity;
    let bestTs = h0;
    let present = 0;
    for (let h = h0; h <= h0 + waitHours * HOUR; h += HOUR) {
      const v = cheapByHour.get(h);
      if (v == null) continue;
      present++;
      if (v < best) {
        best = v;
        bestTs = h;
      }
    }
    if (present < Math.ceil((waitHours + 1) * minCoverage)) continue;

    const gasUsed = Number(tx.gasUsed);
    const paid = Number(tx.gasUsed * tx.gasPrice) / 1e18;
    const counterfactual = (gasUsed * best) / 1e9;
    const saving = Math.max(0, paid - counterfactual);
    const price = priceOn(input.prices, tx.ts);
    const row: OverpaidTx = {
      hash: tx.hash,
      ts: tx.ts,
      paidEth: paid,
      paidUsd: price == null ? null : paid * price,
      bestGwei: best,
      bestTs,
      paidGwei: Number(tx.gasPrice) / 1e9,
      savingEth: saving,
      savingUsd: price == null ? null : saving * price,
    };
    details.push(row);
    paidEth += paid;
    overpaidEth += saving;
    if (price != null) {
      pricedCount++;
      paidUsd += row.paidUsd as number;
      overpaidUsd += row.savingUsd as number;
    }
  }

  let worst: OverpaidTx | null = null;
  for (const d of details) if (!worst || d.savingEth > worst.savingEth) worst = d;

  let habit: OverpaidReport['habit'] = null;
  if (input.txs.length > 0) {
    let how = 0;
    for (let k = 1; k < 168; k++) if ((habitCounts[k] as number) > (habitCounts[how] as number)) how = k;
    const cellVals = input.hourly.filter((r) => hourOfWeek(r.ts) === how).map((r) => r.p50);
    const all = input.hourly.map((r) => r.p50);
    const idx = cellVals.length && all.length ? median(cellVals) / median(all) : null;
    habit = { how, label: labelHow(how), count: habitCounts[how] as number, indexVsMedian: idx };
  }

  return {
    address: input.address.toLowerCase(),
    waitHours,
    txCount: input.txs.length,
    coveredCount: details.length,
    pricedCount,
    paidEth,
    paidUsd: pricedCount ? paidUsd : null,
    overpaidEth,
    overpaidUsd: pricedCount ? overpaidUsd : null,
    overpaidPct: paidEth > 0 ? overpaidEth / paidEth : null,
    worst,
    topTxs: [...details].sort((a, b) => b.savingEth - a.savingEth).slice(0, 5),
    habit,
    coverage: { fromTs: hourlyTs.length ? Math.min(...hourlyTs) : null, toTs: hourlyTs.length ? Math.max(...hourlyTs) + HOUR : null },
  };
}
