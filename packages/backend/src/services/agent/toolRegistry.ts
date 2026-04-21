/**
 * Tool Registry — 工具注册表
 *
 * 统一管理所有可供 Agent 调用的工具。
 * B6 升级: 与 ExtensionManager 双向桥接。
 *
 * 工具注册两条路径:
 * 1. 静态注册: registerBuiltinTools() (src/tools/index.ts)
 * 2. 动态注册: syncFromExtensionManager() (用户扩展)
 *
 * 两者注册后均可通过 CapabilityGate 白名单过滤。
 *
 * @module packages/backend/src/services/agent/toolRegistry
 */

import type { ToolDefinition } from '../pipeline/types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ToolRegistry')

/** 工具处理函数 */
export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<string>

/** 工具执行上下文 */
export interface ToolContext {
  source: string
  agentId: string
  sessionId: string
}

/** 注册的工具 */
interface RegisteredTool {
  definition: ToolDefinition
  handler: ToolHandler
  /** 允许的 source 模式 (空=全部允许) */
  allowedSources?: string[]
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  /** 注册工具 */
  register(definition: ToolDefinition, handler: ToolHandler, allowedSources?: string[]): void {
    this.tools.set(definition.name, {
      definition,
      handler,
      allowedSources,
    })
    logger.debug(`工具已注册: ${definition.name}`)
  }

  /** 批量注册 */
  registerAll(
    tools: Array<{
      definition: ToolDefinition
      handler: ToolHandler
      allowedSources?: string[]
    }>,
  ): void {
    for (const t of tools) {
      this.register(t.definition, t.handler, t.allowedSources)
    }
  }

  /**
   * 从 ExtensionManager 同步 Tool 扩展
   *
   * 将 ExtensionManager 中所有 ToolExtension 桥接注册到 ToolRegistry。
   * 已存在的同名工具不会被覆盖 (静态内置工具优先)。
   */
  syncFromExtensionManager(extensionManager: {
    getAllToolDefinitions(): Array<{ name: string; description: string; parameters?: unknown }>
    getTool(name: string):
      | {
          execute?(
            args: Record<string, unknown>,
            ctx: unknown,
          ): Promise<{ success: boolean; data?: unknown; error?: string }>
        }
      | undefined
  }): number {
    const definitions = extensionManager.getAllToolDefinitions()
    let synced = 0

    for (const def of definitions) {
      if (!def?.name) continue // 防御性跳过无效定义

      // 静态内置工具优先，不覆盖
      if (this.tools.has(def.name)) {
        logger.debug(`跳过已注册工具: ${def.name} (内置优先)`)
        continue
      }

      const tool = extensionManager.getTool(def.name)
      if (!tool?.execute) {
        logger.debug(`ExtensionManager Tool ${def.name} 无顶层 execute (可能是多工具模块，已通过内置注册)`)
        continue
      }

      const handler: ToolHandler = async (args, ctx) => {
        const result = await tool.execute!(args, ctx)
        // ToolResult → string 适配
        if (!result.success) {
          return result.error ?? '工具执行失败'
        }
        return typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? '')
      }

      this.register(
        {
          name: def.name,
          description: def.description,
          parameters: def.parameters as Record<string, unknown>,
        },
        handler,
      )
      synced++
    }

    if (synced > 0) {
      logger.info(`从 ExtensionManager 同步 ${synced} 个工具`)
    }
    return synced
  }

  /** 获取工具处理函数 */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler
  }

  /** 获取允许在指定 source 下使用的工具定义列表 */
  getDefinitions(source?: string): ToolDefinition[] {
    const result: ToolDefinition[] = []
    for (const tool of this.tools.values()) {
      if (source && tool.allowedSources?.length) {
        if (!tool.allowedSources.includes(source)) continue
      }
      result.push(tool.definition)
    }
    return result
  }

  /** 获取所有工具定义 (不过滤) */
  getAllDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition)
  }

  /** 检查工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** 已注册工具数 */
  get size(): number {
    return this.tools.size
  }
}
