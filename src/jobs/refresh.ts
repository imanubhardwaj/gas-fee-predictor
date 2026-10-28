import type { Store } from '../db';
import { CHAINS, type ChainId } from '../chains';
import { reaggregate, syncChain, syncSpot } from './sync';

export interface Freshness {
  chain: ChainId;
  /** True when this request triggered a sync that completed. */
  refreshed: boolean;
  /** Unix seconds of the last successful sync for the chain in this process. */
  syncedAt: number | null;
  error: string | null;
}

const lastSync = new Map<string, number>();
const inflight = new Map<string, Promise<Freshness>>();
let lastSpot = 0;

/**
 * Sync the chain head before answering, so "now" and the forecast level reflect the current
 * block rather than the collector's last tick. Concurrent requests share one sync, and a
 * sync younger than `maxAgeSec` is reused. Failures are reported, never thrown: the stored
 * data is still served, flagged as stale.
 */
export function ensureFresh(store: Store, chain: ChainId, maxAgeSec = 30): Promise<Freshness> {
  const now = Math.floor(Date.now() / 1000);
  const last = lastSync.get(chain) ?? null;
  if (last != null && now - last < maxAgeSec) return Promise.resolve({ chain, refreshed: false, syncedAt: last, error: null });
  const running = inflight.get(chain);
  if (running) return running;
  const p = (async (): Promise<Freshness> => {
    try {
      const r = await syncChain(store, chain, 0);
      reaggregate(store, chain, r.minTsTouched);
      const at = Math.floor(Date.now() / 1000);
      lastSync.set(chain, at);
      if (at - lastSpot > 600) {
        lastSpot = at;
        await syncSpot(store).catch(() => undefined);
      }
      return { chain, refreshed: true, syncedAt: at, error: null };
    } catch (err) {
      return { chain, refreshed: false, syncedAt: last, error: `${CHAINS[chain].name}: ${(err as Error).message}` };
    } finally {
      inflight.delete(chain);
    }
  })();
  inflight.set(chain, p);
  return p;
}

export const lastSyncedAt = (chain: ChainId) => lastSync.get(chain) ?? null;
