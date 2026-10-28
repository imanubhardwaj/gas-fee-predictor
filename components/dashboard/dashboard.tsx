'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ChainSelect } from './chain-select';
import { WindowTabs } from './window-tabs';
import { StatTiles } from './stat-tiles';
import { ForecastChart } from './forecast-chart';
import { FeeHeatmap } from './heatmap';
import { WalletCard } from './wallet-card';
import { CoverageCard } from './coverage-card';
import { api, fmtAgo, type ChainId, type ChainsResponse, type ForecastResponse, type HeatmapResponse, type HistoryResponse, type NowResponse, type WindowId } from '@/lib/api';

const NOW_POLL_MS = 30_000;
const CHAIN_IDS = ['eth', 'base', 'arb', 'op', 'polygon', 'bnb', 'avax', 'btc', 'sol'];
const WINDOW_IDS = ['1w', '28d', '3m', '6m', '1y', 'all'];

/** Initial state from ?chain=&window= so a view can be linked; falls back to defaults on the server. */
function readParam(key: 'chain' | 'window', fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = new URLSearchParams(window.location.search).get(key);
  const allowed = key === 'chain' ? CHAIN_IDS : WINDOW_IDS;
  return v && allowed.includes(v) ? v : fallback;
}

export function Dashboard() {
  const [chains, setChains] = useState<ChainsResponse | null>(null);
  const [chain, setChain] = useState<ChainId>(() => readParam('chain', 'eth') as ChainId);
  const [window_, setWindow] = useState<WindowId>(() => readParam('window', '28d') as WindowId);
  const [now, setNow] = useState<NowResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const req = useRef(0);

  const loadChains = useCallback(async () => {
    try {
      const c = await api.chains();
      setChains(c);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadChains();
  }, [loadChains]);

  // Full reload on chain/window change. Each call syncs the chain head server-side first.
  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    setNow(null);
    setForecast(null);
    setHeatmap(null);
    setHistory(null);
    const settle = <T,>(p: Promise<T>) => p.then((v) => ({ v }), (e: unknown) => ({ e }));
    void (async () => {
      const [n, f, h, hist] = await Promise.all([settle(api.now(chain)), settle(api.forecast(chain, window_)), settle(api.heatmap(chain, window_)), settle(api.history(chain, window_))]);
      if (id !== req.current) return;
      if ('v' in n) setNow(n.v);
      else if ('e' in n && n.e && typeof n.e === 'object' && 'body' in n.e) setNow((n.e as { body: NowResponse }).body);
      if ('v' in f) setForecast(f.v);
      if ('v' in h) setHeatmap(h.v);
      if ('v' in hist) setHistory(hist.v);
      const firstErr = [n, f, h, hist].find((r) => 'e' in r) as { e: Error } | undefined;
      if (firstErr && !('v' in f)) setError(firstErr.e.message);
      setLoading(false);
      void loadChains();
    })();
  }, [chain, window_, tick, loadChains]);

  // Reflect chain and window in the URL without adding history entries.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('chain', chain);
    url.searchParams.set('window', window_);
    window.history.replaceState(null, '', url);
  }, [chain, window_]);

  // Keep "now" live.
  useEffect(() => {
    const id = setInterval(() => {
      api.now(chain).then(setNow, () => undefined);
    }, NOW_POLL_MS);
    return () => clearInterval(id);
  }, [chain]);

  const info = useMemo(() => chains?.chains.find((c) => c.id === chain) ?? null, [chains, chain]);
  const fresh = forecast?.fresh ?? now?.fresh ?? null;
  const syncedAt = fresh?.syncedAt ?? now?.asOf ?? null;
  const truncated = forecast?.window.truncated || heatmap?.window.truncated || history?.window.truncated;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">Gas Forecast</h1>
              <p className="text-xs text-muted-foreground">When will this transaction be cheaper?</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`size-2 rounded-full ${fresh?.error ? 'bg-[var(--warning)]' : 'live-dot bg-[var(--good)]'}`} />
            {fresh?.error ? (
              <span title={fresh.error}>serving stored data · last sync {fmtAgo(syncedAt)}</span>
            ) : (
              <span>
                live · chain head synced {fmtAgo(syncedAt)}
                {fresh?.refreshed ? ' (this request)' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chains ? <ChainSelect chains={chains.chains} value={chain} onChange={setChain} /> : <Skeleton className="h-8 w-[220px]" />}
          {chains ? <WindowTabs windows={chains.windows} value={window_} onChange={setWindow} /> : <Skeleton className="h-8 w-64" />}
          {info?.note && <span className="hidden text-xs text-muted-foreground lg:inline">{info.note}</span>}
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Couldn&apos;t load {info?.name ?? chain}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {truncated && !error && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Window clipped to collected history</AlertTitle>
          <AlertDescription>
            Only {forecast?.window.weeks ?? heatmap?.window.weeks} week(s) are stored for {info?.name}. Use &ldquo;Extend history&rdquo; below to backfill more.
          </AlertDescription>
        </Alert>
      )}

      {info ? (
        <>
          <StatTiles chain={info} now={now} forecast={forecast} loading={loading} />
          <ForecastChart chain={info} history={history} forecast={forecast} loading={loading} />
          <FeeHeatmap chain={info} heatmap={heatmap} loading={loading} />
          <div className="grid gap-4 lg:grid-cols-2">
            <WalletCard chain={info} />
            <CoverageCard chain={info} onJobDone={() => setTick((t) => t + 1)} />
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
        <span>Data: public JSON-RPC pools, mempool.space, CoinGecko, Blockscout. Hours shown in your local time; stored in UTC.</span>
        <span>Forecast = weighted hour-of-week quantiles × current-level factor. Run the backtest before trusting the band.</span>
      </footer>
    </div>
  );
}
