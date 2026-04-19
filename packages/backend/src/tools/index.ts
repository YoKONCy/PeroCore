/**
 * 内置工具注册入口
 *
 * 静态导入所有内置 Tool，在启动时注册到 ToolRegistry。
 *
 * 内置工具 vs 用户扩展：
 * - 内置工具：源码级，静态 import，编译打包
 * - 用户扩展：运行时目录，动态 import()，ExtensionLoader 加载
 *
 * 两者最终都走 ToolRegistry → CapabilityGate → ToolExecutor 同一管线。
 *
 * @module packages/backend/src/tools
 */

import type { ToolRegistry } from '../services/agent/toolRegistry'
import type { ToolDefinition } from '../services/pipeline/types'
import { createLogger } from '../lib/logger'

const logger = createLogger('BuiltinTools')

/** 内置工具标准接口 (与 ToolExtension 对齐，但更轻量) */
export interface BuiltinTool {
  /** 工具定义 (给 LLM function calling + NIT v3) */
  definition: ToolDefinition
  /** 执行函数 */
  execute(args: Record<string, unknown>, ctx: { agentId: string; sessionId: string; source: string }): Promise<string>
  /** 可选：初始化 */
  onLoad?(): Promise<void>
}

// ─────────────────────────────────────────────
// 静态导入所有内置工具
// ─────────────────────────────────────────────

import { finishTaskTool } from './finishTask'
import { loadSkillTool } from './loadSkill'
import { readFileTool, writeFileTool, fileInfoTool, listDirectoryTool } from './fileOps'
import { terminalExecutorTool } from './terminalExecutor'
import { codeSearcherTool } from './codeSearcher'
import { fileSearchTool } from './fileSearch'

/** 全部内置工具列表 */
const ALL_BUILTIN_TOOLS: BuiltinTool[] = [
  // ── 生命周期 (始终允许) ──
  finishTaskTool,
  loadSkillTool,

  // ── 文件系统 ──
  readFileTool,
  writeFileTool,
  fileInfoTool,
  listDirectoryTool,
  fileSearchTool,

  // ── 终端 & 搜索 ──
  terminalExecutorTool,
  codeSearcherTool,

  // ── 待迁移 (需 native addon 或平台适配) ──
  // screenVisionTool,
  // desktopAutomationTool,
  // systemOpsTool,
  // browserOpsTool,
  // schedulerTool,
]

/**
 * 注册所有内置工具到 ToolRegistry
 *
 * 在 app 启动时调用一次。
 */
export async function registerBuiltinTools(registry: ToolRegistry): Promise<void> {
  for (const tool of ALL_BUILTIN_TOOLS) {
    await tool.onLoad?.()
    registry.register(
      tool.definition,
      (args, ctx) => tool.execute(args, ctx),
    )
  }
  logger.info(`内置工具已注册: ${ALL_BUILTIN_TOOLS.length} 个`)
}

/** 获取所有内置工具定义 (调试用) */
export function getBuiltinToolDefinitions(): ToolDefinition[] {
  return ALL_BUILTIN_TOOLS.map((t) => t.definition)
}
