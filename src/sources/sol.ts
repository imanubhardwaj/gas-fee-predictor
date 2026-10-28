import { fetchJson } from '../http';
import type { ChainDef } from '../chains';
import type { SolSampleRow } from '../db';
import { quantile } from '../stats';

/** Hot accounts whose write-locks are contended most of the time: Jupiter v6 and Raydium AMM v4. */
export const SOL_HOT_ACCOUNTS = ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'];

interface PrioritizationFee {
  slot: number;
  prioritizationFee: number; // micro-lamports per compute unit
}

const cursors = new Map<string, number>();

async function solRpc<T>(def: ChainDef, method: string, params: unknown[]): Promise<T> {
  const urls = def.rpcUrls;
  const start = cursors.get(def.id) ?? 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    const idx = (start + attempt) % urls.length;
    const url = urls[idx] as string;
    try {
      const res = await fetchJson<{ result?: T; error?: { message: string } }>(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) },
        { retries: 1, timeoutMs: 15_000 },
      );
      if (res.error) throw new Error(`${def.id} ${method} via ${url}: ${res.error.message}`);
      if (res.result == null) throw new Error(`${def.id} ${method} via ${url}: empty result`);
      cursors.set(def.id, idx);
      return res.result;
    } catch (err) {
      lastErr = err;
    }
  }
  cursors.set(def.id, (start + 1) % urls.length);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** One sample of the last ~150 slots (about a minute) of priority fees on contended accounts. */
export async function sampleSolFees(def: ChainDef, nowTs = Math.floor(Date.now() / 1000)): Promise<SolSampleRow> {
  const fees = await solRpc<PrioritizationFee[]>(def, 'getRecentPrioritizationFees', [SOL_HOT_ACCOUNTS]);
  const values = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const slot = fees.reduce((m, f) => Math.max(m, f.slot), 0);
  return { ts: nowTs, slot, p10: quantile(values, 0.1), p50: quantile(values, 0.5), p90: quantile(values, 0.9), n: values.length };
}
