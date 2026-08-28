/**
 * discovery — 客户端服务
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { ApplicationDiscoveryRecord } from '@infos/shared'

export type ClientDiscoveryRecord = ApplicationDiscoveryRecord

declare global {
  interface Window {
    __ARCA_DISCOVERY__?: ClientDiscoveryRecord
  }
}

export function resolveArcaEndpoint(): string | undefined {
  const query = new URLSearchParams(window.location.search).get('endpoint')
  if (query) return query
  if (window.__ARCA_DISCOVERY__?.endpoint) return window.__ARCA_DISCOVERY__.endpoint
  const environment = import.meta.env.VITE_ARCA_ENDPOINT
  return typeof environment === 'string' && environment ? environment : undefined
}
