/**
 * Capability 协议共享类型定义
 *
 * 第七阶段修复（批次 E2）：把 Daemon 与 Electron 之间的 IPC 消息类型和能力返回格式
 * 提取到 @infos/shared，避免两端各写一套导致不一致（P0-2/P0-3 的根因）。
 *
 * Daemon (capabilityBridge.ts) 和 Electron (capabilityProvider.ts) 都应 import 此模块。
 *
 * @module packages/shared/src/types/capability.types
 */

// ─────────────────────────────────────────────
// IPC 消息类型（Daemon ↔ 能力节点）
// ─────────────────────────────────────────────

/** Daemon → 节点消息 */
export type DaemonToNodeMessage =
  | {
      type: 'tool_call'
      callId: string
      /** 能力名（已映射后的，如 screen_capture） */
      toolName: string
      args: Record<string, unknown>
    }
  | {
      type: 'registered'
      success: boolean
      message?: string
    }
  | {
      type: 'error'
      message: string
    }

/** 节点 → Daemon 消息 */
export type NodeToDaemonMessage =
  | {
      type: 'register'
      nodeId: string
      nodeType: 'electron' | 'mobile' | 'cli' | 'remote-daemon'
      capabilities: string[]
      url?: string
    }
  | {
      type: 'heartbeat'
      nodeId: string
    }
  | {
      type: 'tool_result'
      callId: string
      /** 工具执行结果（任意可序列化对象） */
      result: unknown
      success: boolean
      errorMsg?: string
    }
  | {
      /** 第七阶段修复（批次 E3）：WS 鉴权握手 */
      type: 'auth'
      token: string
    }

/** 通用 Daemon 消息（接收时用） */
export type DaemonMessage = DaemonToNodeMessage | NodeToDaemonMessage

// ─────────────────────────────────────────────
// 标准化能力返回格式
// ─────────────────────────────────────────────

/**
 * 截图能力返回格式（标准化）
 *
 * reactLoop 的多模态截图注入逻辑按此结构解析 screenshots[].dataUri。
 * 任何提供 screen_capture 能力的节点都必须返回此格式。
 */
export interface ScreenCaptureResult {
  success: boolean
  screenshots: Array<{
    /** 截图索引（多显示器场景） */
    index: number
    /** Data URI 格式的图片（data:image/png;base64,...） */
    dataUri: string
  }>
  /** 人类可读的摘要 */
  message: string
}

/**
 * 剪贴板读取返回格式
 */
export interface ClipboardReadResult {
  text: string
}

/**
 * 剪贴板写入返回格式
 */
export interface ClipboardWriteResult {
  success: boolean
}

/**
 * 活动窗口查询返回格式
 */
export interface ActiveWindowResult {
  title: string
  app?: string
}
