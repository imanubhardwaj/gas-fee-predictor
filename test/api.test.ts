import { describe, expect, it } from 'vitest';
import { Store } from '../src/db';
import { createApp } from '../src/api/app';
import { rebuildHourly } from '../src/aggregate';
import { HOUR } from '../src/time';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();

describe('api', () => {
  it('serves status, now, heatmap and forecast from an in-memory store', async () => {
    const store = new Store(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const start = now - 3 * 7 * 86400;
    const blocks = [];
    let n = 1_000_000;
    for (let ts = start; ts < now; ts += 600) blocks.push({ number: n++, ts, baseFee: 1.5e9, tipP10: 1e8, tipP50: 1e9, tipP90: 5e9, gasUsedRatio: 0.5 });
    store.upsertEvmBlocks('eth', blocks);
    rebuildHourly(store, 'eth', start, now + HOUR);
    store.putSnapshot('eth_spot', now, { usd: 2000 });
    const app = createApp(store, { refreshOnRequest: false });

    const status = await json(await app.request('/v1/status'));
    expect(status.chains.eth.raw.count).toBe(blocks.length);

    const nowRes = await app.request('/v1/eth/now');
    expect(nowRes.status).toBe(200);
    const nowJson = await json(nowRes);
    expect(nowJson.value).toBeCloseTo(1.5);
    expect(nowJson.simpleTx.usd).toBeCloseTo((21_000 * 2.5 * 2000) / 1e9);

    const hm = await json(await app.request('/v1/eth/heatmap?window=28d'));
    expect(hm.cells).toHaveLength(168);
    expect(hm.overallP50).toBeCloseTo(1.5);

    const fc = await json(await app.request('/v1/eth/forecast?hours=48&window=28d'));
    expect(fc.window.truncated).toBe(true);
    expect(fc.points).toHaveLength(48);
    expect(fc.points[0].p50).toBeCloseTo(1.5);

    expect((await app.request('/v1/tron/now')).status).toBe(400);
    expect((await app.request('/v1/sol/now')).status).toBe(503);
    expect((await app.request('/v1/btc/now')).status).toBe(503);
    expect((await app.request('/v1/eth/wallet/nothex/overpaid')).status).toBe(400);
    expect((await app.request('/v1/bnb/wallet/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/overpaid')).status).toBe(400);
    const chains = await json(await app.request('/v1/chains'));
    expect(chains.chains).toHaveLength(9);
    expect(chains.defaultWindow).toBe('28d');
    store.close();
  });
});
