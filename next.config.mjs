/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // `mssql` and `pg` are native-ish Node drivers with dynamic requires. Keeping
  // them external stops the bundler from trying to trace optional dependencies
  // (tedious' MSAL paths, pg-native) that are never used at runtime.
  serverExternalPackages: ['mssql', 'pg', 'bcryptjs'],
};

export default nextConfig;
