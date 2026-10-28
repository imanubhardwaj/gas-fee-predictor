import { describe, expect, it } from 'vitest';
import { resolveWindow } from '../src/windows';
import { planEvmChunks } from '../src/jobs/sync';
import { CHAINS } from '../src/chains';
import { Store } from '../src/db';
import { DAY } from '../src/time';

const NOW = 1_790_000_000;

describe('resolveWindow', () => {
  it('clips to stored coverage and flags truncation', () => {
    const w = resolveWindow('1y', NOW, NOW - 28 * DAY);
    expect(w.fromTs).toBe(NOW - 28 * DAY);
    expect(w.truncated).toBe(true);
    expect(w.weeks).toBe(4);
  });
  it('uses everything for "all" and does not flag it', () => {
    const w = resolveWindow('all', NOW, NOW - 100 * DAY);
    expect(w.fromTs).toBe(NOW - 100 * DAY);
    expect(w.truncated).toBe(false);
  });
  it('keeps a full window when data reaches further back', () => {
    const w = resolveWindow('1w', NOW, NOW - 60 * DAY);
    expect(w.fromTs).toBe(NOW - 7 * DAY);
    expect(w.truncated).toBe(false);
    expect(w.weeks).toBe(1);
  });
});

describe('planEvmChunks', () => {
  it('collects Ethereum contiguously and refills gaps', () => {
    const store = new Store(':memory:');
    const latest = 20_000;
    store.upsertEvmBlocks('eth', [10_000, 10_001, 10_003].map((n) => ({ number: n, ts: n, baseFee: 1, tipP10: 0, tipP50: 0, tipP90: 0, gasUsedRatio: 0 })));
    const chunks = planEvmChunks(CHAINS.eth, latest, 0, store);
    expect(chunks[0]).toEqual([10_004, 11_027]);
    expect(chunks.at(-1)).toEqual([10_002, 10_002]);
    store.close();
  });
  it('samples one chunk per hour on fast chains and respects the history floor', () => {
    const store = new Store(':memory:');
    const latest = 1_000_000;
    const chunks = planEvmChunks(CHAINS.base, latest, 1, store);
    expect(chunks).toHaveLength(25);
    expect(chunks[0]).toEqual([latest - 1023, latest]);
    expect(chunks[1]).toEqual([latest - 1800 - 1023, latest - 1800]);
    const avax = planEvmChunks(CHAINS.avax, latest, 28, store);
    expect(avax.length).toBeLessThanOrEqual(14);
    const fast = planEvmChunks(CHAINS.bnb, latest, 1, store, 8000);
    expect(fast[1]).toEqual([latest - 8000 - 1023, latest - 8000]);
    store.close();
  });
});
