/**
 * tabRegistry — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { Component } from 'vue'
import { arcaManifest } from '@infos/arca/manifest'
import { applicationSurfaceRegistry, defineApplicationSurface } from '../../applications'

export type TabModule = { default: Component }
export type TabLoader = () => Promise<TabModule>

const loaders: Record<string, TabLoader> = {
  chat: () => import('../../components/main/tabs/ChatTab.vue'),
  workspace: () => import('../../components/main/tabs/WorkspaceTab.vue'),
  overview: () => import('../../components/dashboard/tabs/OverviewTab.vue'),
  logs: () => import('../../components/dashboard/tabs/LogsTab.vue'),
  memories: () => import('../../components/dashboard/tabs/MemoriesTab.vue'),
  knowledge: () => import('../../components/dashboard/tabs/KnowledgeTab.vue'),
  tasks: () => import('../../components/dashboard/tabs/TasksTab.vue'),
  stronghold: () => import('../../components/main/tabs/StrongholdTab.vue'),
  agent_config: () => import('../../components/dashboard/tabs/AgentConfigTab.vue'),
  user_settings: () => import('../../components/dashboard/tabs/UserSettingsTab.vue'),
  model_config: () => import('../../components/dashboard/tabs/ModelConfigTab.vue'),
  voice_config: () => import('../../components/dashboard/tabs/VoiceTab.vue'),
  mcp_config: () => import('../../components/dashboard/tabs/McpTab.vue'),
  distributed: () => import('../../components/dashboard/tabs/DistributedTab.vue'),
  social: () => import('../../components/dashboard/tabs/SocialTab.vue'),
  terminal: () => import('../../components/dashboard/tabs/TerminalTab.vue'),
  system_reset: () => import('../../components/dashboard/tabs/ResetTab.vue'),
}

applicationSurfaceRegistry.register(
  defineApplicationSurface({
    manifest: arcaManifest,
    surfaceId: 'workbench',
    load: () => import('../../components/dashboard/tabs/ArcaTab.vue'),
  }),
)

for (const surface of applicationSurfaceRegistry.list('main.tab')) {
  loaders[
    surface.appId === 'infos.arca' ? 'arca' : `${surface.appId}:${surface.declaration.surfaceId}`
  ] = surface.load as TabLoader
}

const pending = new Map<string, Promise<TabModule>>()
const ready = new Set<string>()

export function getTabLoader(id: string): TabLoader | undefined {
  const loader = loaders[id]
  if (!loader) return undefined
  return () => preloadTab(id)
}

export function isTabReady(id: string): boolean {
  return ready.has(id)
}

/** 同一 Tab 的下载、解析和模块执行始终复用同一个 Promise。 */
export function preloadTab(id: string): Promise<TabModule> {
  const cached = pending.get(id)
  if (cached) return cached
  const loader = loaders[id]
  if (!loader) return Promise.reject(new Error(`未知 Tab: ${id}`))
  const promise = loader()
    .then((module) => {
      ready.add(id)
      return module
    })
    .catch((error) => {
      pending.delete(id)
      throw error
    })
  pending.set(id, promise)
  return promise
}
