/**
 * ElectronCapabilityProvider — Electron 侧能力提供者
 *
 * 第七阶段核心改造：Electron 不再 spawn 后端，而是作为"能力节点"连接 Daemon。
 *
 * 职责：
 * 1. 启动时连接 Daemon CapabilityBridge WS（:9121）
 * 2. 向 Daemon 注册 Electron 能提供的平台能力（screen_capture / clipboard_read 等）
 * 3. 定期发送 heartbeat 保持在线状态
 * 4. 收到 tool_call 消息时调用对应能力执行，返回 tool_result
 *
 * 能力清单（第一版）：
 * - screen_capture：截屏（desktopCapturer）
 * - clipboard_read：读取剪贴板
 * - clipboard_write：写入剪贴板
 * - get_active_window：获取前台窗口信息
 *
 * @platform ELECTRON
 * @module electron/main/services/capabilityProvider
 */

import WebSocket from 'ws'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../utils/logger'
import {
  captureScreen,
  readClipboard,
  writeClipboard,
  getActiveWindow,
} from './desktopAwareness'

/** Daemon CapabilityBridge WS 端口 */
const CAPABILITY_PORT = Number(process.env.PERO_CAPABILITY_PORT ?? 9121)

/** Daemon 地址（默认本地，后续可配置为远程） */
const DAEMON_HOST = process.env.PERO_DAEMON_HOST ?? '127.0.0.1'

/** 心跳间隔（ms） */
const HEARTBEAT_INTERVAL_MS = 25_000

/** 重连间隔（ms） */
const RECONNECT_INTERVAL_MS = 5_000

/** nodeId 持久化文件名 */
const NODE_ID_FILE = 'electron-node-id.txt'

/**
 * Electron 能提供的能力列表
 *
 * 每个能力对应一个 handler 函数，接收 args 返回结果。
 * 后续可扩展为从配置文件加载。
 *
 * 第七阶段修复（批次 A3）：screen_capture handler 返回格式适配
 * reactLoop 期望的 { success, screenshots: [{ index, dataUri }], message } 结构，
 * 而非底层 captureScreen() 直接返回的 { dataUrl, width, height, timestamp }。
 * 这样 reactLoop 的多模态截图注入逻辑（按 screenshots[].dataUri 提取 image_url 块）
 * 才能正确工作。
 */
const CAPABILITY_HANDLERS: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  screen_capture: async (args) => {
    const maxWidth = (args.maxWidth as number) ?? 1280
    const raw = await captureScreen(maxWidth)
    // captureScreen 可能返回 null（如屏幕不可用时）
    if (!raw) {
      return {
        success: false,
        screenshots: [],
        message: '截图失败：无法获取屏幕内容',
      }
    }
    // 适配为 reactLoop 期望的格式（字段名 dataUri 而非 dataUrl，数组结构）
    return {
      success: true,
      screenshots: [{ index: 0, dataUri: raw.dataUrl }],
      message: `已截取屏幕 (${raw.width}x${raw.height})`,
    }
  },
  clipboard_read: async () => {
    return readClipboard()
  },
  clipboard_write: async (args) => {
    const text = (args.text as string) ?? ''
    writeClipboard(text)
    return { success: true }
  },
  get_active_window: async () => {
    return await getActiveWindow()
  },
}

/** Daemon → 节点消息 */
type DaemonMessage =
  | { type: 'tool_call'; callId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'registered'; success: boolean; message?: string }
  // 第七阶段修复（批次 E3）：错误消息（含鉴权失败）
  | { type: 'error'; message: string }

/** 节点 → Daemon 消息 */
type NodeMessage =
  | {
      type: 'register'
      nodeId: string
      nodeType: string
      capabilities: string[]
      url?: string
    }
  | { type: 'heartbeat'; nodeId: string }
  | {
      type: 'tool_result'
      callId: string
      result: unknown
      success: boolean
      errorMsg?: string
    }
  // 第七阶段修复（批次 E3）：鉴权握手消息
  | { type: 'auth'; token: string }

/**
 * Electron 能力提供者
 *
 * 单例，由 Electron main 进程启动时创建。
 */
class ElectronCapabilityProvider {
  private ws: WebSocket | null = null
  private nodeId: string = ''
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private isStopped = false

  /**
   * 启动能力提供者
   *
   * 1. 加载或生成 nodeId
   * 2. 连接 Daemon WS
   * 3. 注册能力 + 启动心跳
   */
  async start(): Promise<void> {
    this.isStopped = false
    this.nodeId = this.loadOrCreateNodeId()
    this.connect()
  }

  /** 停止能力提供者（Electron 退出时调用） */
  stop(): void {
    this.isStopped = true
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    logger.info('CapabilityProvider', '已停止')
  }

  // ── 内部 ──

