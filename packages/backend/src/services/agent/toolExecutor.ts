/**
 * Tool Executor — 工具执行器
 *
 * 从 ToolRegistry 查找工具并执行。
 * 内置 finish_task + 动态注册表查询 + CapabilityGate 权限校验。
 *
 * B6 升级:
 * - 工具执行超时保护 (默认 30s)
 * - Hook 事件触发 (before_tool_call / after_tool_call)
 * - ExtensionManager 集成
 *
 * 执行流程:
 * 1. finish_task / load_skill → 直接执行 (CapabilityGate 永远放行)
 * 2. CapabilityGate.isToolAllowed() → 权限校验
 * 3. Hook: before_tool_call → 可拦截/修改参数
 * 4. ToolRegistry.getHandler() → 获取处理函数
 * 5. handler(args, context) → 执行 (带超时保护)
 * 6. Hook: after_tool_call → 可修改/记录结果
 *
 * @module packages/backend/src/services/agent/toolExecutor
 */

import type { ToolExecutor, ToolExecutionResult } from './reactLoop'
import type { ToolRegistry, ToolContext } from './toolRegistry'
import type { CapabilityGate } from '../../capabilities/capabilityGate'
import type { SkillLoader } from '../../capabilities/skillLoader'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ToolExecutor')

/** 输出截断限制 */
const MAX_OUTPUT_LENGTH = 8000

/**
 * 免于截断的工具白名单
 *
 * 这些工具的输出包含需要下游完整解析的大体积数据 (如截图 base64)，
 * 一旦被 truncate 砍断就会导致 JSON 解析失败 / base64 残片污染上下文。
 * reactLoop 会负责提取并剥离其中的 base64，因此放行完整输出是安全的。
 */
const SKIP_TRUNCATE_TOOLS = new Set<string>(['take_screenshot'])

/** 默认工具执行超时 (ms) */
const DEFAULT_TOOL_TIMEOUT_MS = 30_000

/**
 * 第七阶段 #5: 平台能力工具名单
 *
 * 这些工具不由 Daemon 本地执行，而是通过 CapabilityBridge 委托给
 * 有能力的节点（如 Electron 提供 screen_capture）。
 *
 * 当工具名命中此名单时，ToolExecutor 优先走 CapabilityBridge 路由；
 * 若 CapabilityBridge 未配置或无可用节点，返回友好错误。
 */
const PLATFORM_CAPABILITY_TOOLS = new Set<string>([
  'screen_capture',
  'take_screenshot', // 兼容旧工具名
  'clipboard_read',
  'clipboard_write',
  'get_active_window',
])

/**
 * 第七阶段修复（批次 A2）：工具名 → 能力节点注册的能力名映射
 *
 * 同一能力可被多个工具名调用：
 * - LLM 调用 `take_screenshot`（screenVision 工具集的真实注册名）
 * - 但 Electron 在 CapabilityProvider 里注册的能力名是 `screen_capture`
 *
 * 没有这层映射时，invokeTool('take_screenshot', args) 会让 CapabilityBridge
 * 找不到提供 `take_screenshot` 的节点，导致截图永远失败。
 *
 * 此映射表只在"工具名 → 能力名"方向做转换，不影响工具调用的日志、SSE、
 * 权限校验（权限校验仍用原始工具名，因为 capabilities.yaml 里配置的是工具名）。
 */
const TOOL_NAME_TO_CAPABILITY: Record<string, string> = {
  take_screenshot: 'screen_capture',
}

/**
 * 第七阶段 #5: 能力调用桥接接口
 *
 * ToolExecutor 通过此接口转发平台工具调用到 CapabilityBridge。
 * 使用接口而非直接 import CapabilityBridge，避免循环依赖。
 */
export interface CapabilityBridgeLike {
  invokeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{
    output: string
    isError: boolean
    durationMs: number
  }>
}

/**
 * 第六阶段 #6: 文件路径相关参数名列表
 *
 * 工具参数中常见的路径字段名（snake_case 与 camelCase 都覆盖）。
 * ToolExecutor 在调用工具前会从 args 中提取这些字段，
 * 用 CapabilityGate.isPathAllowed() 校验是否落在 ResourceScope.allowedRoots 内。
 */
