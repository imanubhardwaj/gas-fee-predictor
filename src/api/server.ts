import { serve } from '@hono/node-server';
import { config } from '../config';
import { Store } from '../db';
import { createApp } from './app';

const store = new Store();
const app = createApp(store);
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`gas-forecast api listening on http://localhost:${info.port} (db: ${config.dbPath})`);
});
process.on('SIGINT', () => {
  store.close();
  process.exit(0);
});
