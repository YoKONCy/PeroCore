/**
 * Extension Manager — 统一扩展管理器
 *
 * PeroCore 扩展系统的大脑。
 * 统一管理 Tool / Hook / Service 三种扩展类型。
 *
 * 职责：
 * 1. 扫描并加载所有扩展 (内置 + 用户)
 * 2. Tool 注册与查询
 * 3. Hook 事件注册与触发
 * 4. Service 子进程生命周期管理
 * 5. 热重载 / 卸载
 * 6. 扩展列表查询 (给 Dashboard API)
 * 7. Skill 联邦发现 — 自动扫描 Extension 中的 skills/ 目录
 *
 * @module packages/backend/src/extensions/extensionManager
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type {
  ExtensionManifest,
  ToolExtension,
  ToolDefinition,
  HookExtension,
  HookEvent,
  ExtensionInfo,
  LoadedExtension,
  ExtensionStatus,
} from './types'
import { ExtensionLoader, type LoadResult } from './extensionLoader'
import { HookRegistry } from './hookRegistry'
import { ServiceRunner } from './serviceRunner'
import { createLogger } from '../lib/logger'

const logger = createLogger('ExtensionManager')

/** ExtensionManager 初始化配置 */
export interface ExtensionManagerConfig {
  /** 内置工具目录 (src/tools/) */
  builtinToolsDir: string
  /** 用户扩展目录 ($PERO_DATA_DIR/extensions/) */
  userExtensionsDir: string
}

export class ExtensionManager {
  /** 已注册的 Tool (name → ToolExtension) */
  private tools = new Map<string, ToolExtension>()

  /** Hook 注册表 */
  private hookRegistry = new HookRegistry()

  /** Service Runner (id → ServiceRunner) */
  private services = new Map<string, ServiceRunner>()

  /** 所有已加载扩展的记录 */
  private loaded = new Map<string, LoadedExtension>()

  /** 扩展加载器 */
  private loader = new ExtensionLoader()

  /** 反向通知处理器 (Service → Core，如社交适配器收到消息) */
  private serviceNotificationHandler?: (serviceId: string, method: string, params: unknown) => void

  /** 发现的 Extension skills 目录 (联邦路径) */
  private discoveredSkillDirs: string[] = []

  // ─────────────────────────────────────────
  // 公开 API: 初始化
  // ─────────────────────────────────────────

  /**
   * 扫描并加载所有扩展
   *
   * 同时自动发现每个 Extension 目录下的 skills/ 子目录，
   * 收集后可通过 getDiscoveredSkillDirs() 获取。
   */
  async loadAll(config: ExtensionManagerConfig): Promise<void> {
    logger.info('开始加载扩展...')
    this.discoveredSkillDirs = []

    // 1. 加载内置 Tool
    const builtinResults = await this.loader.scanAndLoadAll(config.builtinToolsDir)
    for (const result of builtinResults) {
      await this.registerLoadResult(result)
    }

    // 2. 加载用户扩展 (同时发现 skills/ 目录)
    const userResults = await this.loader.scanAndLoadAll(config.userExtensionsDir)
    for (const result of userResults) {
      await this.registerLoadResult(result)
      // 检查该 Extension 目录下是否有 skills/ 子目录
      this.discoverSkillsInExtension(result.dirPath)
    }

    logger.info(
      `扩展加载完成: ${this.tools.size} Tool, ` +
        `${this.hookRegistry.count} Hook, ${this.services.size} Service, ` +
        `${this.discoveredSkillDirs.length} 个 Skill 目录`,
    )
  }

  /**
   * 获取所有发现的 Extension skills 目录
   *
   * 在 loadAll() 后调用，结果传给 SkillLoader.addDirs() 完成联邦注入。
   */
  getDiscoveredSkillDirs(): string[] {
    return [...this.discoveredSkillDirs]
  }

  // ─────────────────────────────────────────
  // 公开 API: Tool
  // ─────────────────────────────────────────

  /** 获取 Tool */
  getTool(name: string): ToolExtension | undefined {
    return this.tools.get(name)
  }

