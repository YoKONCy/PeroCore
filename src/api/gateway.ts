import { Envelope, Hello, Heartbeat, ActionRequest, ActionResponse } from './proto/perolink';
import { invoke } from '../utils/ipcAdapter';

const logToMain = (msg: string, ...args: any[]) => {
  const message = msg + (args.length ? ' ' + JSON.stringify(args) : '');
  console.log(msg, ...args);
  if ((window as any).electron) {
    (window as any).electron.send('log-from-renderer', message);
  }
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private url: string = 'ws://127.0.0.1:14747/ws';
  private reconnectInterval: number = 3000;
  private heartbeatInterval: any = null;
  private deviceId: string = 'electron-client-' + Math.random().toString(36).substr(2, 9);
  private isConnected: boolean = false;

  private pendingRequests: Map<string, { resolve: (data: any) => void, reject: (err: any) => void, onProgress?: (data: any) => void }> = new Map();
  private token: string = '';
  private listeners: Map<string, Function[]> = new Map();

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (!(window as any).electron) {
      // Browser mode: derive from current location
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${window.location.host}/gateway/ws`;
      console.log(`[Gateway] Using Browser URL: ${this.url}`);
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event)!;
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
    }
  }

  private emit(event: string, ...args: any[]) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(...args));
    }
  }

  setToken(token: string) {
    this.token = token;
    if (this.isConnected) {
      console.log('令牌已更新，正在重连...');
      this.ws?.close();
    }
  }

  async sendRequest(targetId: string, actionName: string, params: Record<string, string> = {}, onProgress?: (data: any) => void): Promise<ActionResponse> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('未连接到网关'));
        return;
      }

      const req: ActionRequest = {
        actionName: actionName,
        params: params
      };

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
      };

      // Store promise
      this.pendingRequests.set(envelope.id, { resolve, reject });
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(envelope.id)) {
          this.pendingRequests.delete(envelope.id);
          reject(new Error('请求超时'));
        }
      }, 10000); // 10s timeout

      this.send(envelope);
    });
  }

  async sendStream(targetId: string, data: Uint8Array, contentType: string = 'audio/wav', traceId?: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('未连接到网关');
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
        isEnd: true, // Assuming one-shot for now
        contentType: contentType
      },
      request: undefined,
      hello: undefined,
      heartbeat: undefined,
      register: undefined,
      response: undefined
    };

    this.send(envelope);
  }

  async connect() {
    // Try to get token
    try {
        const token = await invoke('get_gateway_token');
        if (token) {
            this.token = token;
            logToMain(`Using Gateway Token: ${token.substring(0, 8)}...`);
        } else {
            logToMain('Warning: Received empty token');
        }
    } catch (e) {
        logToMain('Failed to get token');
    }

    logToMain(`Connecting to Gateway at ${this.url}...`);
    try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
        logToMain('Connected to Gateway');
        this.isConnected = true;
        this.sendHello();
        this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
        try {
            const data = new Uint8Array(event.data as ArrayBuffer);
            const envelope = Envelope.decode(data);
            this.handleMessage(envelope);
        } catch (e) {
            logToMain('Failed to decode message', e);
        }
        };

        this.ws.onclose = () => {
        logToMain('Disconnected from Gateway');
        this.isConnected = false;
        this.stopHeartbeat();
        setTimeout(() => this.connect(), this.reconnectInterval);
        };

        this.ws.onerror = (error) => {
        logToMain('WebSocket Error', error);
        this.ws?.close();
        };
    } catch (e) {
        logToMain('Failed to create WebSocket', e);
    }
  }

  private sendHello() {
    const hello: Hello = {
      token: this.token,
      deviceName: 'PeroCore Desktop',
      clientVersion: '1.0.0',
      platform: 'windows',
      capabilities: ['audio.in', 'audio.out', 'screen.view', 'notification.push']
    };

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
    };

    this.send(envelope);
  }

  private startHeartbeat() {
    let seq = 0;
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected) return;
      
      const hb: Heartbeat = { seq: ++seq };
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
      };
      this.send(envelope);
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(envelope: Envelope) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const data = Envelope.encode(envelope).finish();
      this.ws.send(data);
    } else {
      console.warn('WebSocket 未连接，无法发送消息。');
    }
  }

  private handleMessage(envelope: Envelope) {
    logToMain('Received envelope from ' + envelope.sourceId);

    if (envelope.request) {
        // Server pushed request (e.g. voice_update)
        this.emit('request', envelope.request);
        this.emit(`action:${envelope.request.actionName}`, envelope.request);
    }
    
    if (envelope.stream) {
        // Server pushed stream (audio)
        this.emit('stream', envelope.stream);
    }

    // Handle ActionResponse
    if (envelope.response) {
      const resp = envelope.response;
      const requestId = resp.requestId;
      
      if (this.pendingRequests.has(requestId)) {
        const { resolve, reject, onProgress } = this.pendingRequests.get(requestId)!;
        
        if (resp.status === 2) {
            // Partial response (Streaming)
            if (onProgress) {
                onProgress(resp);
            }
        } else if (resp.status === 0) {
          // Final success response
          this.pendingRequests.delete(requestId);
          resolve(resp);
        } else {
          // Error
          this.pendingRequests.delete(requestId);
          reject(new Error(resp.errorMsg || '后端未知错误'));
        }
      } else {
        logToMain('收到未知请求 ID 的响应: ' + requestId);
      }
    }
  }

  private generateId() {
    return Math.random().toString(36).substr(2, 9);
  }
}

export const gatewayClient = new GatewayClient();
