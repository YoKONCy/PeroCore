/**
 * code_search — 代码搜索工具
 *
 * 使用 ripgrep (rg) 在目录中搜索代码模式。
 * rg 二进制全平台可用（Windows/Linux/macOS），非必须依赖。
 * 降级方案：Node.js 内置 grep。
 *
 * AIOS(Phase4): 搜索目录默认为 workspace，按 channel 分级控制：
 * - desktop 通道（策略 authorized）：args.path 提供且目录存在时使用之，否则回退 workspace root
 * - 其他通道（策略 workspace）：强制使用 workspace root，忽略 args.path
 * rg 调用逻辑保持不变，仅搜索目录受 containment 约束。
 *
 * @module packages/backend/src/tools/codeSearcher
 */

import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import type { BuiltinTool } from '../index'
import { getWorkspaceService } from '../workspaceServiceHolder'

/** 单次搜索最大结果数 */
const MAX_RESULTS = 50
/** 搜索超时 */
const SEARCH_TIMEOUT_MS = 15_000

export const codeSearcherTool: BuiltinTool = {
  name: 'code_search',

  async execute(args, ctx) {
    const query = args.query as string
    const isRegex = (args.is_regex as boolean) ?? false
    const fileType = args.file_type as string | undefined

    // AIOS(Phase4): 按 channel 分级计算搜索目录
    // - desktop 通道可授权使用 args.path（已存在的目录），否则回退 workspace root
    // - 其他通道强制使用 workspace root，忽略 args.path
    const workspaceService = getWorkspaceService()
    const searchPath =
      workspaceService?.resolveTerminalCwd(
        ctx.agentId,
        args.path as string | undefined,
        ctx.channel,
      ) ?? ((args.path as string) ?? os.homedir())

    if (!existsSync(searchPath)) {
      return JSON.stringify({ error: `搜索路径不存在: ${searchPath}` })
    }

    // 构建 rg 命令
    const rgArgs = [
      '--json', // JSON 输出
      '-n', // 显示行号
      '-I', // 不显示二进制
      '--max-count',
      String(MAX_RESULTS),
      '--max-columns',
      '200',
    ]

    if (!isRegex) {
      rgArgs.push('-F') // 固定字符串模式
    }

    if (fileType) {
      rgArgs.push('-t', fileType)
    }

    rgArgs.push('--', query, searchPath)

    const command = `rg ${rgArgs.map((a) => `"${a}"`).join(' ')}`

    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          timeout: SEARCH_TIMEOUT_MS,
          maxBuffer: 5 * 1024 * 1024,
          env: { ...process.env },
        },
        (error, stdout) => {
          // rg 退出码 1 = 无匹配，不是错误
          if (error && !stdout) {
            // 可能 rg 未安装
            if (error.message.includes('not found') || error.message.includes('not recognized')) {
              resolve(
                JSON.stringify({
                  error:
                    'ripgrep (rg) 未安装。请安装: https://github.com/BurntSushi/ripgrep/releases',
                }),
              )
              return
            }
            resolve(JSON.stringify({ matches: [], message: '未找到匹配' }))
            return
          }

          // 解析 rg JSON 输出
          const matches: Array<{ file: string; line: number; content: string }> = []
          for (const line of stdout.split('\n')) {
            if (!line.trim()) continue
            try {
              const obj = JSON.parse(line)
              if (obj.type === 'match') {
                matches.push({
                  file: obj.data?.path?.text ?? '',
                  line: obj.data?.line_number ?? 0,
                  content: (obj.data?.lines?.text ?? '').trim(),
                })
              }
            } catch {
              // 忽略非 JSON 行
            }
          }

          resolve(JSON.stringify({ matches, total: matches.length }))
        },
      )
    })
  },
}
