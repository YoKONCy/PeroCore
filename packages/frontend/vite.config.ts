import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// 从根 package.json 读取版本号，注入到前端构建中
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
const APP_VERSION: string = rootPkg.version

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // 静态资源统一使用项目根目录的 public/
  publicDir: resolve(__dirname, '../../public'),
  define: {
    /** 构建时注入的应用版本号常量 (由根 package.json 提供) */
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
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
  build: {
    rollupOptions: {
      output: {
        /**
         * 手动分包 — 遵循
         * 将大型第三方库拆分为独立 chunk，减小首屏 JS 体积。
         */
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-three': ['three'],
          'vendor-markdown': ['marked', 'dompurify'],
        },
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 小于 4KB 的资源内联为 base64
    assetsInlineLimit: 4096,
  },
})
