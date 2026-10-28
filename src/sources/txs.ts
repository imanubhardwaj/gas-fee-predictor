import { fetchJson } from '../http';

export interface WalletTx {
  hash: string;
  ts: number;
  blockNumber: number;
  from: string;
  to: string | null;
  gasUsed: bigint;
  gasPrice: bigint; // effective gas price paid, wei
  isError: boolean;
}

interface BlockscoutTx {
  hash: string;
  timeStamp: string;
  blockNumber: string;
  from: string;
  to: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
}

const PAGE_SIZE = 500;
const MAX_PAGES = 20;

export interface SentTxs {
  txs: WalletTx[];
  /** Newest transaction sent by the address at any time, even if older than the cutoff. */
  lastSentTs: number | null;
}

/** Transactions SENT by `address` (the sender pays gas), newest first, down to `fromTs`. */
export async function fetchSentTxs(blockscoutBase: string, address: string, fromTs: number): Promise<SentTxs> {
  const addr = address.toLowerCase();
  const out: WalletTx[] = [];
  let lastSentTs: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${blockscoutBase}?module=account&action=txlist&address=${addr}&page=${page}&offset=${PAGE_SIZE}&sort=desc`;
    const res = await fetchJson<{ status: string; message: string; result: BlockscoutTx[] | string }>(url);
    if (!Array.isArray(res.result)) {
      if (/no transactions/i.test(res.message ?? '') || /no transactions/i.test(String(res.result))) break;
      throw new Error(`explorer: ${res.message || String(res.result)}`);
    }
    let reachedCutoff = false;
    for (const t of res.result) {
      const ts = Number(t.timeStamp);
      const isSender = t.from.toLowerCase() === addr;
      if (isSender && lastSentTs == null) lastSentTs = ts;
      if (ts < fromTs) {
        // keep scanning this page only until we have seen a sent tx, for lastSentTs
        if (lastSentTs != null) {
          reachedCutoff = true;
          break;
        }
        continue;
      }
      if (!isSender) continue;
      out.push({
        hash: t.hash,
        ts,
        blockNumber: Number(t.blockNumber),
        from: t.from.toLowerCase(),
        to: t.to ? t.to.toLowerCase() : null,
        gasUsed: BigInt(t.gasUsed),
        gasPrice: BigInt(t.gasPrice),
        isError: t.isError === '1',
      });
    }
    if (reachedCutoff || res.result.length < PAGE_SIZE) break;
    if (lastSentTs != null && Number(res.result[res.result.length - 1]?.timeStamp ?? 0) < fromTs) break;
  }
  return { txs: out, lastSentTs };
}
