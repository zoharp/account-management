/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // `mssql` and `pg` are native-ish Node drivers with dynamic requires. Keeping
  // them external stops the bundler from trying to trace optional dependencies
  // (tedious' MSAL paths, pg-native) that are never used at runtime.
  serverExternalPackages: ['mssql', 'pg', 'bcryptjs'],

  /**
   * Response headers for every route.
   *
   * `frame-ancestors 'none'` is the one that matters: without it this console
   * can be framed, and a click on an invisible overlay lands on Delete account
   * or a module toggle. It is sent as CSP rather than only `X-Frame-Options`
   * because that is the directive modern browsers actually honour — the older
   * header stays for anything that does not read CSP.
   *
   * NOT a full CSP. `script-src` needs a nonce integration with Next's inline
   * bootstrap before it can be added without breaking the app; see SECURITY.md.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
