'use client';

import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, fmtAgo, type BackfillJob, type ChainInfo } from '@/lib/api';

const EXTEND = [
  { label: '3M', days: 91 },
  { label: '6M', days: 182 },
  { label: '1Y', days: 365 },
];

export function CoverageCard({ chain, onJobDone }: { chain: ChainInfo; onJobDone: () => void }) {
  const [jobs, setJobs] = useState<BackfillJob[]>([]);
  const running = jobs.find((j) => j.chain === chain.id && j.state === 'running');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const js = await api.jobs();
        if (!alive) return;
        const wasRunning = jobs.some((j) => j.chain === chain.id && j.state === 'running');
        setJobs(js);
        if (wasRunning && !js.some((j) => j.chain === chain.id && j.state === 'running')) onJobDone();
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, running ? 3000 : 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.id, Boolean(running)]);

  const cov = chain.coverage;
  const days = cov.minTs && cov.maxTs ? Math.max(0, (cov.maxTs - cov.minTs) / 86400) : 0;
  const canExtend = chain.kind === 'evm';

  return (
    <Card className="gap-0 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Database className="size-4 text-primary" /> Collected history
        </CardTitle>
        <CardDescription className="text-xs">
          {cov.count > 0 ? (
            <>
              {cov.count.toLocaleString()} hourly rows over {days.toFixed(days < 10 ? 1 : 0)} days, from {new Date((cov.minTs ?? 0) * 1000).toLocaleDateString()} · {chain.rawCount.toLocaleString()} raw samples
            </>
          ) : (
            'Nothing collected yet.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {chain.note && <p className="mb-3 text-xs text-muted-foreground">{chain.note}</p>}
        {canExtend ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Extend history:</span>
            {EXTEND.map((e) => (
              <Button key={e.days} size="sm" variant="outline" disabled={Boolean(running)} onClick={() => api.backfill(chain.id, e.days).then(() => api.jobs().then(setJobs))}>
                {e.label}
              </Button>
            ))}
            {running && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                backfilling {running.days} days · started {fmtAgo(running.startedAt)}
                {running.log.at(-1) ? ` · ${running.log.at(-1)}` : ''}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {chain.kind === 'btc' ? 'Bitcoin history comes from mempool.space in one call (up to three years).' : 'Solana history accumulates while the collector runs; there is no keyless historical source.'}
          </p>
        )}
        {jobs.filter((j) => j.chain === chain.id && j.state !== 'running').slice(0, 2).map((j) => (
          <p key={j.id} className="mt-2 text-[11px] text-muted-foreground">
            {j.state === 'done' ? `Backfilled ${j.days} days: ${j.added.toLocaleString()} rows added, ${j.failed} chunks failed` : `Backfill failed: ${j.error}`} · {fmtAgo(j.finishedAt)}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
