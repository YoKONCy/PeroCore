import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import WebSocket from 'ws'
import type {
  DaemonToNodeMessage,
  KernelCapabilityOffer,
  KernelNodeDescriptor,
  KernelNodeId,
  KernelNodeSessionId,
  NodeToDaemonMessage,
  WebPageOperation,
} from '@infos/shared'
import { logger } from '../utils/logger'
import { launchApplication } from './applicationLauncher'
import {
  activateWindow,
  keyboardAction,
  listWindows,
  mouseAction,
  mousePosition,
} from './desktopAutomation'
import { ElectronBrowserRuntime } from './browserRuntime'
import { captureScreen, getActiveWindow, readClipboard, writeClipboard } from './desktopAwareness'

const CAPABILITY_PORT = Number(process.env.PERO_CAPABILITY_PORT ?? 9121)
const DAEMON_HOST = process.env.PERO_DAEMON_HOST ?? '127.0.0.1'
const HEARTBEAT_INTERVAL_MS = 25_000
const RECONNECT_INTERVAL_MS = 5_000
const NODE_ID_FILE = 'electron-node-id.txt'
const DEVICE_CREDENTIAL_FILE = 'capability-device-credential.json'

const browserRuntime = new ElectronBrowserRuntime()
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type OutboundCapabilityMessage = DistributiveOmit<NodeToDaemonMessage, 'protocolVersion'>

const WEB_OPERATIONS: readonly WebPageOperation[] = [
  'open',
  'inspect',
  'extract',
  'search',
  'screenshot',
  'elementScreenshot',
  'click',
  'nativeClick',
  'hover',
  'type',
  'sendKeys',
  'setValue',
  'selectOption',
  'check',
  'scroll',
  'back',
  'wait',
  'listTargets',
  'createTarget',
  'switchTarget',
  'closeTarget',
  'domQuery',
  'frameQuery',
  'sourceSearch',
  'handleDialog',
  'networkQuery',
  'networkBody',
  'networkConfigure',
  'downloadConfigure',
  'uploadFile',
  'storage',
  'emulate',
  'evaluate',
  'runtimeStatus',
]
const DESKTOP_OPERATIONS = [
  'screenCapture',
  'clipboardRead',
  'clipboardWrite',
  'activeWindow',
  'listWindows',
  'activateWindow',
  'applicationLaunch',
  'mousePosition',
  'mouseAction',
  'keyboardAction',
] as const
const AUDIO_OUTPUT_OPERATIONS = ['play', 'stop', 'status'] as const

class ElectronCapabilityProvider {
  private socket: WebSocket | null = null
  private nodeId = '' as KernelNodeId
  private sessionId?: KernelNodeSessionId
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private readonly invocations = new Map<string, AbortController>()
  private readonly playbackStates = new Map<
    string,
    { state: 'playing' | 'completed' | 'cancelled'; startedAt: string }
  >()
  private readonly playbackReceipts = new Map<
    string,
    { resolve: (state: 'completed' | 'cancelled') => void; timer: NodeJS.Timeout }
  >()
  private stopped = false

  getNodeId(): KernelNodeId {
    if (!this.nodeId) this.nodeId = this.loadOrCreateNodeId()
    return this.nodeId
  }

  async start(): Promise<void> {
    this.stopped = false
    this.nodeId = this.getNodeId()
    this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    await browserRuntime.close()
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket?.close()
    this.socket = null
    this.sessionId = undefined
    logger.info('CapabilityProvider', '已停止')
  }

