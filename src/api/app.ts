import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Store } from '../db';
import { CHAINS, CHAIN_IDS, isChainId, simpleTxNative, ASSET_SYMBOL, type ChainId } from '../chains';
import { buildHeatmap } from '../aggregate';
import { forecast } from '../forecast';
import { computeOverpaid } from '../overpaid';
import { fetchSentTxs } from '../sources/txs';
import type { BtcRecommended } from '../sources/btc';
import { ensureFresh, lastSyncedAt } from '../jobs/refresh';
import { listJobs, startBackfill } from '../jobs/backfill-jobs';
import { DEFAULT_WINDOW, isWindowId, resolveWindow, WINDOW_IDS, type WindowId } from '../windows';
import { dayStart, DAY, HOUR, WEEK } from '../time';

const now = () => Math.floor(Date.now() / 1000);

class TtlCache {
  private m = new Map<string, { exp: number; v: unknown }>();
  get<T>(k: string): T | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.m.delete(k);
      return undefined;
    }
    return e.v as T;
  }
  set(k: string, v: unknown, ttlMs: number) {
    this.m.set(k, { exp: Date.now() + ttlMs, v });
  }
}

export interface CreateAppOptions {
  /** Sync the chain head before answering now/forecast/heatmap (default true). */
  refreshOnRequest?: boolean;
}

function coverageFor(store: Store, chain: ChainId) {
  const def = CHAINS[chain];
  const raw = def.kind === 'evm' ? store.evmCoverage(chain) : def.kind === 'btc' ? store.btcCoverage() : store.solCoverage();
  return { raw, hourly: store.hourlyCoverage(chain) };
}

