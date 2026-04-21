/**
 * lifecycle/cron 桶导出
 *
 * 所有后台定时任务的统一入口。
 *
 * @module packages/backend/src/lifecycle/cron
 */

export { runCleanup, type CleanupResult } from './cleanup'
export { runDreamCheck, type DreamCheckResult, type DreamCheckDeps } from './dream'
export { runLonelyScan, type LonelyScanResult, type LonelyScanDeps } from './lonelyScan'
