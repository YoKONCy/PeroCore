/**
 * @file ESLint 配置
 * @description ESLint 项目级代码规范配置
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  globals: {
    /** Vite define 注入的构建时常量 */
    __APP_VERSION__: 'readonly',
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
    'plugin:prettier/recommended',
  ],
  plugins: ['@typescript-eslint'],
  rules: {
    // TypeScript 规则
    // strict/noImplicitAny 已禁止隐式 any；动态模块、IPC 与外部数据边界允许显式标注 any。
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // isolatedModules 已负责校验类型导入是否可安全擦除，避免重复的纯风格告警。
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    // 项目开启 noUncheckedIndexedAccess；循环边界已验证后的数组索引需要显式非空断言。
    '@typescript-eslint/no-non-null-assertion': 'off',
    // Electron 主进程需要在运行时动态 require native 模块，全局降为 warn
    '@typescript-eslint/no-require-imports': 'warn',
    // TS 编译器已覆盖 no-undef 检查，ESLint 的 no-undef 在 TS 项目中会误报 (如 Vite define 常量)
    'no-undef': 'off',

    // Vue 规则
    'vue/multi-word-component-names': 'off',
    'vue/no-v-html': 'off',

    // 通用规则
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      // Electron 主进程 — 允许 require() 动态导入 (Node.js CJS 上下文)
      files: ['electron/**/*.ts', '**/electron/**/*.ts'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
    {
      // 可执行入口、日志器、构建脚本与浏览器扩展以标准输出作为正式输出边界。
      files: [
        'scripts/**/*.{js,ts,cjs,mjs}',
        'packages/backend/src/main.ts',
        'packages/backend/src/lib/logger.ts',
        'packages/backend/src/lib/processGuards.ts',
        'packages/backend/src/nit/runtime.ts',
        'packages/daemon/src/main.ts',
        'packages/browser-extension/**/*.js',
        'packages/frontend/src/lib/logger.ts',
        'packages/frontend/src/components/terminal/TerminalPanel.vue',
        'electron/main/utils/{env,logger}.ts',
      ],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['dist', 'dist-electron', 'release-electron', 'node_modules', '*.d.ts'],
}
