import { Store } from '../db';
import { CHAIN_IDS, CHAINS, isChainId, type ChainId } from '../chains';
import { syncChain, syncPrices, reaggregate } from '../jobs/sync';
import { parseArgs, num } from './args';

const args = parseArgs(process.argv.slice(2));
const days = num(args.days ?? args['eth-days'], 28);
const chainsArg = typeof args.chains === 'string' ? args.chains : 'all';
const chains: ChainId[] = chainsArg === 'all' ? CHAIN_IDS : chainsArg.split(',').map((s) => s.trim()).filter(isChainId);
const skipPrices = args['no-prices'] === true;
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const store = new Store();
const t0 = Date.now();
try {
  for (const chain of chains) {
    const def = CHAINS[chain];
    log(`${chain}: syncing ${def.kind === 'evm' ? `${days} days` : def.kind === 'btc' ? 'all mempool.space windows' : 'one live sample'}`);
    try {
      const r = await syncChain(store, chain, days, log);
      const hours = reaggregate(store, chain, r.minTsTouched);
      log(`${chain}: ${r.added} rows added in ${r.chunks} chunks (${r.failed} failed), ${hours} hourly rows rebuilt`);
    } catch (err) {
      log(`${chain}: FAILED ${(err as Error).message}`);
    }
  }
  if (!skipPrices) await syncPrices(store, 365, log);
  const fmt = (ts: number | null) => (ts == null ? '-' : new Date(ts * 1000).toISOString().slice(0, 16));
  for (const chain of chains) {
    const h = store.hourlyCoverage(chain);
    log(`coverage ${chain.padEnd(8)} hourly rows ${String(h.count).padStart(5)}  ${fmt(h.minTs)} → ${fmt(h.maxTs)}`);
  }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} finally {
  store.close();
}
