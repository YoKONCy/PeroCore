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
import type { ToolExecutionResult } from '../services/agent/reactLoop'
import type { StructuredToolResult } from '../services/execution/toolResult'
import type { ToolDefinition } from '../services/pipeline/types'
import type { ToolDisplayMeta } from '@infos/shared/types/extension.types'
import { createLogger } from '../lib/logger'

import hostCommunicationManifest from './hostCommunication/manifest.json'
import appInteractionManifest from './appInteraction/manifest.json'
import browserControlManifest from './browserControl/manifest.json'
import codeSearcherManifest from './codeSearcher/manifest.json'
import desktopAutomationManifest from './desktopAutomation/manifest.json'
import diarySearchManifest from './diarySearch/manifest.json'
import fileOpsManifest from './fileOps/manifest.json'
import fileSearchManifest from './fileSearch/manifest.json'
import flowStateManifest from './flowState/manifest.json'
import finishTaskManifest from './finishTask/manifest.json'
import loadSkillManifest from './loadSkill/manifest.json'
import runScriptManifest from './runScript/manifest.json'
import schedulerManifest from './scheduler/manifest.json'
import screenVisionManifest from './screenVision/manifest.json'
import socialOpsManifest from './socialOps/manifest.json'
import strongholdOpsManifest from './strongholdOps/manifest.json'
import systemInfoManifest from './systemInfo/manifest.json'
import terminalExecutorManifest from './terminalExecutor/manifest.json'
import terminalSessionManifest from './terminalSession/manifest.json'
import webFetchManifest from './webFetch/manifest.json'
import workspaceProductivityManifest from './workspaceProductivity/manifest.json'

const logger = createLogger('BuiltinTools')

/** 内置工具标准接口 */
export interface BuiltinTool {
  name: string
  /**
   * 执行函数
   *
   * AIOS: ctx 新增 threadId + channel 字段，工具可感知 Thread 上下文。
   * - channel 等价于旧 source（desktop/companion/social/group）
   * - threadId 等价于旧 sessionId（Thread ID）
   */
  execute(
    args: Record<string, unknown>,
    ctx: {
      agentId: string
      sessionId: string
      source: string
      /** AIOS: Thread ID */
      threadId: string
      /** AIOS: 对话通道 */
      channel: string
      signal?: AbortSignal
      taskId?: string
      pairId?: string
    },
  ): Promise<string | StructuredToolResult>
  /** 可选：初始化 */
  onLoad?(): Promise<void>
  /**
   * 内部字段：run_script 专用
   *
   * 第六阶段 #7: 签名增加可选的 runtimeContext 参数（threadId + channel），
   * 透传给 ToolExecutor.execute，让被调用的工具也走 CapabilityGate 鉴权
   * 与 ResourceScope 路径校验。
   */
  _toolExecutor?:
    | ((
        name: string,
        args: Record<string, unknown>,
        source: string,
        runtimeContext?: {
          threadId?: string
          channel?: string
          agentId?: string
          sessionId?: string
        },
      ) => Promise<ToolExecutionResult>)
    | null
  bindToolExecutor?(
    executor: (
      name: string,
      args: Record<string, unknown>,
      source: string,
      runtimeContext?: {
        threadId?: string
        channel?: string
        agentId?: string
        sessionId?: string
      },
    ) => Promise<ToolExecutionResult>,
  ): void
}

// ─────────────────────────────────────────────
// 静态导入所有内置工具
// ─────────────────────────────────────────────

