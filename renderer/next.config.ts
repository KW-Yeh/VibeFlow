import { NextConfig } from 'next'

const config: NextConfig = {
  output: 'export',
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  experimental: { externalDir: true },
  images: {
    unoptimized: true,
  },
}

export default config
