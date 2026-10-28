export type ChainKind = 'evm' | 'btc' | 'sol';
export type ChainId = 'eth' | 'base' | 'arb' | 'op' | 'polygon' | 'bnb' | 'avax' | 'btc' | 'sol';
export type Asset = 'eth' | 'btc' | 'sol' | 'pol' | 'bnb' | 'avax';

export interface ChainDef {
  id: ChainId;
  name: string;
  kind: ChainKind;
  /** Unit of the hourly p10/p50/p90 values. */
  unit: string;
  unitShort: string;
  asset: Asset;
  /** Keyless RPC endpoints, best-first. Overridable with GF_RPC_URLS_<ID>. */
  rpcUrls: string[];
  /** Approximate blocks per hour (measured Oct 2026); the sync re-measures from headers, this is the fallback. */
  blocksPerHour: number;
  /** Public RPCs refuse blocks older than this many behind head (Avalanche C-chain). */
  maxHistoryBlocks?: number;
  /** Blockscout-compatible API base for the wallet "overpaid" card. */
  blockscout?: string;
  explorerTx: string;
  /** Which per-block series the hourly p10/p50/p90 track on EVM chains. Base fee is what you time on
   *  Ethereum and its L2s; where the base fee is zero or trivial (BNB, Polygon) the gas price is. */
  evmSeries?: 'base' | 'base_plus_tip';
  /** Reference transaction used for the USD cost line. gas = gas units (evm), vbytes (btc), compute units (sol). */
  simpleTx: { label: string; gas: number };
  /** Smallest fee value, in the chain's unit, that means anything: the log-space floor for the forecast. */
  valueFloor: number;
  note?: string;
}

const env = (id: string) => process.env[`GF_RPC_URLS_${id.toUpperCase()}`]?.split(',').map((s) => s.trim()).filter(Boolean);

const def = (d: ChainDef): ChainDef => ({ ...d, rpcUrls: env(d.id) ?? d.rpcUrls });

