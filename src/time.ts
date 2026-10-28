export const HOUR = 3600;
export const DAY = 86_400;
export const WEEK = 7 * DAY;

export const hourStart = (ts: number) => ts - (ts % HOUR);
export const dayStart = (ts: number) => ts - (ts % DAY);

/** Hour-of-week index in UTC: Sunday 00:00 = 0 … Saturday 23:00 = 167. */
export function hourOfWeek(ts: number): number {
  const d = new Date(ts * 1000);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function labelHow(k: number): string {
  return `${DOW[Math.floor(k / 24)]} ${String(k % 24).padStart(2, '0')}:00 UTC`;
}
