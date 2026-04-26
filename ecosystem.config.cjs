/**
 * PM2 进程守护配置
 *
 * 用于 Docker 容器内和裸机部署时的后端进程管理。
 * Electron 桌面版不使用 PM2（由 Electron 主进程管理子进程）。
 *
 * 使用方式:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --env production
 *
 * 环境变量前缀: PERO_*（见 lib/env.ts + 07_DUAL_DEPLOYMENT.md §6）
 *
 * @see _docs_/07_DUAL_DEPLOYMENT.md
 * @see _docs_/15_DEVOPS_OPERATIONS.md
 */
module.exports = {
  apps: [
    {
      // ── 后端服务 ──
      name: 'perocore-backend',
      script: 'packages/backend/dist/main.js',

      // 进程管理
      instances: 1, // 单实例（SQLite 不支持多写）
      exec_mode: 'fork', // fork 模式（非 cluster）
      autorestart: true, // 异常退出自动重启
      max_restarts: 10, // 最大连续重启次数
      restart_delay: 3000, // 重启间隔 3 秒
      max_memory_restart: '512M', // 内存超限重启

      // 日志（对齐 08_LOGGING_SPEC.md: 按天轮转 + 14 天清理）
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: 'logs/perocore-error.log',
      out_file: 'logs/perocore-out.log',
      merge_logs: true,
      log_type: 'json',

      // 文件监听（开发模式用，生产关闭）
      watch: false,

      // 默认环境变量
      env: {
        NODE_ENV: 'development',
        PERO_PORT: 9120,
        PERO_HOST: '0.0.0.0', // Docker 容器内需要监听所有接口
        PERO_LOG_LEVEL: 4, // debug
      },

      // 生产环境覆盖
      env_production: {
        NODE_ENV: 'production',
        PERO_PORT: 9120,
        PERO_HOST: '0.0.0.0',
        PERO_LOG_LEVEL: 3, // info
      },
    },
  ],
}
