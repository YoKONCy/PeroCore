/**
 * Transport 层 — 前端通信抽象
 *
 * 核心设计：前端代码 **0 个 Electron 依赖**。
 * 通过 Transport 接口隔离 Electron IPC 和 HTTP。
 *
 * - Docker/Web 模式 → HttpTransport (纯 fetch)
 * - Electron 模式   → ElectronTransport (API 走 HTTP, 系统能力走 IPC)
 *
 */

import type { ApiResponse } from '@perocore/shared'

// ─────────────────────────────────────────────
// Transport 接口
// ─────────────────────────────────────────────

export interface Transport {
  /** HTTP API 请求 */
  request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>>
  /** 系统能力调用 (Electron IPC / HTTP 替代) */
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
}

// ─────────────────────────────────────────────
// Docker / 纯 Web 模式
// ─────────────────────────────────────────────

class HttpTransport implements Transport {
  constructor(private baseUrl: string) {}

  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!res.ok) {
      // 服务端返回了 HTTP 错误但仍有 JSON body
      const body = await res.json().catch(() => ({
        code: 'NETWORK_ERROR',
        message: `HTTP ${res.status} ${res.statusText}`,
      }))
      return body as ApiResponse<T>
    }

    return res.json()
  }

  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    // 无 Electron 时，走 HTTP 替代
    const res = await fetch(`${this.baseUrl}/api/ipc/${channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    const body = await res.json()
    return body.data as T
  }
}

// ─────────────────────────────────────────────
// Electron 模式
// ─────────────────────────────────────────────

class ElectronTransport implements Transport {
  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    // 业务 API 照样走 HTTP (localhost:9120)
    const res = await fetch(`http://localhost:9120/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!res.ok) {
      // 与 HttpTransport 一致的错误降级处理
      const body = await res.json().catch(() => ({
        code: 'NETWORK_ERROR',
        message: `HTTP ${res.status} ${res.statusText}`,
      }))
      return body as ApiResponse<T>
    }

    return res.json()
  }

  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    // Electron 专属能力走 IPC
    return (window as any).electron.invoke(channel, ...args)
  }
}

// ─────────────────────────────────────────────
// 自动选择
// ─────────────────────────────────────────────

/** 当前 Transport 实例 (单例) */
export const transport: Transport = (window as any).electron
  ? new ElectronTransport()
  : new HttpTransport(window.location.origin)
