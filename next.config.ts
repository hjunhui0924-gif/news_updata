import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.STARRED_E2E === 'true' ? '.next-e2e' : '.next',
  output: 'standalone',
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['pg', 'pg-boss', 'pino'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
