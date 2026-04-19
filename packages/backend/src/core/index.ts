/**
 * 核心基础设施模块导出
 *
 * @module packages/backend/src/core
 */

export { PathResolver, type RuntimeEnv, type LogicalPrefix } from './pathResolver'
export {
  AssetRegistry,
  type AssetMetadata,
  type AssetSource,
  type AssetType,
} from './assetRegistry'
