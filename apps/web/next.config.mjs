/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@mafia/shared'],
  // The dev overlay badge sits on top of the bottom-left of the UI, which is
  // exactly where the screens put their footer rules.
  devIndicators: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ['framer-motion'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