import { communicateWithHostTool } from './hostCommunication'
import { interactWithAppTool } from './appInteraction'
import { updateFlowStateTool } from './flowState'
import { finishTaskTool } from './finishTask'
import { loadSkillTool } from './loadSkill'
import { readFileTool, writeFileTool, fileInfoTool, listDirectoryTool } from './fileOps'
import { terminalExecutorTool } from './terminalExecutor'
import {
  terminalCreateTool,
  terminalListTool,
  terminalGetTool,
  terminalReadTool,
  terminalWaitTool,
  terminalWriteTool,
  terminalResizeTool,
  terminalInterruptTool,
  terminalKillTool,
  terminalCloseTool,
} from './terminalSession'
import { codeSearcherTool } from './codeSearcher'
import { fileSearchTool } from './fileSearch'
import { setReminderTool, listRemindersTool, cancelReminderTool } from './scheduler'
import { runScriptTool } from './runScript'
import { takeScreenshotTool } from './screenVision'
import { webFetchTool } from './webFetch'
import {
  browserOpenUrlTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserGetContentTool,
} from './browserControl'
import {
  getSystemInfoTool,
  openApplicationTool,
  getActiveWindowsTool,
  activateWindowTool,
} from './systemInfo'
import { automationExecuteTool, getMousePositionTool } from './desktopAutomation'
import { socialNotifyOwnerTool } from './socialOps/notifyOwner'
import {
  strongholdMoveToRoomTool,
  strongholdListRoomsTool,
  strongholdGetRoomInfoTool,
  strongholdSetEnvironmentTool,
  strongholdCallButlerTool,
} from './strongholdOps'
import { searchDiaryTool } from './diarySearch'
import { readFileRangeTool, globFilesTool, editFileTool } from './workspaceProductivity'

/** 全部内置工具列表 */
const ALL_BUILTIN_TOOLS: BuiltinTool[] = [
  // ── 生命周期 (始终允许) ──
  finishTaskTool,
  loadSkillTool,
  updateFlowStateTool,
  interactWithAppTool,
  communicateWithHostTool,

  // ── 文件系统 ──
  readFileTool,
  writeFileTool,
  fileInfoTool,
  listDirectoryTool,
  fileSearchTool,
  readFileRangeTool,
  globFilesTool,
  editFileTool,

  // ── 终端 & 搜索 ──
  terminalExecutorTool,
  terminalCreateTool,
  terminalListTool,
  terminalGetTool,
  terminalReadTool,
  terminalWaitTool,
  terminalWriteTool,
  terminalResizeTool,
  terminalInterruptTool,
  terminalKillTool,
  terminalCloseTool,
  codeSearcherTool,

  // ── 提醒 & 日程 ──
  setReminderTool,
  listRemindersTool,
  cancelReminderTool,

  // ── 脚本编排 (NIT → FC 工具化) ──
  runScriptTool,

  // ── 视觉感知 (ScreenshotProvider 通过 set 模式设置) ──
  takeScreenshotTool,

  // ── 网页抓取 (跨平台) ──
  webFetchTool,

  // ── 浏览器控制 (BrowserBridge 注入) ──
  browserOpenUrlTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserGetContentTool,

  // ── 系统信息 & 应用管理 (跨平台) ──
  getSystemInfoTool,
  openApplicationTool,
  getActiveWindowsTool,
  activateWindowTool,

  // ── 桌面自动化 (DesktopAutomationProvider 注入, GUI 环境) ──
  automationExecuteTool,
  getMousePositionTool,

  // ── 社交操作 (SocialMessagingProvider 注入, 社交模式) ──
  // 注意：其余 7 个社交工具已迁移到 packages/apps/social/tools/，
  // 仅 social_notify_owner 保留在主 Agent 内核
  socialNotifyOwnerTool,

  // ── 据点操作 (StrongholdService 注入, 群聊模式) ──
  strongholdMoveToRoomTool,
  strongholdListRoomsTool,
  strongholdGetRoomInfoTool,
  strongholdSetEnvironmentTool,
  strongholdCallButlerTool,

  // ── 日记查找 (diary.tdb 语义检索) ──
  searchDiaryTool,
]

interface ManifestToolDefinition {
  name: string
  description: string
  parameters?: Record<string, unknown>
  /** 工具显示元数据（图标/名称/配色/轨迹样式，社区工具同样适用） */
  display?: ToolDisplayMeta
}

interface ToolManifest {
  toolDefinition?: ManifestToolDefinition
  tools?: ManifestToolDefinition[]
}

const MANIFEST_DEFINITIONS = new Map<string, ToolDefinition>()

