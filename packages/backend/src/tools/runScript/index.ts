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
 * @module packages/backend/src/tools/runScript
 */

import type { BuiltinTool } from '../index'
import { executeNit } from '../../nit'
import { createLogger } from '../../lib/logger'

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

    logger.info(`执行 NIT 脚本 (${code.length} 字符, source=${ctx.source})`)

    try {
      // 超时保护
      const scriptPromise = executeNit(code, async (name, toolArgs) => {
        // 通过闭包获取外部的 ToolExecutor — 此处需要在注册时注入
        // run_script 工具的 toolExecutor 在 container.ts 中通过闭包绑定
        const result = await runScriptTool._toolExecutor!(name, toolArgs, ctx.source)
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
   */
  _toolExecutor: null as
    | ((name: string, args: Record<string, unknown>, source: string) => Promise<string>)
    | null,

  /**
   * 绑定工具执行器（在 container.ts 初始化时调用）
   */
  bindToolExecutor(
    executor: (name: string, args: Record<string, unknown>, source: string) => Promise<string>,
  ) {
    runScriptTool._toolExecutor = executor
  },
}
