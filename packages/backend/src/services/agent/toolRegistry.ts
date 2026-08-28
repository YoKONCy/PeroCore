/**
 * Tool Registry — 工具注册表
 *
 * 统一管理所有可供 Agent 调用的工具。
 * 工具注册两条路径:
 * 1. 静态注册: registerBuiltinTools() (src/tools/index.ts)
 * 2. Package Tool Contribution: PackageRuntime 激活时注册
 *
 * 两者注册后均可通过 CapabilityGate 白名单过滤。
 *
 * @module packages/backend/src/services/agent/toolRegistry
 */

import type { ToolDefinition } from '../pipeline/types'
import type { ToolExecutionResult } from './reactLoop'
import type { StructuredToolResult } from '../execution/toolResult'
import { createLogger } from '../../lib/logger'
import { isStrongholdChannelTool } from '../../tools/systemProtocolTools'

const logger = createLogger('ToolRegistry')

/** 工具处理函数 */
export type ToolHandlerResult = string | ToolExecutionResult | StructuredToolResult
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolHandlerResult>

/**
 * 工具执行上下文
 *
 * AIOS: 新增 threadId + channel 字段，工具可感知 Thread 上下文。
 * - threadId: 当前对话 Thread ID（用于持久化、状态查询）
 * - channel: 当前对话通道（desktop/companion/social/group，用于权限/行为分支）
 * - source/sessionId: 保留向后兼容，新代码请用 threadId/channel
 */
export interface ToolContext {
  /** 消息来源（向后兼容，等价于 channel） */
  source: string
  /** Agent ID */
  agentId: string
  /** 会话 ID（向后兼容，等价于 threadId） */
  sessionId: string
  /** AIOS: Thread ID（新版工具应优先使用此字段） */
  threadId: string
  /** AIOS: 对话通道（desktop/companion/social/group） */
  channel: string
  /** 当前对话轮次 ID，文件变更快照按此绑定。 */
  pairId?: string
  /** 当前函数调用 ID，用于审计轮内具体工具操作。 */
  toolCallId?: string
  /** 当前 ReAct/任务的取消信号，长时工具必须主动监听。 */
  signal?: AbortSignal
  /** 后台任务 ID；普通对话为空。 */
  taskId?: string
  /** 当前 Kernel Execution，用于副作用、Receipt和跨 Node调用的统一因果链。 */
  executionId?: import('@infos/shared').KernelExecutionId
  processId?: import('@infos/shared').KernelProcessId
  deadline?: string
  /** 本次敏感调用已经用户逐次审批；不得跨调用持久化或复用。 */
  approvedSensitiveAction?: boolean
  /** 纯读取/搜索工具可访问设备路径；不表示用户批准过写入越界。 */
  deviceReadScope?: boolean
  /** 本次调用已经用户审批，可访问 ResourceScope 外的路径；不得跨调用持久化。 */
  approvedOutsideWorkspace?: boolean
}

/** 注册的工具 */
interface RegisteredTool {
  definition: ToolDefinition
  handler: ToolHandler
  /** 允许的 source 模式 (空=全部允许) */
  allowedSources?: string[]
  /** 所属应用 ID（应用工具专属，主 Agent 工具为 undefined） */
  appId?: string
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()
  /**
   * 应用工具命名空间（appId → 工具集）
   *
   * 应用工具用点号前缀隔离（如 coding.git_diff）。
   * 主 Agent 不自动获得应用工具。
   * 应用停止时调用 unregisterAppTools 清理。
   */
  private appTools = new Map<string, Set<string>>()

  /** 注册工具 */
  register(definition: ToolDefinition, handler: ToolHandler, allowedSources?: string[]): void {
    this.tools.set(definition.name, {
      definition,
      handler,
      allowedSources,
    })
    logger.debug(`工具已注册: ${definition.name}`)
  }

  /** 注销普通工具；仅移除当前注册项。 */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * 注册应用工具（自动加 appId 前缀）
   *
   * 应用工具用点号前缀隔离：`{appId}.{toolName}`。
   * 仅在应用内可用，主 Agent 不自动获得。
   *
   * @param appId       应用 ID
   * @param definition  工具定义（name 不含前缀）
   * @param handler     工具处理函数
   */
  registerAppTool(appId: string, definition: ToolDefinition, handler: ToolHandler): void {
    const prefixedName = `${appId}.${definition.name}`
    this.tools.set(prefixedName, {
      definition: { ...definition, name: prefixedName },
      handler,
      appId,
    })

    // 记录 appId → 工具名集合
    let appSet = this.appTools.get(appId)
    if (!appSet) {
      appSet = new Set()
      this.appTools.set(appId, appSet)
    }
    appSet.add(prefixedName)

    logger.debug(`应用工具已注册: ${prefixedName}`)
  }

  /**
   * 注销应用的所有工具
   *
   * 应用停止时调用，清理 ToolRegistry 中的应用工具。
   *
   * @returns 注销的工具数量
   */
  unregisterAppTools(appId: string): number {
    const appSet = this.appTools.get(appId)
    if (!appSet) return 0

    const count = appSet.size
    for (const toolName of appSet) {
      this.tools.delete(toolName)
    }
    this.appTools.delete(appId)

    if (count > 0) {
      logger.info(`应用工具已注销: appId=${appId}, count=${count}`)
    }
    return count
  }

  /**
   * 获取应用可用工具定义（应用专属 + requiresTools 声明的主 Agent 工具）
   *
   * 应用内 Compiler 调用此方法获取工具描述。
   *
   * @param appId          应用 ID
   * @param requiredTools  Manifest.requiresTools 声明的主 Agent 工具白名单
   */
  getAppTools(appId: string, requiredTools: string[] = []): ToolDefinition[] {
    const result: ToolDefinition[] = []

    // 1. 应用专属工具
    const appSet = this.appTools.get(appId)
    if (appSet) {
      for (const toolName of appSet) {
        const tool = this.tools.get(toolName)
        if (tool) result.push(tool.definition)
      }
    }

    // 2. 主 Agent 工具（requiresTools 白名单）
    for (const name of requiredTools) {
      const tool = this.tools.get(name)
      if (tool && !tool.appId) {
        result.push(tool.definition)
      }
    }

    return result
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

  /** 获取工具处理函数 */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler
  }

  /** 检查工具是否允许在指定来源通道使用。 */
  isAllowedInSource(name: string, source: string): boolean {
    const tool = this.tools.get(name)
    if (!tool) return true
    if (source === 'group' && !isStrongholdChannelTool(name)) return false
    return !tool.allowedSources?.length || tool.allowedSources.includes(source)
  }

  /** 获取工具定义。 */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition
  }

  /** 获取允许在指定 source 下使用的工具定义列表。group额外采用据点上游白名单。 */
  getDefinitions(source?: string): ToolDefinition[] {
    const result: ToolDefinition[] = []
    for (const tool of this.tools.values()) {
      if (source === 'group' && !isStrongholdChannelTool(tool.definition.name)) continue
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
