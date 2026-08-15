/**
 * @file electron-vite 开发配置
 * @description 同时启动 Electron 主进程 + 预加载 + Vue 前端的 Dev Server
 *
 * 启动方式: pnpm dev:electron
 *
 * @see .docs/A04_DEPLOYMENT.md — Electron 部署规范
 */

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// 从根 package.json 读取版本号
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
const APP_VERSION: string = rootPkg.version

export default defineConfig({
  // ── 主进程 ──────────────────────────────────────────────
  main: {
    // updater 必须内联进 app.asar；pnpm 的符号链接依赖不能依靠 electron-builder files 复制。
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater'] })],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: resolve(__dirname, 'electron/main/index.ts'),
        // bufferutil / utf-8-validate 是 ws 的可选原生依赖
        // 在 Electron 环境经常无法编译，ws 内部已 try/catch 容错
        // 标记为 external 避免 Rollup 尝试解析它们
        external: ['winreg', 'steamworks.js', 'bufferutil', 'utf-8-validate'],
      },
    },
  },

  // ── 预加载脚本 ────────────────────────────────────────
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload/index.ts'),
      },
    },
  },

  // ── 渲染进程 (Vue 前端) ───────────────────────────────
  renderer: {
    root: resolve(__dirname, 'packages/frontend'),
    publicDir: resolve(__dirname, 'public'),
    plugins: [vue(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'packages/frontend/src'),
        '@infos/shared': resolve(__dirname, 'packages/shared/src'),
      },
    },
    server: {
      port: 7359,
      proxy: {
        '/api': { target: 'http://localhost:9120', changeOrigin: true },
        '/ws': { target: 'ws://localhost:9120', ws: true },
      },
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'packages/frontend/index.html'),
      },
    },
  },
})
