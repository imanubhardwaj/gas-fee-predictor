import { handle } from 'hono/vercel';
import { Hono } from 'hono';
import { createApp } from '@/src/api/app';
import { getStore } from '@/src/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const app = new Hono().basePath('/api').route('/', createApp(getStore()));

export const GET = handle(app);
export const POST = handle(app);
