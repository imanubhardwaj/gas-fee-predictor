/** Minimal --key value / --flag parser. */
export function parseArgs(argv: readonly string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

export const num = (v: string | boolean | undefined, d: number) => (typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : d);
