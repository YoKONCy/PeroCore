/**
 * run_script — NIT 脚本执行工具
 *
 * 将 NIT 解释器暴露为标准 FC 工具。
 * LLM 通过 Function Calling 调用此工具，传入 NIT 脚本代码，
 * 脚本内部可以编排其他已注册工具的调用（条件/循环/并行）。
 *
 * 设计理念：
 * - NIT 不再是与 FC 并列的"双轨"调用通道
 * - NIT 解释器变成 FC 工具链中的一个"高级编排工具"
 * - LLM 只需要学一种调用方式 (FC)，复杂场景通过 run_script 升级
 *
 * AIOS(Phase4):
 * - 注入 WorkspaceService（setWorkspaceService 模式，共享持有器）
 * - 在 execute 开头按 channel 分级计算 cwd（同 terminalExecutor 逻辑）
 *   desktop 通道可授权使用 args.cwd，其他通道强制 workspace root
 * - run_script 仅接受 inline 脚本（args.code），无脚本文件路径参数，
 *   因此「脚本路径限制在 workspace」不适用；args.code 不做路径检查
 * - CapabilityGate 校验由 ToolExecutor 在调用 run_script 前完成，
 *   脚本内部调用其他工具时由 _toolExecutor 闭包（container.ts 绑定）负责鉴权
 *
 * 第六阶段 #7:
 * - run_script 自身经过 CapabilityGate 校验（由 ToolExecutor 在调用前完成）
 * - 校验 args.cwd 在 ResourceScope.allowedRoots 范围内（若该工具配置了权限）
 * - 内部 _toolExecutor 闭包透传 threadId + channel，让被调用的工具也走
 *   CapabilityGate 鉴权与 ResourceScope 路径校验
 *
 * @module packages/backend/src/tools/runScript
 */

import type { BuiltinTool } from '../index'
import { executeNit } from '../../nit'
import { createLogger } from '../../lib/logger'
import { getWorkspaceService } from '../workspaceServiceHolder'
import { getCapabilityGate } from '../capabilityGateHolder'

const logger = createLogger('RunScript')

/** NIT 脚本执行超时 (30s) */
const SCRIPT_TIMEOUT_MS = 30_000

export const runScriptTool: BuiltinTool = {
  name: 'run_script',

  async execute(args, ctx) {
    const code = args.code as string
    if (!code?.trim()) {
      return JSON.stringify({ error: '脚本内容为空' })
    }

    // AIOS(Phase4): 按 channel 分级计算 cwd（同 terminalExecutor 逻辑）
    // - desktop 通道可授权使用 args.cwd（已存在的目录），否则回退 workspace root
    // - 其他通道强制使用 workspace root，忽略 args.cwd
    // 注：NIT 解释器本身不直接消费 cwd，此处计算用于：
    //   1. 强制 channel 策略生效（companion/social/group 不可逃逸 workspace）
    //   2. 记录到日志便于审计脚本执行环境
    //   3. 后续可通过 NitToolExecutor 闭包向下传递给被调用的工具
    const workspaceService = getWorkspaceService()
    const cwd = workspaceService?.resolveTerminalCwd(
      ctx.agentId,
      args.cwd as string | undefined,
      ctx.channel,
    )

    // 第六阶段 #7: ResourceScope 校验
    // 若 run_script 在 (agentId, channel) 下配置了 ToolPermission，
    // 校验 cwd 是否落在 allowedRoots 内（system 级别不限制）。
    // 注：ToolExecutor 在调用 run_script 前已做 isToolAllowed 白名单校验，
    // 此处只补 cwd 的 ResourceScope 校验（防止脚本通过 args.cwd 逃逸到 workspace 外）。
    if (cwd) {
      const capabilityGate = getCapabilityGate()
      if (capabilityGate) {
        const allowed = capabilityGate.isPathAllowed(
          ctx.agentId,
          ctx.channel,
          'run_script',
          cwd,
        )
        if (!allowed) {
          logger.warn(
            `run_script cwd 被 ResourceScope 拒绝: cwd=${cwd} (agent=${ctx.agentId}, channel=${ctx.channel})`,
          )
          return JSON.stringify({
            error: `脚本工作目录被资源范围策略拒绝: ${cwd}`,
          })
        }
      }
    }

    logger.info(
      `执行 NIT 脚本 (${code.length} 字符, source=${ctx.source}, channel=${ctx.channel}, cwd=${cwd ?? '未注入'})`,
    )

    try {
      // 超时保护
      const scriptPromise = executeNit(code, async (name, toolArgs) => {
        // 通过闭包获取外部的 ToolExecutor — 此处需要在注册时注入
        // run_script 工具的 toolExecutor 在 container.ts 中通过闭包绑定
        // AIOS: _toolExecutor 闭包负责 CapabilityGate 鉴权（在 container.ts 中接线）
        // 第六阶段 #7: 透传 ctx.threadId + ctx.channel，让被调用的工具也走
        // CapabilityGate 鉴权与 ResourceScope 路径校验
        const result = await runScriptTool._toolExecutor!(name, toolArgs, ctx.source, {
          threadId: ctx.threadId,
          channel: ctx.channel,
        })
        return result
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`NIT 脚本执行超时 (${SCRIPT_TIMEOUT_MS}ms)`)),
          SCRIPT_TIMEOUT_MS,
        )
      })

      const result = await Promise.race([scriptPromise, timeoutPromise])

      const outputStr =
        typeof result.value === 'string' ? result.value : JSON.stringify(result.value ?? null)

      logger.info(`NIT 脚本执行完成: ${result.toolCalls.length} 次工具调用`)

      return JSON.stringify({
        success: true,
        value: outputStr,
        toolCallCount: result.toolCalls.length,
        toolCalls: result.toolCalls.map((tc) => ({
          name: tc.name,
          result: String(tc.result).slice(0, 500),
        })),
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`NIT 脚本执行失败: ${errMsg}`)
      return JSON.stringify({ error: errMsg })
    }
  },

  /**
   * 内部工具执行器引用
   * 在 container.ts 注册时通过 `bindToolExecutor` 注入
   *
   * 第六阶段 #7: 签名增加可选的 runtimeContext 参数（threadId + channel），
   * 透传给 ToolExecutor.execute，让被调用的工具也走 CapabilityGate 鉴权。
   */
  _toolExecutor: null as
    | ((
        name: string,
        args: Record<string, unknown>,
        source: string,
        runtimeContext?: { threadId?: string; channel?: string },
      ) => Promise<string>)
    | null,

  /**
   * 绑定工具执行器（在 container.ts 初始化时调用）
   *
   * 第六阶段 #7: 签名增加可选的 runtimeContext 参数。
   */
  bindToolExecutor(
    executor: (
      name: string,
      args: Record<string, unknown>,
      source: string,
      runtimeContext?: { threadId?: string; channel?: string },
    ) => Promise<string>,
  ) {
    runScriptTool._toolExecutor = executor
  },
}
