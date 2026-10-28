import { config } from '../config';
import { fetchJson } from '../http';
import type { BtcFeeRow } from '../db';

export type BtcWindow = '24h' | '3d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y';
/** Longest first so finer windows overwrite the block-averaged rows where they overlap. */
export const BTC_WINDOWS: BtcWindow[] = ['3y', '2y', '1y', '6m', '3m', '1m', '1w', '3d', '24h'];

interface MempoolFeeRateRow {
  avgHeight: number;
  timestamp: number;
  avgFee_10: number;
  avgFee_25: number;
  avgFee_50: number;
  avgFee_75: number;
  avgFee_90: number;
}

export interface BtcRecommended {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export async function fetchBtcFeeRates(window: BtcWindow): Promise<BtcFeeRow[]> {
  const rows = await fetchJson<MempoolFeeRateRow[]>(`${config.mempoolBase}/v1/mining/blocks/fee-rates/${window}`);
  return rows.map((r) => ({ ts: r.timestamp, avgHeight: r.avgHeight, p10: r.avgFee_10, p25: r.avgFee_25, p50: r.avgFee_50, p75: r.avgFee_75, p90: r.avgFee_90 }));
}

export const fetchBtcRecommended = () => fetchJson<BtcRecommended>(`${config.mempoolBase}/v1/fees/recommended`);
