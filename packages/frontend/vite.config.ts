import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // 开发时代理后端 API
    proxy: {
      '/api': {
        target: 'http://localhost:9120',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:9120',
        ws: true,
      },
    },
  },
})
