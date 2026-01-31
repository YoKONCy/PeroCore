import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false
    }
  },
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'element-plus',
      'echarts',
      'marked',
      'dompurify',
      '@element-plus/icons-vue'
    ]
  }
}))
