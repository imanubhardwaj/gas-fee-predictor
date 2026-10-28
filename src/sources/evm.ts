import { fetchJson } from '../http';
import type { ChainDef } from '../chains';
import type { EvmBlockRow } from '../db';

export const MAX_FEE_HISTORY = 1024;
const TIP_CAP_WEI = 10_000e9;

interface FeeHistory {
  oldestBlock: string;
  baseFeePerGas: string[];
  gasUsedRatio: number[];
  reward?: string[][];
}

export const hexToNumber = (hex: string): number => Number(BigInt(hex));
const toHex = (n: number) => '0x' + n.toString(16);

const cursors = new Map<string, number>();

/**
 * JSON-RPC with per-chain provider rotation. A successful call pins the cursor to that
 * provider; a failure moves on, so "archive requests need a token" or a rate limit on one
 * endpoint does not stall a sync.
 */
export async function rpc<T>(def: ChainDef, method: string, params: unknown[]): Promise<T> {
  const urls = def.rpcUrls;
  if (urls.length === 0) throw new Error(`${def.id}: no RPC urls configured`);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const start = cursors.get(def.id) ?? 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    const idx = (start + attempt) % urls.length;
    const url = urls[idx] as string;
    try {
      const res = await fetchJson<{ result?: T; error?: { code: number; message: string } }>(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
        { retries: 1, timeoutMs: 15_000 },
      );
      if (res.error) throw new Error(`${def.id} ${method} via ${url}: ${res.error.message}`);
      if (res.result === undefined || res.result === null) throw new Error(`${def.id} ${method} via ${url}: empty result`);
      cursors.set(def.id, idx);
      return res.result;
    } catch (err) {
      lastErr = err;
    }
  }
  cursors.set(def.id, (start + 1) % urls.length);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const latestBlockNumber = async (def: ChainDef) => hexToNumber(await rpc<string>(def, 'eth_blockNumber', []));

export async function blockTimestamp(def: ChainDef, number: number): Promise<number> {
  const block = await rpc<{ timestamp: string }>(def, 'eth_getBlockByNumber', [toHex(number), false]);
  return hexToNumber(block.timestamp);
}

const capTip = (hex: string | undefined) => Math.min(TIP_CAP_WEI, hex ? hexToNumber(hex) : 0);

/**
 * Base fee + priority-fee percentiles for fromBlock..toBlock (inclusive, at most 1024 blocks).
 * eth_feeHistory carries no timestamps, so the two boundary headers are fetched and the rest
 * interpolated; with regular block times the error stays within a couple of minutes per chunk.
 */
export async function fetchFeeHistoryRange(def: ChainDef, fromBlock: number, toBlock: number): Promise<EvmBlockRow[]> {
  const count = toBlock - fromBlock + 1;
  if (count < 1 || count > MAX_FEE_HISTORY) throw new RangeError(`range must be 1..${MAX_FEE_HISTORY} blocks, got ${count}`);
  const fh = await rpc<FeeHistory>(def, 'eth_feeHistory', [toHex(count), toHex(toBlock), [10, 50, 90]]);
  const oldest = hexToNumber(fh.oldestBlock);
  const got = Math.min(fh.baseFeePerGas.length - 1, fh.gasUsedRatio.length);
  if (got <= 0) return [];
  const newest = oldest + got - 1;
  const [tsFrom, tsTo] = await Promise.all([blockTimestamp(def, oldest), got === 1 ? Promise.resolve(0) : blockTimestamp(def, newest)]);
  const rows: EvmBlockRow[] = [];
  for (let i = 0; i < got; i++) {
    const reward = fh.reward?.[i] ?? [];
    rows.push({
      number: oldest + i,
      ts: got === 1 ? tsFrom : Math.round(tsFrom + ((tsTo - tsFrom) * i) / (got - 1)),
      baseFee: hexToNumber(fh.baseFeePerGas[i] as string),
      tipP10: capTip(reward[0]),
      tipP50: capTip(reward[1]),
      tipP90: capTip(reward[2]),
      gasUsedRatio: fh.gasUsedRatio[i] ?? 0,
    });
  }
  return rows;
}
