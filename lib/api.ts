import type { Heatmap } from '@/src/aggregate';
import type { Forecast } from '@/src/forecast';
import type { HourlyRow } from '@/src/db';
import type { OverpaidReport } from '@/src/overpaid';
import type { Freshness } from '@/src/jobs/refresh';
import type { BackfillJob } from '@/src/jobs/backfill-jobs';
import type { WindowId, WindowRange } from '@/src/windows';
import type { ChainId, ChainKind } from '@/src/chains';

export type { ChainId, WindowId, Heatmap, Forecast, HourlyRow, OverpaidReport, Freshness, BackfillJob, WindowRange };

export interface ChainInfo {
  id: ChainId;
  name: string;
  kind: ChainKind;
  unit: string;
  unitShort: string;
  asset: string;
  assetSymbol: string;
  simpleTx: { label: string; gas: number };
  note: string | null;
  walletSupported: boolean;
  explorerTx: string;
  coverage: { count: number; minTs: number | null; maxTs: number | null };
  rawCount: number;
  lastSyncedAt: number | null;
}

export interface ChainsResponse {
  windows: WindowId[];
  defaultWindow: WindowId;
  chains: ChainInfo[];
}

export interface NowResponse {
  chain: ChainId;
  name: string;
  unit: string;
  unitShort: string;
  assetSymbol: string;
  usd: number | null;
  fresh: Freshness | null;
  lastHour: HourlyRow | null;
  note: string | null;
  asOf?: number;
  block?: number;
  slot?: number;
  value?: number;
  tip?: number;
  p90?: number;
  recommended?: { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number };
  simpleTx?: { label: string; gas: number; native: number; usd: number | null };
  error?: string;
}

export type ForecastResponse = Forecast & { window: WindowRange; fresh: Freshness | null };
export type HeatmapResponse = Heatmap & { window: WindowRange };
export interface HistoryResponse {
  chain: ChainId;
  unit: string;
  window: WindowRange;
  rows: HourlyRow[];
}
export type OverpaidResponse = OverpaidReport & {
  chain: ChainId;
  chainName: string;
  assetSymbol: string;
  explorerTx: string;
  explorerAddress: string;
  requestedDays: number;
  dataFromTs: number;
  lastSentTs: number | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { cache: 'no-store', ...init });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  return body as T;
}

export const api = {
  chains: () => getJson<ChainsResponse>('/v1/chains'),
  now: (chain: ChainId) => getJson<NowResponse>(`/v1/${chain}/now`),
  forecast: (chain: ChainId, window: WindowId) => getJson<ForecastResponse>(`/v1/${chain}/forecast?window=${window}`),
  heatmap: (chain: ChainId, window: WindowId) => getJson<HeatmapResponse>(`/v1/${chain}/heatmap?window=${window}&refresh=0`),
  history: (chain: ChainId, window: WindowId) => getJson<HistoryResponse>(`/v1/${chain}/history?window=${window}`),
  overpaid: (chain: ChainId, address: string, wait = 24) => getJson<OverpaidResponse>(`/v1/${chain}/wallet/${address}/overpaid?wait=${wait}`),
  backfill: (chain: ChainId, days: number) => getJson<BackfillJob>(`/v1/${chain}/backfill?days=${days}`, { method: 'POST' }),
  jobs: () => getJson<BackfillJob[]>('/v1/jobs'),
};

// ---- formatting ----

export function fmtFee(v: number | null | undefined, unitShort: string): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 2 : v >= 0.01 ? 3 : 4;
  return `${v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: v < 1 && v > 0 ? Math.min(digits, 2) : 0 })} ${unitShort}`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function fmtNative(v: number | null | undefined, symbol: string): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const digits = v >= 1 ? 4 : v >= 0.001 ? 6 : 8;
  return `${v.toFixed(digits)} ${symbol}`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${v > 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}%`.replace('−', '-');
}

export function fmtAgo(ts: number | null | undefined, nowMs = Date.now()): string {
  if (ts == null) return 'never';
  const s = Math.max(0, Math.round(nowMs / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtHourLocal(ts: number): string {
  const d = new Date(ts * 1000);
  return `${DOW[d.getDay()]} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateShort(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function fmtWindowRange(startTs: number, endTs: number): string {
  const a = new Date(startTs * 1000);
  const b = new Date(endTs * 1000);
  const sameDay = a.toDateString() === b.toDateString();
  const mer = (d: Date) => (d.getHours() < 12 ? 'AM' : 'PM');
  const hm = (d: Date) => {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes();
    return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
  };
  if (sameDay) {
    return mer(a) === mer(b) ? `${DOW[a.getDay()]} ${hm(a)}–${hm(b)} ${mer(b)}` : `${DOW[a.getDay()]} ${hm(a)} ${mer(a)}–${hm(b)} ${mer(b)}`;
  }
  return `${DOW[a.getDay()]} ${hm(a)} ${mer(a)} – ${DOW[b.getDay()]} ${hm(b)} ${mer(b)}`;
}

export const WINDOW_LABEL: Record<WindowId, string> = { '1w': '1W', '28d': '28D', '3m': '3M', '6m': '6M', '1y': '1Y', all: 'All' };
