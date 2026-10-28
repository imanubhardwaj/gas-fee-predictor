'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiError, fmtDate, fmtFee, fmtHourLocal, fmtNative, fmtUsd, type ChainInfo, type OverpaidResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** API habit is a UTC hour-of-week; show it in the viewer's local time like everything else. */
function habitLocal(how: number): string {
  const offset = -Math.round(new Date().getTimezoneOffset() / 60);
  const local = (((how + offset) % 168) + 168) % 168;
  const h = local % 24;
  const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
  return `${DOW[Math.floor(local / 24)]} ${label}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/40 px-3 py-2">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="tabular mt-0.5 truncate text-sm font-medium">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function EmptyState({ r }: { r: OverpaidResponse }) {
  const since = fmtDate(r.dataFromTs);
  if (r.txCount === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-5 text-sm">
        <div className="font-medium">No transactions sent since {since}</div>
        <p className="mt-1 text-muted-foreground">
          {r.lastSentTs
            ? `This address last sent a transaction on ${fmtDate(r.lastSentTs)}, before the collected ${r.chainName} history begins. Received transfers don't count: the sender pays the gas.`
            : `No transaction sent from this address was found on ${r.chainName}. Received transfers don't count: the sender pays the gas.`}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Extend history below to cover an earlier period, or try a more active address.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed px-4 py-5 text-sm">
      <div className="font-medium">
        {r.txCount} transaction{r.txCount === 1 ? '' : 's'} found, none inside collected hours
      </div>
      <p className="mt-1 text-muted-foreground">The hourly fee history has gaps around those transactions, so there is no fair counterfactual yet. Extending history usually fixes this.</p>
    </div>
  );
}

