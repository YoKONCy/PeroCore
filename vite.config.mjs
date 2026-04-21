import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false
    },
    fs: {
      // 限制 Vite 只允许访问项目根目录以内的文件
      strict: false
    }
  },
  // 排除非源码目录，防止 Vite 依赖扫描器扫描到无关的 HTML 文件
  // (如 resources/python/Lib/site-packages 中的 pygame、win32com 文档等)
  build: {
    rollupOptions: {
      external: []
    }
  },
  optimizeDeps: {
    // 排除会被扫描到的非源码目录中的内容，并且不扫描 native 文件夹
    entries: [
      'index.html',
      'src/**/*.{vue,ts,js,tsx,jsx}',
      '!src/components/avatar/native/**/*'
    ],
    // 这里也可以显式 exclude 那些未安装的可选平台包，防止误报
    exclude: [
      'pero-render-core-win32-x64-msvc',
      'pero-render-core-darwin-arm64',
      'pero-render-core-linux-x64-gnu'
    ],
    force: true,
    include: [
      'vue',
      'vue-router',
      'echarts',
      'marked',
      'dompurify',
      'three',
      'three/addons/controls/OrbitControls.js',
      'axios',
      'dayjs',
      'highlight.js',
      'lucide-vue-next',
      'qrcode.vue'
    ]
  }
}))
