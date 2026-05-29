/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/skinapi/:path*', destination: `${backend}/skinapi/:path*` },
      { source: '/oauth/:path*', destination: `${backend}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${backend}/.well-known/:path*` },
      { source: '/static/:path*', destination: `${backend}/static/:path*` },
    ];
  },
};

export default nextConfig;
