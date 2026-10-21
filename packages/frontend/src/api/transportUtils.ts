/**
 * 传输层工具 — 共享辅助函数
 *
 * 抽取 Transport 层的公共逻辑，避免各模块重复计算 baseUrl。
 *
 * @module packages/frontend/src/api/transportUtils
 */

import { getWebServerOrigin } from './transport'

/** 获取当前环境的 API 基址 */
export function getBaseUrl(): string {
  return getWebServerOrigin()
}
