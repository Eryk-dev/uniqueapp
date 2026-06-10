/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['pdfkit'],
    instrumentationHook: true,
  },
};

export default nextConfig;
