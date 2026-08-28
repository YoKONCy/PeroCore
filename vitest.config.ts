import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

/**
 * @file Vitest 全局配置
 * @description规范
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    // 全局 API（不需要每个文件 import describe/it/expect）
    globals: true,

    // 默认测试环境（后端用 node，前端各包覆盖为 happy-dom）
    environment: 'node',

    // 文件匹配（除 tests/ 目录外，也支持源码内的 __tests__ 同位目录）
    include: [
      'packages/*/tests/**/*.{test,spec}.{ts,tsx}',
      'packages/apps/*/tests/**/*.{test,spec}.{ts,tsx}',
      'packages/*/src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      'electron/main/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/constants/**',
        '**/index.ts',
      ],
      // 覆盖率红线
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },

    // 路径别名（与 tsconfig 对齐）
    alias: {
      '@infos/shared': resolve(__dirname, 'packages/shared/src'),
      '@infos/backend': resolve(__dirname, 'packages/backend/src'),
      '@infos/document-engine': resolve(__dirname, 'packages/document-engine/src'),
      '@infos/node-sdk': resolve(__dirname, 'packages/node-sdk/src'),
      '@infos/node-host': resolve(__dirname, 'packages/node-host/src'),
      '@infos/frontend': resolve(__dirname, 'packages/frontend/src'),
      '@infos/arca': resolve(__dirname, 'packages/apps/arca/src'),
      '@infos/social': resolve(__dirname, 'packages/apps/social'),
    },
  },
})
