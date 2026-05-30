/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // COOP/COEP headers required for SharedArrayBuffer (WASM engine / campus page)
        source: '/campus',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // Also apply COOP/COEP for resource subrequests from campus page
        source: '/resource/:path*',
        headers: [
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
      {
        // Allow packs resources to be loaded cross-origin
        source: '/packs/:path*',
        headers: [
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
    ];
  },
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/skinapi/:path*', destination: `${backend}/skinapi/:path*` },
      { source: '/oauth/:path*', destination: `${backend}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${backend}/.well-known/:path*` },
      { source: '/static/:path*', destination: `${backend}/static/:path*` },
      // MCA world data files served by Caddy directly (backend manages /resource/mca/)
      { source: '/resource/:path*', destination: `${backend}/resource/:path*` },
      // Compiled resource packs (frontend static assets)
      { source: '/packs/:path*', destination: `${backend}/packs/:path*` },
    ];
  },
};

export default nextConfig;
