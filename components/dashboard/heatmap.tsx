'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtFee, type ChainInfo, type HeatmapResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RAMP = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)', 'var(--ramp-5)', 'var(--ramp-6)', 'var(--ramp-7)'];

/** Rank-based color so the grid always shows contrast, even when fees barely move. */
function rampFor(value: number | null, sortedValues: number[]): string {
  if (value == null || sortedValues.length === 0) return 'var(--muted)';
  let lo = 0;
  let hi = sortedValues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sortedValues[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  const q = lo / Math.max(1, sortedValues.length - 1);
  return RAMP[Math.min(RAMP.length - 1, Math.floor(q * RAMP.length))] as string;
}

function fmtHour(h: number) {
  const hh = ((h % 24) + 24) % 24;
  return hh === 0 ? '12a' : hh < 12 ? `${hh}a` : hh === 12 ? '12p' : `${hh - 12}p`;
}

export function FeeHeatmap({ chain, heatmap, loading }: { chain: ChainInfo; heatmap: HeatmapResponse | null; loading: boolean }) {
  const [hover, setHover] = useState<{ how: number } | { hour: number } | null>(null);
  const offsetHours = useMemo(() => -Math.round(new Date().getTimezoneOffset() / 60), []);
  const tzLabel = `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;

  const view = useMemo(() => {
    if (!heatmap) return null;
    // Shift UTC hour-of-week cells into the viewer's local grid.
    const local = new Array<HeatmapResponse['cells'][number]>(168);
    for (const c of heatmap.cells) local[(((c.how + offsetHours) % 168) + 168) % 168] = c;
    const localHours = new Array<HeatmapResponse['byHour'][number]>(24);
    for (const h of heatmap.byHour) localHours[(((h.hour + offsetHours) % 24) + 24) % 24] = h;
    const sorted = heatmap.cells.map((c) => c.p50).filter((v): v is number => v != null).sort((a, b) => a - b);
    const sortedHours = heatmap.byHour.map((c) => c.p50).filter((v): v is number => v != null).sort((a, b) => a - b);
    const cheapest = new Set(heatmap.cheapest.slice(0, 3).map((c) => c.how));
    return { local, localHours, sorted, sortedHours, cheapest };
  }, [heatmap, offsetHours]);

  const unit = chain.unitShort;
  const detail = (() => {
    if (!heatmap || !view || !hover) return null;
    if ('hour' in hover) {
      const c = view.localHours[hover.hour];
      return c?.p50 != null ? `${fmtHour(hover.hour)} local · typical ${fmtFee(c.p50, unit)} · ${((c.index ?? 1) * 100).toFixed(0)}% of median · ${c.n} hours` : 'no data';
    }
    const c = view.local[hover.how];
    if (!c || c.p50 == null) return 'no data';
    return `${DOW[Math.floor(hover.how / 24)]} ${fmtHour(hover.how % 24)} local · median ${fmtFee(c.p50, unit)} (p10 ${fmtFee(c.p10, '')}–p90 ${fmtFee(c.p90, unit)}) · ${((c.index ?? 1) * 100).toFixed(0)}% of weekly median · ${c.n} samples`;
  })();

  return (
    <Card className="gap-0 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">When is it cheap? Hour-of-week heatmap</CardTitle>
        <CardDescription className="text-xs">
          Median fee for each hour across the selected window, in your local time ({tzLabel}). Lighter is cheaper; rings mark the three cheapest hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading && !heatmap ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !heatmap || !view || view.sorted.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No data yet for {chain.name}.</div>
        ) : (
          <div className="space-y-3" onMouseLeave={() => setHover(null)}>
            <div>
              <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Typical day</div>
              <div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {view.localHours.map((c, hour) => (
                  <div
                    key={hour}
                    onMouseEnter={() => setHover({ hour })}
                    className="h-6 rounded-[3px] transition-opacity hover:opacity-80"
                    style={{ background: rampFor(c?.p50 ?? null, view.sortedHours) }}
                    aria-label={`${fmtHour(hour)} local`}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-px" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="tabular pb-0.5 text-center text-[10px] text-muted-foreground">
                  {h % 3 === 0 ? fmtHour(h) : ''}
                </div>
              ))}
              {DOW.map((d, dow) => (
                <div key={d} className="contents">
                  <div className="pr-2 text-right text-[11px] leading-5 text-muted-foreground">{d}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const how = dow * 24 + h;
                    const c = view.local[how];
                    const utcHow = c?.how;
                    const isCheap = utcHow != null && view.cheapest.has(utcHow);
                    return (
                      <div
                        key={h}
                        onMouseEnter={() => setHover({ how })}
                        className={cn('h-5 rounded-[3px] transition-opacity hover:opacity-80', isCheap && 'ring-2 ring-[var(--good)] ring-inset')}
                        style={{ background: rampFor(c?.p50 ?? null, view.sorted) }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                cheap
                {RAMP.map((r) => (
                  <span key={r} className="h-2.5 w-3 rounded-[2px]" style={{ background: r }} />
                ))}
                expensive
              </span>
              <span className="tabular ml-auto min-h-4 text-foreground">{detail ?? `Weekly median ${fmtFee(heatmap.overallP50, unit)} · ${heatmap.weeks} weeks`}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
