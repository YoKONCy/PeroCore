/**
 * Tool Executor — 工具执行器
 *
 * 从 ToolRegistry 查找工具并执行。
 * 内置 finish_task + 动态注册表查询 + CapabilityGate 权限校验。
 *
 * B6 升级:
 * - Hook 事件触发 (before_tool_call / after_tool_call)
 * - Package Hook Bus 事件触发
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
import type { ApplicationRealmManager } from '../../applications/applicationRealm'
import type { CapabilityGate } from '../../capabilities/capabilityGate'
import type { CapabilityScope } from '../../capabilities/types'
import type { SkillLoader } from '../../capabilities/skillLoader'
import { isSystemProtocolTool } from '../../tools/systemProtocolTools'
import { isStructuredToolResult } from '../execution/toolResult'
import type { ApprovalService } from '../execution/approvalService'
import { ALWAYS_APPROVE_EACH_CALL_TOOLS, type PolicyEngine } from '../execution/policyEngine'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ToolExecutor')

/** 输出截断限制 */
const MAX_OUTPUT_LENGTH = 8000

/**
 * 免于截断的工具白名单
 *
 * 这些工具的输出需要在当前 ReAct 内完整消费：文件读取已经在工具内部按行数或字符数设限，
 * 截图则需要下游完整解析 base64。再次按统一 8000 字符截断会让合法的 800 行读取只剩几百行，
 * 或导致截图 JSON/base64 损坏。reactLoop 会对持久化审计另行裁剪，不会把读取正文写入数据库。
 */
const SKIP_TRUNCATE_TOOLS = new Set<string>([
  'read_file',
  'read_file_range',
  'take_screenshot',
  'browser_screenshot',
  'browser_page_image',
])

/** 兼容尚未迁移到 StructuredToolResult 的旧工具错误返回。 */
export function isLegacyToolErrorOutput(output: string): boolean {
  const value = output.trim()
  if (!value.startsWith('{')) return false
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return (
      parsed.success === false ||
      parsed.ok === false ||
      (typeof parsed.error === 'string' && parsed.error.trim().length > 0) ||
      (typeof parsed.error === 'object' && parsed.error !== null)
    )
  } catch {
    return false
  }
}

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
 * 没有这层映射时，调用 `take_screenshot` 会让 CapabilityBridge
 * 找不到提供 `take_screenshot` 的节点，导致截图永远失败。
 *
 * 此映射表只在"工具名 → 能力名"方向做转换，不影响工具调用的日志、SSE、
 * 权限校验（权限校验仍用原始工具名，因为 capabilities.yaml 里配置的是工具名）。
 */
const TOOL_NAME_TO_DESKTOP_OPERATION: Record<
  string,
  | 'screenCapture'
  | 'clipboardRead'
  | 'clipboardWrite'
  | 'activeWindow'
  | 'listWindows'
  | 'activateWindow'
  | 'mousePosition'
  | 'mouseAction'
  | 'keyboardAction'
> = {
  take_screenshot: 'screenCapture',
  screen_capture: 'screenCapture',
  clipboard_read: 'clipboardRead',
  clipboard_write: 'clipboardWrite',
  get_active_window: 'activeWindow',
}

/**
 * 第七阶段 #5: 能力调用桥接接口
 *
 * ToolExecutor 通过此接口转发平台工具调用到 CapabilityBridge。
 * 使用接口而非直接 import CapabilityBridge，避免循环依赖。
 */
export interface DesktopCapabilityPort {
  invoke(
    operation:
      | 'screenCapture'
      | 'clipboardRead'
      | 'clipboardWrite'
      | 'activeWindow'
      | 'listWindows'
      | 'activateWindow'
      | 'applicationLaunch'
      | 'mousePosition'
      | 'mouseAction'
      | 'keyboardAction',
    input: unknown,
    context: import('@infos/shared').KernelCallContext,
  ): Promise<unknown>
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

const DEVICE_READ_TOOLS = new Set([
  'read_file',
  'read_file_range',
  'get_file_info',
  'list_directory',
  'search_files',
  'glob_files',
  'code_search',
])

const TERMINAL_APPROVAL_TOOLS = new Set(['terminal_execute', 'terminal_create', 'terminal_write'])

const isRemoteTerminalTool = (name: string) => name.startsWith('remote_terminal_')

/** Package Hook Bus 接口。 */
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
    /**
     * 第七阶段 #5: 能力调用桥接
     * 用于转发平台工具调用到 CapabilityBridge（Daemon 模式下注入，旧模式为 null）
     */
    private desktopCapabilities: DesktopCapabilityPort | null = null,
    private policyEngine: PolicyEngine | null = null,
    private approvalService: ApprovalService | null = null,
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
  private pathBoundaryChecker:
    | ((agentId: string, channel: string, inputPath: string) => boolean)
    | null = null

