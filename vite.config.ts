import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Scripts only from the app itself, so injected markup cannot run code that would read the session in localStorage.
// tesseract.js loads its worker and wasm from jsDelivr; AI providers, price sources and a self-hosted model can be any https or
// local address. Only the build gets it: the dev server's React refresh needs an inline script.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
})

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png', 'theme.js'],
      workbox: { globPatterns: ['**/*.{js,css,html,woff2}'] },
      manifest: {
        name: 'JOD · จดทุกเทรด รู้ทุกบาท',
        short_name: 'JOD',
        description: 'จดบันทึกการลงทุนและการเทรด พร้อมเรทค่าเงินของทุกรายการ',
        lang: 'th',
        theme_color: '#f3f5f8',
        background_color: '#f3f5f8',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
