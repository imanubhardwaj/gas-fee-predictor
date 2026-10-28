import type { Store } from '../db';
import { config } from '../config';
import { mapLimit } from '../http';
import { CHAINS, ASSETS, type ChainDef, type ChainId } from '../chains';
import { blockTimestamp, fetchFeeHistoryRange, latestBlockNumber, MAX_FEE_HISTORY } from '../sources/evm';
import { BTC_WINDOWS, fetchBtcFeeRates, fetchBtcRecommended, type BtcWindow } from '../sources/btc';
import { sampleSolFees } from '../sources/sol';
import { fetchDailyPrices, fetchSpotPrices } from '../sources/prices';
import { rebuildHourly } from '../aggregate';
import { dayStart, hourStart, HOUR } from '../time';

export type Log = (msg: string) => void;

export interface SyncResult {
  chunks: number;
  added: number;
  failed: number;
  minTsTouched: number | null;
  head?: number;
}

/**
 * Plan the 1024-block chunks to fetch. Ethereum (300 blocks/hour) is collected contiguously
 * and internal gaps are refilled. Faster chains are sampled: one 1024-block chunk per hour,
 * which is plenty for hourly percentiles and keeps a 28-day backfill at ~700 calls.
 */
export function planEvmChunks(def: ChainDef, latest: number, days: number, store: Store, blocksPerHour = def.blocksPerHour): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  const floor = def.maxHistoryBlocks ? latest - def.maxHistoryBlocks + 1 : 0;
  if (blocksPerHour <= MAX_FEE_HISTORY) {
    const cov = store.evmCoverage(def.id);
    const ranges: Array<[number, number]> = [];
    const target = Math.max(floor, latest - Math.ceil(days * 24 * blocksPerHour));
    if (cov.minNumber == null || cov.maxNumber == null) ranges.push([target, latest]);
    else {
      if (cov.maxNumber < latest) ranges.push([cov.maxNumber + 1, latest]);
      if (days > 0 && target < cov.minNumber) ranges.push([target, cov.minNumber - 1]);
      ranges.push(...store.evmGaps(def.id));
    }
    for (const [a, b] of ranges) for (let s = a; s <= b; s += MAX_FEE_HISTORY) chunks.push([s, Math.min(b, s + MAX_FEE_HISTORY - 1)]);
    return chunks;
  }
  const hours = Math.ceil(days * 24);
  for (let k = 0; k <= hours; k++) {
    const end = latest - k * blocksPerHour;
    const start = end - MAX_FEE_HISTORY + 1;
    if (start < floor) break;
    if (k > 0 && store.hasEvmBlock(def.id, end)) continue;
    chunks.push([start, end]);
  }
  return chunks;
}

const measuredRate = new Map<string, { at: number; blocksPerHour: number }>();

/**
 * Block rates drift (BNB and Polygon both sped up in 2025–26), and a wrong rate makes the hourly
 * sampling stride skip or double up hours. Measure it from two headers ~20k blocks apart, once an hour.
 */
export async function measureBlocksPerHour(def: ChainDef, latest: number): Promise<number> {
  const cached = measuredRate.get(def.id);
  const now = Date.now();
  if (cached && now - cached.at < 3600_000) return cached.blocksPerHour;
  try {
    const span = Math.min(20_000, def.maxHistoryBlocks ? def.maxHistoryBlocks - 100 : 20_000);
    const [tsNew, tsOld] = await Promise.all([blockTimestamp(def, latest), blockTimestamp(def, latest - span)]);
    const rate = (span / Math.max(1, tsNew - tsOld)) * 3600;
    const blocksPerHour = Number.isFinite(rate) && rate > 0 ? Math.round(rate) : def.blocksPerHour;
    measuredRate.set(def.id, { at: now, blocksPerHour });
    return blocksPerHour;
  } catch {
    return def.blocksPerHour;
  }
}

