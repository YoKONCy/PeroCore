/**
 * terminal_execute — 终端命令执行工具
 *
 * 在系统 shell 中执行命令并返回输出。
 * 完全跨平台（Windows: PowerShell, Linux/Mac: sh）。
 *
 * AIOS(Phase4): 改造默认 cwd 计算：
 * - 默认 cwd = workspaceService.resolveTerminalCwd(agentId, args.cwd, channel)
 * - desktop 通道（策略 authorized）：args.cwd 提供且目录存在时使用 args.cwd，否则回退 workspace root
 * - 其他通道（策略 workspace）：强制使用 workspace root，忽略 args.cwd
 *
 * @module packages/backend/src/tools/terminalExecutor
 */

import { exec } from 'node:child_process'
import os from 'node:os'
import type { BuiltinTool } from '../index'
import { getWorkspaceService } from '../workspaceServiceHolder'

/** 命令输出最大字符数 */
const MAX_OUTPUT_LENGTH = 20_000
/** 默认超时 (毫秒) */
const DEFAULT_TIMEOUT_MS = 30_000

export const terminalExecutorTool: BuiltinTool = {
  name: 'terminal_execute',

  async execute(args, ctx) {
    const command = args.command as string
    const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT_MS

    // AIOS(Phase4): 按 channel 分级计算 cwd
    // - desktop 通道可授权使用 args.cwd（已存在的目录），否则回退 workspace root
    // - 其他通道强制使用 workspace root，忽略 args.cwd
    const workspaceService = getWorkspaceService()
    const cwd = workspaceService?.resolveTerminalCwd(
      ctx.agentId,
      args.cwd as string | undefined,
      ctx.channel,
    ) ?? ((args.cwd as string) ?? os.homedir())

    // 选择 shell: Windows 用 PowerShell, 其他用 sh
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : '/bin/sh'

    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          cwd,
          timeout,
          shell,
          maxBuffer: 5 * 1024 * 1024, // 5MB
          env: { ...process.env, PAGER: 'cat' },
        },
        (error, stdout, stderr) => {
          let output = ''

          if (stdout) output += stdout
          if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr
          if (error && !stdout && !stderr) {
            output = `命令执行失败: ${error.message}`
          }

          // 截断过长输出
          if (output.length > MAX_OUTPUT_LENGTH) {
            output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n...[输出已截断]...'
          }

          resolve(output || '(无输出)')
        },
      )
    })
  },
}
