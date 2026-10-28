import { Store, type HourlyRow } from '../db';
import { isChainId, type ChainId } from '../chains';
import { forecast } from '../forecast';
import { hourStart, HOUR, DAY, WEEK } from '../time';
import { parseArgs, num } from './args';

const args = parseArgs(process.argv.slice(2));
const chainArg = typeof args.chain === 'string' ? args.chain : 'eth';
if (!isChainId(chainArg)) throw new Error(`unknown chain ${chainArg}`);
const chain: ChainId = chainArg;
const days = num(args.days, 14);
const weeks = num(args.weeks, 8);
const minWeeksTraining = num(args['min-train-weeks'], 2);
const tau = num(args.tau, 96);
const halfLife = num(args['half-life'], 2);
const strength = num(args.strength, 0.5);
const shrinkK = num(args.shrink, 6);
const stepHours = num(args['step-hours'], 6);

const store = new Store();
const nowTs = hourStart(Math.floor(Date.now() / 1000));
const all = store.getHourly(chain, nowTs - (weeks + 1) * WEEK - days * DAY, nowTs);
store.close();
const byTs = new Map<number, HourlyRow>(all.map((r) => [r.ts, r]));
const firstTs = all[0]?.ts ?? nowTs;

interface Acc {
  n: number;
  apeModel: number;
  apeNaive: number;
  sqlogModel: number;
  sqlogNaive: number;
  covered: number;
}
const blank = (): Acc => ({ n: 0, apeModel: 0, apeNaive: 0, sqlogModel: 0, sqlogNaive: 0, covered: 0 });
const acc = { short: blank(), long: blank() };
let windows = 0;
const windowSavingsRealized: number[] = [];
const windowSavingsOracle: number[] = [];
let origins = 0;

for (let origin = nowTs - (nowTs % DAY) - days * DAY; origin <= nowTs - 24 * HOUR; origin += stepHours * HOUR) {
  if (origin - firstTs < minWeeksTraining * WEEK) continue;
  const train = all.filter((r) => r.ts < origin);
  let f;
  try {
    f = forecast(chain, train, origin, 168, { weeks, levelTauHours: tau, halfLifeWeeks: halfLife, seasonalStrength: strength, shrinkK });
  } catch {
    continue;
  }
  origins++;
  const nowVal = f.now.value;
  for (const p of f.points) {
    const actual = byTs.get(p.ts);
    if (!actual || actual.p50 <= 0) continue;
    const h = (p.ts - origin) / HOUR;
    const a = h <= 24 ? acc.short : acc.long;
    a.n++;
    a.apeModel += Math.abs(p.p50 - actual.p50) / actual.p50;
    a.apeNaive += Math.abs(nowVal - actual.p50) / actual.p50;
    const la = Math.log(actual.p50);
    a.sqlogModel += (Math.log(Math.max(p.p50, 1e-12)) - la) ** 2;
    a.sqlogNaive += (Math.log(Math.max(nowVal, 1e-12)) - la) ** 2;
    if (actual.p50 >= p.p10 && actual.p50 <= p.p90) a.covered++;
  }
  const w = f.best.next24h;
  const originActual = byTs.get(origin - HOUR)?.p50 ?? nowVal;
  if (w && originActual > 0) {
    const realized = byTs.get(w.minTs)?.p50;
    const next24 = f.points.slice(0, 24).map((p) => byTs.get(p.ts)?.p50).filter((v): v is number => v != null);
    if (realized != null && next24.length) {
      windows++;
      windowSavingsRealized.push(1 - realized / originActual);
      windowSavingsOracle.push(1 - Math.min(...next24) / originActual);
    }
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const row = (label: string, a: Acc) =>
  a.n === 0
    ? `${label}: no data`
    : `${label}: n=${a.n}  MAPE model ${pct(a.apeModel / a.n)} vs persistence ${pct(a.apeNaive / a.n)}  log-RMSE model ${Math.sqrt(a.sqlogModel / a.n).toFixed(2)} vs persistence ${Math.sqrt(a.sqlogNaive / a.n).toFixed(2)}  band coverage ${pct(a.covered / a.n)}`;

console.log(`backtest ${chain}: ${origins} origins every ${stepHours}h over the last ${days} days, ${weeks}-week window, tau ${tau}h, half-life ${halfLife}w, strength ${strength}, shrink ${shrinkK}`);
console.log(row('  1–24h ', acc.short));
console.log(row('  25–168h', acc.long));
if (windows) {
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] as number;
  };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `  best-window (next 24h): following the call saved median ${pct(med(windowSavingsRealized))} / mean ${pct(mean(windowSavingsRealized))}; oracle median ${pct(med(windowSavingsOracle))} (${windows} windows)`,
  );
}
console.log('  coverage target for p10–p90 is 80%; MAPE below persistence means the seasonal profile adds information.');
