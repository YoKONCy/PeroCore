/**
 * 数据库模块导出
 *
 * @module packages/backend/src/database
 */

export { createDrizzleConnection, closeDrizzleConnection, type DrizzleDb } from './connection'
export * as schema from './schema'