const PATH_PARAM_NAMES = new Set<string>([
  'file_path',
  'filePath',
  'dir_path',
  'dirPath',
  'directory',
  'path',
  'cwd',
  'destination',
  'target_path',
  'targetPath',
  'output_path',
  'outputPath',
])

/** Hook 触发器接口 (避免硬依赖 ExtensionManager) */
export interface HookEmitter {
  emitHook<T>(event: string, data: T): Promise<T>
}

/**
 * 基于 ToolRegistry 的工具执行器
 *
 * 集成 CapabilityGate 运行时权限校验 (D51):
 * - 每次工具调用前检查 isToolAllowed()
 * - 拒绝调用未授权工具，返回友好错误提示
 * - finish_task 和 load_skill 永远放行
 *
 * 第七阶段 #5: 平台能力工具路由
 * - screen_capture / clipboard_* 等工具通过 CapabilityBridge 委托给节点执行
 * - 能力不可用时返回 isError + 友好错误，复用 ReAct 异常处理机制
 */
export class RegistryToolExecutor implements ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private capabilityGate: CapabilityGate | null = null,
    private skillLoader: SkillLoader | null = null,
    private hookEmitter: HookEmitter | null = null,
    private defaultContext: Partial<ToolContext> & { channel?: string } = {},
    private toolTimeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
    /**
     * 第七阶段 #5: 能力调用桥接
     * 用于转发平台工具调用到 CapabilityBridge（Daemon 模式下注入，旧模式为 null）
     */
    private capabilityBridge: CapabilityBridgeLike | null = null,
  ) {}

  /**
   * 第七阶段 #5: 延迟注入 CapabilityBridge
   *
   * 因 CapabilityBridge 依赖完整 AppContext（含 toolExecutor），
   * 存在循环依赖，必须延迟注入：
   * 1. container 先创建 toolExecutor（无 bridge）
   * 2. container 创建完 ctx 后创建 CapabilityBridge
   * 3. container 调用此方法注入 bridge 到 toolExecutor
   */
  setCapabilityBridge(bridge: CapabilityBridgeLike): void {
    this.capabilityBridge = bridge
    logger.info('CapabilityBridge 已注入 ToolExecutor')
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    source: string,
    runtimeContext?: { threadId?: string; channel?: string; agentId?: string; sessionId?: string },
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now()
    // 第七阶段修复（批次 B1）：agentId 必须从 runtimeContext 传入
    // 原实现读 this.defaultContext.agentId（构造时注入且从不更新的共享状态），
    // 而 container.ts 创建 ToolExecutor 时根本没传 defaultContext，
    // 导致所有 Agent 的工具权限校验都用硬编码兜底值 'pero' 的配置 —— 多 Agent 隔离完全失效。
    // 现在优先取 runtimeContext.agentId，仅在缺失时告警并兜底（过渡期保留兜底避免炸调用方）。
    let agentId = runtimeContext?.agentId ?? this.defaultContext.agentId
    if (!agentId) {
      logger.warn(
        `工具 ${name} 调用未提供 agentId，权限校验将退回 'pero' 配置（调用方应透传 agentId）`,
      )
      agentId = 'pero'
    }
    // AIOS: 优先使用 runtimeContext.channel，回退到 defaultContext.channel，最后回退到 source
    const channel = runtimeContext?.channel ?? this.defaultContext.channel ?? source
    // sessionId 同样优先取 runtimeContext（Skill 解锁状态按会话隔离，不能共用 'default'）
    const sessionId = runtimeContext?.sessionId ?? this.defaultContext.sessionId ?? 'default'
    // AIOS: threadId 优先使用 runtimeContext.threadId，回退到 sessionId（向后兼容）
    const threadId = runtimeContext?.threadId ?? sessionId

    // ── 内置: finish_task (始终可用, CapabilityGate 豁免) ──
    // 必须走真正的工具实现 (finishTaskTool.execute) 才能更新角色状态 (mood/vibe/mind 等)
    // 并广播 state_update 到前端；绝不能在此短路返回，否则状态更新逻辑会被整体跳过。
    // 执行完毕 (无论成败) 都强制终止 ReAct 循环。
    if (name === 'finish_task') {
      const handler = this.registry.getHandler('finish_task')
      if (!handler) {
        // 兜底：注册表缺失时退回最简终止行为，至少保证循环能正常结束
        logger.warn('finish_task 未在注册表中找到，退回最简终止行为 (状态更新被跳过)')
        return {
          output: (args.summary as string) ?? '任务完成',
          durationMs: Date.now() - startTime,
          isError: false,
          shouldTerminate: true,
        }
      }
      try {
        const context: ToolContext = { source, agentId, sessionId, threadId, channel }
        const output = await this.executeWithTimeout(handler, args, context, name)
        logger.info(`工具 finish_task 执行完成 (${Date.now() - startTime}ms)`)
        return { output, durationMs: Date.now() - startTime, isError: false, shouldTerminate: true }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.error(`finish_task 执行失败: ${errMsg}`)
        // 即便失败也要终止循环，避免 Agent 无限继续
        return {
          output: (args.summary as string) ?? '任务完成',
          durationMs: Date.now() - startTime,
          isError: false,
          shouldTerminate: true,
        }
      }
    }

    // ── 内置: load_skill (始终可用, 加载 Skill 详情) ──
    if (name === 'load_skill') {
      return this.handleLoadSkill(args, sessionId, startTime)
    }

    // ── CapabilityGate 权限校验 ──
    // 第七阶段修复（批次 B5）：平台能力工具（如 take_screenshot）必须先过 CapabilityGate 白名单
    // 原实现在 CapabilityGate 之前返回，导致社交/群聊等通道可绕过白名单调用截图等敏感工具
    // 现在所有非内置工具（含平台能力工具）统一受白名单约束
    if (this.capabilityGate) {
      const allowed = this.capabilityGate.isToolAllowed(agentId, channel, name, sessionId)
      if (!allowed) {
        logger.warn(`工具 ${name} 被 CapabilityGate 拒绝 (agent=${agentId}, channel=${channel})`)
        return {
          output: `你没有权限使用工具 "${name}"。当前通道 (${channel}) 不允许此操作。`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }

      // 第六阶段 #6: ResourceScope 路径校验
      // 对涉及文件操作的工具，提取 args 中的路径参数，校验是否落在 allowedRoots 内
      const pathViolation = this.checkPathAllowed(name, args, agentId, channel)
      if (pathViolation) {
        logger.warn(
          `工具 ${name} 路径被 ResourceScope 拒绝: ${pathViolation} (agent=${agentId}, channel=${channel})`,
        )
        return {
          output: `工具 "${name}" 的路径参数被资源范围策略拒绝: ${pathViolation}`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
    }

    // ── 从 Registry 查找 ──
    // 第七阶段修复（批次 B5）：平台工具路由已移到 CapabilityGate 校验之后
    // 只有通过白名单校验的平台工具才会走到这里
    if (PLATFORM_CAPABILITY_TOOLS.has(name)) {
      return this.handlePlatformCapability(name, args, startTime)
    }

    const handler = this.registry.getHandler(name)
    if (!handler) {
      logger.warn(`未知工具: ${name}`)
      return {
        output: `未找到工具: ${name}`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    // ── Hook: before_tool_call ──
    if (this.hookEmitter) {
      try {
        const hookData = await this.hookEmitter.emitHook('tool:beforeCall', {
          name,
          args,
          source,
          agentId,
          threadId,
          channel,
        })
        // Hook 可以修改参数
        if (hookData && typeof hookData === 'object' && 'args' in hookData) {
          args = (hookData as { args: Record<string, unknown> }).args
        }
      } catch (err) {
        logger.warn(`before_tool_call Hook 执行失败: ${err}`)
      }
    }

    // ── 执行 (带超时保护) ──
    try {
      // AIOS: 透传 threadId + channel 给工具处理函数
      const context: ToolContext = { source, agentId, sessionId, threadId, channel }

      const rawOutput = await this.executeWithTimeout(handler, args, context, name)
      const durationMs = Date.now() - startTime
      logger.info(`工具 ${name} 执行完成 (${durationMs}ms)`)

      // 截图等需要下游解析的工具输出不能截断：
      // take_screenshot 返回的完整 base64 必须交给 reactLoop 解析后转成 image_url 内容块，
      // 若被 truncate 砍断会导致 JSON 解析失败、base64 残片污染上下文、模型读不到图片。
      // reactLoop 会在提取后剥离 base64，不会把超长数据灌进上下文，因此此处放行是安全的。
      const output = SKIP_TRUNCATE_TOOLS.has(name) ? rawOutput : truncate(rawOutput)

      // ── Hook: after_tool_call ──
      if (this.hookEmitter) {
        try {
          await this.hookEmitter.emitHook('tool:afterCall', {
            name,
            args,
            output,
            durationMs,
            isError: false,
          })
        } catch {
          // after Hook 失败不影响结果
        }
      }

      return {
        output,
        durationMs,
        isError: false,
        shouldTerminate: false,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const durationMs = Date.now() - startTime
      logger.error(`工具 ${name} 执行失败 (${durationMs}ms): ${errMsg}`)

      // ── Hook: after_tool_call (错误) ──
      if (this.hookEmitter) {
        try {
          await this.hookEmitter.emitHook('tool:afterCall', {
            name,
            args,
            output: errMsg,
            durationMs,
            isError: true,
          })
        } catch {
          // after Hook 失败不影响结果
        }
      }

      return {
        output: truncate(`执行失败: ${errMsg}`),
        durationMs,
        isError: true,
        shouldTerminate: false,
      }
    }
  }

  // ── 平台能力工具路由（第七阶段 #5）──

  /**
   * 处理平台能力工具调用
   *
   * 通过 CapabilityBridge 转发到有能力的节点（如 Electron）执行。
   * - capabilityBridge 未配置：返回友好错误（旧模式兼容）
   * - 无可用节点：返回友好错误（能力降级，LLM 自行处理）
   * - 调用成功/失败：透传节点返回的结果
   *
   * 注意：平台能力工具跳过 CapabilityGate 白名单校验，
   * 因为这些工具的可用性由"是否有节点注册"决定，而非 channel 配置。
   */
  private async handlePlatformCapability(
    toolName: string,
    args: Record<string, unknown>,
    startTime: number,
  ): Promise<ToolExecutionResult> {
    // capabilityBridge 未注入（如旧 backend/main.ts 模式或测试环境）
    if (!this.capabilityBridge) {
      logger.warn(
        `平台能力工具 ${toolName} 被调用，但 CapabilityBridge 未配置（可能是非 Daemon 模式）`,
      )
      return {
        output: `工具 "${toolName}" 在当前运行模式下不可用。请使用 Daemon 模式启动并确保相关客户端已连接。`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    logger.info(`平台能力工具调用: ${toolName} → CapabilityBridge`)
    try {
      // 第七阶段修复（批次 A2）：工具名 → 能力名映射
      // LLM 调用的工具名（如 take_screenshot）可能和节点注册的能力名（如 screen_capture）不同
      // CapabilityBridge 按能力名查找提供者节点，所以这里必须转换
      const capabilityName = TOOL_NAME_TO_CAPABILITY[toolName] ?? toolName
      const result = await this.capabilityBridge.invokeTool(capabilityName, args)
      logger.info(
        `平台能力工具 ${toolName} → ${capabilityName} 完成 (${result.durationMs}ms, error=${result.isError})`,
      )
      return {
        output: result.output,
        durationMs: Date.now() - startTime,
        isError: result.isError,
        shouldTerminate: false,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`平台能力工具 ${toolName} 调用异常: ${errMsg}`)
      return {
        output: `工具 "${toolName}" 调用失败: ${errMsg}`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }
  }

  // ── ResourceScope 路径校验（第六阶段 #6）──

  /**
   * 校验工具参数中的路径是否落在 ResourceScope 允许范围内
   *
   * 从 args 中按 PATH_PARAM_NAMES 提取路径参数，
   * 对每个非空字符串路径调用 CapabilityGate.isPathAllowed() 校验。
   *
   * @returns 拒绝原因字符串（首个被拒路径），全部通过时返回 null
   */
  private checkPathAllowed(
    toolName: string,
    args: Record<string, unknown>,
    agentId: string,
    channel: string,
  ): string | null {
    if (!this.capabilityGate) return null

    // 工具未配置 ToolPermission 时 isPathAllowed 直接返回 true，
    // 此处无需提前 getToolPermission 判空，避免遗漏 system 级配置
    for (const [key, value] of Object.entries(args)) {
      if (!PATH_PARAM_NAMES.has(key)) continue
      if (typeof value !== 'string' || value.length === 0) continue

      const allowed = this.capabilityGate.isPathAllowed(agentId, channel, toolName, value)
      if (!allowed) {
        return `${key}=${value}`
      }
    }
    return null
  }

  // ── 工具超时保护 ──

  private executeWithTimeout(
    handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>,
    args: Record<string, unknown>,
    ctx: ToolContext,
    toolName: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`工具 ${toolName} 执行超时 (${this.toolTimeoutMs}ms)`))
      }, this.toolTimeoutMs)

      handler(args, ctx)
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  // ── 内置工具: load_skill ──

  private handleLoadSkill(
    args: Record<string, unknown>,
    sessionId: string,
    startTime: number,
  ): ToolExecutionResult {
    const skillId = (args.skill_id as string) ?? (args.skillId as string)
    if (!skillId) {
      return {
        output: '缺少参数 skill_id',
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    if (!this.skillLoader) {
      return {
        output: 'Skill 系统未初始化',
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    // 提取可选参数
    const params = (args.params as Record<string, string>) ?? undefined

    // 加载 Skill 内容 (支持模板变量替换)
    const fullContent = this.skillLoader.loadSkillContentWithParams(skillId, params)
    if (!fullContent) {
      return {
        output: `Skill "${skillId}" 不存在或加载失败`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    // 临时解锁 Skill 关联的工具 + 递归解锁子 Skill 的工具
    if (this.capabilityGate) {
      this.unlockSkillToolsRecursive(sessionId, skillId, new Set())
    }

    const paramKeys = params ? Object.keys(params) : []
    const paramInfo = paramKeys.length > 0 ? ` (已注入参数: ${paramKeys.join(', ')})` : ''
    logger.info(`Skill ${skillId} 已加载${paramInfo} (session=${sessionId})`)

    return {
      output: fullContent,
      durationMs: Date.now() - startTime,
      isError: false,
      shouldTerminate: false,
    }
  }

  /**
   * 递归解锁 Skill 及其依赖子 Skill 的工具
   *
   * visited 防止循环依赖导致的无限递归。
   */
  private unlockSkillToolsRecursive(
    sessionId: string,
    skillId: string,
    visited: Set<string>,
  ): void {
    if (visited.has(skillId)) return
    visited.add(skillId)

    // 解锁当前 Skill 的工具
    this.capabilityGate!.unlockSkillTools(sessionId, skillId)

    // 获取子 Skill 列表并递归解锁
    if (!this.skillLoader) return
    const manifest = this.skillLoader.getManifest(skillId)
    if (!manifest?.dependsOnSkills?.length) return

    for (const childSkillId of manifest.dependsOnSkills) {
      this.unlockSkillToolsRecursive(sessionId, childSkillId, visited)
      logger.debug(
        `子 Skill ${childSkillId} 工具已递归解锁 (parent=${skillId}, session=${sessionId})`,
      )
    }
  }
}

/** 截断过长文本 */
function truncate(text: string): string {
  if (text.length > MAX_OUTPUT_LENGTH) {
    return text.slice(0, MAX_OUTPUT_LENGTH) + '\n...(truncated by system)'
  }
  return text
}
