'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Clock, Gauge, TrendingDown, Zap } from 'lucide-react';
import { fmtFee, fmtUsd, fmtWindowRange, type ChainInfo, type ForecastResponse, type NowResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

function Tile({ icon, label, children, loading }: { icon: React.ReactNode; label: string; children?: React.ReactNode; loading?: boolean }) {
  return (
    <Card className="min-w-0 gap-0 py-4 shadow-none">
      <CardContent className="min-w-0 px-4">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <span className="text-primary">{icon}</span>
          {label}
        </div>
        <div className="mt-2 min-h-14 min-w-0">{loading ? <Skeleton className="h-9 w-32" /> : children}</div>
      </CardContent>
    </Card>
  );
}

function Hero({ value, sub, compact }: { value: string; sub?: React.ReactNode; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn('tabular font-semibold tracking-tight', compact ? 'text-xl leading-7' : 'text-2xl')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function WindowTile({
  icon,
  label,
  w,
  nowValue,
  unitShort,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  w: ForecastResponse['best']['next24h'] | undefined;
  /** Live fee value; the saving is measured against it so the tiles agree with "Right now". */
  nowValue: number | null;
  unitShort: string;
  loading: boolean;
}) {
  if (loading) return <Tile icon={icon} label={label} loading />;
  if (!w) return <Tile icon={icon} label={label}><Hero value="–" sub="not enough history yet" /></Tile>;
  const saving = nowValue != null && nowValue > 0 ? (1 - w.p50 / nowValue) * 100 : w.savingVsNowPct;
  const tone = saving >= 15 ? 'text-[var(--good)]' : saving <= -15 ? 'text-[var(--critical)]' : 'text-muted-foreground';
  if (saving < 1) {
    return (
      <Tile icon={icon} label={label}>
        <Hero compact value="Now is as good as it gets" sub={<span>no cheaper hour expected · ~{fmtFee(w.p50, unitShort)}</span>} />
      </Tile>
    );
  }
  return (
    <Tile icon={icon} label={label}>
      <Hero
        compact
        value={fmtWindowRange(w.startTs, w.endTs)}
        sub={
          <span className="flex items-center gap-1.5">
            <span className={cn('tabular font-medium', tone)}>{`${saving.toFixed(0)}% cheaper`}</span>
            <span>than now · ~{fmtFee(w.p50, unitShort)}</span>
          </span>
        }
      />
    </Tile>
  );
}

export function StatTiles({ chain, now, forecast, loading }: { chain: ChainInfo; now: NowResponse | null; forecast: ForecastResponse | null; loading: boolean }) {
  const liveNow = now?.value != null && now.value > 0 ? Math.max(now.value, forecast?.floor ?? 0) : (forecast?.now.value ?? null);
  const level = forecast?.level ?? null;
  const levelLabel = level == null ? null : level < 0.8 ? 'below typical' : level > 1.25 ? 'above typical' : 'typical';
  const levelTone = level == null ? '' : level < 0.8 ? 'text-[var(--good)]' : level > 1.25 ? 'text-[var(--critical)]' : 'text-muted-foreground';
  const edge = forecast?.timingEdge ?? null;
  const atFloor = forecast != null && forecast.now.value <= forecast.floor * 1.001;
  const timingNote = atFloor
    ? `fees are at the chain minimum (${fmtFee(forecast.floor, chain.unitShort)}); there is nothing to time right now`
    : edge == null
      ? null
      : `following the cheapest-hour call saved a median ${edge.medianSavingPct.toFixed(0)}% (quartiles ${edge.p25SavingPct.toFixed(0)}%…${edge.p75SavingPct.toFixed(0)}%) at ${edge.origins} holdout origins; ${
          edge.medianSavingPct >= 10 && edge.p25SavingPct >= 0 ? 'timing pays here' : edge.medianSavingPct >= 3 ? 'a modest, uneven edge' : 'timing barely matters here right now'
        }`;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile icon={<Zap className="size-3.5" />} label="Right now" loading={loading && !now}>
        {now?.value != null ? (
          <Hero
            value={fmtFee(now.value, chain.unitShort)}
            sub={
              <>
                {now.simpleTx ? `${chain.simpleTx.label}: ${fmtUsd(now.simpleTx.usd)}` : null}
                {now.tip != null && now.tip > 0 ? ` · tip ${fmtFee(now.tip, chain.unitShort)}` : null}
              </>
            }
          />
        ) : (
          <Hero value="–" sub={now?.error ?? 'no data yet'} />
        )}
      </Tile>
      <Tile icon={<Gauge className="size-3.5" />} label="Versus typical" loading={loading && !forecast}>
        {level != null ? (
          <Hero
            value={`${level.toFixed(2)}×`}
            sub={
              <>
                <span className="flex items-center gap-1.5">
                  <Badge variant="outline" className={cn('h-5 rounded-sm px-1.5 text-[11px]', levelTone)}>
                    {levelLabel}
                  </Badge>
                  for this hour of the week
                </span>
                {timingNote && <span className="mt-0.5 block text-[11px]">{timingNote}</span>}
              </>
            }
          />
        ) : (
          <Hero value="–" sub="not enough history yet" />
        )}
      </Tile>
      <WindowTile icon={<Clock className="size-3.5" />} label="Cheapest · next 24h" w={forecast?.best.next24h} nowValue={liveNow} unitShort={chain.unitShort} loading={loading && !forecast} />
      <WindowTile icon={<TrendingDown className="size-3.5" />} label="Cheapest · next 7 days" w={forecast?.best.next7d} nowValue={liveNow} unitShort={chain.unitShort} loading={loading && !forecast} />
    </div>
  );
}