  /** 获取所有 Tool 定义 (供 LLM function calling) */
  getAllToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition)
  }

  /** 按名称过滤 Tool 定义 (配合 CapabilityGate 白名单) */
  getToolDefinitions(allowedNames: Set<string>): ToolDefinition[] {
    return [...this.tools.entries()]
      .filter(([name]) => allowedNames.has(name))
      .map(([, tool]) => tool.definition)
  }

  // ─────────────────────────────────────────
  // 公开 API: Hook
  // ─────────────────────────────────────────

  /** 触发 Hook 事件 */
  async emitHook<T>(event: HookEvent, data: T): Promise<T> {
    return this.hookRegistry.emit(event, data)
  }

  // ─────────────────────────────────────────
  // 公开 API: Service
  // ─────────────────────────────────────────

  /** 调用 Service 方法 */
  async callService(serviceId: string, method: string, params: unknown): Promise<unknown> {
    const runner = this.services.get(serviceId)
    if (!runner) throw new Error(`Service "${serviceId}" 未找到`)
    return runner.call(method, params)
  }

  /** 启动 Service */
  async startService(serviceId: string): Promise<void> {
    const runner = this.services.get(serviceId)
    if (!runner) throw new Error(`Service "${serviceId}" 未找到`)
    await runner.start()
  }

  /** 停止 Service */
  async stopService(serviceId: string): Promise<void> {
    const runner = this.services.get(serviceId)
    if (!runner) throw new Error(`Service "${serviceId}" 未找到`)
    await runner.stop()
  }

  /** 注册 Service 反向通知处理器 */
  onServiceNotification(
    handler: (serviceId: string, method: string, params: unknown) => void,
  ): void {
    this.serviceNotificationHandler = handler
  }

  // ─────────────────────────────────────────
  // 公开 API: 生命周期管理
  // ─────────────────────────────────────────

  /** 热重载单个扩展 */
  async reloadExtension(extensionId: string): Promise<void> {
    const record = this.loaded.get(extensionId)
    if (!record) throw new Error(`扩展 "${extensionId}" 未找到`)

    // 1. 卸载
    await this.unloadExtension(extensionId)

    // 2. 重新加载
    const result = await this.loader.loadFromDir(record.dirPath)
    if (result) {
      await this.registerLoadResult(result)
    }

    logger.info(`扩展已热重载: ${extensionId}`)
  }

  /** 卸载扩展 */
  async unloadExtension(extensionId: string): Promise<void> {
    const record = this.loaded.get(extensionId)
    if (!record) return

    switch (record.manifest.type) {
      case 'tool': {
        const toolName = record.manifest.toolDefinition?.name ?? extensionId
        const tool = this.tools.get(toolName)
        await tool?.dispose?.()
        this.tools.delete(toolName)
        break
      }
      case 'hook': {
        this.hookRegistry.removeByExtension(extensionId)
        break
      }
      case 'service': {
        const runner = this.services.get(extensionId)
        await runner?.stop()
        this.services.delete(extensionId)
        break
      }
    }

    this.loaded.delete(extensionId)
    logger.debug(`扩展已卸载: ${extensionId}`)
  }

  /** 停止所有 Service (应用关闭时调用) */
  async shutdown(): Promise<void> {
    logger.info('正在关闭所有 Service 扩展...')
    const stopPromises = [...this.services.values()].map((runner) =>
      runner.stop().catch((err) => {
        logger.warn('Service 停止失败', { error: err })
      }),
    )
    await Promise.all(stopPromises)

    // 触发 app:onShutdown Hook
    await this.emitHook('app:onShutdown', {})

    logger.info('所有扩展已关闭')
  }

  // ─────────────────────────────────────────
  // 公开 API: 查询
  // ─────────────────────────────────────────

  /** 列出所有已加载扩展 (给 Dashboard API) */
  listExtensions(): ExtensionInfo[] {
    return [...this.loaded.values()].map((record) => ({
      id: record.manifest.id,
      name: record.manifest.name ?? record.manifest.id,
      type: record.manifest.type,
      version: record.manifest.version ?? '0.0.0',
      status:
        record.status === 'loaded' ? 'loaded' : record.status === 'error' ? 'error' : 'disabled',
    }))
  }

  /** 获取扩展详情 */
  getExtension(extensionId: string): LoadedExtension | undefined {
    return this.loaded.get(extensionId)
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /** 注册加载结果 */
  private async registerLoadResult(result: LoadResult): Promise<void> {
    const { manifest, dirPath, module, error } = result
    const status: ExtensionStatus = error ? 'error' : 'loaded'

    // 记录加载信息
    this.loaded.set(manifest.id, {
      manifest,
      dirPath,
      status,
      error,
      loadedAt: new Date().toISOString(),
    })

    if (error || !module) {
      if (manifest.type === 'service' && !error) {
        // Service 类型: 注册 Runner，不需要 module
        this.registerService(manifest, dirPath)
      }
      return
    }

    // 按类型注册
    switch (manifest.type) {
      case 'tool':
        await this.registerTool(manifest, module as ToolExtension)
        break
      case 'hook':
        this.registerHook(manifest, module as HookExtension)
        break
    }
  }

  /** 注册 Tool */
  private async registerTool(manifest: ExtensionManifest, tool: ToolExtension): Promise<void> {
    const name = tool.definition?.name ?? manifest.toolDefinition?.name ?? manifest.id

    // ESM 模块对象可能是 frozen 的，不能直接赋值属性
    // 若 definition 不存在，用包装对象补全
    let registeredTool = tool
    if (!tool.definition) {
      registeredTool = {
        ...tool,
        definition: {
          name,
          description: manifest.description ?? manifest.name ?? name,
          parameters: manifest.toolDefinition?.parameters ?? {
            type: 'object' as const,
            properties: {},
          },
        },
      }
    }

    await registeredTool.onLoad?.()
    this.tools.set(name, registeredTool)
    logger.debug(`Tool 已注册: ${name}`)
  }

  /** 注册 Hook */
  private registerHook(manifest: ExtensionManifest, hook: HookExtension): void {
    for (const [event, handler] of Object.entries(hook.hooks)) {
      if (handler) {
        this.hookRegistry.register(event as HookEvent, manifest.id, handler)
      }
    }
    hook.onLoad?.().catch((err) => {
      logger.warn(`Hook ${manifest.id} onLoad 失败`, { error: err })
    })
  }

  /** 注册 Service */
  private registerService(manifest: ExtensionManifest, dirPath: string): void {
    const runner = new ServiceRunner(manifest, dirPath)

    // 设置反向通知
    if (this.serviceNotificationHandler) {
      const serviceId = manifest.id
      runner.onNotification((method, params) => {
        this.serviceNotificationHandler!(serviceId, method, params)
      })
    }

    this.services.set(manifest.id, runner)
    logger.debug(`Service 已注册 (未启动): ${manifest.id}`)
  }

  /** 检查 Extension 目录下是否有 skills/ 子目录 */
  private discoverSkillsInExtension(extDirPath: string): void {
    const skillsDir = path.join(extDirPath, 'skills')
    if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
      this.discoveredSkillDirs.push(skillsDir)
      logger.debug(`发现 Extension skills 目录: ${skillsDir}`)
    }
  }
}
