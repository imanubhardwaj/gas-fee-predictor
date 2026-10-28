'use client';

import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDateShort, fmtFee, fmtHourLocal, type ChainInfo, type ForecastResponse, type HistoryResponse } from '@/lib/api';

const config = {
  hist: { label: 'Observed (hourly median)', color: 'var(--chart-1)' },
  fc: { label: 'Forecast (median)', color: 'var(--chart-2)' },
  band: { label: 'Forecast p10–p90', color: 'var(--chart-2)' },
} satisfies ChartConfig;

interface Point {
  ts: number;
  hist?: number;
  fc?: number;
  band?: [number, number];
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Hourly rows for short windows; daily medians once the window is long enough to blur hours anyway. */
function downsample(rows: HistoryResponse['rows'], windowSeconds: number): Array<{ ts: number; v: number }> {
  if (windowSeconds <= 21 * 86400) return rows.map((r) => ({ ts: r.ts, v: r.p50 }));
  const step = windowSeconds <= 120 * 86400 ? 6 * 3600 : 86400;
  const groups = new Map<number, number[]>();
  for (const r of rows) {
    const k = r.ts - (r.ts % step);
    const g = groups.get(k);
    if (g) g.push(r.p50);
    else groups.set(k, [r.p50]);
  }
  return [...groups].map(([ts, vs]) => ({ ts, v: median(vs) }));
}

export function ForecastChart({ chain, history, forecast, loading }: { chain: ChainInfo; history: HistoryResponse | null; forecast: ForecastResponse | null; loading: boolean }) {
  const { data, nowTs, longWindow } = useMemo(() => {
    const pts = new Map<number, Point>();
    const windowSeconds = history ? history.window.toTs - history.window.fromTs : 0;
    const longWindow = windowSeconds > 21 * 86400;
    if (history) for (const r of downsample(history.rows, windowSeconds)) pts.set(r.ts, { ts: r.ts, hist: r.v });
    if (forecast) {
      for (const p of forecast.points) {
        const cur = pts.get(p.ts) ?? { ts: p.ts };
        pts.set(p.ts, { ...cur, fc: p.p50, band: [p.p10, p.p90] });
      }
    }
    return { data: [...pts.values()].sort((a, b) => a.ts - b.ts), nowTs: forecast?.generatedAt ?? null, longWindow };
  }, [history, forecast]);

  const unit = chain.unitShort;
  return (
    <Card className="gap-0 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Fee history and 7-day forecast</CardTitle>
        <CardDescription className="text-xs">
          {longWindow ? 'Observed values are period medians for long windows. ' : ''}
          Forecast is a seasonal baseline with a p10–p90 band; the band is only as good as the backtest says.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pb-3 sm:px-4">
        {loading && data.length === 0 ? (
          <Skeleton className="h-[300px] w-full" />
        ) : data.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">No data yet for {chain.name}. Start the collector or run a backfill.</div>
        ) : (
          <ChartContainer config={config} className="h-[300px] w-full">
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="2 4" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => fmtDateShort(v)}
                tickLine={false}
                axisLine={{ stroke: 'var(--grid)' }}
                tick={{ fill: 'var(--axis)', fontSize: 11 }}
                minTickGap={48}
              />
              <YAxis
                width={56}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--axis)', fontSize: 11 }}
                tickFormatter={(v: number) => fmtFee(v, '').trim()}
                domain={[0, 'auto']}
              />
              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as Point | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                      <div className="mb-1 font-medium">{fmtHourLocal(Number(label))}</div>
                      {p.hist != null && (
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-sm" style={{ background: 'var(--chart-1)' }} />
                          Observed <span className="tabular ml-auto font-medium">{fmtFee(p.hist, unit)}</span>
                        </div>
                      )}
                      {p.fc != null && (
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-sm" style={{ background: 'var(--chart-2)' }} />
                          Forecast <span className="tabular ml-auto font-medium">{fmtFee(p.fc, unit)}</span>
                        </div>
                      )}
                      {p.band && (
                        <div className="mt-0.5 text-muted-foreground">
                          p10–p90: {fmtFee(p.band[0], '')}–{fmtFee(p.band[1], unit)}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Area dataKey="band" type="monotone" stroke="none" fill="var(--color-band)" fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
              <Line dataKey="hist" type="monotone" stroke="var(--color-hist)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line dataKey="fc" type="monotone" stroke="var(--color-fc)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
              {nowTs && <ReferenceLine x={nowTs} stroke="var(--axis)" strokeDasharray="3 3" label={{ value: 'now', position: 'insideTopRight', fill: 'var(--axis)', fontSize: 11 }} />}
            </ComposedChart>
          </ChartContainer>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-4 px-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: 'var(--chart-1)' }} />Observed</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--chart-2)' }} />Forecast median</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: 'var(--chart-2)', opacity: 0.2 }} />p10–p90</span>
          <span className="ml-auto">{chain.unit}</span>
        </div>
      </CardContent>
    </Card>
  );
}
