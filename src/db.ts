import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config';
import type { Asset, ChainId } from './chains';

export interface EvmBlockRow {
  number: number;
  ts: number;
  baseFee: number; // wei
  tipP10: number; // wei
  tipP50: number;
  tipP90: number;
  gasUsedRatio: number;
}

export interface BtcFeeRow {
  ts: number;
  avgHeight: number;
  p10: number; // sat/vB
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface SolSampleRow {
  ts: number;
  slot: number;
  p10: number; // micro-lamports per CU
  p50: number;
  p90: number;
  n: number;
}

/** One row per chain per UTC hour, in the chain's unit (see chains.ts). */
export interface HourlyRow {
  chain: ChainId;
  ts: number;
  p10: number;
  p50: number;
  p90: number;
  tipP50: number | null; // evm only, gwei
  n: number;
}

export interface Coverage {
  count: number;
  minTs: number | null;
  maxTs: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS evm_blocks (
  chain TEXT NOT NULL,
  number INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  base_fee INTEGER NOT NULL,
  tip_p10 INTEGER NOT NULL,
  tip_p50 INTEGER NOT NULL,
  tip_p90 INTEGER NOT NULL,
  gas_used_ratio REAL NOT NULL,
  PRIMARY KEY (chain, number)
);
CREATE INDEX IF NOT EXISTS evm_blocks_chain_ts ON evm_blocks(chain, ts);

CREATE TABLE IF NOT EXISTS btc_fee_rows (
  ts INTEGER PRIMARY KEY,
  avg_height INTEGER NOT NULL,
  p10 REAL NOT NULL, p25 REAL NOT NULL, p50 REAL NOT NULL, p75 REAL NOT NULL, p90 REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sol_samples (
  ts INTEGER PRIMARY KEY,
  slot INTEGER NOT NULL,
  p10 REAL NOT NULL, p50 REAL NOT NULL, p90 REAL NOT NULL,
  n INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hourly (
  chain TEXT NOT NULL,
  ts INTEGER NOT NULL,
  p10 REAL NOT NULL, p50 REAL NOT NULL, p90 REAL NOT NULL,
  tip_p50 REAL,
  n INTEGER NOT NULL,
  PRIMARY KEY (chain, ts)
);

CREATE TABLE IF NOT EXISTS prices_daily (
  asset TEXT NOT NULL,
  day INTEGER NOT NULL,
  usd REAL NOT NULL,
  PRIMARY KEY (asset, day)
);

CREATE TABLE IF NOT EXISTS snapshots (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (key, ts)
);
`;

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v);
const nullableNum = (v: unknown) => (v == null ? null : Number(v));

/** Serverless: the deployed bundle is read-only, so copy the committed snapshot into the writable DB path once per cold start. */
function seedFromSnapshot(path: string) {
  if (!config.serverless || existsSync(path)) return;
  const seed = join(process.cwd(), 'snapshot', 'gas.sqlite');
  if (existsSync(seed)) copyFileSync(seed, path);
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string = config.dbPath) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
      seedFromSnapshot(path);
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** v0.1 stored Ethereum alone in eth_blocks; fold it into the per-chain table once. */
  private migrate() {
    const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='eth_blocks'").get();
    if (!legacy) return;
    this.transaction(() => {
      this.db.exec(
        `INSERT OR IGNORE INTO evm_blocks (chain, number, ts, base_fee, tip_p10, tip_p50, tip_p90, gas_used_ratio)
         SELECT 'eth', number, ts, base_fee, tip_p10, tip_p50, tip_p90, gas_used_ratio FROM eth_blocks`,
      );
      this.db.exec('DROP TABLE eth_blocks');
    });
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }

  // ---- evm blocks ----

  upsertEvmBlocks(chain: ChainId, rows: readonly EvmBlockRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO evm_blocks (chain, number, ts, base_fee, tip_p10, tip_p50, tip_p90, gas_used_ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chain, number) DO UPDATE SET ts=excluded.ts, base_fee=excluded.base_fee, tip_p10=excluded.tip_p10,
         tip_p50=excluded.tip_p50, tip_p90=excluded.tip_p90, gas_used_ratio=excluded.gas_used_ratio`,
    );
    this.transaction(() => {
      for (const r of rows) stmt.run(chain, r.number, r.ts, r.baseFee, r.tipP10, r.tipP50, r.tipP90, r.gasUsedRatio);
    });
  }