  private connect(): void {
    if (this.stopped) return
    const url = `ws://${DAEMON_HOST}:${CAPABILITY_PORT}`
    logger.info('CapabilityProvider', `正在连接 Daemon: ${url}`)
    const socket = new WebSocket(url)
    this.socket = socket
    socket.on('open', () => {
      const message: OutboundCapabilityMessage = {
        type: 'authenticate',
        token:
          this.loadDeviceToken(DAEMON_HOST, CAPABILITY_PORT) ||
          process.env.INFOS_CAPABILITY_PAIRING_CODE ||
          process.env.INFOS_API_TOKEN ||
          '',
      }
      this.send(message)
    })
    socket.on('message', (data) => void this.handleMessage(data.toString()))
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      this.sessionId = undefined
      this.stopHeartbeat()
      this.scheduleReconnect()
    })
    socket.on('error', (error) => logger.error('CapabilityProvider', `连接错误: ${error.message}`))
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: DaemonToNodeMessage
    try {
      message = JSON.parse(raw) as DaemonToNodeMessage
    } catch {
      logger.warn('CapabilityProvider', `收到非法 JSON: ${raw.slice(0, 200)}`)
      return
    }
    if (message.type === 'authenticated') {
      if (message.deviceToken) {
        this.saveDeviceToken(DAEMON_HOST, CAPABILITY_PORT, message.deviceToken)
      }
      this.sendHello()
      return
    }
    if (message.type === 'node_accepted') {
      this.sessionId = message.sessionId
      this.startHeartbeat()
      logger.info('CapabilityProvider', `Node已接入，Session=${message.sessionId}`)
      return
    }
    if (message.type === 'capability_invoke') {
      await this.invoke(message)
      return
    }
    if (message.type === 'capability_cancel') {
      this.invocations.get(message.invocationId)?.abort(message.reason)
      this.invocations.delete(message.invocationId)
      return
    }
    if (message.type === 'error')
      logger.error('CapabilityProvider', `Daemon错误: ${message.message}`)
  }

  private sendHello(): void {
    const descriptor: KernelNodeDescriptor = {
      nodeId: this.nodeId,
      displayName: 'infOS Electron Client',
      facets: ['client', 'capability', 'device'],
      trust: 'local',
      platform: {
        os:
          process.platform === 'win32'
            ? 'windows'
            : process.platform === 'darwin'
              ? 'macos'
              : process.platform === 'linux'
                ? 'linux'
                : 'unknown',
        arch: process.arch,
        runtime: 'electron',
        version: process.versions.electron,
      },
      protocolVersion: 1,
      labels: { edition: process.env.INFOS_EDITION ?? 'desktop' },
      registeredAt: new Date().toISOString(),
    }
    this.send({ type: 'node_hello', descriptor, offers: this.createOffers() })
  }

  private createOffers(): KernelCapabilityOffer[] {
    return [
      this.offer('electron.web-page', 'web.page', WEB_OPERATIONS, ['web-page', 'browser-session']),
      this.offer('electron.desktop-environment', 'desktop.environment', DESKTOP_OPERATIONS, [
        'screen',
        'clipboard',
        'active-window',
      ]),
      this.offer('electron.audio-output', 'audio.output', AUDIO_OUTPUT_OPERATIONS, [
        'speaker',
        'audio-playback',
      ]),
    ]
  }

  private offer(
    id: string,
    capabilityType: string,
    operations: readonly string[],
    resourceKinds: readonly string[],
  ): KernelCapabilityOffer {
    return {
      offerId: `${id}@1.0:${this.nodeId}`,
      provider: {
        objectType: 'capability-provider',
        objectId: `${id}/provider` as KernelCapabilityOffer['provider']['objectId'],
        generation: 1,
        ownerPrincipalId: 'electron-client',
        authorityNodeId: this.nodeId,
        authorityEpoch: 1,
      },
      capabilityType,
      contractVersion: '1.0',
      operations,
      resourceKinds,
      health: 'available',
      placement: {
        providerNodeId: this.nodeId,
        providerFacet: 'capability',
        executionLocation: 'client-local',
        resourceAuthorityNodeId: this.nodeId,
        requiresClientPresence: true,
        requiresInputSeat: capabilityType === 'desktop.environment',
        supportsHeadless: false,
        dataResidency: 'device-only',
        latencyClass: 'local',
        costClass: 'free',
      },
    }
  }

  private async invoke(
    message: Extract<DaemonToNodeMessage, { type: 'capability_invoke' }>,
  ): Promise<void> {
    const { invocationId, envelope } = message
    const operation = envelope.payload.operation
    const controller = new AbortController()
    this.invocations.set(invocationId, controller)
    try {
      if (envelope.deadline && Date.parse(envelope.deadline) <= Date.now()) {
        throw new Error('CAPABILITY_DEADLINE_EXCEEDED: 调用已过期')
      }
      let output: unknown
      if (envelope.operation.startsWith('web.page/')) {
        if (!WEB_OPERATIONS.includes(operation as WebPageOperation)) {
          throw new Error(`CAPABILITY_OPERATION_UNSUPPORTED: ${operation}`)
        }
        output = await browserRuntime.invoke(
          operation,
          envelope.payload.input as Record<string, unknown>,
          envelope.principalId,
        )
      } else if (envelope.operation.startsWith('desktop.environment/')) {
        output = await this.invokeDesktop(
          operation,
          envelope.payload.input as Record<string, unknown>,
        )
      } else if (envelope.operation.startsWith('audio.output/')) {
        output = await this.invokeAudioOutput(
          operation,
          envelope.payload.input as Record<string, unknown>,
          controller.signal,
        )
      } else {
        throw new Error(`CAPABILITY_TYPE_UNSUPPORTED: ${envelope.operation}`)
      }
      this.send({ type: 'capability_result', invocationId, success: true, output })
      logger.info('CapabilityProvider', `调用完成: ${envelope.operation}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      const separator = text.indexOf(':')
      this.send({
        type: 'capability_result',
        invocationId,
        success: false,
        error: {
          code: separator > 0 ? text.slice(0, separator) : 'CAPABILITY_PROVIDER_ERROR',
          message: separator > 0 ? text.slice(separator + 1).trim() : text,
          retryable: /TIMEOUT|UNAVAILABLE|DISCONNECTED/.test(text),
        },
      })
      logger.error('CapabilityProvider', `调用失败: ${envelope.operation} - ${text}`)
    } finally {
      this.invocations.delete(invocationId)
    }
  }

  private async invokeAudioOutput(
    operation: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const playbackId = String(input.playbackId ?? randomUUID())
    if (operation === 'status') {
      return { playbackId, ...(this.playbackStates.get(playbackId) ?? { state: 'cancelled' }) }
    }
    if (operation === 'stop') {
      const current = this.playbackStates.get(playbackId)
      if (current) current.state = 'cancelled'
      return { playbackId, state: 'cancelled' }
    }
    if (operation !== 'play') throw new Error(`CAPABILITY_OPERATION_UNSUPPORTED: ${operation}`)
    const assetUrl = String(input.assetUrl ?? '')
    if (!assetUrl.startsWith('/api/assets/audio/')) {
      throw new Error('AUDIO_ASSET_INVALID: audio.output.play 需要受控 Audio Asset URL')
    }
    this.playbackStates.set(playbackId, { state: 'playing', startedAt: new Date().toISOString() })
    if (signal.aborted) throw new Error('CAPABILITY_CANCELLED: 播放已取消')
    const windows = (await import('../windows/manager')).windowManager
    const targetWindow =
      windows.petWin ?? windows.chatWin ?? windows.dashboardWin ?? windows.launcherWin
    targetWindow?.webContents.send('audio-output:play', {
      playbackId,
      assetUrl,
      volume: Number(input.volume ?? 1),
    })
    const state = await this.waitForPlaybackReceipt(playbackId, signal)
    return { playbackId, state }
  }

  completePlayback(playbackId: string, state: 'completed' | 'cancelled'): void {
    const current = this.playbackStates.get(playbackId)
    if (current) current.state = state
    const receipt = this.playbackReceipts.get(playbackId)
    if (!receipt) return
    clearTimeout(receipt.timer)
    this.playbackReceipts.delete(playbackId)
    receipt.resolve(state)
  }

  private waitForPlaybackReceipt(
    playbackId: string,
    signal: AbortSignal,
  ): Promise<'completed' | 'cancelled'> {
    return new Promise((resolve) => {
      const finish = (state: 'completed' | 'cancelled') => {
        signal.removeEventListener('abort', onAbort)
        resolve(state)
      }
      const onAbort = () => {
        const windowsPromise = import('../windows/manager')
        void windowsPromise.then(({ windowManager: windows }) => {
          const targetWindow =
            windows.petWin ?? windows.chatWin ?? windows.dashboardWin ?? windows.launcherWin
          targetWindow?.webContents.send('audio-output:stop', { playbackId })
        })
        this.completePlayback(playbackId, 'cancelled')
      }
      const timer = setTimeout(() => this.completePlayback(playbackId, 'cancelled'), 5 * 60_000)
      timer.unref?.()
      this.playbackReceipts.set(playbackId, { resolve: finish, timer })
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  private async invokeDesktop(operation: string, input: Record<string, unknown>): Promise<unknown> {
    if (operation === 'screenCapture') {
      const raw = await captureScreen(Number(input.maxWidth ?? 1280))
      if (!raw) throw new Error('SCREEN_CAPTURE_UNAVAILABLE: 无法获取屏幕内容')
      return {
        success: true,
        screenshots: [
          {
            index: 0,
            dataUri: raw.dataUrl,
            coordinateContext: {
              displayId: raw.displayId,
              coordinateSpace: 'screenshot',
              screenshotWidth: raw.width,
              screenshotHeight: raw.height,
              bounds: raw.bounds,
              workArea: raw.workArea,
              scaleFactor: raw.scaleFactor,
            },
          },
        ],
        message:
          `已截取屏幕 (${raw.width}x${raw.height})。` +
          `如需点击截图位置，请使用coordinateSpace=screenshot、displayId=${raw.displayId}、` +
          `screenshotWidth=${raw.width}、screenshotHeight=${raw.height}。`,
      }
    }
    if (operation === 'clipboardRead') return readClipboard()
    if (operation === 'clipboardWrite') {
      writeClipboard(String(input.text ?? ''))
      return { success: true }
    }
    if (operation === 'activeWindow') return getActiveWindow()
    if (operation === 'listWindows') return listWindows()
    if (operation === 'activateWindow') return activateWindow(String(input.target ?? ''))
    if (operation === 'applicationLaunch') {
      return launchApplication(String(input.appName ?? input.app_name ?? ''))
    }
    if (operation === 'mousePosition') return mousePosition()
    if (operation === 'mouseAction') return mouseAction(input)
    if (operation === 'keyboardAction') return keyboardAction(input)
    throw new Error(`CAPABILITY_OPERATION_UNSUPPORTED: ${operation}`)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.sessionId) return
      this.send({ type: 'heartbeat', nodeId: this.nodeId, sessionId: this.sessionId })
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_INTERVAL_MS)
  }

  private send(message: OutboundCapabilityMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ ...message, protocolVersion: 1 }))
    }
  }

  private credentialFile(): string {
    return path.join(app.getPath('userData'), DEVICE_CREDENTIAL_FILE)
  }

  private loadDeviceToken(host: string, port: number): string {
    try {
      const file = this.credentialFile()
      if (!fs.existsSync(file)) return ''
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        endpoint?: string
        token?: string
      }
      return parsed.endpoint === `${host}:${port}` ? (parsed.token ?? '') : ''
    } catch {
      return ''
    }
  }

  private saveDeviceToken(host: string, port: number, token: string): void {
    try {
      fs.writeFileSync(
        this.credentialFile(),
        JSON.stringify({ version: 1, endpoint: `${host}:${port}`, token }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      )
      logger.info('CapabilityProvider', '能力节点设备凭据已安全保存')
    } catch (error) {
      logger.warn('CapabilityProvider', `保存能力节点设备凭据失败: ${error}`)
    }
  }

  private loadOrCreateNodeId(): KernelNodeId {
    const file = path.join(app.getPath('userData'), NODE_ID_FILE)
    try {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''
      if (existing) return existing as KernelNodeId
    } catch (error) {
      logger.warn('CapabilityProvider', `读取 Node ID失败: ${error}`)
    }
    const id = `electron:${randomUUID()}` as KernelNodeId
    try {
      fs.writeFileSync(file, id, 'utf8')
    } catch (error) {
      logger.warn('CapabilityProvider', `保存 Node ID失败: ${error}`)
    }
    return id
  }
}

export const capabilityProvider = new ElectronCapabilityProvider()
