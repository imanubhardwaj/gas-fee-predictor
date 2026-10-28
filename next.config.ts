import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // node:sqlite and the fee collectors run in the Node runtime only.
  serverExternalPackages: [],
};

export default nextConfig;