  setPathBoundaryChecker(
    checker: (agentId: string, channel: string, inputPath: string) => boolean,
  ): void {
    this.pathBoundaryChecker = checker
  }

  setPolicyRuntime(policyEngine: PolicyEngine, approvalService: ApprovalService): void {
    this.policyEngine = policyEngine
    this.approvalService = approvalService
  }

  private applicationRealms: ApplicationRealmManager | null = null

  setApplicationRealmManager(manager: ApplicationRealmManager): void {
    this.applicationRealms = manager
  }

  setDesktopCapabilities(port: DesktopCapabilityPort): void {
    this.desktopCapabilities = port
    logger.info('Desktop Capability Port 已注入 ToolExecutor')
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    source: string,
    runtimeContext?: {
      threadId?: string
      channel?: string
      agentId?: string
      sessionId?: string
      signal?: AbortSignal
      taskId?: string
      realmId?: string
      executionId?: import('@infos/shared').KernelExecutionId
      processId?: import('@infos/shared').KernelProcessId
      deadline?: string
      pairId?: string
      toolCallId?: string
      disabledTools?: string[]
      autoExecuteTools?: boolean
      capabilityScope?: CapabilityScope
    },
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

    // ToolRegistry通道约束既用于工具定义注入，也必须在执行时再次校验，防止手工FC绕过。
    if (!this.registry.isAllowedInSource(name, channel)) {
      logger.warn(`工具 ${name} 不允许在通道 ${channel} 执行`)
      return {
        output: `工具“${name}”不允许在当前通道 (${channel}) 使用。`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    if (name !== 'finish_task' && this.applicationRealms) {
      const realmId = runtimeContext?.realmId
      const realmTool = this.applicationRealms.ownsTool(name)
      const hostProjection = this.applicationRealms.isHostProjection(name)
      if (
        (realmId && !this.applicationRealms.allowsTool(realmId, name)) ||
        (!realmId && realmTool && !hostProjection)
      ) {
        logger.warn(`工具 ${name} 被Application Realm拒绝 (realm=${realmId ?? 'none'})`)
        return {
          output: `工具“${name}”不属于当前Application Realm。`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
      if (realmId && !realmTool) {
        return {
          output: `当前Application Realm不允许调用主应用工具“${name}”。`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
    }

    // Thread工具策略是 Channel 白名单之上的减法层；必须先于内置工具捷径执行。
    if (runtimeContext?.disabledTools?.includes(name) && !isSystemProtocolTool(name)) {
      logger.warn(`工具 ${name} 被 Thread 策略禁用 (thread=${threadId}, channel=${channel})`)
      return {
        output: `工具“${name}”已在本会话中禁用。请由用户在 CHAR OPS 工具管理中重新启用。`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

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
        const context: ToolContext = {
          source,
          agentId,
          sessionId,
          threadId,
          channel,
          signal: runtimeContext?.signal,
          taskId: runtimeContext?.taskId,
          executionId: runtimeContext?.executionId,
          processId: runtimeContext?.processId,
          deadline: runtimeContext?.deadline,
          pairId: runtimeContext?.pairId,
          toolCallId: runtimeContext?.toolCallId,
        }
        const result = await handler(args, context)
        const failed =
          typeof result !== 'string' &&
          (isStructuredToolResult(result) ? !result.ok : result.isError)
        if (failed) {
          logger.error(
            `finish_task 执行失败: ${typeof result === 'string' ? result : result.output}`,
          )
          return {
            output: typeof result === 'string' ? result : result.output,
            durationMs: Date.now() - startTime,
            isError: true,
            shouldTerminate: false,
          }
        }
        const output = typeof result === 'string' ? result : result.output
        logger.info(`工具 finish_task 执行完成 (${Date.now() - startTime}ms)`)
        return { output, durationMs: Date.now() - startTime, isError: false, shouldTerminate: true }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.error(`finish_task 执行失败: ${errMsg}`)
        return {
          output: `执行失败: ${errMsg}`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
    }

    // ── 内置: load_skill（ambient 作用域禁止动态解锁能力） ──
    if (name === 'load_skill') {
      if (runtimeContext?.capabilityScope === 'ambient') {
        return {
          output: '当前低权限环境不允许动态加载技能。',
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
      return await this.handleLoadSkill(args, sessionId, startTime)
    }

    // ── CapabilityGate 权限校验 ──
    // 第七阶段修复（批次 B5）：平台能力工具（如 take_screenshot）必须先过 CapabilityGate 白名单
    // 原实现在 CapabilityGate 之前返回，导致社交/群聊等通道可绕过白名单调用截图等敏感工具
    // 现在所有非内置工具（含平台能力工具）统一受白名单约束
    if (this.capabilityGate && !runtimeContext?.realmId) {
      const allowed = this.capabilityGate.isToolAllowed(
        agentId,
        channel,
        name,
        sessionId,
        runtimeContext?.capabilityScope,
      )
      if (!allowed) {
        logger.warn(`工具 ${name} 被 CapabilityGate 拒绝 (agent=${agentId}, channel=${channel})`)
        return {
          output: `你没有权限使用工具 "${name}"。当前通道 (${channel}) 不允许此操作。`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }

      // ResourceScope 路径越界不在这里直接拒绝；Hook 可能修改参数，最终参数会在
      // Hook 后进入强制审批。工具白名单本身仍然保持 fail-closed。
    }

    // ── 从 Registry 查找 ──
    // 第七阶段修复（批次 B5）：平台工具路由已移到 CapabilityGate 校验之后
    // 只有通过白名单校验的平台工具才会走到这里
    if (PLATFORM_CAPABILITY_TOOLS.has(name)) {
      return this.handlePlatformCapability(name, args, startTime, {
        principalId: agentId,
        correlationId: runtimeContext?.toolCallId ?? `platform-tool:${name}:${Date.now()}`,
        executionId: runtimeContext?.executionId,
        processId: runtimeContext?.processId,
        deadline: runtimeContext?.deadline,
      })
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

    const remoteTerminalTool = isRemoteTerminalTool(name)
    const isDeviceReadTool = DEVICE_READ_TOOLS.has(name)
    const isSkillTool =
      typeof this.capabilityGate?.isSkillUnlockedTool === 'function' &&
      this.capabilityGate.isSkillUnlockedTool(sessionId, name)
    // 远程节点路径由节点侧解释，不能拿 Server Workspace 边界误判。
    const pathViolation =
      !remoteTerminalTool && !isDeviceReadTool
        ? this.checkPathAllowed(name, args, agentId, channel)
        : null
    if (pathViolation) {
      logger.warn(
        `工具 ${name} 请求 ResourceScope 外路径，转入强制审批: ${pathViolation} (agent=${agentId}, channel=${channel})`,
      )
    }

    // 参数与审批策略必须基于 Hook 修改后的最终参数执行。
    let approvalObservation: { decision: string; userMessage?: string } | undefined
    let approvedSensitiveAction = false
    let approvedOutsideWorkspace = false
    const autoExecuteTools = runtimeContext?.autoExecuteTools === true
    const pathRequiresApproval =
      pathViolation !== null && (!autoExecuteTools || name === 'delete_file')
    const forceApprovalEachCall =
      (!autoExecuteTools && remoteTerminalTool) ||
      (!remoteTerminalTool &&
        (pathRequiresApproval ||
          TERMINAL_APPROVAL_TOOLS.has(name) ||
          (!autoExecuteTools && ALWAYS_APPROVE_EACH_CALL_TOOLS.has(name))))
    if (forceApprovalEachCall && !this.policyEngine) {
      return {
        output: JSON.stringify({
          code: 'APPROVAL_UNAVAILABLE',
          message: '该敏感工具调用必须经过用户审批，但策略引擎当前不可用',
        }),
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }
    if (this.policyEngine) {
      const permission = this.capabilityGate?.getToolPermission(agentId, channel, name)
      const declaredPermission = this.registry.getDefinition(name)?.requiresApproval
        ? {
            toolName: name,
            resourceScope: permission?.resourceScope ?? {
              allowedRoots: [],
              deniedPaths: [],
              scope: 'system' as const,
            },
            paramPolicy: permission?.paramPolicy,
            requiresApproval: true,
          }
        : permission
      const basePolicyDecision = this.policyEngine.evaluate({
        agentId,
        channel,
        sessionId,
        threadId,
        taskId: runtimeContext?.taskId,
        toolName: name,
        args,
        permission: declaredPermission,
      })
      const policyDecision = remoteTerminalTool
        ? autoExecuteTools
          ? { action: 'allow' as const }
          : {
              action: 'require_approval' as const,
              reason: `远程能力节点工具 ${name} 在非自动执行模式下必须逐次审批`,
              riskLevel: 'high' as const,
            }
        : runtimeContext?.autoExecuteTools &&
            basePolicyDecision.action === 'require_approval' &&
            !TERMINAL_APPROVAL_TOOLS.has(name) &&
            !(name === 'delete_file' && pathViolation !== null)
          ? { action: 'allow' as const }
          : isSkillTool && basePolicyDecision.action === 'allow'
            ? {
                action: 'require_approval' as const,
                reason: `工具 ${name} 由Skill临时解锁，首次执行需要用户确认`,
                riskLevel: 'medium' as const,
              }
            : basePolicyDecision
      const decision = pathRequiresApproval
        ? {
            action: 'require_approval' as const,
            reason: `工具 ${name} 请求访问工作区或资源范围外路径：${pathViolation}`,
            riskLevel: 'high' as const,
          }
        : policyDecision
      if (decision.action === 'deny') {
        return {
          output: JSON.stringify({ code: decision.code, message: decision.reason }),
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
      if (decision.action === 'require_approval') {
        if (!this.approvalService) {
          return {
            output: JSON.stringify({
              code: 'APPROVAL_UNAVAILABLE',
              message: '该工具调用需要用户审批，但审批服务当前不可用',
            }),
            durationMs: Date.now() - startTime,
            isError: true,
            shouldTerminate: false,
          }
        }
        const deniedOnceMessage = this.approvalService.consumeDeniedOnce({
          agentId,
          sessionId,
          toolName: name,
          args,
        })
        if (deniedOnceMessage) {
          return {
            output: JSON.stringify({
              code: 'APPROVAL_DENIED',
              message: '用户拒绝了本次工具调用',
              userMessage: deniedOnceMessage,
              suggestedAction: '根据用户附言调整方案，不要原样重试。',
            }),
            durationMs: Date.now() - startTime,
            isError: true,
            shouldTerminate: false,
          }
        }
        const storedAuthorization = this.approvalService.authorize({
          agentId,
          sessionId,
          toolName: name,
          args,
        })
        const authorization =
          forceApprovalEachCall && storedAuthorization === 'allow' ? 'none' : storedAuthorization
        if (authorization === 'deny') {
          // 若用户留过拒绝附言，把理由一并回传给 Agent，避免原样盲目重试。
          const userMessage = this.approvalService.findDeniedMessage({
            agentId,
            sessionId,
            toolName: name,
            args,
          })
          return {
            output: JSON.stringify({
              code: 'APPROVAL_DENIED',
              message: '该工具调用已被用户拒绝',
              ...(userMessage
                ? { userMessage, suggestedAction: '根据用户附言调整方案，不要原样重试。' }
                : {}),
            }),
            durationMs: Date.now() - startTime,
            isError: true,
            shouldTerminate: false,
          }
        }
        if (authorization !== 'allow') {
          const approval = this.approvalService.create({
            agentId,
            channel,
            sessionId,
            threadId,
            taskId: runtimeContext?.taskId,
            toolName: name,
            args,
            reason: decision.reason,
            riskLevel: decision.riskLevel,
          })
          const resolved = await this.approvalService.waitForResolution(
            approval.id,
            runtimeContext?.signal,
          )
          if (resolved.status !== 'approved' || !resolved.decision?.startsWith('allow_')) {
            return {
              output: JSON.stringify({
                code: 'APPROVAL_DENIED',
                message: '用户拒绝了本次工具调用',
                ...(resolved.resolutionMessage
                  ? {
                      userMessage: resolved.resolutionMessage,
                      suggestedAction: '根据用户附言调整方案，不要原样重试。',
                    }
                  : {}),
              }),
              durationMs: Date.now() - startTime,
              isError: true,
              shouldTerminate: false,
            }
          }
          // waitForResolution 已确认本次原调用，因此直接续行；allow_once 在此消费。
          if (resolved.decision === 'allow_once') {
            this.approvalService.authorize({ agentId, sessionId, toolName: name, args })
          }
          approvalObservation = {
            decision: resolved.decision,
            userMessage: resolved.resolutionMessage,
          }
          approvedSensitiveAction = remoteTerminalTool || ALWAYS_APPROVE_EACH_CALL_TOOLS.has(name)
          approvedOutsideWorkspace = pathViolation !== null
        }
      }
    }

    if (autoExecuteTools && remoteTerminalTool) {
      approvedSensitiveAction = true
    }
    if (autoExecuteTools && name === 'delete_file' && pathViolation === null) {
      approvedSensitiveAction = true
    }
    if (autoExecuteTools && pathViolation !== null && name !== 'delete_file') {
      approvedOutsideWorkspace = true
    }

    // 工具只受调用方取消信号和各工具自身契约控制；全局执行器不设置超时。
    try {
      // AIOS: 透传 threadId + channel 给工具处理函数
      const context: ToolContext = {
        source,
        agentId,
        sessionId,
        threadId,
        channel,
        signal: runtimeContext?.signal,
        taskId: runtimeContext?.taskId,
        executionId: runtimeContext?.executionId,
        processId: runtimeContext?.processId,
        deadline: runtimeContext?.deadline,
        pairId: runtimeContext?.pairId,
        toolCallId: runtimeContext?.toolCallId,
        ...(approvedSensitiveAction ? { approvedSensitiveAction: true } : {}),
        ...(isDeviceReadTool ? { deviceReadScope: true } : {}),
        ...(approvedOutsideWorkspace ? { approvedOutsideWorkspace: true } : {}),
      }

      const rawResult = await handler(args, context)
      const durationMs = Date.now() - startTime
      const structuredResult = typeof rawResult === 'string' ? null : rawResult
      const rawOutput = typeof rawResult === 'string' ? rawResult : rawResult.output
      const isError = isStructuredToolResult(structuredResult)
        ? !structuredResult.ok
        : (structuredResult?.isError ?? isLegacyToolErrorOutput(rawOutput))
      logger.info(`工具 ${name} 执行完成 (${durationMs}ms, error=${isError})`)

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
            isError,
          })
        } catch {
          // after Hook 失败不影响结果
        }
      }

      return {
        output,
        durationMs,
        isError,
        shouldTerminate:
          structuredResult && 'shouldTerminate' in structuredResult
            ? structuredResult.shouldTerminate
            : false,
        approvalObservation: approvalObservation
          ? `【用户审批】决策：${approvalObservation.decision}${approvalObservation.userMessage ? `；附言：${approvalObservation.userMessage}` : ''}`
          : undefined,
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
    context: import('@infos/shared').KernelCallContext,
  ): Promise<ToolExecutionResult> {
    if (!this.desktopCapabilities) {
      return {
        output: `工具 "${toolName}" 在当前运行环境不可用，请连接 Electron Client。`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }
    const operation = TOOL_NAME_TO_DESKTOP_OPERATION[toolName]
    if (!operation) {
      return {
        output: `工具 "${toolName}" 没有对应的 Desktop Capability Operation。`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }
    logger.info(`平台能力工具调用: ${toolName} → desktop.environment/${operation}`)
    try {
      const output = await this.desktopCapabilities.invoke(operation, args, context)
      return {
        output: typeof output === 'string' ? output : JSON.stringify(output),
        durationMs: Date.now() - startTime,
        isError: false,
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
    for (const [key, value] of Object.entries(args)) {
      if (!PATH_PARAM_NAMES.has(key)) continue
      if (typeof value !== 'string' || value.length === 0) continue

      const withinWorkspace = this.pathBoundaryChecker?.(agentId, channel, value) ?? true
      const withinResourceScope =
        this.capabilityGate?.isPathAllowed(agentId, channel, toolName, value) ?? true
      if (!withinWorkspace || !withinResourceScope) {
        return `${key}=${value}`
      }
    }
    return null
  }

  // ── 内置工具: load_skill ──

  private async handleLoadSkill(
    args: Record<string, unknown>,
    sessionId: string,
    startTime: number,
  ): Promise<ToolExecutionResult> {
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

    try {
      const params = (args.params as Record<string, string>) ?? undefined
      const fullContent = this.skillLoader.loadSkillContentWithParams(skillId, params)
      if (!fullContent) {
        return {
          output: `Skill "${skillId}" 不存在或加载失败`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Skill ${skillId} 加载异常: ${message}`)
      return {
        output: `Skill "${skillId}" 加载失败: ${message}`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
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
