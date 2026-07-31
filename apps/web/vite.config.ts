import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Anklav',
        short_name: 'Anklav',
        description: 'A flow-based control room for AI-assisted software development.',
        theme_color: '#10131a',
        background_color: '#10131a',
        display: 'standalone',
        icons: [{ src: '/anklav-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico}'] },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3000', '/mcp': 'http://localhost:3000', '/oauth': 'http://localhost:3000', '/.well-known': 'http://localhost:3000' } },
});
