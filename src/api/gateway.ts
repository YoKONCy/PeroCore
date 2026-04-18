import { Envelope, Hello, Heartbeat, ActionRequest, ActionResponse } from './proto/perolink'
import { invoke } from '../utils/ipcAdapter'
import { API_BASE, WS_BASE } from '../config'
import { buildAuthenticatedWebSocketUrl } from './runtimeAuth'

const logToMain = (msg: string, ...args: any[]) => {
  const message = msg + (args.length ? ' ' + JSON.stringify(args) : '')
  console.log(msg, ...args)
  if ((window as any).electron) {
    ;(window as any).electron.send('log-from-renderer', message)
  }
}

export class GatewayClient {
  private ws: WebSocket | null = null
  private url: string = ''
  private reconnectInterval: number = 3000
  private heartbeatInterval: any = null
  private deviceId: string = 'electron-client-' + Math.random().toString(36).substr(2, 9)
  private isConnected: boolean = false
  private shouldReconnect: boolean = true

  private pendingRequests: Map<
    string,
    { resolve: (data: any) => void; reject: (err: any) => void; onProgress?: (data: any) => void }
  > = new Map()
  private token: string = ''
  private listeners: Map<string, ((...args: any[]) => void)[]> = new Map()

  constructor(url?: string) {
    if (url) {
      this.url = url
    }
  }

  private resolveUrl() {
    return buildAuthenticatedWebSocketUrl(`${WS_BASE}/gateway`)
  }

  private async resolveGatewayToken(): Promise<string> {
    if ((window as any).electron) {
      return (await invoke('get_gateway_token')) || ''
    }

    const response = await fetch(`${API_BASE}/system/gateway/token`)
    if (!response.ok) {
      throw new Error(`获取 Gateway 令牌失败 (${response.status})`)
    }

    const data = await response.json()
    return data?.token || ''
  }

