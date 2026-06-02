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
      {
        // Yggdrasil API 地址指示（ALI）—— authlib-injector 规范
        // 启动器访问站点首页时，通过此头自动发现 Yggdrasil API 地址
        // 用户只需输入站点域名，启动器即可自动找到 /skinapi/ 端点
        source: '/:path*',
        headers: [
          { key: 'X-Authlib-Injector-API-Location', value: '/skinapi/' },
        ],
      },
    ];
  },
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/oauth/:path*', destination: `${backend}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${backend}/.well-known/:path*` },
      { source: '/static/:path*', destination: `${backend}/static/:path*` },
      // CustomSkinAPI（CustomSkinLoader Mod 用）
      { source: '/csl/:path*', destination: `${backend}/api/csl/:path*` },
      // MCA world data files served by Caddy directly (backend manages /resource/mca/)
      { source: '/resource/:path*', destination: `${backend}/resource/:path*` },
      // Compiled resource packs (frontend static assets)
      { source: '/packs/:path*', destination: `${backend}/packs/:path*` },
    ];
  },
};

export default nextConfig;