export function createApp(store: Store, opts: CreateAppOptions = {}) {
  const refreshOnRequest = opts.refreshOnRequest ?? true;
  const app = new Hono();
  const cache = new TtlCache();
  app.use('*', cors());

  const parseChain = (s: string): ChainId | null => (isChainId(s) ? s : null);
  const parseWindow = (s: string | undefined): WindowId => (s && isWindowId(s) ? s : DEFAULT_WINDOW);
  const wantRefresh = (q: string | undefined) => refreshOnRequest && q !== '0' && q !== 'false';

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/v1/chains', (c) =>
    c.json({
      windows: WINDOW_IDS,
      defaultWindow: DEFAULT_WINDOW,
      chains: CHAIN_IDS.map((id) => {
        const def = CHAINS[id];
        const cov = coverageFor(store, id);
        return {
          id,
          name: def.name,
          kind: def.kind,
          unit: def.unit,
          unitShort: def.unitShort,
          asset: def.asset,
          assetSymbol: ASSET_SYMBOL[def.asset],
          simpleTx: def.simpleTx,
          note: def.note ?? null,
          walletSupported: Boolean(def.blockscout),
          explorerTx: def.explorerTx,
          coverage: cov.hourly,
          rawCount: cov.raw.count,
          lastSyncedAt: lastSyncedAt(id),
        };
      }),
    }),
  );

  app.get('/v1/status', (c) => {
    const out: Record<string, unknown> = {};
    for (const id of CHAIN_IDS) out[id] = { ...coverageFor(store, id), lastSyncedAt: lastSyncedAt(id) };
    return c.json({ chains: out, prices: Object.fromEntries(CHAIN_IDS.map((id) => [CHAINS[id].asset, store.latestSnapshot(`${CHAINS[id].asset}_spot`)])), jobs: listJobs() });
  });

  app.get('/v1/:chain/now', async (c) => {
    const chain = parseChain(c.req.param('chain'));
    if (!chain) return c.json({ error: `chain must be one of ${CHAIN_IDS.join(', ')}` }, 400);
    const def = CHAINS[chain];
    const fresh = wantRefresh(c.req.query('refresh')) ? await ensureFresh(store, chain) : null;
    const spot = store.latestSnapshot<{ usd: number }>(`${def.asset}_spot`)?.payload.usd ?? store.latestPrice(def.asset)?.usd ?? null;
    const t = now();
    const recentHours = store.getHourly(chain, t - 48 * HOUR, t + HOUR);
    const lastHour = recentHours.at(-1) ?? null;
    const base = { chain, name: def.name, unit: def.unit, unitShort: def.unitShort, assetSymbol: ASSET_SYMBOL[def.asset], usd: spot, fresh, lastHour, note: def.note ?? null };

    if (def.kind === 'evm') {
      const b = store.latestEvmBlock(chain);
      if (!b) return c.json({ ...base, error: 'no data yet; run a backfill' }, 503);
      const tipValue = b.tipP50 / 1e9;
      const feeValue = (b.baseFee + (def.evmSeries === 'base_plus_tip' ? b.tipP50 : 0)) / 1e9;
      const native = simpleTxNative(def, feeValue, tipValue);
      return c.json({ ...base, asOf: b.ts, block: b.number, value: feeValue, tip: tipValue, simpleTx: { ...def.simpleTx, native, usd: spot == null ? null : native * spot } });
    }
    if (def.kind === 'btc') {
      const rec = store.latestSnapshot<BtcRecommended>('btc_recommended');
      if (!rec) return c.json({ ...base, error: 'no data yet; run a backfill' }, 503);
      const native = simpleTxNative(def, rec.payload.halfHourFee);
      return c.json({ ...base, asOf: rec.ts, value: rec.payload.halfHourFee, recommended: rec.payload, simpleTx: { ...def.simpleTx, native, usd: spot == null ? null : native * spot } });
    }
    const s = store.latestSolSample();
    if (!s) return c.json({ ...base, error: 'no data yet; the collector samples Solana live' }, 503);
    const native = simpleTxNative(def, s.p50);
    return c.json({ ...base, asOf: s.ts, slot: s.slot, value: s.p50, p90: s.p90, simpleTx: { ...def.simpleTx, native, usd: spot == null ? null : native * spot } });
  });

  app.get('/v1/:chain/history', (c) => {
    const chain = parseChain(c.req.param('chain'));
    if (!chain) return c.json({ error: 'unknown chain' }, 400);
    const t = now();
    const w = resolveWindow(parseWindow(c.req.query('window')), t, store.hourlyCoverage(chain).minTs);
    return c.json({ chain, unit: CHAINS[chain].unit, window: w, rows: store.getHourly(chain, w.fromTs, w.toTs + HOUR) });
  });

  app.get('/v1/:chain/heatmap', async (c) => {
    const chain = parseChain(c.req.param('chain'));
    if (!chain) return c.json({ error: 'unknown chain' }, 400);
    if (wantRefresh(c.req.query('refresh'))) await ensureFresh(store, chain);
    const t = now();
    const w = resolveWindow(parseWindow(c.req.query('window')), t, store.hourlyCoverage(chain).minTs);
    const key = `heatmap:${chain}:${w.id}:${Math.floor(t / 60)}`;
    const hit = cache.get(key);
    if (hit) return c.json(hit);
    const out = { ...buildHeatmap(chain, store.getHourly(chain, w.fromTs, t), t, w.weeks), window: w };
    cache.set(key, out, 60_000);
    return c.json(out);
  });

  app.get('/v1/:chain/forecast', async (c) => {
    const chain = parseChain(c.req.param('chain'));
    if (!chain) return c.json({ error: 'unknown chain' }, 400);
    const hours = Math.min(336, Math.max(1, Number(c.req.query('hours') ?? 168)));
    const fresh = wantRefresh(c.req.query('refresh')) ? await ensureFresh(store, chain) : null;
    const t = now();
    const w = resolveWindow(parseWindow(c.req.query('window')), t, store.hourlyCoverage(chain).minTs);
    try {
      const out = { ...forecast(chain, store.getHourly(chain, w.fromTs, t), t, hours, { weeks: w.weeks }), window: w, fresh };
      return c.json(out);
    } catch (err) {
      return c.json({ error: (err as Error).message, window: w, fresh }, 503);
    }
  });

  app.get('/v1/:chain/wallet/:address/overpaid', async (c) => {
    const chain = parseChain(c.req.param('chain'));
    if (!chain) return c.json({ error: 'unknown chain' }, 400);
    const def = CHAINS[chain];
    if (!def.blockscout) return c.json({ error: `wallet analysis is not available for ${def.name}` }, 400);
    const address = c.req.param('address');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: 'address must be a 0x-prefixed 20-byte hex string' }, 400);
    const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 365)));
    const waitHours = Math.min(168, Math.max(1, Number(c.req.query('wait') ?? 24)));
    const key = `overpaid:${chain}:${address.toLowerCase()}:${days}:${waitHours}`;
    const hit = cache.get(key);
    if (hit) return c.json(hit);
    const t = now();
    const cov = store.hourlyCoverage(chain);
    const fromTs = Math.max(t - days * DAY, cov.minTs ?? 0);
    try {
      const { txs, lastSentTs } = await fetchSentTxs(def.blockscout, address, fromTs);
      const hourly = store.getHourly(chain, fromTs - HOUR, t + HOUR);
      const prices = store.getPrices(def.asset, dayStart(fromTs) - DAY, dayStart(t) + DAY);
      const out = {
        ...computeOverpaid({ address, txs, hourly, prices, waitHours }),
        chain,
        chainName: def.name,
        assetSymbol: ASSET_SYMBOL[def.asset],
        explorerTx: def.explorerTx,
        explorerAddress: def.explorerTx.replace(/\/tx\/$/, '/address/'),
        requestedDays: days,
        dataFromTs: fromTs,
        lastSentTs,
      };
      cache.set(key, out, 5 * 60_000);
      return c.json(out);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post('/v1/:chain/backfill', (c) => {
    const chain = parseChain(c.req.param('chain'));
    if (!chain) return c.json({ error: 'unknown chain' }, 400);
    const days = Math.min(400, Math.max(1, Number(c.req.query('days') ?? 28)));
    return c.json(startBackfill(store, chain, days), 202);
  });

  app.get('/v1/jobs', (c) => c.json(listJobs()));

  return app;
}

export { WEEK };