export async function syncEvm(store: Store, def: ChainDef, days: number, log?: Log): Promise<SyncResult> {
  const latest = await latestBlockNumber(def);
  const blocksPerHour = def.blocksPerHour > MAX_FEE_HISTORY ? await measureBlocksPerHour(def, latest) : def.blocksPerHour;
  if (log && blocksPerHour !== def.blocksPerHour) log(`${def.id}: measured ${blocksPerHour} blocks/hour (registry says ${def.blocksPerHour})`);
  const chunks = planEvmChunks(def, latest, days, store, blocksPerHour);
  let added = 0;
  let failed = 0;
  let done = 0;
  let minTsTouched: number | null = null;
  await mapLimit(chunks, config.rpcConcurrency, async ([a, b]) => {
    try {
      const rows = await fetchFeeHistoryRange(def, a, b);
      store.upsertEvmBlocks(def.id, rows);
      added += rows.length;
      for (const r of rows) if (minTsTouched == null || r.ts < minTsTouched) minTsTouched = r.ts;
    } catch (err) {
      failed++;
      log?.(`${def.id}: chunk ${a}-${b} failed, will retry next sync: ${(err as Error).message}`);
    }
    done++;
    if (log && (done % 25 === 0 || done === chunks.length)) log(`${def.id}: ${done}/${chunks.length} chunks, ${added} blocks, ${failed} failed`);
  });
  return { head: latest, chunks: chunks.length, added, failed, minTsTouched };
}

export async function syncBtc(store: Store, windows: BtcWindow[] = BTC_WINDOWS, log?: Log): Promise<SyncResult> {
  let added = 0;
  let failed = 0;
  let minTsTouched: number | null = null;
  for (const w of windows) {
    try {
      const rows = await fetchBtcFeeRates(w);
      store.upsertBtcRows(rows);
      added += rows.length;
      for (const r of rows) if (minTsTouched == null || r.ts < minTsTouched) minTsTouched = r.ts;
      log?.(`btc: window ${w} -> ${rows.length} rows`);
    } catch (err) {
      failed++;
      log?.(`btc: window ${w} failed: ${(err as Error).message}`);
    }
  }
  const rec = await fetchBtcRecommended();
  store.putSnapshot('btc_recommended', Math.floor(Date.now() / 1000), rec);
  return { chunks: windows.length, added, failed, minTsTouched };
}

export async function syncSol(store: Store, log?: Log): Promise<SyncResult> {
  const sample = await sampleSolFees(CHAINS.sol);
  store.upsertSolSamples([sample]);
  log?.(`sol: slot ${sample.slot} p50 ${sample.p50} µL/CU over ${sample.n} slots`);
  return { chunks: 1, added: 1, failed: 0, minTsTouched: sample.ts };
}

/** Dispatch by chain kind. `days` only matters for EVM chains. */
export function syncChain(store: Store, chain: ChainId, days: number, log?: Log): Promise<SyncResult> {
  const def = CHAINS[chain];
  if (def.kind === 'evm') return syncEvm(store, def, days, log);
  if (def.kind === 'btc') return syncBtc(store, days > 0 ? BTC_WINDOWS : ['24h'], log);
  return syncSol(store, log);
}

export async function syncPrices(store: Store, days = 365, log?: Log): Promise<void> {
  for (const asset of ASSETS) {
    try {
      const rows = await fetchDailyPrices(asset, days);
      store.upsertPrices(asset, rows);
      log?.(`prices: ${asset} ${rows.length} days`);
    } catch (err) {
      log?.(`prices: ${asset} failed: ${(err as Error).message}`);
    }
  }
  await syncSpot(store);
}

export async function syncSpot(store: Store): Promise<void> {
  const spot = await fetchSpotPrices();
  const now = Math.floor(Date.now() / 1000);
  for (const asset of ASSETS) {
    const usd = spot[asset];
    if (usd == null) continue;
    store.upsertPrices(asset, [{ day: dayStart(now), usd }]);
    store.putSnapshot(`${asset}_spot`, now, { usd });
  }
}

/** Re-aggregate the hours a sync touched, with an hour of slack either side. */
export function reaggregate(store: Store, chain: ChainId, minTsTouched: number | null, nowTs = Math.floor(Date.now() / 1000)): number {
  if (minTsTouched == null) return 0;
  return rebuildHourly(store, chain, hourStart(minTsTouched) - HOUR, hourStart(nowTs) + 2 * HOUR);
}
