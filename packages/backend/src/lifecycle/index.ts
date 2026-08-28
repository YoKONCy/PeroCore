/**
 * Lifecycle 模块导出
 *
 * 应用生命周期管理：启动 / 定时任务 / 关闭。
 *
 * @module packages/backend/src/lifecycle
 */

export { runStartupTasks } from './startup'
export { runCleanup, runDreamCheck } from './cron'
