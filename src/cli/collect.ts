import { Store } from '../db';
import { CHAIN_IDS, isChainId, type ChainId } from '../chains';
import { syncChain, syncSpot, reaggregate } from '../jobs/sync';
import { parseArgs, num } from './args';
import { sleep } from '../http';

const args = parseArgs(process.argv.slice(2));
const intervalSec = num(args.interval, 60);
const chainsArg = typeof args.chains === 'string' ? args.chains : 'all';
const chains: ChainId[] = chainsArg === 'all' ? CHAIN_IDS : chainsArg.split(',').map((s) => s.trim()).filter(isChainId);
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const store = new Store();
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
  log('stopping after current tick');
});

let tick = 0;
while (!stopping) {
  const started = Date.now();
  await Promise.all(
    chains.map(async (chain) => {
      try {
        const r = await syncChain(store, chain, 0);
        const hours = reaggregate(store, chain, r.minTsTouched);
        log(`${chain}: +${r.added} rows${r.head ? ` (head ${r.head})` : ''}, ${hours} hourly rows refreshed`);
      } catch (err) {
        log(`${chain}: ${(err as Error).message}`);
      }
    }),
  );
  if (tick % 10 === 0) {
    try {
      await syncSpot(store);
      log('prices: spot refreshed');
    } catch (err) {
      log(`prices: ${(err as Error).message}`);
    }
  }
  tick++;
  const wait = Math.max(0, intervalSec * 1000 - (Date.now() - started));
  if (!stopping) await sleep(wait);
}
store.close();