  evmCoverage(chain: ChainId): Coverage & { minNumber: number | null; maxNumber: number | null } {
    const r = this.db
      .prepare('SELECT COUNT(*) AS count, MIN(number) AS minNumber, MAX(number) AS maxNumber, MIN(ts) AS minTs, MAX(ts) AS maxTs FROM evm_blocks WHERE chain = ?')
      .get(chain) as Row;
    return { count: num(r.count), minNumber: nullableNum(r.minNumber), maxNumber: nullableNum(r.maxNumber), minTs: nullableNum(r.minTs), maxTs: nullableNum(r.maxTs) };
  }

  /** Missing block ranges strictly inside the stored min..max (contiguous chains only). */
  evmGaps(chain: ChainId, limit = 1000): Array<[number, number]> {
    const rows = this.db
      .prepare(
        `SELECT number + 1 AS start, next - 1 AS end
         FROM (SELECT number, LEAD(number) OVER (ORDER BY number) AS next FROM evm_blocks WHERE chain = ?)
         WHERE next > number + 1 LIMIT ?`,
      )
      .all(chain, limit) as Row[];
    return rows.map((r) => [num(r.start), num(r.end)]);
  }

  hasEvmBlock(chain: ChainId, number: number): boolean {
    return this.db.prepare('SELECT 1 FROM evm_blocks WHERE chain = ? AND number = ?').get(chain, number) != null;
  }

  getEvmBlocks(chain: ChainId, fromTs: number, toTs: number): EvmBlockRow[] {
    const rows = this.db
      .prepare('SELECT number, ts, base_fee, tip_p10, tip_p50, tip_p90, gas_used_ratio FROM evm_blocks WHERE chain = ? AND ts >= ? AND ts < ? ORDER BY ts')
      .all(chain, fromTs, toTs) as Row[];
    return rows.map(toEvmBlock);
  }

  latestEvmBlock(chain: ChainId): EvmBlockRow | null {
    const r = this.db
      .prepare('SELECT number, ts, base_fee, tip_p10, tip_p50, tip_p90, gas_used_ratio FROM evm_blocks WHERE chain = ? ORDER BY number DESC LIMIT 1')
      .get(chain) as Row | undefined;
    return r ? toEvmBlock(r) : null;
  }

  // ---- btc ----

