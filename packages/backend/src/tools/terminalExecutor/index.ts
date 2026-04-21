/**
 * terminal_execute — 终端命令执行工具
 *
 * 在系统 shell 中执行命令并返回输出。
 * 完全跨平台（Windows: PowerShell, Linux/Mac: sh）。
 *
 * @module packages/backend/src/tools/terminalExecutor
 */

import { exec } from 'node:child_process'
import os from 'node:os'
import type { BuiltinTool } from '../index'

/** 命令输出最大字符数 */
const MAX_OUTPUT_LENGTH = 20_000
/** 默认超时 (毫秒) */
const DEFAULT_TIMEOUT_MS = 30_000

export const terminalExecutorTool: BuiltinTool = {
  definition: {
    name: 'terminal_execute',
    description:
      '在系统终端中执行命令并获取输出。支持任意 shell 命令。注意：请谨慎执行有副作用的命令。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '工作目录 (可选，默认用户主目录)' },
        timeout: { type: 'number', description: '超时时间(毫秒)，默认 30000' },
      },
      required: ['command'],
    },
  },

  async execute(args) {
    const command = args.command as string
    const cwd = (args.cwd as string) ?? os.homedir()
    const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT_MS

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
