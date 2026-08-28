/**
 * collaboration — 客户端服务
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
export interface ArcaCollaborationTask {
  taskId: string
  documentId: string
  baseRevisionId: string
  instruction: string
  scope: 'selection' | 'section' | 'document'
  nodeId?: string
  agentId: string
  source?: 'local' | 'kernel'
  resultText?: string
  status:
    | 'queued'
    | 'working'
    | 'completed'
    | 'awaiting_review'
    | 'committed'
    | 'rejected'
    | 'failed'
    | 'cancelled'
  progress: number | null
  stage: string | null
  changeSetId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

function resolveKernelOrigin(): string | undefined {
  const raw = new URLSearchParams(window.location.search).get('kernelOrigin')
  if (!raw) return window.location.protocol.startsWith('http') ? window.location.origin : undefined
  const origin = new URL(raw).origin
  const url = new URL(origin)
  if (
    url.origin !== window.location.origin &&
    !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  ) {
    return undefined
  }
  return origin
}

class ArcaCollaborationClient {
  private readonly origin = resolveKernelOrigin()

  available(): boolean {
    return Boolean(this.origin)
  }

  async status(): Promise<{ available: boolean; agents: Array<{ id: string; name: string }> }> {
    return this.request('/status')
  }

  async create(input: {
    documentId: string
    instruction: string
    scope: 'selection' | 'section' | 'document'
    nodeId?: string
    agentId: string
    requirements?: string
  }): Promise<ArcaCollaborationTask> {
    return this.request('', { method: 'POST', body: JSON.stringify(input) })
  }

  async list(documentId: string): Promise<ArcaCollaborationTask[]> {
    return this.request(`?documentId=${encodeURIComponent(documentId)}`)
  }

  async cancel(taskId: string): Promise<ArcaCollaborationTask> {
    return this.request(`/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!this.origin) throw new Error('ARCA_KERNEL_UNAVAILABLE: 缺少Kernel连接地址')
    const response = await fetch(`${this.origin}/api/applications/arca/collaboration${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    })
    const body = (await response.json()) as { code: string; data?: T; message?: string }
    if (!response.ok || body.code !== 'OK') {
      throw new Error(body.message ?? `HTTP ${response.status}`)
    }
    return body.data as T
  }
}

export const arcaCollaborationClient = new ArcaCollaborationClient()
