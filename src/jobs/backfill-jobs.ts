import type { Store } from '../db';
import { CHAINS, type ChainId } from '../chains';
import { reaggregate, syncChain } from './sync';

export interface BackfillJob {
  id: string;
  chain: ChainId;
  days: number;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  added: number;
  failed: number;
  log: string[];
  error: string | null;
}

const jobs = new Map<string, BackfillJob>();

/** Start an in-process backfill. One running job per chain; returns the existing one if present. */
export function startBackfill(store: Store, chain: ChainId, days: number): BackfillJob {
  const existing = [...jobs.values()].find((j) => j.chain === chain && j.state === 'running');
  if (existing) return existing;
  const job: BackfillJob = {
    id: `${chain}-${Date.now()}`,
    chain,
    days,
    state: 'running',
    startedAt: Math.floor(Date.now() / 1000),
    finishedAt: null,
    added: 0,
    failed: 0,
    log: [],
    error: null,
  };
  jobs.set(job.id, job);
  const log = (m: string) => {
    job.log.push(m);
    if (job.log.length > 50) job.log.shift();
  };
  void (async () => {
    try {
      const r = await syncChain(store, chain, days, log);
      job.added = r.added;
      job.failed = r.failed;
      reaggregate(store, chain, r.minTsTouched);
      job.state = 'done';
    } catch (err) {
      job.state = 'failed';
      job.error = `${CHAINS[chain].name}: ${(err as Error).message}`;
    } finally {
      job.finishedAt = Math.floor(Date.now() / 1000);
    }
  })();
  return job;
}

export const listJobs = () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