export function WalletCard({ chain }: { chain: ChainInfo }) {
  const [address, setAddress] = useState(() => (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('address') ?? '')));
  const [report, setReport] = useState<OverpaidResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const valid = ADDRESS_RE.test(address.trim());

  const run = useCallback(
    async (addr: string) => {
      if (!ADDRESS_RE.test(addr) || !chain.walletSupported) return;
      setBusy(true);
      setError(null);
      setReport(null);
      try {
        setReport(await api.overpaid(chain.id, addr));
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('address', addr);
          window.history.replaceState(null, '', url);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'request failed');
      } finally {
        setBusy(false);
      }
    },
    [chain.id, chain.walletSupported],
  );

  // Re-run for the new chain when one is already loaded, and auto-run from ?address= on first load.
  useEffect(() => {
    setReport(null);
    setError(null);
    const a = address.trim();
    if (ADDRESS_RE.test(a)) void run(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.id]);

  const copySummary = async () => {
    if (!report) return;
    const text =
      report.overpaidEth > 0
        ? `On ${report.chainName}, ${short(report.address)} paid ${fmtUsd(report.paidUsd)} in fees over ${report.txCount} transactions and could have saved ${fmtUsd(report.overpaidUsd)} (${Math.round((report.overpaidPct ?? 0) * 100)}%) by waiting up to ${report.waitHours}h.`
        : `On ${report.chainName}, ${short(report.address)} timed its ${report.txCount} transactions well: nothing to save by waiting up to ${report.waitHours}h.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const pct = report?.overpaidPct == null ? null : Math.round(report.overpaidPct * 100);

  return (
    <Card className="gap-0 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="size-4 text-primary" /> What did waiting cost you?
        </CardTitle>
        <CardDescription className="text-xs">
          {chain.walletSupported
            ? `Every transaction this address sent on ${chain.name}, against the cheapest hourly median within the following 24 hours.`
            : `Wallet analysis needs a Blockscout explorer; none is wired for ${chain.name} yet.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(address.trim());
          }}
        >
          <Input
            placeholder="0x… address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={!chain.walletSupported}
            className={cn('font-mono text-xs', address && !valid && 'border-[var(--critical)]')}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(address) && !valid}
          />
          <Button type="submit" disabled={!chain.walletSupported || busy || !valid}>
            {busy ? 'Analyzing…' : 'Analyze'}
          </Button>
        </form>
        {address && !valid && <p className="mt-1.5 text-[11px] text-[var(--critical)]">Enter a 0x address with 40 hex characters.</p>}
        {error && <p className="mt-3 text-xs text-[var(--critical)]">{error}</p>}

        {busy && (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-12 w-64" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </div>
        )}

        {report && !busy && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <a className="font-mono text-foreground underline-offset-2 hover:underline" href={`${report.explorerAddress}${report.address}`} target="_blank" rel="noreferrer">
                {short(report.address)} <ArrowUpRight className="inline size-3" />
              </a>
              <span>on {report.chainName}</span>
              <span>· history from {fmtDate(report.dataFromTs)}</span>
            </div>

            {report.coveredCount === 0 ? (
              <EmptyState r={report} />
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {report.overpaidEth > 0 ? 'Could have saved by waiting' : 'Timing'}
                    </div>
                    {report.overpaidEth > 0 ? (
                      <>
                        <div className="tabular text-3xl font-semibold tracking-tight">
                          {report.overpaidUsd != null ? fmtUsd(report.overpaidUsd) : fmtNative(report.overpaidEth, report.assetSymbol)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {report.overpaidUsd != null ? `${fmtNative(report.overpaidEth, report.assetSymbol)} · ` : ''}
                          {pct != null ? `${pct}% of the fees paid` : ''}
                        </div>
                      </>
                    ) : (
                      <div className="text-xl font-semibold tracking-tight">Well timed: nothing to save</div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={copySummary}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? 'Copied' : 'Copy summary'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Stat
                    label="Fees paid"
                    value={report.paidUsd != null ? fmtUsd(report.paidUsd) : fmtNative(report.paidEth, report.assetSymbol)}
                    sub={report.paidUsd != null ? fmtNative(report.paidEth, report.assetSymbol) : undefined}
                  />
                  <Stat
                    label="Transactions"
                    value={`${report.coveredCount} analyzed`}
                    sub={report.coveredCount < report.txCount ? `${report.txCount - report.coveredCount} outside collected hours` : `all ${report.txCount} sent since ${fmtDate(report.dataFromTs)}`}
                  />
                  <Stat
                    label="Usual send time"
                    value={report.habit ? habitLocal(report.habit.how) : '–'}
                    sub={report.habit?.indexVsMedian != null ? `${Math.round(report.habit.indexVsMedian * 100)}% of the weekly median fee` : undefined}
                  />
                </div>

                {report.topTxs.length > 0 && report.overpaidEth > 0 && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Costliest timings</div>
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead className="h-8">Sent</TableHead>
                          <TableHead className="h-8 text-right">Paid</TableHead>
                          <TableHead className="h-8 text-right">Cheapest within 24h</TableHead>
                          <TableHead className="h-8 text-right">Saving</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.topTxs
                          .filter((t) => t.savingEth > 0)
                          .map((t) => (
                            <TableRow key={t.hash} className="text-xs">
                              <TableCell className="py-1.5">
                                <a className="font-mono text-primary underline-offset-2 hover:underline" href={`${report.explorerTx}${t.hash}`} target="_blank" rel="noreferrer">
                                  {fmtHourLocal(t.ts)}
                                </a>
                              </TableCell>
                              <TableCell className="tabular py-1.5 text-right">{fmtFee(t.paidGwei, 'gwei')}</TableCell>
                              <TableCell className="tabular py-1.5 text-right">
                                {fmtFee(t.bestGwei, 'gwei')} <span className="text-muted-foreground">at {fmtHourLocal(t.bestTs)}</span>
                              </TableCell>
                              <TableCell className="tabular py-1.5 text-right font-medium">{t.savingUsd != null ? fmtUsd(t.savingUsd) : fmtNative(t.savingEth, report.assetSymbol)}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Counterfactual: the hourly median base fee plus median tip within {report.waitHours}h of each send, times the gas the transaction actually used.
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
