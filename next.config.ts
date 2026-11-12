import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The Keeta SDK + anchor client + postgres use native / dynamic modules that
  // must not be bundled by webpack — load them at runtime from node_modules.
  serverExternalPackages: [
    '@keetanetwork/keetanet-client',
    '@keetanetwork/anchor',
    'postgres',
  ],
};

export default nextConfig;