function toToolDefinition(definition: ManifestToolDefinition): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters ?? {
      type: 'object',
      properties: {},
    },
    display: definition.display,
  }
}

function collectManifestDefinitions(manifest: ToolManifest): ToolDefinition[] {
  if (manifest.tools?.length) return manifest.tools.map(toToolDefinition)
  return manifest.toolDefinition ? [toToolDefinition(manifest.toolDefinition)] : []
}

for (const manifest of [
  hostCommunicationManifest,
  appInteractionManifest,
  browserControlManifest,
  codeSearcherManifest,
  desktopAutomationManifest,
  diarySearchManifest,
  fileOpsManifest,
  fileSearchManifest,
  flowStateManifest,
  finishTaskManifest,
  loadSkillManifest,
  runScriptManifest,
  schedulerManifest,
  screenVisionManifest,
  socialOpsManifest,
  strongholdOpsManifest,
  systemInfoManifest,
  terminalExecutorManifest,
  terminalSessionManifest,
  webFetchManifest,
  workspaceProductivityManifest,
] satisfies ToolManifest[]) {
  for (const definition of collectManifestDefinitions(manifest)) {
    MANIFEST_DEFINITIONS.set(definition.name, definition)
  }
}

function getToolDefinition(tool: BuiltinTool): ToolDefinition {
  const manifestDefinition = MANIFEST_DEFINITIONS.get(tool.name)
  if (manifestDefinition) return manifestDefinition

  throw new Error(`内置工具 ${tool.name} 缺少 manifest.json 工具定义`)
}

/**
 * 注册所有内置工具到 ToolRegistry
 *
 * 在 app 启动时调用一次。
 */
export async function registerBuiltinTools(registry: ToolRegistry): Promise<void> {
  for (const tool of ALL_BUILTIN_TOOLS) {
    await tool.onLoad?.()
    registry.register(getToolDefinition(tool), (args, ctx) => tool.execute(args, ctx))
  }
  logger.info(`内置工具已注册: ${ALL_BUILTIN_TOOLS.length} 个`)
}

/** 获取所有内置工具定义 (调试用) */
export function getBuiltinToolDefinitions(): ToolDefinition[] {
  return ALL_BUILTIN_TOOLS.map(getToolDefinition)
}

// ─────────────────────────────────────────────
// Re-export: 工具依赖设置函数 (供 container.ts 使用)
// ─────────────────────────────────────────────

export { setAppInteractionManager } from './appInteraction'
export { setFlowStateService } from './flowState'
export { setScreenshotProvider } from './screenVision'
export type { ScreenshotProvider } from './screenVision'
export { setWindowProvider } from './systemInfo'
export type { WindowProvider } from './systemInfo'
export { setDesktopAutomationProvider } from './desktopAutomation'
export type { DesktopAutomationProvider } from './desktopAutomation'
export { setSocialMessagingProvider } from './socialOps/notifyOwner'
export type { SocialMessagingProvider } from './socialOps/notifyOwner'
export { setStrongholdService } from './strongholdOps'
export { setSchedulerService } from './scheduler'
export { setFinishTaskDeps } from './finishTask'
export { setBrowserBridge } from './browserControl'
export type { BrowserBridge } from './browserControl'
export { setDiarySearchDeps } from './diarySearch'
// AIOS(Phase4): WorkspaceService 注入
// - fileOps 自带 setter（核心逻辑锁定不改）
// - terminalExecutor / runScript / fileSearch / codeSearcher 共用 workspaceServiceHolder 的 setter
export { setWorkspaceService, setWorkspaceCheckpointService } from './fileOps'
export { setWorkspaceProductivityCheckpointService } from './workspaceProductivity'
export { setWorkspaceService as setSharedWorkspaceService } from './workspaceServiceHolder'
export type { WorkspaceService } from '../services/workspace/workspaceService'
// 第六阶段 #7: CapabilityGate 共享持有器（run_script 用于 ResourceScope 校验）
export { setCapabilityGate } from './capabilityGateHolder'
