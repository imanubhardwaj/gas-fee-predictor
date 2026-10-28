import { config } from '../config';
import { fetchJson } from '../http';
import { dayStart } from '../time';
import { ASSETS, COINGECKO_ID, type Asset } from '../chains';

export async function fetchDailyPrices(asset: Asset, days = 365): Promise<Array<{ day: number; usd: number }>> {
  const res = await fetchJson<{ prices: [number, number][] }>(
    `${config.coingeckoBase}/coins/${COINGECKO_ID[asset]}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
  );
  const byDay = new Map<number, number>();
  for (const [ms, usd] of res.prices) byDay.set(dayStart(Math.floor(ms / 1000)), usd);
  return [...byDay].map(([day, usd]) => ({ day, usd }));
}

export async function fetchSpotPrices(): Promise<Partial<Record<Asset, number>>> {
  const ids = ASSETS.map((a) => COINGECKO_ID[a]).join(',');
  const res = await fetchJson<Record<string, { usd: number }>>(`${config.coingeckoBase}/simple/price?ids=${ids}&vs_currencies=usd`);
  const out: Partial<Record<Asset, number>> = {};
  for (const a of ASSETS) {
    const v = res[COINGECKO_ID[a]]?.usd;
    if (typeof v === 'number' && Number.isFinite(v)) out[a] = v;
  }
  return out;
}
