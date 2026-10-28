# gas-forecast

"When will this transaction be cheaper?" for every major chain. A Next.js app with the fee
collectors, SQLite store, hour-of-week heatmap, calibrated seven-day forecast and a wallet
"you overpaid $X" card, plus the HTTP API the UI is built on. No API keys, one SQLite file.

## Chains

| Chain | Source | Series | History |
|---|---|---|---|
| Ethereum | keyless JSON-RPC pool (drpc, 1rpc, blastapi, mevblocker, nodies, bloXroute) | base fee, gwei | contiguous, backfill any depth |
| Base, OP Mainnet, Arbitrum One | keyless JSON-RPC pools | L2 base fee, gwei (L1 data fee not included) | sampled 1024 blocks per hour; Arbitrum only via drpc |
| Polygon PoS, BNB Chain | keyless JSON-RPC pools | base fee + median tip, gwei (base fee alone is meaningless there) | sampled per hour |
| Avalanche C-Chain | public RPC | base fee, nAVAX | public RPCs serve only ~25k blocks (~14h); accumulates while collecting |
| Bitcoin | mempool.space | fee rate, sat/vB | up to three years in one call |
| Solana | public RPC `getRecentPrioritizationFees` on Jupiter and Raydium accounts | priority fee, micro-lamports per CU | live only; accumulates while collecting |

Prices come from CoinGecko; wallet transactions from Blockscout (Ethereum, Base, OP, Arbitrum, Polygon).
Per-chain RPC pools are in `src/chains.ts` and can be overridden with `GF_RPC_URLS_<CHAIN>`.

## Run

```bash
pnpm install
pnpm backfill --chains eth,btc --days 28     # or --chains all; EVM chains take ~3 min per chain per 28 days
pnpm build && pnpm start                     # http://localhost:3000
pnpm collect                                 # optional: keeps every chain fresh on a 60s loop
pnpm backtest --chain eth --days 14          # judge the forecast before trusting it
pnpm test && pnpm typecheck
```

Every `now`, `forecast` and `heatmap` request syncs the chain head first (throttled to once per 30s per
chain, shared across concurrent requests), so the page is current even without the collector. Backfills
can also be started from the UI ("Extend history") and run inside the server process.

`pnpm dev` uses the Turbopack watcher, which fails in sandboxed shells ("unable to start FSEvent stream");
`ulimit -n 65536 && pnpm exec next dev --webpack` works there.

## API (under `/api`)

| Route | Returns |
|---|---|
| `GET /v1/chains` | registry with units, notes, wallet support and stored coverage |
| `GET /v1/status` | raw and hourly coverage per chain, spot prices, background jobs |
| `GET /v1/{chain}/now` | latest fee, tip, spot price, USD cost of a reference transaction, freshness of the sync this request triggered |
| `GET /v1/{chain}/history?window=28d` | hourly p10/p50/p90 rows for the window (`1w`, `28d`, `3m`, `6m`, `1y`, `all`), clipped to stored data with a `truncated` flag |
| `GET /v1/{chain}/heatmap?window=28d` | 168 hour-of-week cells plus a 24-cell typical-day profile, cheapest and priciest hours |
| `GET /v1/{chain}/forecast?window=28d&hours=168` | hourly p10/p50/p90, level vs seasonal, best windows for 24h and 7d, calibrated band, realized timing edge |
| `GET /v1/{chain}/wallet/{address}/overpaid?wait=24` | fees paid vs the cheapest hourly median within the wait window, in native units and USD |
| `POST /v1/{chain}/backfill?days=91` | start an in-process backfill; `GET /v1/jobs` lists them |

Add `refresh=0` to skip the on-request sync. All timestamps are unix seconds; hours are UTC in the API and
shown in local time by the UI.

## Forecast

Seasonal-shape persistence in log space: a recency-weighted hour-of-week profile, shrunk toward the
hour-of-day profile and the overall median (the raw 168-cell profile is mostly noise with a few weeks of
data), times the current deviation from that profile decaying over 168 hours. The p10–p90 band is
calibrated from the residuals this predictor made at past origins in the window, by horizon bucket.
`timingEdge` reports what following the model's cheapest-hour call would actually have saved at past
origins; the UI shows it so a flat week is never sold as a timing opportunity. `pnpm backtest` gives the
out-of-sample view with persistence as the baseline.

## Layout

- `src/` chain registry, store, sources, aggregation, forecast, overpaid, sync and refresh jobs, Hono API
- `app/api/[[...route]]` mounts the Hono app in Next; `src/api/server.ts` runs it standalone on :8787
- `components/dashboard` the UI (shadcn, Recharts); `lib/api.ts` typed client and formatters
- `test/` vitest; `pnpm backtest` for model quality

## Known limits

- EVM timestamps are interpolated inside each 1024-block chunk (a few minutes of error near chunk edges).
- L2 numbers are the L2 execution fee only; the L1 data component is not modelled.
- The wallet card compares against hourly medians, a fair "if you had waited" counterfactual, not a replay.
- Public RPCs rate-limit; the pool rotates and failed chunks are retried on the next sync.
- No executor yet: "sign once, execute when cheap" (EIP-7702 delegation plus a relayer) is a separate phase.
