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

/** 默认工具执行超时 (ms) */
const DEFAULT_TOOL_TIMEOUT_MS = 30_000

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
 */
export class RegistryToolExecutor implements ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private capabilityGate: CapabilityGate | null = null,
    private skillLoader: SkillLoader | null = null,
    private hookEmitter: HookEmitter | null = null,
    private defaultContext: Partial<ToolContext> & { mode?: string } = {},
    private toolTimeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
  ) {}

  async execute(
    name: string,
    args: Record<string, unknown>,
    source: string,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now()
    const agentId = this.defaultContext.agentId ?? 'pero'
    const mode = this.defaultContext.mode ?? source
    const sessionId = this.defaultContext.sessionId ?? 'default'

    // ── 内置: finish_task (始终可用) ──
    if (name === 'finish_task') {
      const summary = (args.summary as string) ?? '任务完成'
      return {
        output: summary,
        durationMs: Date.now() - startTime,
        isError: false,
        shouldTerminate: true,
      }
    }

    // ── 内置: load_skill (始终可用, 加载 Skill 详情) ──
    if (name === 'load_skill') {
      return this.handleLoadSkill(args, sessionId, startTime)
    }

    // ── CapabilityGate 权限校验 ──
    if (this.capabilityGate) {
      const allowed = this.capabilityGate.isToolAllowed(agentId, mode, name, sessionId)
      if (!allowed) {
        logger.warn(`工具 ${name} 被 CapabilityGate 拒绝 (agent=${agentId}, mode=${mode})`)
        return {
          output: `你没有权限使用工具 "${name}"。当前模式 (${mode}) 不允许此操作。`,
          durationMs: Date.now() - startTime,
          isError: true,
          shouldTerminate: false,
        }
      }
    }

    // ── 从 Registry 查找 ──
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
      const context: ToolContext = { source, agentId, sessionId }

      const output = await this.executeWithTimeout(handler, args, context, name)
      const durationMs = Date.now() - startTime
      logger.info(`工具 ${name} 执行完成 (${durationMs}ms)`)

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
        output: truncate(output),
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

    const fullContent = this.skillLoader.loadSkillContent(skillId)
    if (!fullContent) {
      return {
        output: `Skill "${skillId}" 不存在或加载失败`,
        durationMs: Date.now() - startTime,
        isError: true,
        shouldTerminate: false,
      }
    }

    // 临时解锁 Skill 关联的工具
    if (this.capabilityGate) {
      this.capabilityGate.unlockSkillTools(sessionId, skillId)
    }

    logger.info(`Skill ${skillId} 已加载 (session=${sessionId})`)

    return {
      output: fullContent,
      durationMs: Date.now() - startTime,
      isError: false,
      shouldTerminate: false,
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
