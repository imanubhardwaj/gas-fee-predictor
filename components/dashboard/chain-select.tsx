'use client';

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ChainInfo, ChainId } from '@/lib/api';
import { cn } from '@/lib/utils';

const GROUPS: Array<{ kind: ChainInfo['kind']; label: string }> = [
  { kind: 'evm', label: 'EVM chains' },
  { kind: 'btc', label: 'Bitcoin' },
  { kind: 'sol', label: 'Solana' },
];

function Dot({ info, className }: { info: ChainInfo; className?: string }) {
  const empty = info.coverage.count === 0;
  return <span className={cn('size-1.5 shrink-0 rounded-full', empty ? 'bg-[var(--warning)]' : 'bg-[var(--good)]', className)} title={empty ? 'No data collected yet' : `${info.coverage.count} hours collected`} />;
}

export function ChainSelect({ chains, value, onChange }: { chains: ChainInfo[]; value: ChainId; onChange: (id: ChainId) => void }) {
  const current = chains.find((c) => c.id === value);
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as ChainId)}>
      <SelectTrigger className="h-8 w-[220px] bg-card" aria-label="Chain">
        <SelectValue>
          {current ? (
            <span className="flex items-center gap-2">
              <Dot info={current} />
              <span className="font-medium">{current.name}</span>
              <span className="text-xs text-muted-foreground">{current.unitShort}</span>
            </span>
          ) : (
            'Chain'
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {GROUPS.map((g) => {
          const items = chains.filter((c) => c.kind === g.kind);
          if (items.length === 0) return null;
          return (
            <SelectGroup key={g.kind}>
              <SelectLabel>{g.label}</SelectLabel>
              {items.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex w-full items-center gap-2">
                    <Dot info={c} />
                    <span>{c.name}</span>
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">{c.unitShort}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