  /**
   * 注册事件监听器
   * @param event 事件名称
   * @param callback 回调函数
   */
  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
  }

  /**
   * 移除事件监听器
   * @param event 事件名称
   * @param callback 回调函数
   */
  off(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners.has(event)) return
    const callbacks = this.listeners.get(event)!
    const index = callbacks.indexOf(callback)
    if (index !== -1) {
      callbacks.splice(index, 1)
    }
  }

  /**
   * 触发本地事件
   * @param event 事件名称
   * @param args 参数
   */
  private emit(event: string, ...args: any[]) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach((cb) => cb(...args))
    }
  }

  setToken(token: string) {
    this.token = token
    if (this.isConnected) {
      console.log('令牌已更新，正在重连...')
      this.ws?.close()
    }
  }

  async sendRequest(
    targetId: string,
    actionName: string,
    params: Record<string, string> = {},
    onProgress?: (data: any) => void
  ): Promise<ActionResponse> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('未连接到网关'))
        return
      }

      const req: ActionRequest = {
        actionName: actionName,
        params: params
      }

      const envelope: Envelope = {
        id: this.generateId(),
        sourceId: this.deviceId,
        targetId: targetId,
        timestamp: Date.now(),
        traceId: this.generateId(),
        request: req,
        hello: undefined,
        heartbeat: undefined,
        register: undefined,
        response: undefined,
        stream: undefined
      }

      // 存储 promise
      this.pendingRequests.set(envelope.id, { resolve, reject, onProgress })

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(envelope.id)) {
          this.pendingRequests.delete(envelope.id)
          reject(new Error('请求超时'))
        }
      }, 10000) // 10秒超时

      this.send(envelope)
    })
  }

  async sendStream(
    targetId: string,
    data: Uint8Array,
    contentType: string = 'audio/wav',
    traceId?: string
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error('未连接到网关')
    }

    const envelope: Envelope = {
      id: this.generateId(),
      sourceId: this.deviceId,
      targetId: targetId,
      timestamp: Date.now(),
      traceId: traceId || this.generateId(),
      stream: {
        streamId: this.generateId(),
        data: data,
        isEnd: true, // 暂时假设为一次性传输
        contentType: contentType
      },
      request: undefined,
      hello: undefined,
      heartbeat: undefined,
      register: undefined,
      response: undefined
    }

    this.send(envelope)
  }

  async connect() {
    this.shouldReconnect = true
    this.url = this.resolveUrl()

    // 尝试获取令牌
    try {
      const token = await this.resolveGatewayToken()
      if (token) {
        this.token = token
        logToMain(`使用 Gateway 令牌: ${token.substring(0, 8)}...`)
      } else {
        logToMain('警告: 收到空令牌，稍后重试 Gateway 连接')
        setTimeout(() => this.connect(), this.reconnectInterval)
        return
      }
    } catch (e: any) {
      logToMain(`获取令牌失败: ${e?.message || e}`)
      setTimeout(() => this.connect(), this.reconnectInterval)
      return
    }

    logToMain(`正在连接到 Gateway: ${this.url}...`)
    try {
      this.ws = new WebSocket(this.url)
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        logToMain('已连接到 Gateway')
        this.isConnected = true
        this.sendHello()
        this.startHeartbeat()
      }

      this.ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            // 通常 Gateway 发送二进制数据。
            logToMain(`收到意外的文本帧: ${event.data.substring(0, 50)}...`)
            return
          }

          const data = new Uint8Array(event.data as ArrayBuffer)
          if (data.length === 0) {
            logToMain('收到空二进制消息')
            return
          }

          try {
            const envelope = Envelope.decode(data)
            this.handleMessage(envelope)
          } catch (decodeErr: any) {
            logToMain(
              `解码 Protobuf 消息失败 (长度=${data.length}): ${decodeErr.message || decodeErr}`
            )
          }
        } catch (e: any) {
          logToMain('处理消息时出错', e.message || e)
        }
      }

      this.ws.onclose = () => {
        // 仅在之前实际连接过的情况下记录“已断开连接”
        // 这避免了在后端尚未准备好的启动期间刷屏
        if (this.isConnected) {
          logToMain('已从 Gateway 断开连接')
        }
        this.isConnected = false
        this.stopHeartbeat()
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), this.reconnectInterval)
        }
      }

      this.ws.onerror = () => {
        // 仅在不在重连循环中时记录错误，以避免刷屏
        // logToMain('WebSocket 错误', error);
        this.ws?.close()
      }
    } catch (e) {
      logToMain('创建 WebSocket 失败', e)
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.stopHeartbeat()
    this.isConnected = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private sendHello() {
    const hello: Hello = {
      token: this.token,
      deviceName: '萌动链接：PeroperoChat！ 桌面端',
      clientVersion: '1.0.0',
      platform: 'windows',
      capabilities: ['audio.in', 'audio.out', 'screen.view', 'notification.push']
    }

    const envelope: Envelope = {
      id: this.generateId(),
      sourceId: this.deviceId,
      targetId: 'master',
      timestamp: Date.now(),
      traceId: this.generateId(),
      hello: hello,
      heartbeat: undefined,
      register: undefined,
      request: undefined,
      response: undefined,
      stream: undefined
    }

    this.send(envelope)
  }

  private startHeartbeat() {
    let seq = 0
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected) return

      const hb: Heartbeat = { seq: ++seq }
      const envelope: Envelope = {
        id: this.generateId(),
        sourceId: this.deviceId,
        targetId: 'master',
        timestamp: Date.now(),
        traceId: '',
        heartbeat: hb,
        hello: undefined,
        register: undefined,
        request: undefined,
        response: undefined,
        stream: undefined
      }
      this.send(envelope)
    }, 5000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  send(envelope: Envelope) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const data = Envelope.encode(envelope).finish()
      this.ws.send(data)
    } else {
      console.warn('WebSocket 未连接，无法发送消息。')
    }
  }

  private handleMessage(envelope: Envelope) {
    // 降级日志，不再发送到主进程终端
    console.debug('收到来自 ' + envelope.sourceId + ' 的信封')

    if (envelope.request) {
      // 服务器推送请求（例如 voice_update）
      this.emit('request', envelope.request)
      this.emit(`action:${envelope.request.actionName}`, envelope.request)
    }

    if (envelope.stream) {
      // 服务器推送流（音频）
      this.emit('stream', envelope.stream)
    }

    // 处理 ActionResponse
    if (envelope.response) {
      const resp = envelope.response
      const requestId = resp.requestId

      if (this.pendingRequests.has(requestId)) {
        const { resolve, reject, onProgress } = this.pendingRequests.get(requestId)!

        if (resp.status === 2) {
          // 部分响应（流式传输）
          if (onProgress) {
            onProgress(resp)
          }
        } else if (resp.status === 0) {
          // 最终成功响应
          this.pendingRequests.delete(requestId)
          resolve(resp)
        } else {
          // 错误
          this.pendingRequests.delete(requestId)
          reject(new Error(resp.errorMsg || '后端未知错误'))
        }
      } else {
        logToMain('收到未知请求 ID 的响应: ' + requestId)
      }
    }
  }

  private generateId() {
    return Math.random().toString(36).substr(2, 9)
  }
}

export const gatewayClient = new GatewayClient()
