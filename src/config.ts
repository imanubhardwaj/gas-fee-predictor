import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const config = {
  root,
  dbPath: process.env.GF_DB_PATH ?? join(root, 'data', 'gas.sqlite'),
  mempoolBase: process.env.GF_MEMPOOL_URL ?? 'https://mempool.space/api',
  coingeckoBase: process.env.GF_COINGECKO_URL ?? 'https://api.coingecko.com/api/v3',
  port: Number(process.env.PORT ?? 8787),
  rpcConcurrency: Number(process.env.GF_RPC_CONCURRENCY ?? 3),
  userAgent: 'gas-forecast/0.1 (local dev)',
};
