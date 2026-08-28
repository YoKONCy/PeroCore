/**
 * socialMessage.repo — 持久化仓储
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
export type { SocialStoragePort } from '../applications/socialPorts'
export { SqliteSocialStoragePort } from '../applications/sqliteSocialStoragePort'