  upsertBtcRows(rows: readonly BtcFeeRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO btc_fee_rows (ts, avg_height, p10, p25, p50, p75, p90) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ts) DO UPDATE SET avg_height=excluded.avg_height, p10=excluded.p10, p25=excluded.p25, p50=excluded.p50, p75=excluded.p75, p90=excluded.p90`,
    );
    this.transaction(() => {
      for (const r of rows) stmt.run(r.ts, r.avgHeight, r.p10, r.p25, r.p50, r.p75, r.p90);
    });
  }

  btcCoverage(): Coverage {
    const r = this.db.prepare('SELECT COUNT(*) AS count, MIN(ts) AS minTs, MAX(ts) AS maxTs FROM btc_fee_rows').get() as Row;
    return { count: num(r.count), minTs: nullableNum(r.minTs), maxTs: nullableNum(r.maxTs) };
  }

  getBtcRows(fromTs: number, toTs: number): BtcFeeRow[] {
    const rows = this.db.prepare('SELECT ts, avg_height, p10, p25, p50, p75, p90 FROM btc_fee_rows WHERE ts >= ? AND ts < ? ORDER BY ts').all(fromTs, toTs) as Row[];
    return rows.map((r) => ({ ts: num(r.ts), avgHeight: num(r.avg_height), p10: num(r.p10), p25: num(r.p25), p50: num(r.p50), p75: num(r.p75), p90: num(r.p90) }));
  }

  // ---- sol ----

  upsertSolSamples(rows: readonly SolSampleRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO sol_samples (ts, slot, p10, p50, p90, n) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ts) DO UPDATE SET slot=excluded.slot, p10=excluded.p10, p50=excluded.p50, p90=excluded.p90, n=excluded.n`,
    );
    this.transaction(() => {
      for (const r of rows) stmt.run(r.ts, r.slot, r.p10, r.p50, r.p90, r.n);
    });
  }

  solCoverage(): Coverage {
    const r = this.db.prepare('SELECT COUNT(*) AS count, MIN(ts) AS minTs, MAX(ts) AS maxTs FROM sol_samples').get() as Row;
    return { count: num(r.count), minTs: nullableNum(r.minTs), maxTs: nullableNum(r.maxTs) };
  }

  getSolSamples(fromTs: number, toTs: number): SolSampleRow[] {
    const rows = this.db.prepare('SELECT ts, slot, p10, p50, p90, n FROM sol_samples WHERE ts >= ? AND ts < ? ORDER BY ts').all(fromTs, toTs) as Row[];
    return rows.map((r) => ({ ts: num(r.ts), slot: num(r.slot), p10: num(r.p10), p50: num(r.p50), p90: num(r.p90), n: num(r.n) }));
  }

  latestSolSample(): SolSampleRow | null {
    const r = this.db.prepare('SELECT ts, slot, p10, p50, p90, n FROM sol_samples ORDER BY ts DESC LIMIT 1').get() as Row | undefined;
    return r ? { ts: num(r.ts), slot: num(r.slot), p10: num(r.p10), p50: num(r.p50), p90: num(r.p90), n: num(r.n) } : null;
  }

  // ---- hourly ----

  upsertHourly(rows: readonly HourlyRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO hourly (chain, ts, p10, p50, p90, tip_p50, n) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chain, ts) DO UPDATE SET p10=excluded.p10, p50=excluded.p50, p90=excluded.p90, tip_p50=excluded.tip_p50, n=excluded.n`,
    );
    this.transaction(() => {
      for (const r of rows) stmt.run(r.chain, r.ts, r.p10, r.p50, r.p90, r.tipP50, r.n);
    });
  }

  getHourly(chain: ChainId, fromTs: number, toTs: number): HourlyRow[] {
    const rows = this.db.prepare('SELECT ts, p10, p50, p90, tip_p50, n FROM hourly WHERE chain = ? AND ts >= ? AND ts < ? ORDER BY ts').all(chain, fromTs, toTs) as Row[];
    return rows.map((r) => ({ chain, ts: num(r.ts), p10: num(r.p10), p50: num(r.p50), p90: num(r.p90), tipP50: nullableNum(r.tip_p50), n: num(r.n) }));
  }

  hourlyCoverage(chain: ChainId): Coverage {
    const r = this.db.prepare('SELECT COUNT(*) AS count, MIN(ts) AS minTs, MAX(ts) AS maxTs FROM hourly WHERE chain = ?').get(chain) as Row;
    return { count: num(r.count), minTs: nullableNum(r.minTs), maxTs: nullableNum(r.maxTs) };
  }

  // ---- prices ----

  upsertPrices(asset: Asset, rows: ReadonlyArray<{ day: number; usd: number }>): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare('INSERT INTO prices_daily (asset, day, usd) VALUES (?, ?, ?) ON CONFLICT(asset, day) DO UPDATE SET usd=excluded.usd');
    this.transaction(() => {
      for (const r of rows) stmt.run(asset, r.day, r.usd);
    });
  }

  getPrices(asset: Asset, fromDay: number, toDay: number): Map<number, number> {
    const rows = this.db.prepare('SELECT day, usd FROM prices_daily WHERE asset = ? AND day >= ? AND day <= ?').all(asset, fromDay, toDay) as Row[];
    return new Map(rows.map((r) => [num(r.day), num(r.usd)]));
  }

  latestPrice(asset: Asset): { day: number; usd: number } | null {
    const r = this.db.prepare('SELECT day, usd FROM prices_daily WHERE asset = ? ORDER BY day DESC LIMIT 1').get(asset) as Row | undefined;
    return r ? { day: num(r.day), usd: num(r.usd) } : null;
  }

  // ---- snapshots ----

  putSnapshot(key: string, ts: number, payload: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO snapshots (key, ts, payload) VALUES (?, ?, ?)').run(key, ts, JSON.stringify(payload));
  }

  latestSnapshot<T>(key: string): { ts: number; payload: T } | null {
    const r = this.db.prepare('SELECT ts, payload FROM snapshots WHERE key = ? ORDER BY ts DESC LIMIT 1').get(key) as Row | undefined;
    return r ? { ts: num(r.ts), payload: JSON.parse(String(r.payload)) as T } : null;
  }
}

function toEvmBlock(r: Row): EvmBlockRow {
  return { number: num(r.number), ts: num(r.ts), baseFee: num(r.base_fee), tipP10: num(r.tip_p10), tipP50: num(r.tip_p50), tipP90: num(r.tip_p90), gasUsedRatio: num(r.gas_used_ratio) };
}
