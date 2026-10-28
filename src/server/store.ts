import { Store } from '../db';

/** One SQLite handle per process, surviving Next.js dev-server module reloads. */
const g = globalThis as unknown as { __gasForecastStore?: Store };

export function getStore(): Store {
  if (!g.__gasForecastStore) g.__gasForecastStore = new Store();
  return g.__gasForecastStore;
}
