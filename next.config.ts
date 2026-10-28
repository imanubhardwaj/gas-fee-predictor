import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // node:sqlite and the fee collectors run in the Node runtime only.
  serverExternalPackages: [],
  // The SQLite seed is read at runtime, so file tracing must ship it with the API route.
  outputFileTracingIncludes: { '/api/**': ['./snapshot/gas.sqlite'] },
};

export default nextConfig;