export const CHAINS: Record<ChainId, ChainDef> = {
  eth: def({
    id: 'eth',
    valueFloor: 0.001,
    name: 'Ethereum',
    kind: 'evm',
    unit: 'gwei (base fee)',
    unitShort: 'gwei',
    asset: 'eth',
    rpcUrls: ['https://eth.drpc.org', 'https://1rpc.io/eth', 'https://eth-mainnet.public.blastapi.io', 'https://rpc.mevblocker.io', 'https://eth-pokt.nodies.app', 'https://eth.rpc.blxrbdn.com'],
    blocksPerHour: 300,
    blockscout: 'https://eth.blockscout.com/api',
    explorerTx: 'https://etherscan.io/tx/',
    simpleTx: { label: 'ETH transfer (21k gas)', gas: 21_000 },
  }),
  base: def({
    id: 'base',
    valueFloor: 0.0005,
    name: 'Base',
    kind: 'evm',
    unit: 'gwei (L2 base fee)',
    unitShort: 'gwei',
    asset: 'eth',
    rpcUrls: ['https://mainnet.base.org', 'https://base.drpc.org', 'https://1rpc.io/base', 'https://base-mainnet.public.blastapi.io'],
    blocksPerHour: 1800,
    blockscout: 'https://base.blockscout.com/api',
    explorerTx: 'https://basescan.org/tx/',
    simpleTx: { label: 'ETH transfer (21k gas)', gas: 21_000 },
    note: 'L2 execution fee only; the L1 data fee is charged separately and is not in this number.',
  }),
  arb: def({
    id: 'arb',
    valueFloor: 0.01,
    name: 'Arbitrum One',
    kind: 'evm',
    unit: 'gwei (L2 base fee)',
    unitShort: 'gwei',
    asset: 'eth',
    rpcUrls: ['https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc', 'https://1rpc.io/arb', 'https://arbitrum-one.public.blastapi.io'],
    blocksPerHour: 11_600,
    blockscout: 'https://arbitrum.blockscout.com/api',
    explorerTx: 'https://arbiscan.io/tx/',
    simpleTx: { label: 'ETH transfer (21k gas)', gas: 21_000 },
    note: 'L2 execution fee only; the L1 data fee is charged separately. Only drpc serves historical blocks keylessly.',
  }),
  op: def({
    id: 'op',
    valueFloor: 0.0005,
    name: 'OP Mainnet',
    kind: 'evm',
    unit: 'gwei (L2 base fee)',
    unitShort: 'gwei',
    asset: 'eth',
    rpcUrls: ['https://mainnet.optimism.io', 'https://optimism.drpc.org', 'https://1rpc.io/op'],
    blocksPerHour: 1800,
    blockscout: 'https://optimism.blockscout.com/api',
    explorerTx: 'https://optimistic.etherscan.io/tx/',
    simpleTx: { label: 'ETH transfer (21k gas)', gas: 21_000 },
    note: 'L2 execution fee only; the L1 data fee is charged separately and is not in this number.',
  }),
  polygon: def({
    id: 'polygon',
    valueFloor: 1,
    name: 'Polygon PoS',
    kind: 'evm',
    unit: 'gwei (base fee + median tip)',
    unitShort: 'gwei',
    asset: 'pol',
    evmSeries: 'base_plus_tip',
    rpcUrls: ['https://polygon.drpc.org', 'https://1rpc.io/matic', 'https://polygon-rpc.com'],
    blocksPerHour: 2400,
    blockscout: 'https://polygon.blockscout.com/api',
    explorerTx: 'https://polygonscan.com/tx/',
    simpleTx: { label: 'POL transfer (21k gas)', gas: 21_000 },
    note: 'Polygon enforces a 25 gwei minimum priority fee, so the tip usually matters more than the base fee.',
  }),
  bnb: def({
    id: 'bnb',
    valueFloor: 0.05,
    name: 'BNB Chain',
    kind: 'evm',
    unit: 'gwei (base fee + median tip)',
    unitShort: 'gwei',
    asset: 'bnb',
    evmSeries: 'base_plus_tip',
    rpcUrls: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-mainnet.public.blastapi.io', 'https://1rpc.io/bnb', 'https://bsc.drpc.org'],
    blocksPerHour: 8000,
    explorerTx: 'https://bscscan.com/tx/',
    simpleTx: { label: 'BNB transfer (21k gas)', gas: 21_000 },
    note: 'BNB Chain base fee is zero; validators price by priority fee, so the tip series is the one to read.',
  }),
  avax: def({
    id: 'avax',
    valueFloor: 1,
    name: 'Avalanche C-Chain',
    kind: 'evm',
    unit: 'nAVAX (base fee)',
    unitShort: 'nAVAX',
    asset: 'avax',
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.drpc.org', 'https://1rpc.io/avax/c'],
    blocksPerHour: 1800,
    maxHistoryBlocks: 25_000,
    explorerTx: 'https://snowtrace.io/tx/',
    simpleTx: { label: 'AVAX transfer (21k gas)', gas: 21_000 },
    note: 'Public RPCs only serve the last ~25k blocks (about 14 hours); longer history accumulates while the collector runs.',
  }),
  btc: def({
    id: 'btc',
    valueFloor: 1,
    name: 'Bitcoin',
    kind: 'btc',
    unit: 'sat/vB',
    unitShort: 'sat/vB',
    asset: 'btc',
    rpcUrls: [],
    blocksPerHour: 6,
    explorerTx: 'https://mempool.space/tx/',
    simpleTx: { label: 'BTC send (140 vB)', gas: 140 },
  }),
  sol: def({
    id: 'sol',
    valueFloor: 1,
    name: 'Solana',
    kind: 'sol',
    unit: 'micro-lamports per CU (priority fee)',
    unitShort: 'µL/CU',
    asset: 'sol',
    rpcUrls: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com', 'https://rpc.ankr.com/solana'],
    blocksPerHour: 9000,
    explorerTx: 'https://solscan.io/tx/',
    simpleTx: { label: 'swap-sized tx (200k CU)', gas: 200_000 },
    note: 'Sampled from getRecentPrioritizationFees for Jupiter and Raydium accounts; there is no keyless historical source, so history accumulates while the collector runs.',
  }),
};

export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[];
export const isChainId = (s: string): s is ChainId => s in CHAINS;
export const chainDef = (id: ChainId) => CHAINS[id];

export const ASSETS: Asset[] = ['eth', 'btc', 'sol', 'pol', 'bnb', 'avax'];
export const COINGECKO_ID: Record<Asset, string> = {
  eth: 'ethereum',
  btc: 'bitcoin',
  sol: 'solana',
  pol: 'polygon-ecosystem-token',
  bnb: 'binancecoin',
  avax: 'avalanche-2',
};
export const ASSET_SYMBOL: Record<Asset, string> = { eth: 'ETH', btc: 'BTC', sol: 'SOL', pol: 'POL', bnb: 'BNB', avax: 'AVAX' };

/** Native-unit cost of the reference transaction given hourly-unit fee values. */
export function simpleTxNative(def: ChainDef, feeValue: number, tipValue = 0): number {
  switch (def.kind) {
    case 'evm':
      return (def.simpleTx.gas * (feeValue + (def.evmSeries === 'base_plus_tip' ? 0 : tipValue))) / 1e9; // gwei/nAVAX → native
    case 'btc':
      return (def.simpleTx.gas * feeValue) / 1e8; // sat → BTC
    case 'sol':
      return (5000 + (def.simpleTx.gas * feeValue) / 1e6) / 1e9; // base 5000 lamports + priority
  }
}