  /** 连接 Daemon WS */
  private connect(): void {
    if (this.isStopped) return

    const url = `ws://${DAEMON_HOST}:${CAPABILITY_PORT}`
    logger.info('CapabilityProvider', `正在连接 Daemon: ${url}`)

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      logger.info('CapabilityProvider', `已连接 Daemon，发送鉴权...`)
      // 第七阶段修复（批次 E3）：先发送 auth 消息进行鉴权
      this.sendAuth()
      // 鉴权成功后 register 由 handleAuthed 触发（避免在未认证时发送 register 被拒绝）
    })

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString()).catch((err) => {
        logger.error('CapabilityProvider', `消息处理失败: ${err}`)
      })
    })

    this.ws.on('close', () => {
      logger.warn('CapabilityProvider', '与 Daemon 连接断开')
      this.stopHeartbeat()
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      logger.error('CapabilityProvider', `连接错误: ${err.message}`)
    })
  }

  /**
   * 发送鉴权消息（第七阶段修复 E3）
   *
   * 连接建立后必须先发送 auth 消息，Daemon 验证通过后才允许 register。
   * token 从 PERO_CAPABILITY_TOKEN 环境变量读取（由后端注入或开发者设置）。
   * 未设置 token 时仍发送 auth（Daemon 在未配置 PEROCORE_API_TOKEN 时会跳过校验放行）。
   */
  private sendAuth(): void {
    const token = process.env.PERO_CAPABILITY_TOKEN ?? ''
    const msg: NodeMessage = { type: 'auth', token }
    this.send(msg)
  }

  /** 发送注册消息 */
  private sendRegister(): void {
    const capabilities = Object.keys(CAPABILITY_HANDLERS)
    const msg: NodeMessage = {
      type: 'register',
      nodeId: this.nodeId,
      nodeType: 'electron',
      capabilities,
    }
    this.send(msg)
  }

  /** 启动心跳 */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const msg: NodeMessage = { type: 'heartbeat', nodeId: this.nodeId }
      this.send(msg)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 调度重连 */
  private scheduleReconnect(): void {
    if (this.isStopped) return
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, RECONNECT_INTERVAL_MS)
  }

  /** 处理 Daemon 消息 */
  private async handleMessage(raw: string): Promise<void> {
    let msg: DaemonMessage
    try {
      msg = JSON.parse(raw) as DaemonMessage
    } catch {
      logger.warn('CapabilityProvider', `收到非法 JSON: ${raw.slice(0, 200)}`)
      return
    }

    switch (msg.type) {
      case 'tool_call':
        await this.handleToolCall(msg)
        break
      case 'registered':
        if (msg.success) {
          // 第七阶段修复（批次 E3）：registered 消息可能是 authed 或 register 成功
          // authed 时 message 为 'authed'，此时继续发送 register
          if (msg.message === 'authed') {
            logger.info('CapabilityProvider', '鉴权成功，注册能力...')
            this.sendRegister()
            this.startHeartbeat()
          } else {
            logger.info('CapabilityProvider', `能力注册成功: ${msg.message ?? ''}`)
          }
        } else {
          logger.error('CapabilityProvider', `注册失败: ${msg.message ?? '未知错误'}`)
        }
        break
      case 'error':
        // 第七阶段修复（批次 E3）：处理鉴权失败等错误
        logger.error('CapabilityProvider', `Daemon 错误: ${msg.message}`)
        break
      default:
        logger.warn('CapabilityProvider', `未知消息类型: ${(msg as { type: string }).type}`)
    }
  }

  /** 处理工具调用 */
  private async handleToolCall(
    msg: Extract<DaemonMessage, { type: 'tool_call' }>,
  ): Promise<void> {
    const { callId, toolName, args } = msg
    logger.info('CapabilityProvider', `收到工具调用: ${toolName} (callId=${callId})`)

    const handler = CAPABILITY_HANDLERS[toolName]
    if (!handler) {
      this.send({
        type: 'tool_result',
        callId,
        result: null,
        success: false,
        errorMsg: `Electron 不支持能力: ${toolName}`,
      })
      return
    }

    try {
      const result = await handler(args)
      this.send({
        type: 'tool_result',
        callId,
        result,
        success: true,
      })
      logger.info('CapabilityProvider', `工具调用完成: ${toolName} (callId=${callId})`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('CapabilityProvider', `工具调用失败: ${toolName} - ${errMsg}`)
      this.send({
        type: 'tool_result',
        callId,
        result: null,
        success: false,
        errorMsg: errMsg,
      })
    }
  }

  /** 发送消息到 Daemon */
  private send(msg: NodeMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  /**
   * 加载或生成 nodeId
   *
   * nodeId 持久化在 userData 目录下，保证 Electron 重启后 nodeId 不变。
   * Daemon 据此识别"同一个节点重新连接"。
   */
  private loadOrCreateNodeId(): string {
    const idFile = path.join(app.getPath('userData'), NODE_ID_FILE)
    try {
      if (fs.existsSync(idFile)) {
        const id = fs.readFileSync(idFile, 'utf-8').trim()
        if (id) return id
      }
    } catch {
      // 读取失败，继续生成新 ID
    }

    // 生成新 nodeId（时间戳 + 随机串）
    const newId = `electron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    try {
      fs.writeFileSync(idFile, newId, 'utf-8')
    } catch (err) {
      logger.warn('CapabilityProvider', `nodeId 持久化失败: ${err}`)
    }
    return newId
  }
}

/** 单例 */
export const capabilityProvider = new ElectronCapabilityProvider()
