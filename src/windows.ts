import { DAY, WEEK } from './time';

export type WindowId = '1w' | '28d' | '3m' | '6m' | '1y' | 'all';
export const WINDOW_IDS: WindowId[] = ['1w', '28d', '3m', '6m', '1y', 'all'];
export const DEFAULT_WINDOW: WindowId = '28d';

const SECONDS: Record<Exclude<WindowId, 'all'>, number> = { '1w': 7 * DAY, '28d': 28 * DAY, '3m': 91 * DAY, '6m': 182 * DAY, '1y': 365 * DAY };

export const isWindowId = (s: string): s is WindowId => (WINDOW_IDS as string[]).includes(s);

export interface WindowRange {
  id: WindowId;
  fromTs: number;
  toTs: number;
  /** Whole weeks covered, at least 1; feeds the seasonal profile. */
  weeks: number;
  /** True when the requested window reaches past the stored data. */
  truncated: boolean;
}

/** Resolve a window to an absolute range, clipped to the data actually stored. */
export function resolveWindow(id: WindowId, nowTs: number, coverageMinTs: number | null): WindowRange {
  const requestedFrom = id === 'all' ? (coverageMinTs ?? nowTs - 28 * DAY) : nowTs - SECONDS[id];
  const fromTs = coverageMinTs == null ? requestedFrom : Math.max(requestedFrom, coverageMinTs);
  const truncated = id !== 'all' && coverageMinTs != null && coverageMinTs > requestedFrom + DAY;
  return { id, fromTs, toTs: nowTs, weeks: Math.max(1, Math.round((nowTs - fromTs) / WEEK)), truncated };
}
